# Council outputs and document review roadmap

## Why this matters

Council Chat should end in work Ben can use, not only a good conversation. A room
should turn its agreed draft into a downloadable file, and every invited vendor
should be able to examine a document Ben supplies, point out problems, and help
improve it. The first useful result is dependable Markdown/text; Word and slides
follow when formatting matters. The same room remains the audit trail: source,
critiques, revisions, cost, and final download stay together.

## Most frequent jobs

| Rank | Ben's job | First useful output |
| --- | --- | --- |
| 1 | Ask for a proposal, plan, brief, or decision record | `.md` (and `.txt` when plain text is needed) |
| 2 | Ask one seat to turn the agreed proposal into a client-ready document | `.docx` |
| 3 | Ask for an executive summary or pitch of the discussion | `.pptx` |
| 4 | Upload a draft and ask every seat to find gaps, risks, and contradictions | In-thread critiques plus a revised source draft |
| 5 | Compare several uploaded files or versions and choose a recommendation | Cited comparison and an exported decision record |

## Chosen design

### Storage, sources, and downloads

- A Council room is already an issue. Reuse its company-scoped `issue_attachments`
  and `assets` rows and the configured local/S3 storage provider; do not create a
  Council-only bucket or write files to the server filesystem.
- Uploads and generated binaries become ordinary room attachments. Attach the
  generated file to the export comment, so the existing authenticated
  `/api/attachments/:id/content` path provides open/download behaviour. Also create
  an attachment-backed work product so it appears in the normal artifact surfaces.
- Keep the writer's editable canonical source in an issue document such as
  `council-output:<uuid>` (Markdown). Its existing document revisions are the
  durable source history. Add a small `council_outputs` table only in O5 to map a
  named output to its source-document key, writer seat, current exported attachment,
  format, and lifecycle; it must be company- and issue-scoped.
- Use a **dedicated Export action** as the authoritative operation. A writer may
  return a structured `council_output` proposal block (`title`, `markdown`,
  `suggestedFormat`) in its reply, but the server validates it, saves a revision,
  and generates bytes only after Ben selects **Save draft** or **Export**. Models
  never choose a storage key or write arbitrary bytes.
- The thread shows a compact draft/export card: title, writer, version, source
  revision, format, creation time, and Open/Download links. Re-exporting creates a
  new attachment and never overwrites an older download.

### Who writes and who reviews

1. Ben chooses a writer seat (default: the summary seat) and the requested format.
2. The writer prepares the canonical Markdown source; it does not manufacture a
   DOCX/PPTX directly in prose.
3. Other active seats receive that exact numbered draft and give independent,
   labeled critiques. The writer sees the critiques, revises, and creates the next
   document revision.
4. Export turns the selected revision into `.txt`, `.md`, `.docx`, or `.pptx`.
   The export comment links both the artifact and its source revision.

### Generation libraries: decision

`server/package.json` currently has `sharp`, but no `docx`, `pptxgenjs`,
`mammoth`, PDF, spreadsheet, ZIP/XML, or office-generation dependency. Keep the
implementation in the TypeScript server process; do not add a Python child process
or `python-pptx` runtime, which would add an unpinned host dependency, subprocess
security surface, and a second deployment toolchain.

| Need | Pick | Why |
| --- | --- | --- |
| Word export | `docx` | Node/TypeScript API; deterministic construction from canonical Markdown blocks; no external process. |
| PowerPoint export | `pptxgenjs` | Node/TypeScript API; supports simple, repeatable title/bullet/table layouts. |
| DOCX reading | `mammoth` | Extracts DOCX text without executing Office content. |
| PDF reading | `pdf-parse` | Server-side text extraction; gate by page/text limits. |
| PPTX reading | `jszip` + `fast-xml-parser` | Read only slide XML and notes; avoid rendering or executing embedded content. |
| XLSX reading | `xlsx` (SheetJS) | Read cell values/formulas as text with sheet/row/cell bounds. |

Start with deliberately modest templates: headings, paragraphs, bullets, tables,
and links for DOCX; title, section, bullets, and bounded tables for PPTX. Reject
unsupported rich Markdown with a clear warning rather than silently producing a
misleading file.

## Reading documents

### Upload and extraction path

- Add a Council paperclip/upload control that uses the existing
  `POST /companies/:companyId/issues/:issueId/attachments` flow. Display the
  attachment card in the room and let Ben select one or more files for a round.
- The server reads the authorized attachment stream, verifies MIME **and** filename
  extension/signature where feasible, extracts text into an in-memory bounded
  `CouncilDocumentContext`, then discards the buffer. Persist original bytes as the
  attachment; persist only extraction status, checksum, page/sheet/slide counts,
  and a bounded normalized-text cache if profiling shows re-extraction is costly.
- Extractors: TXT/MD/CSV as UTF-8 (reject invalid/oversized data); DOCX via
  Mammoth; PDF via `pdf-parse`; PPTX by ZIP/XML slide order plus speaker notes;
  XLSX via SheetJS values/formulas with sheet names; PNG/JPEG/WebP via an
  image-capable seat in a later phase. Never execute macros, formulas, embedded
  OLE objects, links, JavaScript, or HTML.

### Prompt context and limits

- Each chunk carries stable provenance: `[file: name | attachment: id | page/slide/sheet: N]`.
  Include the most relevant chunks first, then a capped remainder; ask seats to cite
  those markers. Do not send raw binary or a download URL to a vendor.
- Treat every extracted character as untrusted data, wrapped in `<document-data>`
  with a system instruction that it cannot change roles, tools, permissions, or
  export instructions. Keep it separate from the Council system prompt and preserve
  the existing tagged-turn escaping discipline.
- Initial caps: existing attachment ceiling (10 MB by default), at most 5 selected
  files/round, 2 MB extracted text/file, 200 pages PDF, 100 slides PPTX, 20 sheets
  and 10,000 populated XLSX rows, and 12,000 input tokens total/seat/round.
  Reserve/document input tokens before a call; truncate with an explicit notice.
  Free-tier seats get a lower configurable document-context cap (default 4,000
  tokens) rather than an unlimited resend of the files.
- Scanned PDFs and images are phase O6: first offer OCR/vision only to opted-in
  vision seats, send rendered pages at a bounded resolution/count, and state which
  pages were unreadable. No silent cloud upload.

## Privacy, safety, and cost controls

- Recheck room/company access before upload, extraction, generation, download, and
  prompt assembly. An attachment ID from another company must return not found.
- Allow only TXT, MD, DOCX, PPTX, PDF, XLSX, CSV, PNG, JPEG, and WebP for Council;
  reject macro-enabled Office types, archives, legacy Office binaries, SVG, HTML,
  executables, and audio until their dedicated phase.
- Enforce the existing size limit before parsing plus the extraction limits above;
  use timeouts, parser error isolation, decompression-ratio/file-count limits for
  ZIP-based Office files, and no network fetching while parsing.
- Default document sharing to **local/approved providers only**. A room-level,
  explicit “send document text to cloud seats” toggle is off; it names the seats and
  providers, is recorded in activity, and must be re-confirmed when the selected
  attachment set changes. Local Ollama counts as local only when its endpoint is
  operator-designated private.
- Apply existing Council admission, per-seat output caps, and cost events to review,
  revision, OCR, image, and audio calls. Add a per-room document-processing cap and
  stop the round before a provider call if either cap is exhausted.

## Milestones

| Milestone | Scope and likely files | Acceptance test | Effort |
| --- | --- | --- | --- |
| **O1 — text in/out** | TXT/MD upload via the existing issue-attachment route; selected text injected as bounded untrusted context; writer draft/save/export to TXT/MD. Touch `server/src/services/council-chat.ts`, `server/src/routes/council-chat.ts`, `ui/src/api/council.ts`, `ui/src/pages/Council.tsx`, targeted Council tests; reuse `issues` attachment APIs. | Upload `brief.md`; two seats cite it; save v1 and v2; download both `.md` and `.txt` and verify their bytes and company authorization. | 24–32 h |
| **O2 — Word** | Add `docx`; Markdown-to-DOCX generator; export cards/metadata and fixture tests. Touch O1 files plus `server/package.json`; add only necessary shared/API types. | Export a heading, bullets, table, and link; open in Word/LibreOffice; attachment downloads, source revision link, and budget/cost entry are correct. | 16–24 h |
| **O3 — slides** | Add `pptxgenjs`; constrained Markdown-to-slide outline/template and PPTX export. Same service/route/UI/API/tests plus `server/package.json`. | Export a 6-slide summary; open in PowerPoint/LibreOffice; slide order/title/bullets survive and an unsupported table is visibly warned. | 20–28 h |
| **O4 — document reading** | Add `mammoth`, `pdf-parse`, `jszip`, `fast-xml-parser`, and `xlsx`; bounded extractor/chunker service and privacy toggle. Touch Council service/routes/UI/API, `server/package.json`, and extraction/security tests. | For DOCX, PDF, XLSX, PPTX, CSV, and MD fixtures, seats cite correct source markers; malformed/oversize/macro-like files are rejected; cloud toggle blocks transmission by default. | 40–56 h |
| **O5 — review and versions** | Writer/reviewer roles, draft/revise/export state, critique cards, comparison/version picker, `council_outputs` schema/migration/export, activity events. Touch `packages/db/src/schema/`, migration, shared types, Council server/UI/API, tests. | Draft → two critiques → writer v2 → export; old v1 remains downloadable; another company cannot read either attachment/output. | 32–44 h |
| **O6 — images and audio** | Image generation/review, OCR/vision, TTS/STT and explicit provider/cost controls. Touch Council server/UI/API plus selected provider adapters and tests. | Opted-in image/PDF-page review identifies source pages; generated image/audio is attached; per-room cap blocks the next call and leaves an audit entry. | 48–72 h |

## O6 provider policy

- Image: begin with a Gemini image/vision seat only when its connection exposes
  the capability; permit local Ollama vision/image models through the existing
  OpenAI-compatible connection path when operator-designated private. Store every
  image as an attachment and cap images/pages per round.
- Audio: add provider-agnostic STT/TTS adapters behind an explicit seat capability;
  prefer local Whisper/Piper/Ollama-compatible services where available, then an
  opted-in cloud connection. Default caps: 10 minutes input audio and 2 minutes
  generated audio per room/day, plus the existing monetary/token budget.

## Decisions Ben needs to make

1. Should the default cloud-document toggle be permanently off, or remembered per
   company after an explicit first confirmation?
2. Which seat should be the default writer: fastest/cheapest, a named vendor, or
   Ben chooses every time?
3. Is a simple Paperclip-branded DOCX/PPTX template enough for O2/O3, or do we
   need company templates/logos before shipping?
4. Should reviewers see all uploaded files by default, or only files Ben attaches
   to a specific question/draft?
5. For O6, is local-first processing mandatory, or are named cloud image/audio
   providers acceptable after the room toggle and budget cap?

## VPS2 direction (from Codex review, 2026-11-04)

Council as a controlled workstream, not parallel bots. Priority order:
1. Run timeline with per-run model, duration, retries, fallback and error (read-only, smallest slice).
2. Shared brief per room (objective, constraints, accepted facts, open questions, decision, next action) plus roles: Researcher, Builder, Critic, Synthesizer.
3. Approval gates (Approve / Edit / Reject) before send, delete, spend or publish.
4. Artifact panel with version, producing seat, sources and promote-to-project.
5. Moderator that routes who speaks and records disagreement (needs 2).
6. Layout: Participants drawer on the right; centre is brief, discussion and final decision.
Contract: normalised run events (message, status, tool call, artifact, evidence, approval request, error); reference AG-UI.
