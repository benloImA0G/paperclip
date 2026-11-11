#!/usr/bin/env python3
"""Live smoke test for Council Documents with generated PPTX and XLSX attachments."""
import json
import os
import pathlib
import subprocess
import tempfile
import urllib.error
import urllib.request
import uuid
import zipfile

BASE = "http://127.0.0.1:3100/api"
COMPANY = "d99efc5c-1461-43ea-bd1e-ff897119e274"
PANDOC = os.environ.get("PANDOC_PATH", "/home/super/.local/bin/pandoc")
FILES = [
    ("pptx", "OSPREY-4", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
    ("xlsx", "KESTREL-2", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
]


def call(method, path, body=None, timeout=240):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"content-type": "application/json"})
    try:
        return json.load(urllib.request.urlopen(req, timeout=timeout))
    except urllib.error.HTTPError as exc:
        return {"__error": exc.code, "body": exc.read().decode()[:400]}


def upload(issue_id, filename, content, content_type):
    boundary = "----council-docs-" + uuid.uuid4().hex
    data = (b"--" + boundary.encode() + b"\r\n"
            + ('Content-Disposition: form-data; name="file"; filename="%s"\r\n' % filename).encode()
            + ("Content-Type: " + content_type + "\r\n\r\n").encode()
            + content + b"\r\n--" + boundary.encode() + b"--\r\n")
    req = urllib.request.Request(
        BASE + "/companies/%s/issues/%s/attachments" % (COMPANY, issue_id),
        data=data, method="POST",
        headers={"content-type": "multipart/form-data; boundary=" + boundary})
    try:
        return json.load(urllib.request.urlopen(req, timeout=60))
    except urllib.error.HTTPError as exc:
        return {"__error": exc.code, "body": exc.read().decode()[:400]}


def build_pptx(directory):
    source, output = directory / "launch.md", directory / "launch.pptx"
    source.write_text("# Launch\n\nThe launch codename is OSPREY-4\n", encoding="utf-8")
    subprocess.run([PANDOC, str(source), "--output", str(output)], check=True,
                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return output.read_bytes()


def build_xlsx(directory):
    output = directory / "launch.xlsx"
    entries = {
        "[Content_Types].xml": '''<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>''',
        "_rels/.rels": '''<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>''',
        "xl/workbook.xml": '''<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Launch" sheetId="1" r:id="rId1"/></sheets></workbook>''',
        "xl/_rels/workbook.xml.rels": '''<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>''',
        "xl/worksheets/sheet1.xml": '''<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>The launch codename is KESTREL-2</t></is></c></row></sheetData></worksheet>''',
    }
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as workbook:
        for name, content in entries.items():
            workbook.writestr(name, content)
    subprocess.run([PANDOC, "--from", "xlsx", "--to", "markdown", str(output)],
                   check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return output.read_bytes()


def smoke(extension, codename, content_type, content):
    company_base = "/companies/%s/council" % COMPANY
    rid = None
    try:
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
        room = call("POST", company_base + "/rooms", {"title": "Docs office smoke (auto)"})
        rid = room.get("id") or room.get("issueId")
        if not rid:
            raise RuntimeError("create room failed: %s" % room)
        chair = next(s for s in template if s["role"] == "moderator")
        vendors = [s for s in template if s["role"] != "moderator"][:2]
        configs = [("Chair", chair, "moderator")] + [
            ("Docs %s" % chr(65 + i), src, "none") for i, src in enumerate(vendors)]
        for name, src, role in configs:
            added = call("POST", "%s/rooms/%s/seats" % (company_base, rid), {
                "name": name, "connectionId": src["connectionId"],
                "grantId": src["grantId"], "model": src["model"], "role": role})
            if isinstance(added, dict) and "__error" in added:
                raise RuntimeError("add seat %s failed: %s" % (name, added))
        result = upload(rid, "launch." + extension, content, content_type)
        if isinstance(result, dict) and "__error" in result:
            raise RuntimeError("upload launch.%s failed: %s" % (extension, result))
        response = call("POST", "%s/rooms/%s/rounds" % (company_base, rid), {
            "mode": "ask", "message": "What is the launch codename?", "maxOutputTokens": 500})
        results = response.get("results", []) if isinstance(response, dict) else []
        matching = [r.get("seatName", "unknown") for r in results if r.get("status") == "ok"
                    and codename in str(r.get("response") or r.get("text") or r.get("content") or r.get("answer") or "")]
        if matching:
            print("PASS Council Documents %s codename reply - %s" % (extension.upper(), ", ".join(matching)))
            return True
        print("FAIL Council Documents %s codename reply - expected %s" % (extension.upper(), codename))
        return False
    except Exception as exc:
        print("FAIL Council Documents %s smoke - %s" % (extension.upper(), exc))
        return False
    finally:
        if rid:
            deleted = call("DELETE", "/issues/%s" % rid)
            if isinstance(deleted, dict) and "__error" in deleted:
                print("FAIL cleanup room %s - %s" % (rid, deleted))


def main():
    outcomes = []
    with tempfile.TemporaryDirectory(prefix="council-office-smoke-") as temporary:
        directory = pathlib.Path(temporary)
        fixtures = {
            "pptx": build_pptx(directory),
            "xlsx": build_xlsx(directory),
        }
    for extension, codename, content_type in FILES:
        outcomes.append(smoke(extension, codename, content_type, fixtures[extension]))
    return 0 if all(outcomes) else 1


if __name__ == "__main__":
    raise SystemExit(main())
