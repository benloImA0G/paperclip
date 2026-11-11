#!/usr/bin/env python3
"""Prove a Council work session can use an attached issue document."""
import json
import time
import urllib.error
import urllib.request
import uuid

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


def upload(issue_id):
    boundary = "----council-work-docs-" + uuid.uuid4().hex
    content = b"# Notes\n\nThe launch codename is HERON-9. The launch date is 14 March.\n"
    data = (b"--" + boundary.encode() + b"\r\n"
            b'Content-Disposition: form-data; name="file"; filename="notes.md"\r\n'
            b"Content-Type: text/markdown; charset=utf-8\r\n\r\n" + content + b"\r\n"
            b"--" + boundary.encode() + b"--\r\n")
    req = urllib.request.Request(
        BASE + "/companies/%s/issues/%s/attachments" % (COMPANY, issue_id),
        data=data, method="POST",
        headers={"content-type": "multipart/form-data; boundary=" + boundary})
    try:
        return json.load(urllib.request.urlopen(req, timeout=60))
    except urllib.error.HTTPError as exc:
        return {"__error": exc.code, "body": exc.read().decode()[:400]}


def main():
    company_base = "/companies/%s/council" % COMPANY
    rid = None
    failure = None
    try:
        rooms = call("GET", company_base + "/rooms")
        if not isinstance(rooms, list):
            raise RuntimeError("list rooms failed: %s" % rooms)
        template = None
        for existing in rooms:
            seats = call("GET", "%s/rooms/%s/seats" % (company_base, existing["id"]))
            if isinstance(seats, list) and any(s["role"] == "moderator" for s in seats) and len(
                    [s for s in seats if s["role"] != "moderator"]) >= 2:
                template = seats
                break
        if not template:
            raise RuntimeError("No room with a moderator and 2 free seats to copy")

        room = call("POST", company_base + "/rooms", {"title": "Work docs smoke (auto)"})
        rid = room.get("id") or room.get("issueId")
        if not rid:
            raise RuntimeError("create room failed: %s" % room)
        chair = next(s for s in template if s["role"] == "moderator")
        vendors = [s for s in template if s["role"] != "moderator"][:2]
        copies = [("Chair", chair, "moderator")] + [
            ("Work docs %s" % chr(65 + i), src, "none") for i, src in enumerate(vendors)]
        for name, src, role in copies:
            added = call("POST", "%s/rooms/%s/seats" % (company_base, rid), {
                "name": name, "connectionId": src["connectionId"],
                "grantId": src["grantId"], "model": src["model"], "role": role})
            if isinstance(added, dict) and "__error" in added:
                raise RuntimeError("add seat %s failed: %s" % (name, added))

        attachment = upload(rid)
        if isinstance(attachment, dict) and "__error" in attachment:
            raise RuntimeError("upload notes.md failed: %s" % attachment)

        path = "%s/rooms/%s/work" % (company_base, rid)
        started = call("POST", path, {
            "goal": "Write one sentence stating the launch codename and the launch date.",
            "createTasks": False})
        if started.get("started") is not True:
            raise RuntimeError("work session did not start: %s" % started)

        state = {}
        for _ in range(40):
            time.sleep(6)
            state = call("GET", path)
            if state.get("status") != "running":
                break
        if state.get("status") not in ("done", "partial"):
            raise RuntimeError("work session did not finish: %s" % state.get("status"))
        steps = state.get("steps", [])
        text = "\n".join([state.get("summary") or ""] + [
            str(step.get("output") or step.get("result") or "") for step in steps])
        if "HERON-9" not in text or "14 March" not in text:
            raise RuntimeError("deliverable/summary missing document facts: %s" % text[:800])
        print("PASS work session used attached notes.md: HERON-9, 14 March")
    except Exception as exc:
        failure = str(exc)
        print("FAIL Council work documents smoke - " + failure)
    finally:
        if rid:
            deleted = call("DELETE", "/issues/%s" % rid)
            if isinstance(deleted, dict) and "__error" in deleted:
                print("FAIL cleanup room %s - %s" % (rid, deleted))
                failure = failure or "cleanup failed"
    return 1 if failure else 0


if __name__ == "__main__":
    raise SystemExit(main())
