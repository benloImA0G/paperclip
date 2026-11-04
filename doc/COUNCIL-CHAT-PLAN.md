# Council Chat (multi-vendor war rooms) - design plan

Private fork feature. Goal: a "Council Chat" section like the OmniCouncil mockup (war rooms, vendor seats,
@mention routing, debate rounds, summary, archive) that reuses Paperclip tasks, identities and budgets.

## What Paperclip already gives us (found in code)
- AI connections (`server/src/routes/ai-connections.ts`, `packages/shared/src/ai-connections.ts`): providers
  anthropic/openai/openrouter/xai/github/google, PLUS custom routing (baseUrl + protocol chat + auth none).
  => NVIDIA NIM, Groq and Ollama (OpenAI-compatible endpoints) need NO new vendor client.
- `fast-response-provider.ts` `fastResponseModel()` / `runFastResponseProvider()`: one-shot model call via the
  Vercel AI SDK with usage receipts. Seats use this directly (no agent subprocess).
- Costs/budgets: `cost_events`, `budget_policies`, `budget-reservations.ts`, `budgets.ts`. Every seat turn is
  recorded and reserved against the budget of its identity.
- `board-chat.ts` + `ui/src/pages/BoardChat.tsx`: SSE streaming chat persisted to a standing issue. Pattern to copy.
- Issues/comments for durable threads; `IssueChatThread.tsx` and `ChatComposer.tsx` UI pieces.
- Agent-based seats (claude-local, codex-local, gemini-local, grok-local, opencode-local, hermes) can be added
  later as "agent seats" that run through the normal heartbeat path.

## Design
Room = one Paperclip issue (labelled `council`). Messages = issue comments (author = seat identity).
Seat = { name, persona, connectionId + model (fast-response style), or agentId (agent seat), muted, budget scope }.
Seats are Paperclip identities, so cost, budget caps and audit trail come for free.

Orchestrator (server service `council-chat.ts`, GroupChatManager pattern):
1. User posts message (optional @Seat / @Council tags; no tag = all active seats).
2. Round 1: selected seats answer in PARALLEL and blind (no peeking) - avoids copying.
3. Rounds 2..N (N = 1-3, default 1): each seat sees the thread and replies; prompt always includes
   "change your answer only for a concrete reason" (anti-conformity). Stop on max rounds, no new points,
   budget exhausted, or user Stop.
4. Optional Summary: one designated seat writes the unified answer and keeps the minority view.
5. Stream every turn over SSE (same event shape as board chat: start/status/chunk/done/error).
Guards: per-room and per-turn token caps, concurrency limit (like MAX_CONCURRENT_BOARD_CHATS), budget reservation
before each call, turn text is tagged/escaped (see serializeTurn) to prevent history injection.
No tools / no side effects in council turns; anything actionable becomes a normal Paperclip task for approval.

## Data
Prefer zero new tables for v1: room = issue, message = comment with metadata {seatId, round, kind}.
Add one small table `council_seats` (roomId, name, persona, connectionId, model, agentId, active, position)
and `council_settings` only if issue metadata is not enough. Migration via Drizzle (`packages/db`).

## UI (ui/src/pages/CouncilChat.tsx, sidebar entry "Council")
War room tabs + New War Room; vendor seat cards (active toggle, bot name, model picker, persona);
streaming thread with @mention highlighting; composer with tag chips and Discussion rounds control;
Summary, Archive, Delete, Clear. Model picker shows Rec/benchmark hints from a static JSON for now.

## Milestones
M0 run Paperclip locally (pnpm install, pnpm dev) and read doc/SPEC-implementation.md, rules/*.mdc.
M1 server: seats + room + single-round parallel replies, cost recorded. API tests.
M2 UI: war rooms + seat cards + streaming thread.
M3 rounds, @mentions, stop, summary, archive.
M4 connections for NVIDIA NIM / Groq / Gemini / Ollama (RTX 3090 over Tailscale); budgets per seat.
M5 deploy as 2nd instance on VPS2 (tailnet only), sync upstream periodically (`git fetch upstream`).

## Risks
Upstream is very active (13.9k files): keep changes in new files, minimal edits to shared routes/App.tsx.
Debate costs 3-6x tokens: default 1 round, hard budget caps. Check `rules/*.mdc` before editing matching paths.

## Takeaways from the OmniCouncil draft (Antigravity export)
Adopt (as behaviours, not code):
- Per-seat fallback chain: ordered list of {connection, model}; on 429/404/410/503 or timeout, try the next
  entry and record which one answered. Stored on the seat (`fallbacks` JSON).
- History auto-compaction: older turns shrink to a short digest (~160 chars each) once the thread exceeds a
  token budget; the last round stays verbatim. Done at prompt-build time; stored comments stay intact.
- Archive: freeze a room into a read-only archived state, with dedup by content hash so the same debate is not
  archived twice. Delete asks for confirmation. War-room numbering ("War Room 7") comes from a per-company
  counter, not from list length.
- Status endpoint: which seats/connections are reachable and which fallback tier is active.
Do NOT copy:
- SQLite storage (we use Paperclip issues/comments + Drizzle/Postgres).
- Hard-coded model names: take them from each providers

## Takeaways from the OmniCouncil draft (Antigravity export)
Adopt (as behaviours, not code):
- Per-seat fallback chain: ordered list of {connection, model}; on 429/404/410/503 or timeout, try the next
  entry and record which one answered. Stored on the seat (`fallbacks` JSON).
- History auto-compaction: older turns shrink to a short digest (~160 chars each) once the thread exceeds a
  token budget; the last round stays verbatim. Done at prompt-build time; stored comments stay intact.
- Archive: freeze a room into a read-only archived state, with dedup by content hash so the same debate is not
  archived twice. Delete asks for confirmation. War-room numbering ("War Room 7") comes from a per-company
  counter, not from list length.
- Status endpoint: which seats/connections are reachable and which fallback tier is active.

Do NOT copy:
- SQLite storage (we use Paperclip issues/comments + Drizzle/Postgres).
- Hard-coded model names: take them from each provider's model list and verify before use.
- Keys in app config: all keys go through Paperclip secrets / AI connections.
- Free-tier = unmetered: budgets and token caps still apply to zero-cost providers (Groq, NIM, Ollama).
