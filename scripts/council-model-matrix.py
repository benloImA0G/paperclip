#!/usr/bin/env python3
"""Free model matrix: checks each model on the vendors used by the "Council smoke (auto)" room.

Creates a temporary room, adds one model seat per (vendor, model), runs the seat check,
prints a table, and always deletes the temporary room afterwards.
  python3 scripts/council-model-matrix.py [--base http://127.0.0.1:3100/api]
"""
import argparse
import json
import re
import sys
import urllib.error
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument("--base", default="http://127.0.0.1:3100/api")
args = parser.parse_args()

SECRET = re.compile(r"(sk-|gsk_|nvapi-|AIza|Bearer\s+)[A-Za-z0-9_\-\.]{6,}")
NOT_CHAT = re.compile(r"embed|whisper|tts|guard|moderation|rerank|dall|image|audio|transcri|speech|vision|aqa|orpheus", re.I)


def clean(text, limit=110):
    text = SECRET.sub("[redacted]", str(text or ""))
    return " ".join(text.split())[:limit]


def call(method, path, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(args.base + path, data=data, method=method, headers={"content-type": "application/json"})
    try:
        raw = urllib.request.urlopen(req, timeout=timeout).read().decode()
        return json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as e:
        return {"__error": "HTTP %d: %s" % (e.code, clean(e.read().decode(), 160))}
    except Exception as e:
        return {"__error": clean(e, 160)}


def fail(msg):
    print("FATAL " + msg)
    sys.exit(2)


companies = call("GET", "/companies")
if not isinstance(companies, list) or not companies:
    fail("could not list companies: %s" % clean(companies))
company = companies[0]["id"]
base = "/companies/%s/council" % company

rooms = call("GET", base + "/rooms")
smoke = next((r for r in rooms if isinstance(r, dict) and r.get("title") == "Council smoke (auto)"), None) if isinstance(rooms, list) else None
if not smoke:
    fail("room 'Council smoke (auto)' not found; run scripts/council-live-smoke.py first")

seats = call("GET", "%s/rooms/%s/seats" % (base, smoke["id"]))
if not isinstance(seats, list):
    fail("could not read smoke seats: %s" % clean(seats))

# Connection names give the vendor labels. If this lookup fails, short ids are used instead.
names = {}
conns = call("GET", "/companies/%s/ai-connections" % company)
items = conns if isinstance(conns, list) else (conns.get("connections") or conns.get("items") or []) if isinstance(conns, dict) else []
for c in items:
    if isinstance(c, dict) and c.get("id"):
        names[c["id"]] = str(c.get("name") or c.get("label") or c.get("title") or "")


def vendor_label(cid):
    label = names.get(cid) or ("conn-" + cid[:6])
    first = label.split()[0] if label.split() else "conn"
    return re.sub(r"[^A-Za-z0-9]+", "", first)[:12] or "conn"


def is_local(cid):
    label = (names.get(cid) or "").lower()
    return "ollama" in label or "local" in label


# Group smoke seats by (connection, grant). Agent seats have no connectionId and are skipped.
groups = {}
for s in seats:
    if isinstance(s, dict) and s.get("connectionId") and s.get("grantId") and s.get("model"):
        groups.setdefault((s["connectionId"], s["grantId"]), []).append(s)

selected = []  # (vendor, connectionId, grantId, model)
list_failures = []  # (vendor, error)
for (cid, gid), group in groups.items():
    vendor = vendor_label(cid)
    cap = 4 if is_local(cid) else 8
    chosen = list(dict.fromkeys(s["model"] for s in group))  # smoke models always stay in
    lst = call("GET", "%s/connections/%s/models?grantId=%s" % (base, cid, gid), timeout=30)
    if isinstance(lst, dict) and "__error" in lst:
        list_failures.append((vendor, lst["__error"]))
    else:
        for m in (lst if isinstance(lst, list) else []):
            if len(chosen) >= cap:
                break
            if isinstance(m, str) and m and not NOT_CHAT.search(m) and m not in chosen:
                chosen.append(m)
    for m in chosen:
        selected.append((vendor, cid, gid, m))

rows = []  # dicts: vendor, model, ok, secs, err
# A council room takes at most 8 seats, so the models are tested in batches of 8, one temporary room per batch.
for start in range(0, len(selected), 8):
    chunk = selected[start:start + 8]
    tmp = call("POST", base + "/rooms", {"title": "Model matrix (auto)"})
    if not isinstance(tmp, dict) or "id" not in tmp:
        for vendor, cid, gid, model in chunk:
            rows.append({"vendor": vendor, "model": model, "ok": False, "secs": 0.0, "err": "could not create temporary room: " + clean(tmp)})
        continue
    rid = tmp["id"]
    try:
        seat_map = {}  # seat name -> (vendor, model)
        used = set()
        for vendor, cid, gid, model in chunk:
            short = model[-24:]
            name = ("%s:%s" % (vendor, short))[:80]
            n = 2
            while name in used:
                name = ("%s:%s#%d" % (vendor, short, n))[:80]
                n += 1
            used.add(name)
            body = {"kind": "model", "name": name, "connectionId": cid, "grantId": gid, "model": model, "role": "none", "persona": ""}
            added = call("POST", "%s/rooms/%s/seats" % (base, rid), body)
            if not isinstance(added, dict) or "id" not in added:
                rows.append({"vendor": vendor, "model": model, "ok": False, "secs": 0.0, "err": "could not add seat: " + clean(added.get("__error", "no id"))})
                continue
            seat_map[name] = (vendor, model)

        if seat_map:
            res = call("POST", "%s/rooms/%s/seats/check" % (base, rid), None, timeout=240)
            if "__error" in res:
                for vendor, model in seat_map.values():
                    rows.append({"vendor": vendor, "model": model, "ok": False, "secs": 0.0, "err": "check request failed: " + res["__error"]})
            else:
                seen = set()
                for r in res.get("results", []):
                    vendor, model = seat_map.get(r.get("seatName"), ("?", r.get("model") or "?"))
                    seen.add(r.get("seatName"))
                    ok = bool(r.get("ok"))
                    rows.append({"vendor": vendor, "model": r.get("model") or model, "ok": ok, "secs": (r.get("durationMs") or 0) / 1000.0, "err": "" if ok else clean(r.get("error") or r.get("status"))})
                for name, (vendor, model) in seat_map.items():
                    if name not in seen:
                        rows.append({"vendor": vendor, "model": model, "ok": False, "secs": 0.0, "err": "no result returned"})
    finally:
        deleted = call("DELETE", "/issues/%s" % rid)
        if isinstance(deleted, dict) and "__error" in deleted:
            print("WARNING: temporary room was not deleted: %s" % deleted["__error"])
rows.sort(key=lambda r: (r["vendor"], not r["ok"], r["secs"]))
print("%-12s %-46s %-5s %8s  %s" % ("vendor", "model", "state", "seconds", "error"))
for r in rows:
    print("%-12s %-46s %-5s %8.1f  %s" % (r["vendor"][:12], r["model"][:46], "OK" if r["ok"] else "FAIL", r["secs"], r["err"]))

print()
for vendor in sorted({r["vendor"] for r in rows}):
    mine = [r for r in rows if r["vendor"] == vendor]
    good = [r for r in mine if r["ok"]]
    avg = sum(r["secs"] for r in good) / len(good) if good else 0.0
    print("%-12s total %2d  ok %2d  fail %2d  avg ok %.1fs" % (vendor, len(mine), len(good), len(mine) - len(good), avg))
for vendor, err in list_failures:
    print("MODEL LIST FAILED %s: %s" % (vendor, err))
