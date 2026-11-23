# Automatic session recovery

English | [中文](README.zh.md)

This POSIX one-shot scanner continues eligible interrupted work through the authenticated `session/prompt` endpoint. Run it from the existing task-center cron service (which incorporates dsh-cron). It creates no timer or daemon.

## Operator setup

The core runtime must include the `automaticRecovery` projection and conditional prompt admission from this change. Deploy the matching core artifact before enabling the job. The scanner fails closed when that API is absent.

Copy `scan.py` to a persistent deployment directory. Copy `config.example.json` to a private runtime location and replace the origin, credential-file path and state directory with this deployment's values. Store the native authenticated launch URL in the private file selected by `tokenFile`; the launcher prints this URL but does not create that file. Its origin must match the configured local endpoint. It is exchanged for the normal signed authentication cookie. Deployments with an existing Bearer authentication provider may explicitly set `authentication` to `bearer` and point `tokenFile` at its private token. Credentials are never placed in argv or recorded in recovery logs. Keep configuration and credentials outside Git.

Run one scan with `python3 scan.py --config /path/to/config.json`. Install the argv job from `cron-job.example.json` in the existing scheduler's jobs list, using the actual deployed paths. The job is enabled by default and runs once per minute in UTC. Use the already-active task-center cron service and its existing jobs list; do not activate a separate dsh-cron bundle, daemon, or copy of the other jobs. Files on disk alone do not start scheduling. The NAS supervisor owns profile activation, final deployment and restart; this change does not modify a production profile.

## Safety and observation

The Host admits only empty retry inputs, at an unchanged Session event cut, while its maintenance reservation excludes an active driver. It never records a synthetic human instruction. Crash repair retains completed tool results; an unknown started-tool outcome blocks automatic recovery. Manual cancellation durably revokes recovery even while idle. Completed, blocked, forked, manually cancelled, approval/question activity, inactive goals, credential failures and invalid requests such as HTTP 422 are ineligible. Only structured TRANSPORT/TIMEOUT endings or native crash repair qualify. Active goals remain disarmed after restart; recovery does not authorize goal mutation or rearming.

The scanner skips running sessions, pending approval/login/question events and subagents. The Host also rejects live owned jobs. Eligible parked inbox input is resumed through `Agent.resumePending()` without changing the messages or appending another continuation; `recovery/queued` records and deduplicates that wake. It does not infer interruption from silence. The Host checks archive membership again at admission. A changed event cut rejects a new stale scan without sending model work; redelivery of an accepted request may re-drive its still-pending inbox after a crash, subject to all eligibility checks.

A kernel advisory lock serializes all scanners sharing the state directory and releases on process exit. Keep one shared state directory per target origin, on a local POSIX filesystem supporting flock and atomic rename. The Host's persistent request-id deduplication independently protects concurrent delivery or a lost response. The key is Session id plus interrupted ending seq; state is fsynced before delivery. Recovery waits 60 seconds, doubles delay up to 30 minutes, and permits five delivery attempts per human-input episode. Ambiguous sends consume budget and reuse the same request id. Fresh human input starts a new episode. `sessionIds` optionally restricts scans to an explicit list.

`state.json` records delivery intent and outcome. `scans.jsonl` records scans, skips, acceptance and matching later execution events. `accepted-awaiting-execution` is not completion: `execution-observed` identifies the matching retry input or queued-wake receipt, a subsequent turn, and its later ending. A bounded history window that cannot locate an unresolved delivery stops that episode for operator reconciliation. Preserve state during upgrades; deleting it resets the retry budget. The scanner does not edit Session files, permissions, goals, provider configuration or tool outcomes.

## Device scope

Each scanner targets exactly one configured origin and state directory. The NAS job scans the NAS Host only. Workers do not install task-center by default: remote recovery requires an explicit authenticated worker endpoint reachable through the existing bridge, with a separate scanner configuration and state directory. This change does not enable remote scanning or claim fleet coverage.

## Stop and rollback

Set the existing job's `enabled` to false to stop scheduled scans. Setting scanner configuration `enabled` to false also disables recovery. Neither action cancels already accepted work; stop that Session through the normal UI if needed. Keep `state.json` and the Session logs. Roll back the scanner artifact only after disabling its job. A core downgrade that cannot read the required recovery revocation event must refuse those logs; retain this core build or a successor when opening affected Sessions.

## Worker verification

`python3 -m unittest discover -s scripts/session-recovery -p 'test_*.py' -v` covers scanner persistence, response loss, lock contention, backoff and observation. `node scripts/session-recovery/acceptance.mjs` launches an isolated built Web profile with a deterministic external model, completes one tool effect, kills the process during its following model request, restarts it, runs the scanner, and checks recovery completion plus exactly one effect. It retains its private temporary evidence directory and stops its own Web process. Build the current core artifacts first. Production credentials and production services are not used. `RECOVERY_CASE=queue node scripts/session-recovery/acceptance.mjs` exercises a transport failure with an already-queued instruction, preserves its async-dispatch setting, and verifies zero appended retries.
