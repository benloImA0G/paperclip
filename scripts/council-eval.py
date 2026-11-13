#!/usr/bin/env python3
"""Run the fixed Council evaluation against a local trusted Paperclip instance."""
import argparse
import json
from pathlib import Path
import sys
import time
import urllib.error
import urllib.request

SET_PATH = Path(__file__).with_name('council-eval-set.json')
KINDS = {'quick-fact', 'decision', 'brainstorm', 'review', 'plan-and-do'}
ROOM_TITLE = 'Council eval (auto, delete me)'
BASE = 'http://127.0.0.1:3100/api'


def load_cases():
    cases = json.loads(SET_PATH.read_text(encoding='utf-8'))
    if not isinstance(cases, list) or not cases:
        raise ValueError('case set must be a nonempty array')
    ids = set()
    for case in cases:
        if not isinstance(case, dict) or set(case) != {'id', 'kind', 'question', 'must_include', 'must_not', 'max_seconds'}:
            raise ValueError('each case must have exactly the documented fields')
        if not isinstance(case['id'], str) or not case['id'].strip() or case['id'] in ids:
            raise ValueError('case ids must be unique nonempty strings')
        ids.add(case['id'])
        if case['kind'] not in KINDS or not isinstance(case['question'], str) or not case['question'].strip():
            raise ValueError(f"{case['id']}: invalid kind or question")
        for field, low, high in [('must_include', 2, 4), ('must_not', 0, 2)]:
            value = case[field]
            if not isinstance(value, list) or not low <= len(value) <= high or any(not isinstance(x, str) or not x.strip() for x in value):
                raise ValueError(f"{case['id']}: invalid {field}")
        if isinstance(case['max_seconds'], bool) or not isinstance(case['max_seconds'], (int, float)) or case['max_seconds'] <= 0:
            raise ValueError(f"{case['id']}: invalid max_seconds")
    return cases


def request(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=600) as response:
        raw = response.read()
        return json.loads(raw) if raw else None


def score(case, result):
    answer = result.get('text') or ''
    folded = answer.casefold()
    missing = [s for s in case['must_include'] if s.casefold() not in folded]
    forbidden = [s for s in case['must_not'] if s.casefold() in folded]
    return {'seat_id': result.get('seatId'), 'seat': result.get('seatName'),
            'status': result.get('status'), 'answer': answer,
            'duration_ms': result.get('durationMs'), 'fallback_used': result.get('fallbackUsed', False),
            'missing': missing, 'forbidden': forbidden,
            'passed': result.get('status') == 'ok' and bool(answer) and not missing and not forbidden}


def table(results):
    lines = ['# Council evaluation', '', 'Keyword checks are literal case-insensitive substrings; they are not quality judgments.', '',
             '| Group | Passed / total | Rate |', '| --- | ---: | ---: |']
    for label, key in [('Kind', 'kind'), ('Seat', 'seat')]:
        groups = {}
        for case in results:
            for seat in case['seats']:
                name = case['kind'] if key == 'kind' else (seat['seat'] or seat['seat_id'] or 'Unknown')
                groups.setdefault(name, []).append(seat['passed'])
        for name, values in sorted(groups.items()):
            safe_name = str(name).replace('|', '\\|')
            lines.append(f'| {label}: {safe_name} | {sum(values)} / {len(values)} | {sum(values) / len(values):.0%} |')
    lines += ['', '## Slowest cases', '', '| Case | Kind | Seconds | Limit |', '| --- | --- | ---: | ---: |']
    for case in sorted(results, key=lambda c: c['duration_seconds'], reverse=True)[:5]:
        lines.append(f"| {case['id']} | {case['kind']} | {case['duration_seconds']:.1f} | {case['max_seconds']} |")
    return '\n'.join(lines) + '\n'


def main():
    global BASE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default=BASE, help='API base URL (default: %(default)s)')
    parser.add_argument('--cases', type=int, help='run the first N selected cases')
    parser.add_argument('--kind', choices=sorted(KINDS))
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--out', default='council-eval-results.json', help='JSON output path; Markdown uses the same stem')
    args = parser.parse_args()
    BASE = args.base.rstrip('/')
    if args.cases is not None and args.cases < 1:
        parser.error('--cases must be positive')
    cases = load_cases()
    cases = [c for c in cases if not args.kind or c['kind'] == args.kind]
    if args.cases is not None:
        cases = cases[:args.cases]
    for case in cases:
        print(f"{case['id']} [{case['kind']}] {case['question']}")
    if Path(args.out).suffix.lower() == '.md':
        parser.error('--out must not have a .md suffix')
    if args.dry_run:
        print(f'{len(cases)} cases planned; no network calls')
        return
    companies = request('GET', '/companies')
    if not companies:
        raise RuntimeError('No company available')
    company_id = companies[0]['id']
    prefix = f'/companies/{company_id}/council/rooms'
    rooms = request('GET', prefix)
    source = None
    for room in rooms:
        seats = request('GET', f"{prefix}/{room['id']}/seats")
        moderator = next((s for s in seats if s.get('role') == 'moderator' and s.get('connectionId')), None)
        peers = [s for s in seats if s.get('role') != 'moderator' and s.get('connectionId')]
        if moderator and len(peers) >= 2:
            source = [moderator] + peers[:4]
            break
    if not source:
        raise RuntimeError('Need an existing room with a model moderator and at least two model peers')
    room_id = None
    results = []
    try:
        room = request('POST', prefix, {'title': ROOM_TITLE})
        room_id = room.get('id') or room.get('issueId')
        if not room_id:
            raise RuntimeError('Created room response has no id; cannot identify room for cleanup')
        for i, seat in enumerate(source):
            body = {key: seat.get(key) for key in ('name', 'connectionId', 'grantId', 'model')}
            body['role'] = 'moderator' if i == 0 else 'none'
            request('POST', f'{prefix}/{room_id}/seats', body)
        for case in cases:
            start = time.monotonic()
            response = request('POST', f'{prefix}/{room_id}/rounds', {
                'mode': 'ask', 'message': case['question'], 'maxOutputTokens': 1000})
            elapsed = time.monotonic() - start
            seats = [score(case, item) for item in response.get('results', [])]
            if not seats:
                raise RuntimeError(f"{case['id']}: round returned no seat results")
            results.append({'id': case['id'], 'kind': case['kind'], 'question': case['question'],
                            'duration_seconds': round(elapsed, 3), 'max_seconds': case['max_seconds'],
                            'slow': elapsed > case['max_seconds'], 'seats': seats})
    finally:
        try:
            if room_id:
                request('DELETE', f'/issues/{room_id}')
        finally:
            out = Path(args.out)
            out.write_text(json.dumps({'cases': results}, indent=2) + '\n', encoding='utf-8')
            out.with_suffix('.md').write_text(table(results), encoding='utf-8')
            print(f'Wrote {out} and {out.with_suffix(".md")}')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, RuntimeError, urllib.error.URLError) as exc:
        print(f'Council eval: {exc}', file=sys.stderr)
        sys.exit(1)
