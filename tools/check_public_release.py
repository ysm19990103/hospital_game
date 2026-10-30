#!/usr/bin/env python3
"""Check distributable game files without printing sensitive matched values."""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATTERNS = {
    'key-like-token': re.compile(r'\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b'),
    'github-token': re.compile(r'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b'),
    'private-key': re.compile(r'-{5}BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-{5}'),
    'private-library-reference': re.compile(r'\blibfile_[0-9a-f]{16,}\b|\bfile_[0-9a-f]{24,}\b'),
    'local-workspace-path': re.compile(r'/(?:workspace/scratch|Users|home)/[A-Za-z0-9_.-]+/'),
    'credential-in-url': re.compile(r'https?://[^\s/@:]+:[^\s/@]+@'),
}
TEXT_EXTENSIONS = {'.js', '.json', '.py', '.md', '.html', '.yml', '.yaml', '.txt', '.srt', '.sh'}
failures = []
if (ROOT / '.git').is_dir():
    tracked = subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd=ROOT)
    paths = [ROOT / name for name in dict.fromkeys(tracked.decode().split('\0')) if name and (ROOT / name).is_file()]
else:
    paths = [p for p in ROOT.rglob('*') if p.is_file() and not any(part in {'.git', 'node_modules', '__pycache__', '.build-staging'} for part in p.relative_to(ROOT).parts)]
for path in paths:
    rel = path.relative_to(ROOT).as_posix()
    if any(part.startswith('.') and part not in {'.github', '.gitignore', '.gitattributes'} for part in path.relative_to(ROOT).parts):
        failures.append({'path': rel, 'category': 'unreviewed-hidden-file'})
    if path.name.startswith('.env') or path.name == 'project.private.config.json' or path.suffix in {'.pem', '.key', '.p12', '.pfx', '.sqlite', '.sqlite3', '.db'}:
        failures.append({'path': rel, 'category': 'private-local-file'})
    if path.stat().st_size >= 100 * 1024 * 1024:
        failures.append({'path': rel, 'category': 'large-git-object'})
    if path.suffix not in TEXT_EXTENSIONS:
        continue
    text = path.read_text(encoding='utf-8')
    for category, pattern in PATTERNS.items():
        if pattern.search(text):
            failures.append({'path': rel, 'category': category})

chapters = json.loads((ROOT / 'data/chapters.json').read_text())
stories = json.loads((ROOT / 'data/side-stories.json').read_text())
expected = {c.get('video', f'media/ch{c["id"]:02d}.mp4') for c in chapters} | {s['video'] for s in stories}
actual = {p.relative_to(ROOT).as_posix() for p in (ROOT / 'media').rglob('*.mp4')}
for name in sorted(expected - actual):
    failures.append({'path': name, 'category': 'missing-video'})
for name in sorted(actual - expected):
    failures.append({'path': name, 'category': 'uncatalogued-video'})

project = json.loads((ROOT / 'project.config.json').read_text())
board = json.loads((ROOT / 'data/leaderboard-config.json').read_text())
study = json.loads((ROOT / 'data/study-config.json').read_text())
if project.get('appid') not in {'', 'touristappid'}:
    failures.append({'path': 'project.config.json', 'category': 'personal-appid'})
if board.get('enabled') or board.get('envId'):
    failures.append({'path': 'data/leaderboard-config.json', 'category': 'configured-cloud'})
if study.get('enabled') or study.get('items'):
    failures.append({'path': 'data/study-config.json', 'category': 'configured-research-study'})

print(json.dumps({'passed': not failures, 'checkedFiles': len(paths), 'mainChapters': len(chapters), 'sideStories': len(stories), 'videos': len(expected), 'findings': failures}, ensure_ascii=False, indent=2))
sys.exit(1 if failures else 0)
