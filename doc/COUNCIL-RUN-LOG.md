# Council run log

Council run events persist an append-only, ordered stream for each run. The service
accepts `message`, `status`, `tool_call`, `artifact`, `evidence`, `approval_request`,
and `error` events. Payloads are redacted before storage and strings are limited to
4,000 characters. Concurrent sequence conflicts are retried once.

`listRunEvents` pages forward by sequence, with at most 500 events per page.
`replayRun` reads all pages and summarizes timestamps, the latest status, errors,
and pending approvals. Approval events use `approvalId`, or `gate` as a fallback,
to match a pending request with a later event whose state is no longer pending.
The service is not yet connected to Council execution or routes.
