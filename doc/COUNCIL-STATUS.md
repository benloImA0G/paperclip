# Council Chat status (updated 2026-11-05 05:10 WIB, autonomous overnight run)

Branch: `feat/council-chat` (private fork), everything below is committed and pushed.
Checks at this point: 73 council vitest tests; live suites in `~/council-test/codex`: `regress.mjs`, `e2e-orchestrator.mjs`, `e2e-templates.mjs`, `e2e-stop.mjs`, `e2e-review.mjs` (real free vendors); server/UI typechecks and `pnpm check:token-gates` clean. Live-model suites can be flaky; rerun once before assuming a regression.

## Built

- Run timeline per round: duration, fallback used, tokens, answering model; per-room Reliability summary (replies, average time, backup use).
- Shared brief per room (delimited, untrusted-context framing).
- Seat roles including **Orchestrator** (stored as role `moderator`): one per room; posts a decision card (recommendation, confidence, agreement, dissent, risks, next question) after ask/discuss rounds; the backup model answers if the primary fails. Default pair: GPT-OSS 120B and Nemotron 3 Nano Omni 30B back each other up.
- Room templates: Quick check, Balanced debate, Decision, Red-team (with call estimates).
- Exports: Pandoc DOCX/PPTX with branded templates; PPTX is condensed to a short deck by the orchestrator first (falls back to the original text and logs why); optional "Ask before downloading exports".
- Artifacts panel with versions, plus **Review & revise** (other seats critique, the orchestrator saves a new version; older versions kept; conflict check against manual edits).
- **Stop** a running round; one active round per room; Clear Chat fenced against in-flight rounds.
- Security: board-only routes, 8-seat cap, export SSRF/size guards, untrusted-data delimiters, forged-delimiter escaping.
- UI/UX: chat-first layout, sticky composer, Room tools row, collapsed vendor settings, mobile layout, design tokens, accessibility fixes, stale-room race fixes.

- Paperclip bridge (2026-11-05): Council spend card on the Costs page (GET /costs/council, no migration; calls already land in the cost ledger as fast_response with billingCode council:<room>); Create task button on decision cards and a Linked tasks panel in Room settings (normal manual tasks, linked through room references; rooms stay out of /tasks); Agents panel with Create agent. Staged plan for real agent seats and a Hermes orchestrator option: doc/COUNCIL-AGENTS-PLAN.md.
- Agent seats (2026-11-05): Hermes gateway agents can join a room as seats (max 3 per room) and can be the Orchestrator; if an agent orchestrator fails, a model seat takes over. Council turns use a one-shot service (`council-agent-turn.ts`) with a deadline, abort that also stops the remote Hermes run, secret redaction, no tools or workspace requested, and cost recording. Only `hermes_gateway` agents are allowed (local CLI adapters cannot be sandboxed here). Migration 0434 adds `seat_kind` and `agent_id` to `council_seats`. Not live-tested against a real Hermes gateway yet (no Hermes agent exists in the company); covered by mock and fake-gateway tests. Tool access is governed by the Hermes gateway toolsets: use a dedicated no-tools Hermes profile for council agents (see `COUNCIL-AGENTS-PLAN.md` Security).
- Hermes orchestrator seat is reachable locally via an ssh-stdio forwarder on `127.0.0.1:18642`, with a ready `hermes-orchestrator` agent (dev only).
- Speaking order for rounds: seat, random, or reverse; moderator last. In-round context is included for discussion turns (commit `972184282`).
- Discussion style per round: Collaborate (default) or Challenge each other (cited rebuttal, concede or hold).
- Decision cards now have an Action items section with per-item Create task, assignee select, Create selected, and agent names in Linked tasks.

## Known gaps / decisions for Ben

- Pandoc must be installed on VPS2 / any deployment host (`PANDOC_PATH`).
- Dashboard onboarding is disabled on this fork (earlier commit), shared issue comment metadata/validators gained optional Council fields, and migration 0434 plus a deleted old 0429 snapshot touch shared DB files: all likely upstream merge conflicts.
- Mobile thread is still fairly short on small phones because of the composer.
- 4 `council-stop.test.ts` tests fail at HEAD from stale mocks.
- Not built (see `COUNCIL-PROPOSALS.md`): document upload and review, durable replayable runs, cheap-first spend estimates, guarded self-improvement proposals.
- Open decisions: cloud-doc toggle, default writer seat, template/logo needs, reviewer file visibility, local-first vs cloud.
