"""Recovery scanner persistence and delivery tests with isolated paths and clock."""
import copy
import fcntl
import json
from pathlib import Path
import tempfile
import subprocess
import sys
import unittest
from scan import scan


class FakeApi:
    def __init__(self):
        self.prompts = []
        self.records = []
        self.items = [{'sessionId': 's', 'running': False}]
        self.runtime = {'running': False, 'pendingInput': [], 'queue': None}
        self.projections = {'kind': 'sequenced', 'asOfSeq': 7, 'values': {'inbox': {'next-turn': [], 'next-step': []},
            'automaticRecovery': {'humanSeq': 2, 'candidate': {'endingSeq': 7, 'time': 0, 'kind': 'interrupted'}}}}
        self.fail = False

    def call(self, method, args):
        if method == 'session/list': return {'items': self.items}
        if method == 'session/state': return self.runtime
        if method == 'session/projections': return self.projections
        if method == 'session/events': return {'records': self.records, 'hasMore': False}
        if method == 'session/prompt':
            self.prompts.append(copy.deepcopy(args['request']))
            if self.fail: raise TimeoutError('response lost')
            return {'accepted': True}
        raise AssertionError(method)


class ScannerTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.config = {'stateDir': self.directory.name, 'origin': 'http://127.0.0.1:1', 'maxAttempts': 3}
        self.api = FakeApi()
        self.now = 100

    def run_scan(self):
        return scan(self.config, self.api, lambda: self.now)

    def test_double_scan_restart_and_uncertain_acceptance_reuses_request(self):
        self.api.fail = True
        self.run_scan()
        self.assertEqual(len(self.api.prompts), 1)
        self.run_scan()
        self.assertEqual(len(self.api.prompts), 1)
        # A fresh call reconstructs state from disk; no process-local deduplication.
        self.now += 61
        self.api.fail = False
        self.run_scan()
        self.assertEqual(self.api.prompts[0], self.api.prompts[1])
        self.assertEqual(self.api.prompts[0]['content'], [])
        state = json.loads((Path(self.directory.name) / 'state.json').read_text())
        self.assertEqual(state['sessions']['s']['delivery']['status'], 'accepted')
        self.assertNotIn('completed', state['sessions']['s']['delivery'])

    def test_pending_running_protection_and_disabled(self):
        for runtime in [{'running': True, 'pendingInput': [], 'queue': []},
                        {'running': False, 'pendingInput': ['approval'], 'queue': []},
                        {'running': False, 'pendingInput': ['other'], 'queue': []}]:
            self.api.runtime = runtime
            self.run_scan()
        self.config['enabled'] = False
        self.assertEqual(self.run_scan(), [{'reason': 'disabled'}])
        self.assertEqual(self.api.prompts, [])

    def test_existing_queue_requests_native_wake_without_extra_content(self):
        self.api.runtime['queue'] = [{'id': 'original'}]
        self.api.projections['values']['inbox']['next-turn'] = [{'id': 'original'}]
        self.run_scan()
        self.assertEqual(len(self.api.prompts), 1)
        self.assertEqual(self.api.prompts[0]['content'], [])
        request_id = self.api.prompts[0]['requestId']
        self.api.records = [
            {'event': {'seq': 8, 'type': 'recovery/queued', 'data': {'requestId': request_id}}},
            {'event': {'seq': 9, 'type': 'turn/start', 'data': {}}},
            {'event': {'seq': 10, 'type': 'turn/end', 'data': {'reason': {'kind': 'completed'}}}}]
        self.api.projections['values']['automaticRecovery']['candidate'] = None
        self.api.projections['values']['automaticRecovery']['humanSeq'] = 9
        rows = self.run_scan()
        self.assertTrue(any(row['reason'] == 'execution-observed' and row['ending'] == 'completed' for row in rows))
        self.assertEqual(len(self.api.prompts), 1)

    def test_cross_process_lock_and_durable_restart(self):
        lock_path = str(Path(self.directory.name) / 'scan.lock')
        code = "import fcntl,sys;f=open(sys.argv[1],'a');fcntl.flock(f,fcntl.LOCK_EX);print('locked',flush=True);sys.stdin.read(1)"
        process = subprocess.Popen([sys.executable, '-c', code, lock_path], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(process.stdout.readline().strip(), 'locked')
            self.assertEqual(self.run_scan(), [{'reason': 'scanner-locked'}])
        finally:
            process.communicate('x', timeout=10)
        self.assertEqual(process.returncode, 0)
        self.run_scan()
        code = "import json,sys;from test_scan import FakeApi;from scan import scan;a=FakeApi();scan(json.loads(sys.argv[1]),a,lambda:100);print(len(a.prompts))"
        completed = subprocess.run([sys.executable, '-c', code, json.dumps(self.config)], cwd=Path(__file__).parent,
            capture_output=True, text=True, check=True, timeout=10)
        self.assertEqual(completed.stdout.strip(), '0')

    def test_backoff_and_attempt_ceiling(self):
        self.api.fail = True
        for delta in [0, 61, 121, 241, 1000]:
            self.now += delta
            rows = self.run_scan()
        self.assertEqual(len(self.api.prompts), 3)
        self.assertTrue(any(row['reason'] == 'attempt-limit' for row in rows))
        self.assertEqual(len({row['requestId'] for row in self.api.prompts}), 1)

    def test_backoff_delay_saturates_at_configured_cap(self):
        self.config.update(cooldownSeconds=1, maxBackoffSeconds=2, maxAttempts=5)
        self.api.fail = True
        for attempt, delta in enumerate([0, 1, 2, 2, 2], 1):
            self.now += delta
            self.run_scan()
            state = json.loads((Path(self.directory.name) / 'state.json').read_text())
            self.assertEqual(state['sessions']['s']['nextAt'] - self.now * 1000,
                min(2000, 1000 * 2 ** (attempt - 1)))
        self.assertEqual(len(self.api.prompts), 5)

    def test_locked_scanner_never_sends(self):
        with (Path(self.directory.name) / 'scan.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertEqual(self.run_scan(), [{'reason': 'scanner-locked'}])
        self.assertEqual(self.api.prompts, [])

    def test_observation_requires_matching_input_then_new_turn_end(self):
        self.run_scan()
        request_id = self.api.prompts[0]['requestId']
        self.now += 61
        self.api.records = [{'event': {'seq': 8, 'type': 'turn/start', 'data': {}}},
            {'event': {'seq': 9, 'type': 'user/message', 'data': {'source': {'kind': 'retry', 'rpcId': request_id}}}},
            {'event': {'seq': 10, 'type': 'turn/end', 'data': {'reason': {'kind': 'completed'}}}}]
        self.api.projections['values']['automaticRecovery']['candidate'] = None
        rows = self.run_scan()
        observed = next(row for row in rows if row['reason'] == 'execution-observed')
        self.assertEqual(observed['ending'], 'completed')
        self.assertEqual(len(self.api.prompts), 1)

    def test_missing_eligibility_and_current_api_never_sends(self):
        self.api.projections['values']['automaticRecovery']['candidate'] = None
        self.run_scan()
        del self.api.projections['values']['automaticRecovery']
        self.run_scan()
        self.assertEqual(self.api.prompts, [])

    def test_origin_mismatch_preserves_existing_state(self):
        self.run_scan()
        self.config['origin'] = 'https://different.example'
        with self.assertRaisesRegex(ValueError, 'another origin'):
            self.run_scan()


if __name__ == '__main__':
    unittest.main()
