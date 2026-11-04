# Council Chat status (updated 2026-11-05, autonomous overnight run)

Branch: `feat/council-chat` (private fork). All items below are committed and pushed; tests: 47 council vitest, `regress.mjs` (UI smoke) and `e2e-orchestrator.mjs` (live vendors) pass.

## Built

- Run timeline per round (duration, fallback used).
- Shared brief per room (injected into prompts as delimited context).
- Seat roles: researcher, builder, critic, synthesizer, **orchestrator** (stored as role `moderator`).
- Orchestrator: one per room; after ask/discuss it posts agreement, disagreement, recommendation and next question; the backup model answers if the primary fails. Default: GPT-OSS 120B with Nemotron 3 Nano Omni 30B as backup (and the reverse for Nemotron).
- Export: Pandoc DOCX/PPTX with branded reference templates; PPTX is condensed to a short deck by the orchestrator first (falls back to the original text and logs why).
- Approval gate: optional "Ask before downloading exports".
- Artifacts panel with versions (issue documents).
- Security hardening: board-only routes, 8-seat cap, export SSRF/size guards, untrusted-data delimiters.
- UI/UX: chat-first layout, sticky composer, Room tools row, collapsed vendor settings, design-token clean, mobile layout, stale-room race fixes.

## Known gaps / decisions for Ben

- Pandoc must be installed on VPS2 / any deployment host (`PANDOC_PATH`).
- Dashboard onboarding is disabled on this fork (earlier commit); likely upstream merge conflict.
- Mobile: thread is short (~130px) because the composer takes most of the viewport.
- Open decisions: cloud-doc toggle, default writer seat, template/logo needs, reviewer file visibility, local-first vs cloud.
- "Clear Chat" races are only guarded in the UI (no server-side round fencing).
