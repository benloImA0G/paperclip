# Council: three decisions for Ben (roadmap H5)

Plain English. Each part ends in a yes/no you can answer. Nothing here has been changed yet.

## 1. Beginner wording

"War room" sounds like jargon. "Start the work" does not say that it plans and runs several steps.
Proposed words are suggestions; the mode names in the list below are already fairly clear.

| Current wording | Proposed plain wording | Where |
|---|---|---|
| War rooms (sidebar heading) | Discussions | ui/src/pages/Council.tsx:1014 |
| Archived war rooms | Archived discussions | ui/src/pages/Council.tsx:987 |
| New war room (button label) | New discussion | ui/src/pages/Council.tsx:1038 |
| Create a war room to put several AI models on one question. | Start a discussion to ask several AI models the same question. | ui/src/pages/Council.tsx:1073 |
| Optional controls for this war room. | Optional settings for this discussion. | ui/src/pages/Council.tsx:934 |
| Delete the war room "..." and all its messages? | Delete the discussion "..." and all its messages? | ui/src/pages/Council.tsx:964 |
| Clear every message in this war room? | Clear every message in this discussion? | ui/src/pages/Council.tsx:966 |
| Only Hermes gateway agents can join war rooms. | Only Hermes gateway agents can join a discussion. | ui/src/components/CouncilAgentPanel.tsx:57 |
| Choose a room mode (War room template / modes) | Choose how the AIs should work together | ui/src/components/CouncilTemplates.tsx:6-8 |
| Mode card "Blind best-of-N" | Anonymous vote | ui/src/pages/council-templates.ts:34 |
| Mode card "Red-team" | Find the weak spots | ui/src/pages/council-templates.ts:33 |
| Mode card "Builder then reviewer (chain)" | Draft, then check | ui/src/pages/council-templates.ts:39 |
| Mode card "Get it done" (text mentions "chair", "jury") | Plan and do it (text: "One AI plans the steps, others check each step") | ui/src/pages/council-templates.ts:37 |
| "Estimate · about N model calls per question" | About N AI answers per question (this is what costs money or time) | ui/src/components/CouncilTemplates.tsx:~17 |
| Start the work (button) | Plan and carry out the steps | ui/src/pages/Council.tsx:1474 and :1537 |
| Resume the work / Stop work | Continue the steps / Stop the steps | ui/src/pages/Council.tsx:1537 |
| "start the work again with a clearer goal" | "try again with a clearer goal" | ui/src/pages/council-work-step.tsx:60 |

Note: tests match some of these strings (Council.test.tsx lines 91, 207, 210; council-work-step.test.tsx:40;
CouncilAgentPanel.test.tsx:165). They would need updating in the same change.

## 2. Document privacy switch

Problem: documents attached to a discussion are read, cut into chunks, and pasted into the prompt of every AI seat.
If a seat is a cloud model, your document text leaves this machine.

Proposal: a per-discussion switch, "Send my documents to cloud AIs", default OFF.
- When off, document text is only given to local seats (on this machine). Cloud seats get the question without it,
  and the room shows a note such as "Documents were not shared with Seat X (cloud)".
- It also blocks stored room memory that quotes documents, since that is built in the same step.

Where the check would sit: `roomReferenceContext` in server/src/services/council-chat.ts:428 builds the document text
(calling `loadCouncilDocuments`, council-chat.ts:359). It is called at lines 772, 1610 and 1963. The decision is per seat,
so the check belongs where each seat prompt is assembled from that result (around line 1610), not inside council-docs.ts
(which only extracts text and has no idea which seat is cloud or local).

Options:
- A. Per-seat filter (above). Local seats still use documents; only cloud seats are cut off. More useful, slightly more work.
- B. All-or-nothing: while the switch is off, nobody reads documents at all. Simple and safest, but the "Review a document"
  mode would not work without turning it on.

Recommendation: A, default off, with a clear one-click "turn on for this discussion" and a visible label on cloud seats.

## 3. Long-term home: Paperclip fork or our own "Jarvis Core"

- Today the Council runs inside our fork of Paperclip. It already has rooms, seats, work plans, approvals, and artifacts.
- Building our own Jarvis Core from scratch would mean redoing all of that, with a beginner's 5 to 10 hours a week.
- Existing recommendation (roadmap H5c): stay on the fork.
- Borrow from Jarvis Core instead of replacing the fork with it: its ledger (a log of what happened and why) and its
  human-approval-before-apply rule.
- Revisit only if the fork becomes hard to update, or if we need rules Paperclip cannot support.

## Checklist (answer yes or no)

- [ ] Rename "War rooms" to "Discussions" everywhere in the UI?
- [ ] Use the plain mode names above (Anonymous vote, Find the weak spots, Draft then check, Plan and do it)?
- [ ] Rename "Start the work" to "Plan and carry out the steps"?
- [ ] Show costs as "About N AI answers per question"?
- [ ] Add the document privacy switch, default OFF?
- [ ] Choose option A (per-seat: local seats still read documents) rather than B (all-or-nothing)?
- [ ] Stay on the Paperclip fork long term and borrow Jarvis Core's ledger and approvals?
