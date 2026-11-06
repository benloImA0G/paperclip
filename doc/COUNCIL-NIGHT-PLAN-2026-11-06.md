# Council Chat night shift plan (2026-11-06, 6 hours, until 6am)

Agreed with Ben 2026-11-06. Focus: functionality (UX), not visual UI. Goal: several agents from several
vendors work together towards a goal, then carry out the work through tasks until a checked output.

## Run rules
- One long run until 6am: no stops, no gates. Blocked or approval-needing items go on the blocked list; work continues.
- Chair: Claude Sonnet 5.5 medium (Haiku 5.5 for checks). Codex pipe: gpt-6.1-terra (`cxw`), gpt-6-luna (`cx`), `cxs` for review.
- Split by files; Codex never commits. Claude reviews, tests, commits and pushes small slices to `feat/council-chat`
  (private fork), then `graphify update .`.
- Live tests use free vendors only. Work-step tasks are created as drafts for Ben's approval.
- Security rules unchanged: company isolation, no tools in council turns, no secrets in prompts/logs, deadlines and abort, bounded output.

## What already exists (do not rebuild)
Multi-vendor seats with fallbacks (max 8), Quick check (one-way blind), one-hop clarify in ask mode, discussion rounds
(collaborate / challenge, until agreement <= 3 with meter), speaking order (seat / random / reverse), 4 templates,
work sessions (chair plans 2-6 steps, seats run them, one-page summary, in memory only), action items -> tasks, Hermes agent seats.

## Slices
| Time | Claude pipe | Codex pipe |
|---|---|---|
| 0:00-1:00 | **Mode router**: classify the question (quick fact, decision, brainstorm, review, plan-and-do) -> mode, rounds and seats, with a one-line reason; Ben can override. New file `council-modes.ts` + route option | `cx`: fix the Ollama seat (172.25.240.1:11434, not 127.0.0.1); then tests for the router |
| 1:00-2:30 | **Anonymous peer ranking + jury round** (Karpathy council / judge panel) in the council engine | `cxw`: **random panels**: N seats at random, vendor diversity (no two from one vendor), random personas, answers labelled Seat A/B/C. New file `council-panel.ts` + tests |
| 2:30-3:30 | **Dissent check**: automatic devil's-advocate round when agreement is fast and confident | `cxw`: **clarify first** for work sessions: the chair asks Ben up to 3 questions before starting; seats may still ask during the work (`council-work.ts`) |
| 3:30-5:30 | **Goal -> tasks -> output**: persist work sessions (migration), each step optionally a draft Paperclip task, a checker grades each step against its expected output and retries a failed step once, final deliverable | Tests + e2e against free vendors |
| 5:30-6:00 | Full test pass, `COUNCIL-STATUS.md` update, morning summary | `cxs`: read-only review of the night's diff |

Stretch / fallback: if persistence (3:30-5:30) does not fit, it moves to the next shift and the morning summary says so.
UI changes only where a feature needs them (mode picker showing chosen mode and why, ranking/jury results, dissent result).

## Morning summary (written at 6am)
Done / partly done / blocked, commits pushed, tests run and results, decisions waiting for Ben.

## Running list (updated during the shift)
Claude weekly resets 01:00 WIB (Sat 2026-11-07); until then Claude does most of the work (Sonnet chair, Haiku checks). Codex jobs were meant to wait for the reset (launcher: ~/council-test/night-launch.sh); they were started a little early by mistake at 23:58 and are small.

**Done (pushed to feat/council-chat)**
- Mode router + /council/classify route + composer hint (suggested mode, reason, Plan first shortcut)
- Step checker with one retry in work sessions (checkSteps), grade shown per step
- Dissent check module + round option dissent + until-agreement debates run it and show the result
- Work session persistence (migration 0436 written, NOT applied to the dev database; no drizzle snapshot file yet)
- createTasks: one backlog draft task per step
- Anonymous peer ranking + jury helpers (council-ranking.ts), round option ranking, Peer ranking toggle

**Next**: random panels (council-panel.ts, Codex), clarify-first for work sessions (council-clarify.ts, Codex) then wire both, engine tests (Codex), Ollama seat investigation (Codex), jury round in engine, UI to start work sessions with createTasks, status doc.

**Blocked / waiting for Ben**: apply migration 0436 to the dev DB (and generate its snapshot); Ollama seat needs a vendor connection pointing at http://172.25.240.1:11434/v1.
