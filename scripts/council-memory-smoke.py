#!/usr/bin/env python3
"""Live smoke test for Memory relevance in Council seat replies."""
import json
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:3100/api"
COMPANY = "d99efc5c-1461-43ea-bd1e-ff897119e274"


def call(method, path, body=None, timeout=240):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"content-type": "application/json"})
    try:
        return json.load(urllib.request.urlopen(req, timeout=timeout))
    except urllib.error.HTTPError as exc:
        return {"__error": exc.code, "body": exc.read().decode()[:400]}


def main():
    company_base = "/companies/%s/council" % COMPANY
    memory_base = "/companies/%s/memory" % COMPANY
    room_id = None
    memory_ids = []
    failure = None
    try:
        for title, body in [
                ("Smoke: office plant codename", "The office plant is called FERNANDO-3"),
                ("Smoke: lunch rule", "Lunch is normally eaten at noon."),
                ("Smoke: parking rule", "Visitors should park in the east lot.")]:
            entry = call("POST", memory_base, {
                "kind": "fact", "title": title, "body": body,
                "sourceUrl": None, "sourceLabel": None, "tags": ["council-smoke"],
                "pinned": False})
            if isinstance(entry, dict) and "__error" in entry:
                raise RuntimeError("create memory %s failed: %s" % (title, entry))
            if not entry.get("id"):
                raise RuntimeError("create memory %s returned no id: %s" % (title, entry))
            memory_ids.append(entry["id"])

        rooms = call("GET", company_base + "/rooms")
        if isinstance(rooms, dict) and "__error" in rooms:
            raise RuntimeError("list rooms: %s" % rooms)
        template = None
        for existing in rooms:
            seats = call("GET", "%s/rooms/%s/seats" % (company_base, existing["id"]))
            if isinstance(seats, list) and any(s["role"] == "moderator" for s in seats) and len(
                    [s for s in seats if s["role"] != "moderator"]) >= 2:
                template = seats
                break
        if not template:
            raise RuntimeError("No room with a moderator and 2 vendor seats to copy")

        room = call("POST", company_base + "/rooms", {"title": "Memory smoke (auto)"})
        room_id = room.get("id") or room.get("issueId")
        if not room_id:
            raise RuntimeError("create room failed: %s" % room)
        chair = next(s for s in template if s["role"] == "moderator")
        vendors = [s for s in template if s["role"] != "moderator"][:2]
        for name, src, role in [("Chair", chair, "moderator")] + [
                ("Memory %s" % chr(65 + i), src, "none") for i, src in enumerate(vendors)]:
            added = call("POST", "%s/rooms/%s/seats" % (company_base, room_id), {
                "name": name, "connectionId": src["connectionId"],
                "grantId": src["grantId"], "model": src["model"], "role": role})
            if isinstance(added, dict) and "__error" in added:
                raise RuntimeError("add seat %s failed: %s" % (name, added))

        response = call("POST", "%s/rooms/%s/rounds" % (company_base, room_id), {
            "mode": "ask", "message": "What is the office plant called?",
            "maxOutputTokens": 500})
        results = response.get("results", []) if isinstance(response, dict) else []
        matches = []
        for result in results:
            reply = " ".join(str(result.get(key) or "")
                             for key in ("response", "text", "content", "answer"))
            if result.get("status") == "ok" and "FERNANDO-3" in reply:
                matches.append(result.get("seatName", "unknown"))
        if matches:
            print("PASS Council Memory relevance - " + ", ".join(dict.fromkeys(matches)))
        else:
            failure = "no seat reply contained FERNANDO-3: %s" % response
            print("FAIL Council Memory relevance - " + failure)
    except Exception as exc:
        failure = str(exc)
        print("FAIL Council Memory smoke - " + failure)
    finally:
        for memory_id in memory_ids:
            deleted = call("DELETE", memory_base + "/" + memory_id)
            if isinstance(deleted, dict) and "__error" in deleted:
                # Current server builds have no memory DELETE route. Withdraw
                # this exact entry so it cannot participate in future context.
                withdrawn = call("POST", memory_base + "/" + memory_id + "/withdraw",
                                 {"reason": "Council memory smoke cleanup"})
                if isinstance(withdrawn, dict) and "__error" in withdrawn:
                    print("FAIL cleanup memory %s - delete %s; withdraw %s" %
                          (memory_id, deleted, withdrawn))
                    failure = failure or "memory cleanup failed"
                else:
                    print("PASS cleanup memory %s (withdrawn; DELETE unavailable)" % memory_id)
            else:
                print("PASS cleanup memory " + memory_id)
        if room_id:
            deleted = call("DELETE", "/issues/%s" % room_id)
            if isinstance(deleted, dict) and "__error" in deleted:
                print("FAIL cleanup room %s - %s" % (room_id, deleted))
                failure = failure or "room cleanup failed"
            else:
                print("PASS cleanup room " + room_id)
    return 1 if failure else 0


if __name__ == "__main__":
    raise SystemExit(main())
