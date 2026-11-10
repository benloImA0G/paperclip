#!/usr/bin/env python3
"""Live check of chain mode, measured reply metadata, plain errors and Fork against a local dev server.

Uses the room "Council smoke (auto)" made by council-live-smoke.py (free vendors only).
  python3 scripts/council-live-new.py [--base http://127.0.0.1:3100/api]
"""
import argparse
import json
import sys
import urllib.error
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument("--base", default="http://127.0.0.1:3100/api")
args = parser.parse_args()
failures = []


def call(method, path, body=None, timeout=300):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(args.base + path, data=data, method=method, headers={"content-type": "application/json"})
    try:
        return json.load(urllib.request.urlopen(req, timeout=timeout))
    except urllib.error.HTTPError as e:
        return {"__error": e.code, "body": e.read().decode()[:300]}


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + (" - " + str(detail) if detail else ""))
    if not ok:
        failures.append(name)


company = call("GET", "/companies")[0]["id"]
base = "/companies/%s/council" % company
room = next((r for r in call("GET", base + "/rooms") if r["title"] == "Council smoke (auto)"), None)
if not room:
    print("Run scripts/council-live-smoke.py --no-work first (it creates the smoke room).")
    sys.exit(2)
rid = room["id"]
seats = call("GET", "%s/rooms/%s/seats" % (base, rid))
print("seats:", ", ".join("%s(%s)" % (s["name"], s["model"]) for s in seats))

# 1) chain round: seats answer one after another
r = call("POST", "%s/rooms/%s/rounds" % (base, rid), {
    "mode": "ask", "style": "chain", "message": "Chain test: give a one-line tip for a newsletter subject line. Each seat improves the previous tip in one sentence.",
    "maxOutputTokens": 800,
})
if "__error" in r:
    check("chain round runs", False, r)
else:
    for x in r["results"]:
        print("  %-10s %-9s %s" % (x.get("seatName"), x["status"], (x.get("text") or x.get("error") or "")[:90].replace("\n", " ")))
    ok = [x for x in r["results"] if x["status"] == "ok"]
    check("chain: at least 2 seats answered", len(ok) >= 2, len(ok))
    check("chain: failures are plain words (no URLs/keys)", all("http" not in (x.get("error") or "") and "Bearer" not in (x.get("error") or "") for x in r["results"]))

# 2) reply metadata used by the footer
comments = call("GET", "/issues/%s/comments" % rid)
if isinstance(comments, dict) and "__error" in comments:
    comments = []
seat_comments = [c for c in comments if str(c.get("authorUserId") or "").startswith("council-seat:")]
rel = [(c.get("metadata") or {}).get("councilReliability") or {} for c in seat_comments[-4:]]
check("footer data: duration and provider recorded", bool(rel) and all("durationMs" in x and "provider" in x for x in rel), rel[-1] if rel else None)
print("  local flags:", [x.get("local") for x in rel], "costCents:", [x.get("costCents") for x in rel])

# 3) fork from the last seat reply
if seat_comments:
    f = call("POST", "%s/rooms/%s/fork" % (base, rid), {"upToCommentId": seat_comments[-1]["id"]})
    check("fork returns a new room", "room" in f and f["room"].get("id") != rid, f if "__error" in f else {k: f[k] for k in ("copiedMessages", "copiedSeats")})
    if "room" in f:
        fid = f["room"]["id"]
        fseats = call("GET", "%s/rooms/%s/seats" % (base, fid))
        check("fork copies every seat", len(fseats) == len(seats), "%d vs %d" % (len(fseats), len(seats)))
        fcomments = call("GET", "/issues/%s/comments" % fid)
        check("fork copies the thread", isinstance(fcomments, list) and len(fcomments) == f["copiedMessages"], len(fcomments) if isinstance(fcomments, list) else fcomments)
        call("DELETE", "/issues/%s" % fid)
else:
    check("fork: a seat reply exists to fork from", False)

print("\n%d failure(s)" % len(failures) if failures else "\nAll checks passed")
sys.exit(1 if failures else 0)
