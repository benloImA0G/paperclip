# Council evaluation

This fixed set of 20 general business and technology questions provides a repeatable
baseline for comparing Council prompts, models, and routing. It covers four cases
for each discussion kind. Keyword checks are a rough signal, not a quality judgment.

Run from the repository root against a local trusted Paperclip instance:

```sh
python3 scripts/council-eval.py --dry-run
python3 scripts/council-eval.py --out council-results.json
python3 scripts/council-eval.py --kind review --cases 2 --out review-results.json
```

The live run uses the first company and copies seats from an existing room with a
model moderator and at least two model peers. It creates one temporary room and
deletes it afterwards. Live calls consume model quota. The JSON records answers,
seat timing, fallback use, and keyword matches; the adjacent `.md` file summarizes
pass rates per kind and seat and the five slowest cases. A pass means every required
substring appeared and no forbidden substring appeared, ignoring case. Compare runs
using the same set and panel; inspect answers because synonyms and context can fool
the checks. Case duration is wall time; the table includes each case's time limit.

To propose a case, add an object to `scripts/council-eval-set.json` with a unique
`id`, router `kind`, general `question`, 2–4 short `must_include` substrings,
0–2 `must_not` substrings, and a positive `max_seconds`. Avoid private or company
data. Run the dry run and JSON validation. Agents may propose cases, but only Ben
approves changes to the set.
