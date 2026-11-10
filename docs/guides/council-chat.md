# Council Chat: quick guide

Council is a chat room where several AI models (and agents) answer the same question, challenge each other, and turn the result into tasks. Open it from **Council** in the sidebar.

## 1. Get a team in one click

1. Pick a room (or press **+ New**).
2. A new room already gets one seat per connection. If a room has fewer than three seats, press **Add a free team**: it creates up to four seats from your free connections (quick vendors first, the slow local model last): a Chairman, a Builder, a Reviewer and a Contrarian. **Teams** saves the current seats under a name so you can reuse them in another room.
3. Press **Check seats**. Each seat shows green (works), amber (works only through a backup model, with the main model's problem in plain words), or red (needs attention). An agent seat is checked by reading its status; nothing is started. The dots on the seat chips remember the last check.

Want something else? Add a seat yourself and use **Start from a role** to fill in the role and persona. Presets: Chairman, Builder, Reviewer, Researcher, Context optimizer, Deep benchmark researcher, Contrarian, Architect, First-principles thinker, Executor, Outsider, Security reviewer.

Templates (the cards under **+ New**) set up a whole room at once: *Quick check*, *Balanced debate*, *Decision*, *Red-team*, *Blind best-of-N*, *Builder then reviewer* and *Research, build, review* (the last two rename seats to Researcher / Builder / Reviewer and switch the unused default seat off). Each template also sets the room's kind and remembers its answer style.

## 2. Ask

- Type a question and press **Send** (or Ctrl+Enter).
- **@Name** (or type @ and pick) asks just that seat: no debate or summary follows. **@all** asks everyone.
- While seats answer, the chips show who is still working and a status line counts the seats done; in "One after another" it names the seat answering now.
- The switch above the composer sets how seats answer: **Work together**, **Challenge each other**, or **One after another** (each seat sees the previous seat's answer and improves it).

## 3. Read the answers

Under each reply you see only what was measured: time, tokens in and out, and cost (**FREE (Local)** for local models, a price when known, nothing when unknown). Replies say **Not fact-checked** until a check is run. Time to first token is not measured, so it is not shown.

A banner warns when a prompt may be sent to a cloud provider.

If a seat fails, the message is plain words, never a URL or key. A thinking model that returns nothing is retried once with a bigger answer limit.

## 4. Branch, copy, export

- **Fork from here** on a reply copies the thread up to that point into a new room.
- **Ask again** re-asks that one seat the question that came before that reply (no duplicate message; the new reply says which question it answers). If the seat fails, a message says why.
- **Save as artifact** saves the reply in one click to this room's Artifacts.
- **More → Copy as Markdown** copies the whole conversation.
- Decisions can be saved as artifacts and exported.

## 5. From chat to real work

- A decision lists **Action items**. Pick an agent in the dropdown and press **Create task**: the task is created as *todo* for that agent, who starts on it. With no agent it goes to the backlog.
- **Start the work** runs a plan: seats do the steps, an optional jury checks each step, and tasks can be created from the steps.
- **Tasks from this room** appears above the message box once tasks exist: id, status, agent, and **Ask in room** to follow up. Items owned by you ("Needs you") are questions for you, not agent work. Agents marked error or paused cannot be assigned. Note: on this dev machine the idle `edge-*` agents need a gateway that is not reachable from the PC, so their runs fail; the Hermes test agent works through the fake gateway only.
- The work run says how it ended ("Finished: all 3 steps passed the check" or "Finished with problems ...") and its chat summary leads with the deliverable.

## 6. Settings (per room)

Three plain groups (**Who answers**, **How they talk**, **Safety and extras**) and a collapsed **Advanced options** section for the expert controls (jury, peer ranking, clarify, plan first, draft tasks, rounds, summary). The answer style is set by the three buttons above the message box. **Manage AI connections** opens the connections page. A seat's **Can see images** switch lets it receive attached pictures (tested with Gemini).

## Free models that worked (tested 2026-11-11)

Checked with **Check seats** on the free connections:

| Vendor | Worked (about seconds) | Did not work |
| --- | --- | --- |
| Groq | allam-2-7b (0.3), qwen/qwen3.8-27b (0.3), openai/gpt-oss-120b (0.7), openai/gpt-oss-20b (1.0) | none |
| Gemini | gemini-3.5-flash-lite (1.3) | preview / deep-research models: not enabled or rate limited |
| NVIDIA | nvidia/nemotron-3-nano-omni-30b-a3b-reasoning (1.6; a thinking model, so give it room for a longer answer) | most other listed models are refused on this connection |
| Ollama (local) | devstral-small-2:24b (20), gemma4:26b (37), gemma4:e4b (12-48) | gemma4:31b-cloud needs vendor credits |

A vendor's model list is not proof that a model is available: always press **Check seats** after adding a seat. Local models are slower and vary a lot between runs. `python3 scripts/council-model-matrix.py` repeats this test.

## Hermes as a seat

A Hermes agent (`hermes_gateway` adapter) can sit in a room as an orchestrator seat. Status on the dev machine (2026-11-11):

- The Council side works: the seat calls the adapter, **Check seats** reads the agent's status without starting a run, and plain-word errors appear when the gateway is down.
- The real Hermes is not running here: the `hermes` CLI is not installed in WSL and nothing listens on port 18642. The agent was pointed at the fake gateway for testing, so its saved `apiKey` is now a test value.
- To make it real: either run the repository's own container smoke (`scripts/smoke/hermes-gateway-e2e.sh`, it builds `docker/hermes-gateway-smoke`; it needs a model provider set through `HERMES_SMOKE_MODEL_PROVIDER`, `HERMES_SMOKE_MODEL_DEFAULT`, `HERMES_SMOKE_MODEL_BASE_URL` and the provider key in the environment), or install Hermes and start `hermes gateway run` with `API_SERVER_ENABLED=true` and an `API_SERVER_KEY`. Then set the agent's `apiBaseUrl` (the docs use port 8642; this agent used 18642) and put the same key in `apiKey`.
- `hermes-chief` is a placeholder (HTTP adapter to an unused address); fix or delete it.

## Testing it yourself

Scripts that exercise a running dev server using free vendors only:

```bash
python3 scripts/council-live-smoke.py --full     # panel, peer ranking, jury, work session
python3 scripts/council-live-new.py              # chain, reply metadata, plain errors, fork
python3 scripts/council-live-sweep.py            # every room endpoint
node scripts/hermes-fake-gateway.mjs --port 18642 --key <test-key>   # stand-in for a Hermes agent seat
```

The fake Hermes gateway lets you try a Hermes agent seat without the Hermes CLI: set the agent's `apiBaseUrl` to `http://127.0.0.1:18642/api` and its `apiKey` to the same test key.
