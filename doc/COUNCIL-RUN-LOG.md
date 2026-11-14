# Council run log

Council run events persist an append-only, ordered stream for each run. The service
accepts `message`, `status`, `tool_call`, `artifact`, `evidence`, `approval_request`,
and `error` events. Payloads are redacted before storage and strings are limited to
4,000 characters. Concurrent sequence conflicts are retried once.

`listRunEvents` pages forward by sequence, with at most 500 events per page.
`replayRun` reads all pages and summarizes timestamps, the latest status, errors,
and pending approvals. Approval events use `approvalId`, or `gate` as a fallback,
to match a pending request with a later event whose state is no longer pending.
The service is not yet connected to Council execution.

## Read API

Board users can read a company run at `GET /companies/:companyId/council/runs/:runId/events`,
using `afterSequence` and `limit` (1–500) to page. `GET /companies/:companyId/council/runs/:runId/replay`
returns the replay summary. Runs with no events or events belonging to another company return 404.

## Recorder

`buildRoundEvents` maps a structural Council round to ordered run-log events.
`recordRound` appends those events sequentially and returns written and failed
counts; an individual append failure does not stop later appends. Approval
requests are recorded as pending. The recorder is not wired into execution yet.
