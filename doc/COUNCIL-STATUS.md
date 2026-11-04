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

## Known gaps / decisions for Ben

- Pandoc must be installed on VPS2 / any deployment host (`PANDOC_PATH`).
- Dashboard onboarding is disabled on this fork (earlier commit) and shared issue comment metadata/validators gained optional Council fields: both are likely upstream merge conflicts.
- Mobile thread is still fairly short on small phones because of the composer.
- Not built (see `COUNCIL-PROPOSALS.md`): document upload and review, durable replayable runs, cheap-first spend estimates, guarded self-improvement proposals.
- Open decisions: cloud-doc toggle, default writer seat, template/logo needs, reviewer file visibility, local-first vs cloud.
