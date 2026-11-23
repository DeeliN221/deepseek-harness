"""One bounded recovery scan, launched by the existing script scheduler (POSIX)."""
import argparse
import fcntl
import hashlib
import http.cookiejar
import urllib.parse
import json
import os
from pathlib import Path
import time
import urllib.request
import urllib.error
import uuid


def save(path, value):
    """Publish state durably; a failed publication prevents prompt delivery."""
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    with temporary.open('x', encoding='utf-8') as stream:
        os.chmod(temporary, 0o600)
        json.dump(value, stream)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    descriptor = os.open(str(path.parent), os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


class Api:
    """Use the normal authenticated Remote gateway without alternate session writes."""
    def __init__(self, config):
        self.origin = config['origin'].rstrip('/')
        if not self.origin.startswith(('https://', 'http://127.0.0.1:', 'http://localhost:')):
            raise ValueError('origin requires HTTPS or loopback HTTP')
        self.token = Path(config['tokenFile']).read_text().strip()
        if not self.token:
            raise ValueError('empty token file')
        self.timeout = config.get('requestTimeoutSeconds', 10)
        self.jar = http.cookiejar.CookieJar()
        self.client = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(self.jar), NoRedirect())
        self.bearer = config.get('authentication') == 'bearer'
        if not self.bearer:
            token = self.token
            if token.startswith(('http://', 'https://')):
                parsed = urllib.parse.urlsplit(token)
                if parsed.scheme + '://' + parsed.netloc != self.origin or parsed.path != '/':
                    raise ValueError('bootstrap URL does not match configured origin')
                token = urllib.parse.parse_qs(parsed.query).get('token', [''])[0]
            try:
                with self.client.open(self.origin + '/?token=' + urllib.parse.quote(token, safe=''), timeout=self.timeout) as response:
                    response.read(1)
            except urllib.error.HTTPError as error:
                if error.code not in (302, 303) or error.headers.get('Location') not in ('/', './'):
                    raise ValueError('bootstrap authentication failed') from None
            if not list(self.jar):
                raise ValueError('bootstrap did not issue an authentication cookie')

    def call(self, method, args):
        body = {'type': 'client-request', 'rpcId': str(uuid.uuid4()), 'method': method, 'payload': {'args': args}}
        request = urllib.request.Request(self.origin + '/api/' + method, data=json.dumps(body).encode(),
            headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + self.token} if self.bearer else {})})
        with self.client.open(request, timeout=self.timeout) as response:
            raw = response.read(24 * 1024 * 1024 + 1)
        if len(raw) > 24 * 1024 * 1024:
            raise ValueError('response too large')
        result = json.loads(raw)['result']
        if result.get('ok') is not True:
            # Do not retain provider messages or credential-bearing request diagnostics.
            raise ValueError('remote:' + str(result.get('error', {}).get('code', 'unknown'))[:160])
        return result['value']


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Keep authorization on the explicitly configured origin."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def scan(config, api, clock=time.time):
    """Serialize scanners, persist intent before send, and observe durable execution after acceptance."""
    if config.get('enabled', True) is False:
        return [{'reason': 'disabled'}]
    directory = Path(config['stateDir']).expanduser().resolve()
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    state_path = directory / 'state.json'
    lock = (directory / 'scan.lock').open('a')
    os.chmod(directory / 'scan.lock', 0o600)
    try:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return [{'reason': 'scanner-locked'}]
        state = json.loads(state_path.read_text()) if state_path.exists() else {'version': 1, 'sessions': {}}
        if state.get('version') != 1 or not isinstance(state.get('sessions'), dict):
            raise ValueError('invalid recovery state; reconcile before scanning')
        origin = config['origin'].rstrip('/')
        if state.get('origin', origin) != origin:
            raise ValueError('state belongs to another origin')
        state['origin'] = origin
        rows = []
        now = int(clock() * 1000)
        cooldown = config.get('cooldownSeconds', 60) * 1000
        maximum = config.get('maxAttempts', 5)
        cap = config.get('maxBackoffSeconds', 1800) * 1000
        if not (cooldown >= 1000 and 1 <= maximum <= 20 and cap >= cooldown):
            raise ValueError('invalid cooldown, backoff or attempt limit')

        def record(sid, reason, **details):
            row = {'at': now, 'sessionId': sid, 'reason': reason, **details}
            rows.append(row)
            with (directory / 'scans.jsonl').open('a', encoding='utf-8') as stream:
                os.chmod(directory / 'scans.jsonl', 0o600)
                stream.write(json.dumps(row) + '\n')

        items = api.call('session/list', {'_request': {}})['items']
        for item in items[:config.get('maxSessions', 2000)]:
            sid = item['sessionId']
            try:
                if item.get('origin') == 'subagent' or item.get('running'):
                    record(sid, 'subagent' if item.get('origin') == 'subagent' else 'running')
                    continue
                if config.get('sessionIds') and sid not in config['sessionIds']:
                    record(sid, 'outside-session-scope')
                    continue
                runtime = api.call('session/state', {'request': {'sessionId': sid}})
                if runtime['running'] or runtime['pendingInput']:
                    record(sid, 'running-or-pending-input')
                    continue
                baseline = api.call('session/projections', {'request': {'sessionId': sid}})
                if baseline is None or baseline.get('kind') != 'sequenced':
                    record(sid, 'unavailable-current-projections')
                    continue
                values = baseline['values']
                recovery = values.get('automaticRecovery')
                inbox = values.get('inbox')
                if recovery is None or inbox is None:
                    record(sid, 'recovery-api-unavailable')
                    continue
                prior = state['sessions'].get(sid)
                if prior:
                    entry = prior.get('delivery')
                    if entry and not entry.get('settled'):
                        page = api.call('session/events', {'request': {'address': {'kind': 'session', 'sessionId': sid},
                            'throughSeq': baseline['asOfSeq'], 'maxEvents': 5000, 'maxMessages': 5000}})
                        events = [record.get('event', record) for record in page['records']]
                        anchor = next((event for event in events if
                            (event['type'] == 'user/message' and event['data'].get('source', {}).get('rpcId') == entry['requestId'])
                            or (event['type'] == 'recovery/queued' and event['data'].get('requestId') == entry['requestId'])), None)
                        start = None if anchor is None else anchor['seq']
                        if anchor is not None and anchor['type'] == 'recovery/queued':
                            start = next((event['seq'] for event in events if event['seq'] > anchor['seq']
                                and event['type'] == 'turn/start'), None)
                        if start is not None:
                            entry['observedStart'] = start
                            observed = [event for event in events if event['seq'] >= start]
                            end = next((event for event in observed if event['type'] == 'turn/end'), None)
                            record(sid, 'execution-observed', requestId=entry['requestId'], startSeq=start,
                                lastSeq=observed[-1]['seq'], ending=end['data']['reason']['kind'] if end else None)
                            if end:
                                entry['settled'] = True
                        elif page['hasMore']:
                            record(sid, 'observation-window-exceeded')
                            continue
                if prior is not None and prior['humanSeq'] != recovery['humanSeq']:
                    if prior.get('delivery') and not prior['delivery'].get('settled'):
                        record(sid, 'prior-delivery-unresolved')
                        continue
                    prior = None
                    state['sessions'].pop(sid)
                candidate = recovery['candidate']
                if candidate is None:
                    save(state_path, state)
                    record(sid, 'no-eligible-interruption')
                    continue
                if now - candidate['time'] < cooldown:
                    record(sid, 'cooldown')
                    continue
                if prior is None or prior['humanSeq'] != recovery['humanSeq']:
                    prior = {'humanSeq': recovery['humanSeq'], 'attempts': 0, 'nextAt': 0}
                    state['sessions'][sid] = prior
                entry = prior.get('delivery')
                if entry and entry.get('observedStart') is not None and not entry.get('settled'):
                    record(sid, 'prior-execution-unsettled')
                    continue
                if prior['attempts'] >= maximum or now < prior['nextAt']:
                    record(sid, 'attempt-limit' if prior['attempts'] >= maximum else 'backoff')
                    continue
                key = hashlib.sha256(json.dumps([sid, candidate['endingSeq']]).encode()).hexdigest()
                request_id = 'automatic-recovery-' + key
                if entry and not entry.get('settled') and entry['requestId'] != request_id:
                    record(sid, 'prior-delivery-unresolved')
                    continue
                if entry and entry.get('settled') and entry['requestId'] == request_id:
                    record(sid, 'interruption-already-recovered')
                    continue
                prior['attempts'] += 1
                prior['nextAt'] = now + min(cap, cooldown * 2 ** (prior['attempts'] - 1))
                prior['delivery'] = {'requestId': request_id, 'endingSeq': candidate['endingSeq'], 'status': 'sending'}
                save(state_path, state)
                result = api.call('session/prompt', {'request': {'sessionId': sid, 'requestId': request_id,
                    'mode': 'queue', 'content': [], 'recovery': {'endingSeq': candidate['endingSeq'], 'throughSeq': baseline['asOfSeq']}}})
                if result.get('accepted') is not True:
                    raise ValueError('missing acceptance')
                prior['delivery']['status'] = 'accepted'
                save(state_path, state)
                record(sid, 'accepted-awaiting-execution', requestId=request_id, endingSeq=candidate['endingSeq'])
            except Exception as error:
                # Preserve delivery intent on every uncertain outcome; a later scan uses the same request id.
                record(sid, 'scan-or-delivery-error', errorClass=type(error).__name__)
        save(state_path, state)
        record(None, 'scan-complete', sessions=len(items), scanned=min(len(items), config.get('maxSessions', 2000)))
        return rows
    finally:
        lock.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    arguments = parser.parse_args()
    configuration = json.loads(Path(arguments.config).read_text())
    print(json.dumps(scan(configuration, Api(configuration)), ensure_ascii=False))
