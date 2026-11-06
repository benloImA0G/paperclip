# Council discussion design (researched 2026-11-06)

Sources: Du et al. 2023 multi-agent debate (arXiv 2305.14325); Smit et al., ICML 2024 (debate does not reliably beat self-consistency at equal cost); ChatEval (arXiv 2308.07201, distinct personas matter); Karpathy llm-council (blind answers, anonymous peer ranking, chairman); AutoGen SelectorGroupChat docs; 2025-26 preprints on sycophancy and conformity in debate (arXiv 2509.23055, 2605.00914); Delphi consensus reviews (75-80% agreement is the usual threshold). Many 2025-26 results are unreplicated preprints.

## Ben's direction (2026-11-06)
- Daytime default: ONE turn (every seat answers once, then the moderator summarizes). No debate unless asked.
- The council should work like Claude Code: the chair works out the steps needed for the goal straight away, then models and agents carry them out (plan, assign, run, report) instead of everyone talking in circles.
- Debate ("until agreement", up to 3 rounds) is an opt-in for hard or high-stakes questions and overnight runs.

## How many turns
- Evidence-backed default is 2 rounds; 3 is the cap. More rounds add cost (about 3x tokens) and conformity, not accuracy.
- "Until agreement" is offered, with a hard cap of 3 discussion rounds. Stops: agreement reached, two rounds with almost no change (stalled), or the cap.
- Agreement is not correctness: when everyone converges at once with high confidence, a dissent check (devil's advocate round) is the recommended next step (not built yet).

## Protocol
1. Clarify (optional): a seat may ask another seat or Ben one question; others see it in the thread. One hop only.
2. Blind round: every seat answers without seeing the others (no anchoring).
3. Discussion rounds: seats read each other's answers, must name a reason for any agreement, and end with a stance block.
4. Score after each discussion round; stop when agreement is reached.
5. Moderator writes the decision (recommendation, agreement, dissent kept with the seat name, risks, action items).

## Agreement in plain English
Each seat gives a stance (agree, agree with conditions, disagree, abstain) and confidence 1-5. Score = weighted share of agreement (agree 1.0, with conditions 0.65, disagree 0, abstain excluded; weight 0.6 + 0.4 x confidence/5).
Labels: Strong agreement (85%+ and no disagreement), Agreement with concessions (65%+), Split (40%+), No agreement. Thresholds are a design choice inspired by the 75-80% Delphi norm, not a validated standard. Concessions and open objections are listed under the meter.

## After agreement
Plan (numbered steps, each with an expected output) -> run the steps with visible status -> 1-page summary in the chat. Word or PowerPoint files are made only on request (existing export route, pandoc).
