# Council Chat: ranked next improvements

Note 2026-11-13: priorities are now tracked in `COUNCIL-ROADMAP.md`. This list is kept as background detail.

1. **Durable, replayable council runs with a real Stop button**
   - Why: makes war rooms trustworthy—Ben can see exactly what ran, recover after refresh/restart, and avoid duplicate or “ghost” vendor replies.
   - Effort: L
   - Risk: requires careful concurrency and company-scoped run ownership; must not duplicate provider spend.
   - Test: start a multi-seat round, refresh/restart during it, stop it, and verify one ordered run record, no post-stop persisted replies, correct costs, and replayable status/error history.

2. **Cheap-first “War Room modes” with a visible spend/time estimate**
   - Why: turns vendor choice from technical setup into a simple business decision: “Fast free check,” “Balanced debate,” or “Escalate for final decision.”
   - Effort: M
   - Risk: provider pricing/availability can be incomplete; estimates must be labeled estimates and never weaken budget enforcement.
   - Test: select each mode and confirm its seat/model/fallback plan, projected request count and token cap; simulate a failed free seat and verify the declared fallback and budget block behavior.

3. **Structured decision record with evidence and dissent**
   - Why: converts discussion into an accountable outcome: recommendation, confidence, unresolved risks, named dissent, assumptions, owner, and next action—not merely a generic summary.
   - Effort: M
   - Risk: models can overstate consensus or invent support; claims must link only to actual seat replies and supplied sources.
   - Test: run a deliberately split council; verify the record names both sides, preserves dissent, links claims to message/source IDs, and cannot be marked final without Ben’s approval.

4. **Document upload and bounded multi-vendor review**
   - Why: lets Ben bring real proposals, client drafts, plans, and spreadsheets into the room—where Council becomes useful work, not just chat.
   - Effort: L
   - Risk: confidential data and hostile document content; cloud transmission must remain off by default, with strict parsing/token/file limits.
   - Test: upload Markdown, DOCX, PDF, PPTX, CSV, and XLSX fixtures; verify source citations, malformed/oversized rejection, cross-company isolation, and that cloud seats receive nothing until Ben explicitly approves the selected files/providers.

5. **Draft → critique → revise → approved export workflow**
   - Why: produces client-ready, versioned work with a clear human decision point, rather than one-off downloads that become impossible to trace or improve.
   - Effort: L
   - Risk: workflow complexity could make the UI feel heavy; retain a one-click “quick export” for casual use.
   - Test: create draft v1, collect two independent critiques, revise to v2, approve/export it, and confirm both source revisions and downloads remain available with their producing seat and approval history.

6. **One-screen guided room setup and reusable council templates**
   - Why: Ben should be able to start a useful room in under a minute without understanding models, personas, roles, fallbacks, or discussion-depth controls.
   - Effort: M
   - Risk: presets can hide important choices; show a compact “what will happen” preview and allow advanced editing.
   - Test: from a fresh company, launch “Decision,” “Red-team,” and “Document review” templates; verify each creates the intended cheap-first seats, roles, budget limits, and default output format.

7. **Per-room reliability and value scorecard**
   - Why: makes it obvious whether Council is earning its cost: vendor success rate, fallback rate, latency, actual spend, consensus rate, and whether Ben accepted the recommendation.
   - Effort: M
   - Risk: metrics may encourage simplistic vendor rankings; label low-sample results and keep them advisory.
   - Test: seed successful, failed, fallback, and budget-blocked runs; verify totals reconcile to cost events, filters are company/room scoped, and the UI highlights uncertainty for small samples.

8. **Simplified mobile-first conversation controls**
   - Why: the current composer/options area is dense and the documented mobile thread is short; a simpler “Ask / Debate / Summarize” flow improves adoption for a non-technical owner.
   - Effort: S
   - Risk: hiding advanced controls can frustrate power users; keep them behind an explicit “Customize” drawer.
   - Test: run responsive browser checks at common phone sizes; confirm the latest replies remain visible above the composer, one-tap actions work, keyboard navigation is intact, and advanced controls remain reachable.

# Self-improvement proposals — never auto-apply

1. **Weekly model-and-routing recommendation**
   - Study: compare each seat/model by success, fallback, latency, cost, usefulness signals, and unsupported-output failures.
   - Proposal: suggest cheaper defaults, fallback order changes, or retiring unreliable models.
   - Approval gate: show the evidence window, sample size, affected rooms, expected savings, and rollback plan; Ben must explicitly approve each seat/configuration change.

2. **Run-quality and prompt-template review**
   - Study: detect recurring ambiguity, repeated clarification loops, weak summaries, missing dissent, and recommendations later overridden by Ben.
   - Proposal: draft changes to room templates, summary instructions, or decision-record fields.
   - Approval gate: generate a side-by-side preview using anonymized/referenced historical runs; changes remain drafts until Ben approves a named template version.

3. **Safety, privacy, and cost anomaly review**
   - Study: flag unusual spend, repeated provider timeouts, unexpected fallback chains, document-sharing attempts, and unusually large context use.
   - Proposal: recommend tighter caps, a changed default mode, added confirmation, or a temporary provider pause.
   - Approval gate: anomalies may notify and optionally pause only under existing hard budget rules; every policy/configuration change requires Ben’s explicit approval and is logged with a reversible rollback action.
