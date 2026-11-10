#!/usr/bin/env python3
"""Live API sweep of Council chat on the local dev server, using the room "Council smoke (auto)".

  python3 scripts/council-live-sweep.py [--base http://127.0.0.1:3100/api]
"""
import argparse
import json
import socket
import sys
import urllib.error
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument("--base", default="http://127.0.0.1:3100/api")
args = parser.parse_args()
failures = []
seat_errors = []  # (seat name, error text) for every failed seat result in the rounds below
SECRET_MARKERS = ("http", "Bearer", "sk-", "AIza")


def call(method, path, body=None, timeout=300):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(args.base + path, data=data, method=method, headers={"content-type": "application/json"})
    try:
        return json.load(urllib.request.urlopen(req, timeout=timeout))
    except urllib.error.HTTPError as e:
        return {"__error": e.code, "body": e.read().decode()[:300]}
    except (urllib.error.URLError, socket.timeout, OSError) as e:
        return {"__error": "net", "body": str(e)[:300]}


def snip(x):
    text = x if isinstance(x, str) else json.dumps(x, default=str)
    return text[:400]


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("" if ok or detail == "" else " - " + snip(detail)))
    if not ok:
        failures.append(name)


def step(name, fn):
    try:
        fn()
    except Exception as e:  # one broken check must not stop the rest
        check(name + " (exception)", False, repr(e))


def is_err(r):
    return isinstance(r, dict) and "__error" in r


def has_number(x):
    if isinstance(x, bool):
        return False
    if isinstance(x, (int, float)):
        return True
    if isinstance(x, dict):
        return any(has_number(v) for v in x.values())
    if isinstance(x, list):
        return any(has_number(v) for v in x)
    return False


def collect_errors(r):
    for x in r.get("results", []) if isinstance(r, dict) else []:
        if x.get("status") == "error":
            seat_errors.append((x.get("seatName"), x.get("error") or ""))


def ok_results(r):
    return [x for x in r.get("results", []) if x.get("status") == "ok"]


company = call("GET", "/companies")
if not isinstance(company, list) or not company:
    print("FAIL could not read /companies - is the dev server up on %s?" % args.base)
    sys.exit(2)
company = company[0]["id"]
base = "/companies/%s/council" % company
rooms = call("GET", base + "/rooms")
room = next((r for r in rooms if isinstance(r, dict) and r.get("title") == "Council smoke (auto)"), None) if isinstance(rooms, list) else None
if not room:
    print('FAIL room "Council smoke (auto)" not found - create it with scripts/council-live-smoke.py first')
    sys.exit(2)
rid = room["id"]
RB = "%s/rooms/%s" % (base, rid)

seats = call("GET", RB + "/seats")
seat_list = seats if isinstance(seats, list) else []
for s in seat_list:
    extra = {k: v for k, v in s.items() if any(w in k.lower() for w in ("provider", "vendor", "connection")) and not k.lower().endswith("id")}
    print("seat: %s | model: %s | %s" % (s.get("name"), s.get("model"), extra))
seat_names = [s.get("name") for s in seat_list]


def c1_rooms():
    rooms2 = call("GET", base + "/rooms")
    check("1a GET rooms lists the room", isinstance(rooms2, list) and any(r.get("id") == rid for r in rooms2), "" if isinstance(rooms2, list) else rooms2)


def c1_room():
    r = call("GET", RB)
    check("1b GET rooms/:id returns the room", isinstance(r, dict) and r.get("id") == rid, r)


def c1_stats():
    r = call("GET", RB + "/stats")
    check("1c GET stats", not is_err(r), r)


def c1_estimate():
    r = call("GET", RB + "/estimate?mode=ask")
    check("1d GET estimate (ask) returns 200 with a number", not is_err(r) and has_number(r), r)


def c2_ask_collaborate():
    r = call("POST", RB + "/rounds", {"mode": "ask", "style": "collaborate", "message": "Say hi in 5 words", "maxOutputTokens": 600})
    if is_err(r):
        check("2 ask/collaborate: round runs", False, r)
        return
    collect_errors(r)
    n = len(ok_results(r))
    check("2 ask/collaborate: at least 3 seats ok", n >= 3, "%d ok of %d; %s" % (n, len(r.get("results", [])), r) if n < 3 else "")


def c3_mention():
    r = call("POST", RB + "/rounds", {"mode": "ask", "message": "@Smoke B say hi", "maxOutputTokens": 600})
    if is_err(r):
        check("3 @Smoke B: round runs", False, r)
        return
    collect_errors(r)
    res = r.get("results", [])
    check("3 @Smoke B: exactly one result from Smoke B", len(res) == 1 and res[0].get("seatName") == "Smoke B", "" if len(res) == 1 and res[0].get("seatName") == "Smoke B" else r)


def c4_discuss():
    r = call("POST", RB + "/rounds", {"mode": "discuss", "message": "Is a weekly newsletter better than a monthly one? One short answer.", "maxOutputTokens": 600}, timeout=400)
    if is_err(r):
        check("4 discuss: round runs", False, r)
        return
    collect_errors(r)
    n = len(ok_results(r))
    check("4 discuss: at least 2 seats ok", n >= 2, "" if n >= 2 else "%d ok; %s" % (n, r))


def c5_summarize():
    r = call("POST", RB + "/rounds", {"mode": "summarize", "maxOutputTokens": 600})
    if is_err(r):
        check("5 summarize: 200 with text", False, r)
        return
    collect_errors(r)
    text_found = any((x.get("text") or "").strip() for x in r.get("results", [])) or any(
        isinstance(v, str) and v.strip() for k, v in r.items() if k not in ("id", "roomId")
    )
    check("5 summarize: 200 with some text", text_found, "" if text_found else r)


def c6_stop():
    r = call("POST", RB + "/rounds/stop")
    code = r.get("__error") if is_err(r) else None
    check("6 rounds/stop with nothing running: not a 5xx", not (isinstance(code, int) and code >= 500), r)


def c7_artifacts():
    key = "council-output-live-sweep"
    created = call("POST", RB + "/artifacts", {"key": key, "title": "Live sweep artifact", "markdown": "# Live sweep\n\nTest artifact written by council-live-sweep."})
    check("7a POST artifacts", not is_err(created), created)
    listed = call("GET", RB + "/artifacts")
    check("7b GET artifacts lists the key", isinstance(listed, list) and any(a.get("key") == key for a in listed), listed)
    one = call("GET", RB + "/artifacts/" + key)
    check("7c GET artifact by key", not is_err(one) and "Live sweep" in json.dumps(one), one)
    print("  note: no artifact delete route exists; artifact '%s' left in place" % key)


def c8_classify():
    r = call("POST", base + "/classify", {"text": "Should we switch our hosting provider? I need to decide this week."})
    check("8 POST classify returns 200", not is_err(r), r)


def c9_brief():
    original = call("GET", RB + "/brief")
    marker = "live sweep brief check"
    put = call("PUT", RB + "/brief", {"brief": marker})
    if is_err(put):
        check("9 PUT brief", False, put)
    else:
        got = call("GET", RB + "/brief")
        check("9 brief round-trips", not is_err(got) and marker in json.dumps(got), got)
    if isinstance(original, dict) and not is_err(original) and "brief" in original:
        call("PUT", RB + "/brief", {"brief": original.get("brief") or ""})
        print("  note: original brief restored")


def c10_errors():
    bad = [(n, e) for n, e in seat_errors if any(m in (e or "") for m in SECRET_MARKERS)]
    check("10 seat error text has no http/Bearer/sk-/AIza (%d seat errors seen)" % len(seat_errors), not bad, bad)


for name, fn in [
    ("1a", c1_rooms), ("1b", c1_room), ("1c", c1_stats), ("1d", c1_estimate),
    ("2", c2_ask_collaborate), ("3", c3_mention), ("4", c4_discuss), ("5", c5_summarize),
    ("6", c6_stop), ("7", c7_artifacts), ("8", c8_classify), ("9", c9_brief), ("10", c10_errors),
]:
    step(name, fn)

print("\n%d failure(s)" % len(failures) if failures else "\nAll checks passed")
sys.exit(1 if failures else 0)