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

## Testing it yourself

Scripts that exercise a running dev server using free vendors only:

```bash
python3 scripts/council-live-smoke.py --full     # panel, peer ranking, jury, work session
python3 scripts/council-live-new.py              # chain, reply metadata, plain errors, fork
python3 scripts/council-live-sweep.py            # every room endpoint
node scripts/hermes-fake-gateway.mjs --port 18642 --key <test-key>   # stand-in for a Hermes agent seat
```

The fake Hermes gateway lets you try a Hermes agent seat without the Hermes CLI: set the agent's `apiBaseUrl` to `http://127.0.0.1:18642/api` and its `apiKey` to the same test key.
