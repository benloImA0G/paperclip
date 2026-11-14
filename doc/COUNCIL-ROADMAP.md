# Council roadmap and tracker

Last updated: 2026-11-13

This is the single place to track Council work. Older lists (`COUNCIL-PROPOSALS.md`, the "Known gaps" list in `COUNCIL-STATUS.md`, `COUNCIL-OUTPUTS-ROADMAP.md`) stay as background detail.

How to update: change the Status cell and the date, add a link to the commit or evidence. Status is one of: Not started, In progress, Built (not committed), Done, Parked, Needs Ben.

## 1. The flow we are building

| Stage | What it means | Where we are on 2026-11-13 | Biggest gap |
|---|---|---|---|
| 1 Multi-agent chat | Several models from different vendors answer in one room | Built on the dev machine | Wording is hard for beginners |
| 2 Council and discussion | Rounds, blind ranking, jury, dissent check, random panels | Strongest part | One chair writes every summary (risk of one voice dominating) |
| 3 Task and follow-up | A discussion becomes tasks, and results come back to the room | Tasks can be created; results do not come back yet | No follow-up loop |
| 4 Actions | Agents do things, with approval where it matters | Weakest part: workers only answer | No risk tiers, no durable run record |
| 5 Outputs | Summary, text, Word, PowerPoint, Excel; later voice and video | Text, Word and PowerPoint export; Excel can be read but not produced | No Excel output, no check that a file opens correctly |
| 6 Continuous improvement | The system learns from results, with Ben approving changes | Memory lessons and a reliability summary | No feedback buttons, no saved run record, no fixed test set |

## 2. Tracker

| ID | Priority | Stage | Item | Status | Updated | Notes or evidence |
|---|---|---|---|---|---|---|
| H1 | High | 4,6 | Durable run record: one append-only event log per run (message, status, artifact, approval request, error), so a run survives a restart and can be replayed | Not started | 2026-11-13 | Design sketch in COUNCIL-OUTPUTS-ROADMAP.md "Event contract"; largest item |
| H2 | High | 3 | Follow-up loop: tasks created from a room report status and result back into the room | Built (not committed) | 2026-11-13 | Read path built: a room shows status, owner and latest result of its tasks (server/src/services/council-followup.ts, ui/src/components/CouncilFollowUp.tsx, shown in the Linked tasks panel). 20 tests pass. Not checked in the browser yet. Next: post a result card into the thread when a task finishes |
| H3 | High | 4 | Risk tiers for actions: read-only runs, reversible runs with undo, external or costly waits for Ben, forbidden is blocked | Built (not committed) | 2026-11-13 | Policy module built with 18 action kinds and 6 tests (doc/COUNCIL-ACTION-POLICY.md). Nothing calls it yet. Next: Ben confirms the kinds list, then wire into task creation, exports and agent seats |
| H4 | High | 6 | Feedback and a fixed test set: thumbs up or down on answers, plus about 20 real questions to compare before and after any change | Built (not committed) | 2026-11-13 | Test set of 20 questions and a runner built (doc/COUNCIL-EVAL.md); dry run passes, live run not done yet. Server now accepts thumbs votes on Council answers (4 new tests pass). Next: add the thumbs buttons to the reply footer, which is waiting on the other uncommitted work in that file |
| H5 | High | all | Decisions for Ben: (a) document privacy switch, off by default, before document text goes to cloud seats; (b) beginner wording for "WAR ROOMS", mode cards, "Start the work"; (c) long-term home: Paperclip fork or own Jarvis Core | Needs Ben | 2026-11-13 | Recommendation for (c): stay on the fork, reuse Core's ledger and approval ideas as patterns |
| M1 | Medium | 5 | Excel output, and a check on every exported file (opens, right sheets or slides) | Built, not committed: file check (502 on bad file) and Excel export (xlsx, exceljs approved) | 2026-11-13 | |
| M2 | Medium | 2 | Chair safeguards: always show the minority view next to the summary; a second seat checks the summary | Built (not committed) | 2026-11-13 | council-minority.ts + CouncilMinorityView built and tested; next: call buildMinorityView(round) in council-chat.ts round reply, then render CouncilMinorityView under the summary in Council.tsx (karpathy/llm-council issue 3) |
| M3 | Medium | 2,6 | Measure whether a council beats one model; send simple questions to one model | Not started | 2026-11-13 | Uses the H4 test set |
| M4 | Medium | 2 | One stronger voter seat (Claude or Codex) for important rooms | Not started | 2026-11-13 | A weak free model vetoed good answers in earlier logs |
| M5 | Medium | 1 | PDF reading (needs Ben's OK for a new tool, Poppler) | Needs Ben | 2026-11-13 | |
| M6 | Medium | 2 | Live test of a Hermes agent as a seat | Not started | 2026-11-13 | Built, only tested with a fake gateway |
| M7 | Medium | all | One complete server test run on a quiet machine | Not started | 2026-11-13 | Partial run showed lock-timeout failures outside Council and Memory |
| L1 | Low | 5 | Voice: speech to text first, then read aloud (self-hosted tools exist) | Not started | 2026-11-13 | |
| L2 | Low | 5 | Video and images | Not started | 2026-11-13 | |
| L3 | Low | 2 | More council modes | Parked | 2026-11-13 | The council stage is already ahead of the others |
| L4 | Low | all | Housekeeping: migration 0436 snapshot file, unpushed chore/pin-agent-models branch, stale dev-watch processes, upstream merge conflicts | Not started | 2026-11-13 | |
| P1 | Parked | 1 | Redeploy VPS2 (33 commits behind, kit ready in ~/council-test/VPS2-REDEPLOY-README.md) and confirm its seats reach the NAS model gateway | Parked | 2026-11-13 | Parked by Ben on 2026-11-13 to save time and tokens; development continues on the dev machine |

## 3. Order of work

1. Finish the first slices of H2, H3 and H4, and wire them in.
2. Ben's H5 decisions (about 30 minutes).
3. H1 durable run record, then build approvals and evidence links on it.
4. Medium items.
5. P1 when Ben says so.

## 4. Change log

- 2026-11-13: tracker created after a review of the plan against the six-stage flow and outside practice; VPS2 redeploy parked; first slices of H2, H3, H4 built the same evening (committed as 3512cf2cd, not pushed).
- 2026-11-14 (night run, stopped 1 a.m.): M1 file check and M2 minority-view module built and tested (8 server + 2 UI tests), uncommitted. H1 run record NOT built: WSL hung (load 200+, disk 100%) and restarted, which killed the Codex job; brief kept at ~/council-test/cdx/runlog.md. Research: adopt exceljs (needs Ben OK) and try promptfoo for the eval set; build the event table ourselves.

## 5. Sources used in the 2026-11-13 review

- https://www.langchain.com/blog/traces-start-agent-improvement-loop
- https://developers.openai.com/cookbook/examples/agents_sdk/agent_improvement_loop
- https://neuraltrust.ai/blog/human-in-the-loop-ai-agents
- https://github.com/karpathy/llm-council/issues/3
- https://www.mindstudio.ai/blog/multi-model-ai-agent-council
- https://meetrix.io/blogs/self-host-voice-ai-agent-stack/
