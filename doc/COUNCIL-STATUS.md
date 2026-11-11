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
- Not built (see `COUNCIL-PROPOSALS.md`): document upload and review, durable replayable runs, cheap-first spend estimates, guarded self-improvement proposals.
- Open decisions: cloud-doc toggle, default writer seat, template/logo needs, reviewer file visibility, local-first vs cloud.

## Added 2026-11-06 (daytime default stays one turn)
- Agreement in plain English: after an Until agreement debate (up to 3 rounds) the room shows a meter (label, percent, who agrees, concessions, open objections). Seats that skip the stance block are asked once for it.
- Work sessions: Plan first toggle, or Start the work after answers. The chair plans 2-6 steps, seats carry them out with live status, a one-page Work summary lands in the thread (Word/PowerPoint export works on it).
- Design and sources: doc/COUNCIL-DISCUSSION-DESIGN.md. Gaps: dissent-check round, work state is in memory (lost on server restart), Ollama connection points at 127.0.0.1 so it fails from WSL.

## Added 2026-11-07 (night shift)
- **Mode router**: `POST /companies/:id/council/classify` suggests a kind (quick fact, decision, brainstorm, review, plan-and-do) with mode, rounds, seat count and a one-line reason. Heuristic only (no model call, no cost). The composer shows "Suggested: ... because ..." and a Plan first shortcut. Ben decides; nothing is applied automatically.
- **Random panels**: round option `panel { size, seed }` answers with a random subset of seats, one per connection first, each with a persona (skeptic, pragmatist, risk officer, ...). The UI picks one seed per question so the same panel answers every round.
- **Blind peer ranking** (Karpathy-style): round option `ranking` (needs 3+ answers). Answers are relabelled Seat A/B/C, every non-moderator seat ranks them, Borda count, result shown as a line in the composer area.
- **Jury**: round option `jury`; the other seats vote pass / revise / fail on the best answer (the top-ranked one when ranking is on); majority wins, a tie means revise.
- **Dissent check**: round option `dissent` (used by Until agreement debates): when agreement came fast (80%+, nobody disagrees, at most half the rounds), one seat argues the other side; the result is shown after the meter.
- **Work sessions**: a checker (the chair) grades every step against its expected output and a failed step is retried once with the feedback; `createTasks` creates one backlog draft task per step under the room; the latest session per room is saved in `council_work_sessions` (migration 0436, applied automatically by the dev server) and survives restarts (a session still "running" after a restart shows as failed).
- Live-tested on the dev server with free vendors only (Groq, NVIDIA): panel of 3 from 4 seats, ranking with 3 judges, jury 2/2 pass, work session of 4 steps all graded pass, 4 draft tasks created, state reloaded after a restart.
- Tests: `cd server && PATH=/home/super/.nvm/versions/node/v22.23.1/bin:$PATH npx vitest run src/__tests__/council-` (Node 22 needed).
- Gaps: clarify-first questions before a work session, persisting the discussion kind on the room (classification is suggested but not stored), Ollama connection base URL (172.25.240.1 from WSL), no drizzle snapshot file for 0436, jury is not used inside work-step checking yet, only the latest work session per room is kept.

### Later the same night (2026-11-07)
- **Clarify first** for work sessions: with "Ask me first" the chair asks up to 3 short questions in a small form; answers are added to the goal (`clarifyFirst`, `answers`).
- **Parallel steps**: plan lines may end with `| after: 1,2`; steps whose dependencies are done run together (max 3 at once) and the panel shows "waits for step N".
- **Jury checks** (extra vendors grade each step, majority decides), **Final review** (the deliverable is checked against the goal and revised once), automatic summary if the chair cannot write one, rate-limit retry (a seat or work step waits briefly and retries once), a failed grade after the retry marks the step failed (session "partial").
- The deliverable is saved as the room artifact `council-output-work-deliverable` (review, export to Word/PowerPoint work on it).
- **Discussion kind** is stored on the room (auto-classified on the first round, editable in Room settings) and shown as a chip; **presets** (Blind best-of-N, Debate to agreement, Fresh angles, Get it done); the composer shows "About N model calls".
- Review fixes from a read-only Codex review: work state saved before and after the run and normalized after a restart, forged-delimiter protection (`council-untrusted.ts`), room-safe clarify form, stale classify guard, abortable backoff.
- Recipes: `doc/COUNCIL-RECIPES.md`. Live check: `python3 scripts/council-live-smoke.py [--full]` (also checked in the browser: hint, toggles, clarify form, grades, parallel steps).
- Known gaps: work sessions are not claimed across several server replicas (single dev server is fine); only the latest work session per room is kept; Groq's free tier rate-limits on tokens per minute when several seats share one model (the retry helps, fallbacks help more).

## Added 2026-11-11 (night shift)
- **Documents:** attach `.txt`, `.md`, `.markdown`, `.csv` or `.json` files to a room in **Room settings → Documents**. Seats read relevant parts as untrusted reference text with source markers. A room can have up to 5 documents, each up to 512 KB. The service is in `server/src/services/council-docs.ts` and is wired into `council-chat.ts`'s `runRound`.
- **Memory context:** shared memory is now ranked by relevance to the question, with pinned entries first. Previously, a full question could match nothing.
- **Known gaps:** DOCX, PDF and XLSX are not supported yet (milestone O4 in `COUNCIL-OUTPUTS-ROADMAP.md`).
