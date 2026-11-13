# Council Action Policy

Code, not a model or prompt wording, decides how much approval a council action needs.
This avoids approval fatigue: only risky actions interrupt the owner.

Source: `server/src/services/council-action-policy.ts`, function `classifyCouncilAction(action)`.

## Tiers

| Tier | Name | Decision | What happens |
| --- | --- | --- | --- |
| 0 | read | run | Runs, logged only |
| 1 | reversible | run_notify | Runs, owner is notified, undo offered |
| 2 | approve | needs_approval | Waits for the owner's approval |
| 3 | blocked | blocked | Never allowed, no approval path |

## Known kinds

| Kind | Tier |
| --- | --- |
| search, summarize, read_document | 0 |
| create_draft_task, save_artifact_version, add_room_comment, export_file | 1 |
| send_message_external, publish, spend_above_cap, delete, assign_agent_task, call_paid_model | 2 |
| change_permissions, change_budget, edit_policy, access_secrets, disable_logging | 3 |

Unknown kinds default to tier 2 (fail closed).

## Modifiers can only raise a tier

- `external: true` -> at least tier 2
- `reversible: false` -> at least tier 2
- `estimatedCostCents` above `COUNCIL_ACTION_COST_CAP_CENTS` (default 0, so any paid call) -> at least tier 2
- `dataClass: "restricted"` with `targetsCloud: true` -> tier 3

A modifier never lowers a tier, so a blocked kind stays blocked whatever flags are set.
`listCouncilActionKinds()` returns the table for a future settings screen.

## Not wired yet

Nothing calls this module yet. Wiring it into task creation, exports and agent seats is the
next step and needs Ben's go.
