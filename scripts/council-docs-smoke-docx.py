#!/usr/bin/env python3
"""Live smoke test for Council Documents with a generated DOCX attachment."""
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.request
import uuid

BASE = "http://127.0.0.1:3100/api"
COMPANY = "d99efc5c-1461-43ea-bd1e-ff897119e274"
FACT = "The launch codename is HERON-9"
DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def call(method, path, body=None, timeout=240):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"content-type": "application/json"})
    try:
        return json.load(urllib.request.urlopen(req, timeout=timeout))
    except urllib.error.HTTPError as exc:
        return {"__error": exc.code, "body": exc.read().decode()[:400]}


def build_docx():
    pandoc = os.environ.get("PANDOC_PATH", "/home/super/.local/bin/pandoc")
    with tempfile.TemporaryDirectory(prefix="council-docx-smoke-") as temp_dir:
        source = pathlib.Path(temp_dir) / "notes.md"
        output = pathlib.Path(temp_dir) / "notes.docx"
        source.write_text(FACT + "\n", encoding="utf-8")
        subprocess.run([pandoc, str(source), "--output", str(output)], check=True,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return output.read_bytes()


def upload(issue_id, content):
    boundary = "----council-docs-" + uuid.uuid4().hex
    data = (b"--" + boundary.encode() + b"\r\n"
            b'Content-Disposition: form-data; name="file"; filename="notes.docx"\r\n'
            + ("Content-Type: " + DOCX_CONTENT_TYPE + "\r\n\r\n").encode()
            + content + b"\r\n--" + boundary.encode() + b"--\r\n")
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
        docx = build_docx()
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

        room = call("POST", company_base + "/rooms", {"title": "Docs docx smoke (auto)"})
        rid = room.get("id") or room.get("issueId")
        if not rid:
            raise RuntimeError("create room failed: %s" % room)
        chair = next(s for s in template if s["role"] == "moderator")
        vendors = [s for s in template if s["role"] != "moderator"][:2]
        for name, src, role in [("Chair", chair, "moderator")] + [
                ("Docs %s" % chr(65 + i), src, "none") for i, src in enumerate(vendors)]:
            added = call("POST", "%s/rooms/%s/seats" % (company_base, rid), {
                "name": name, "connectionId": src["connectionId"],
                "grantId": src["grantId"], "model": src["model"], "role": role})
            if isinstance(added, dict) and "__error" in added:
                raise RuntimeError("add seat %s failed: %s" % (name, added))

        attachment = upload(rid, docx)
        if isinstance(attachment, dict) and "__error" in attachment:
            raise RuntimeError("upload notes.docx failed: %s" % attachment)

        response = call("POST", "%s/rooms/%s/rounds" % (company_base, rid), {
            "mode": "ask", "message": "What is the launch codename?",
            "maxOutputTokens": 500})
        results = response.get("results", []) if isinstance(response, dict) else []
        names = [r.get("seatName", "unknown") for r in results if r.get("status") == "ok"
                 and "HERON-9" in (r.get("response") or r.get("text") or r.get("content") or "")]
        names += [r.get("seatName", "unknown") for r in results if r.get("status") == "ok"
                  and "HERON-9" in str(r.get("answer", ""))]
        names = list(dict.fromkeys(names))
        if names:
            print("PASS Council Documents DOCX codename reply - " + ", ".join(names))
        else:
            failure = "round did not return HERON-9: %s" % response
            print("FAIL Council Documents DOCX codename reply - " + ", ".join(
                r.get("seatName", "unknown") for r in results))
    except Exception as exc:
        failure = str(exc)
        print("FAIL Council Documents DOCX smoke - " + failure)
    finally:
        if rid:
            deleted = call("DELETE", "/issues/%s" % rid)
            if isinstance(deleted, dict) and "__error" in deleted:
                print("FAIL cleanup room %s - %s" % (rid, deleted))
                failure = failure or "cleanup failed"
            else:
                print("PASS cleanup room " + rid)
    return 1 if failure else 0


if __name__ == "__main__":
    raise SystemExit(main())
