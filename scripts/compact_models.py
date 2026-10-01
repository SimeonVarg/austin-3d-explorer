import argparse
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
TOKENS = re.compile(r'"(?:\\.|[^"\\])*"|\s+')


def compact(text):
    return TOKENS.sub(lambda match: match.group(0) if match.group(0).startswith('"') else '', text)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    catalog = json.loads((ROOT / 'data/apartments/index.json').read_text(encoding='utf-8'))
    changed = 0
    saved = 0
    for name in catalog['buildings']:
        path = ROOT / 'data/apartments' / name
        original = path.read_bytes()
        reduced = compact(original.decode('utf-8')).encode('utf-8')
        if json.loads(original) != json.loads(reduced):
            raise ValueError(str(path) + ': JSON content changed')
        if original == reduced:
            continue
        changed += 1
        saved += len(original) - len(reduced)
        if not args.check:
            path.write_bytes(reduced)
    print(str(changed) + ' core model files; ' + str(saved) + ' whitespace bytes')
    return 1 if args.check and changed else 0


if __name__ == '__main__':
    raise SystemExit(main())
