# Council Chat recipes: which settings for which job

Plain answers to "what do I switch on?". Everything here is optional; the default stays one turn (each seat answers once, then an optional summary).

| I want to... | Pattern it comes from | Switch on |
|---|---|---|
| A quick second opinion | One-way blind answers | Nothing (Quick check template). The composer hint says "quick fact" when it looks like this. |
| Pick between options | Debate (Du et al.), jury | Rounds: Until agreement. The dissent check runs by itself when agreement comes too easily. |
| The best of many answers | Karpathy "LLM Council" | **Peer ranking** (needs 3+ answers; answers are relabelled Seat A/B/C so nobody knows who wrote what). Add **Jury** to vote pass / revise / fail on the winner. |
| Different angles, not three copies of the same view | Mixture of agents | **Random panel** (2 to 6 seats, one per connection first, each with a persona such as skeptic or risk officer). |
| Catch groupthink | Devil's advocate | Dissent check (automatic after a fast agreement of 80%+ with nobody disagreeing). |
| Review something | Red team / critique | Red-team template, or Review and revise on an artifact. |
| Get a job done, not just an opinion | Manager and team (CrewAI, AutoGen, MetaGPT style) | **Plan first** (or "Start the work"): the chair plans 2 to 6 steps, seats carry them out, a checker grades each step and a failed step is retried once. Add **Ask me first** (the chair asks up to 3 questions), **Jury checks** (two more vendors grade each step) and **Draft tasks** (one backlog task per step for you to approve). |

## Notes
- The composer shows "Suggested: ..." from `POST /council/classify` (keywords only, no model call, free). You decide; nothing is applied automatically.
- Costs: each extra feature adds calls. Peer ranking adds one short call per judge seat, Jury adds one per other seat, Jury checks add two per step. Free vendors (Groq, NVIDIA, local Ollama) make these cheap; watch the Costs page for paid ones.
- Reasoning models may need a bigger answer budget: if a seat says "Empty answer", raise the token cap (judge calls already use 1000+).
- Council turns never get tools or a workspace; work-step tasks are drafts (backlog) until you approve them.
- Live check: `python3 scripts/council-live-smoke.py` runs a panel, ranking, jury and a work session against the local dev server.
