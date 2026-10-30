#!/usr/bin/env python3
"""Freeze authoritative CommonJS rules/data for the WeChat cloud function.

Run tools/build.py first to assemble current timeline/chapters. This script never
uploads/deploys, never reads a credential, and never changes live cloud settings.
"""
import hashlib
import json
import pathlib
import re
import shutil

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEST = ROOT / 'cloudfunctions' / 'baiyiLeaderboard' / 'vendor'
FILES = ['src/engine.js', 'data/chapters.json', 'data/npcs.json', 'data/knowledge.json', 'data/side-stories.json']

def main():
    included = set()
    def include(relative):
        path = ROOT / relative
        relative = path.relative_to(ROOT).as_posix()
        if relative in included:
            return
        if not path.is_file():
            raise SystemExit(f'Missing authoritative source: {relative}')
        included.add(relative)
        if path.suffix == '.js':
            for dependency in re.findall(r"require\(['\"](\.[^'\"]+)['\"]\)", path.read_text()):
                target = path.parent / dependency
                if not target.suffix:
                    target = target.with_suffix('.js')
                include(target.resolve().relative_to(ROOT).as_posix())
    for name in FILES:
        include(name)
    manifest = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in sorted(included)}
    version = hashlib.sha256(json.dumps(manifest, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    if DEST.exists():
        shutil.rmtree(DEST)
    for name in sorted(included):
        output = DEST / name
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, output)
    (DEST / 'manifest.json').write_text(json.dumps({'engineVersion': version, 'files': manifest}, ensure_ascii=False, indent=2) + '\n')
    (DEST / 'index.js').write_text("'use strict';\nmodule.exports = { createGame: require('./src/engine').createGame, createQuestionHistory: require('./src/question-history').createQuestionHistory, chapters: require('./data/chapters.json'), npcs: require('./data/npcs.json'), knowledge: require('./data/knowledge.json'), sideStories: require('./data/side-stories.json'), engineVersion: require('./manifest.json').engineVersion };\n")
    print(f'Bundled {len(included)} authoritative files; engineVersion={version}')

if __name__ == '__main__':
    main()
