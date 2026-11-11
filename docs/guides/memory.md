# Memory

The **Memory** page (left panel, right under Inbox) is the team's shared notebook. People and agents save notes, decisions, preferences, lessons and links there, and every agent can reuse them.

## How it works

- **Kinds:** Fact, Decision, Preference, Reference, Lesson.
- **Sources:** each entry can carry a source link and label, plus who wrote it and when.
- **Pinned:** pinned entries are given to agents first. Other approved entries are ranked by relevance to the question, so a full question can still find useful memory.
- **Filter and sort:** use tag filters to narrow the list, then sort entries to find the ones you need.
- **Related:** an entry's Related list shows connected memory entries.
- **Import:** import entries from JSON or Markdown. Imported entries arrive as *Waiting for approval* until approved, and duplicates are skipped. Imports are limited to 100 entries.
- **Approval:** entries written by an agent or from a Council reply start as *Waiting for approval*. They are never given to agents until a person approves them. This stops outside text or a confused agent from quietly writing instructions into shared memory.
- **Withdraw, never delete:** a withdrawn entry disappears from every agent but stays in the list ("Show withdrawn") and can be restored.
- **Export as Markdown:** one click gives a portable copy of every active entry.
- **Council:** every seat reply has *Save to memory*, and each round gives the seats the matching approved entries, labelled as reference only.

API: `GET/POST /companies/:id/memory`, `PATCH /memory/:id`, `POST /memory/:id/withdraw|restore|approve`, `GET /memory/context?query=`, `GET /memory/export`.

## What the benchmark showed (Nov 2026)

Patterns that worked across Mem0, Zep/Graphiti, Letta, Basic Memory, Claude Code memory, Cursor rules and GBrain:
plain-text entries with a source on each, typed entries, human-editable, keyword search first and semantic later, correction by withdrawing or superseding instead of overwriting, pinning for always-on items, scoping per team. Pitfalls: stale facts, loading everything every time (prompt bloat), no sources, and agents writing into shared memory unchecked. v1 covers all of these except semantic search and supersede-with-history.

## GBrain vs Graphify

- **Graphify** maps the *code*: files, functions and how they connect (built from the syntax tree, no model cost). Use it to answer "where is X and what depends on it".
- **GBrain** (github.com/garrytan/gbrain) is a *knowledge memory* for agents: Markdown pages with sources, a self-linking graph of people, companies and events, hybrid keyword + semantic search on Postgres. Use it for "what did we decide and why".
- They complement each other: code questions go to Graphify, decisions and references go to Memory. We borrowed GBrain's ideas (sources, withdraw, pinning, keyword-first, Markdown export) rather than installing it, which would need Postgres/pgvector and a bun installer.

## Later ideas

Semantic search, supersede-with-history, typed links between entries, automatic extraction from finished Council rooms, per-room scope.
