# Council Chat: quick guide

Council is a chat room where several AI models (and agents) answer the same question, challenge each other, and turn the result into tasks. Open it from **Council** in the sidebar.

## 1. Get a team in one click

1. Pick a room (or press **+ New**).
2. Press **Add a free team**. It creates up to four seats from your free connections (Groq, NVIDIA, Gemini, local Ollama): a Chairman, a Builder, a Reviewer and a Contrarian.
3. Press **Check seats** to see which seats answer right now. A red line tells you in plain words what to fix (wrong key, model not available, local server not running).

Want something else? Add a seat yourself and use **Start from a role** to fill in the role and persona. Presets: Chairman, Builder, Reviewer, Researcher, Context optimizer, Deep benchmark researcher, Contrarian, Architect, First-principles thinker, Executor, Outsider, Security reviewer.

Templates (Settings) set up a whole room at once, for example *Balanced debate*, *Decision*, *Red-team*, *Blind best-of-N* and *Research, build, review*.

## 2. Ask

- Type a question and press **Send** (or Ctrl+Enter).
- **@Name** asks just that seat. **@all** asks everyone.
- The switch above the composer sets how seats answer: **Work together**, **Challenge each other**, or **One after another** (each seat sees the previous seat's answer and improves it).

## 3. Read the answers

Under each reply you see only what was measured: time, tokens in and out, and cost (**FREE (Local)** for local models, a price when known, nothing when unknown). Replies say **Not fact-checked** until a check is run. Time to first token is not measured, so it is not shown.

A banner warns when a prompt may be sent to a cloud provider.

If a seat fails, the message is plain words, never a URL or key. A thinking model that returns nothing is retried once with a bigger answer limit.

## 4. Branch, copy, export

- **Fork from here** on a reply copies the thread up to that point into a new room.
- **More → Copy as Markdown** copies the whole conversation.
- Decisions can be saved as artifacts and exported.

## 5. From chat to real work

- A decision lists **Action items**. Pick an agent in the dropdown and press **Create task**: the task is created as *todo* for that agent, who starts on it. With no agent it goes to the backlog.
- **Start the work** runs a plan: seats do the steps, an optional jury checks each step, and tasks can be created from the steps.
- **Linked tasks** shows the tasks created from the room, with **Ask in room** to follow up.

## 6. Settings (per room)

Three groups, each control with a one-line description: **Who answers**, **How they talk**, **More**. **Manage AI connections** opens the connections page.

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
