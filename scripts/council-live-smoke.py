#!/usr/bin/env python3
"""Live smoke test for Council Chat against a running local dev server (no auth, local_trusted).

Uses only the vendor connections already configured in the first room that has a moderator seat
and at least one other seat, copies them into a reusable room called "Council smoke (auto)", then
checks: random panel, blind peer ranking, jury, and a work session with step checking.
Spends a few thousand tokens on whatever model those seats use, so point it at free vendors.

  python3 scripts/council-live-smoke.py [--base http://127.0.0.1:3100/api] [--no-work]
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument("--base", default="http://127.0.0.1:3100/api")
parser.add_argument("--no-work", action="store_true")
args = parser.parse_args()
failures = []


def call(method, path, body=None, timeout=240):
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
rooms = call("GET", base + "/rooms")
room = next((r for r in rooms if r["title"] == "Council smoke (auto)"), None)
if room is None:
    template_seats = None
    for r in rooms:
        seats = call("GET", "%s/rooms/%s/seats" % (base, r["id"]))
        if any(s["role"] == "moderator" for s in seats) and len([s for s in seats if s["role"] != "moderator"]) >= 2:
            template_seats = seats
            break
    if not template_seats:
        print("No room with a moderator and 2+ other seats to copy; add seats in the UI first.")
        sys.exit(2)
    room = call("POST", base + "/rooms", {"title": "Council smoke (auto)"})
    rid = room.get("id") or room.get("issueId")
    others = [s for s in template_seats if s["role"] != "moderator"]
    chair = next(s for s in template_seats if s["role"] == "moderator")
    copies = [("Chair", chair, "moderator")] + [("Smoke %s" % chr(65 + i), s, "none") for i, s in enumerate((others * 2)[:4])]
    for name, src, role in copies:
        call("POST", "%s/rooms/%s/seats" % (base, rid), {"name": name, "connectionId": src["connectionId"], "grantId": src["grantId"], "model": src["model"], "role": role})
else:
    rid = room["id"]
print("room", rid)

classify = call("POST", base + "/classify", {"text": "Should we use Postgres or SQLite for the council history?"})
check("classify suggests a decision", classify.get("kind") == "decision", classify.get("kind"))

r = call("POST", "%s/rooms/%s/rounds" % (base, rid), {
    "mode": "ask", "message": "In one sentence: what is the best first step for a small team starting a newsletter?",
    "ranking": True, "jury": True, "panel": {"size": 3, "seed": 42}, "maxOutputTokens": 1000,
})
if "__error" in r:
    check("ask round with panel, ranking and jury", False, r)
else:
    answered = [x for x in r["results"] if x["status"] == "ok" and x.get("seatName") != "Chair"]
    check("panel limits the answering seats to 3", len(answered) == 3, len(answered))
    check("peer ranking returns an order", bool(r.get("ranking") and r["ranking"]["order"]), r.get("ranking"))
    check("jury returns a verdict", bool(r.get("jury") and r["jury"]["verdict"]), r.get("jury"))

if not args.no_work:
    path = "%s/rooms/%s/work" % (base, rid)
    started = call("POST", path, {"goal": "Write a 3-bullet launch checklist for a newsletter and a one-line subject for issue one.", "createTasks": False})
    check("work session starts", started.get("started") is True, started)
    state = {}
    for _ in range(80):
        time.sleep(6)
        state = call("GET", path)
        if state.get("status") != "running":
            break
    check("work session finishes", state.get("status") in ("done", "partial"), state.get("status"))
    check("every step was graded", all(s.get("grade") for s in state.get("steps", [])) and bool(state.get("steps")), [s.get("grade") for s in state.get("steps", [])])
    check("a summary exists", bool((state.get("summary") or "").strip()))

print("\n%d failure(s)" % len(failures) if failures else "\nAll checks passed")
sys.exit(1 if failures else 0)
