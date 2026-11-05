# Council agents plan

Council agents will be delivered in small, reviewable stages.

## Stage 1: company agent panel

Add an Agents panel to the Council experience. It lists the current company's
Paperclip agents, links to their profiles, and opens the existing Create agent
flow. Agents cannot join war rooms yet; the panel states that clearly.

## Stage 2: council seat model

Add a database migration that extends `council_seats` with a nullable
`agent_id` and a `seat_kind` value of `model` or `agent`. Add a database CHECK
constraint so the seat shape remains valid for its kind.

## Stage 3: one agent turn

Add `council-agent-turn.ts` on the server. It runs one agent turn with no tools,
a hard deadline and abort support, checks budget admission before starting, and
records usage.

## Stage 4: orchestration source

Let the council orchestrator choose `{ source: model | agent }`. When an agent
source is unavailable or fails admission, the room falls back to the model
orchestrator.

## Stage 5: Hermes gateway qualification

Add a Hermes gateway qualification test using a fake `/v1/runs` endpoint, an
SSE response stream, and a `/stop` gateway endpoint.

## Security

- Council agents are Hermes-gateway only. Local CLI adapters are excluded because
  their local working directory, skills, home directory, and tool access cannot
  be safely disabled by the Council turn service.
- Tool access is governed by Hermes gateway toolsets. Council deployments must
  use a dedicated Council Hermes profile with no tools enabled.
- Council turns pass no workspace or runtime tools, force an ephemeral Hermes
  session scope, enforce a hard deadline, and propagate cancellation to the
  gateway's run stop endpoint after a run is created.
- Every string value of sufficient length in resolved adapter configuration and
  environment is redacted from returned output, adapter errors, and retained
  turn logs.
- Known limits: gateway-side tools and profile isolation remain the Hermes
  gateway operator's responsibility; process-local in-flight idempotency does
  not coordinate between server replicas; best-effort remote stop cannot prove
  a gateway has terminated a run when it is unreachable.

## Risks to address in every later stage

- Keep every seat, agent lookup, run, and usage record isolated to its company.
- Do not place secrets in prompts or logs.
- Treat prompt injection as especially risky before allowing tool-capable agents.
- Keep budget admission, deadlines, cancellation, and usage recording strict to prevent runaway spend.
