#!/usr/bin/env python3
"""Join existing private photo records without losing unlocated or unassigned images."""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
import os
from pathlib import Path
import time

from accept import Rejected, private_path, write_json

IMAGE_SUFFIXES = {'.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.tif', '.tiff'}


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def build(root, index_dir, output):
    root = Path(root).expanduser().resolve()
    output = private_path(output)
    if root == output or root in output.parents:
        raise Rejected('catalog output must be outside the source tree')
    started = time.monotonic()
    images = {p.absolute(): dict(file=str(p.absolute()), resolved_file=str(p.resolve()), bytes=p.stat().st_size,
                               sha256=digest(p), records=[])
              for p in sorted(root.rglob('*')) if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES}
    records, issues = [], []
    by_stem = defaultdict(list)
    for path in images:
        by_stem[path.stem].append(path)
    index_dir = Path(index_dir).expanduser()
    indexed = {}
    if (index_dir / 'index.jsonl').exists():
        indexed = {r['id']: r for r in read_lines(index_dir / 'index.jsonl')}
    confirmed_path = index_dir / 'confirmed.json'
    confirmed = json.loads(confirmed_path.read_text()) if confirmed_path.exists() else {}

    def record(kind, origin, number, value, paths, **extra):
        key = hashlib.sha256(f'{origin.relative_to(root)}:{number}'.encode()).hexdigest()[:20]
        logical = [Path(os.path.abspath(p)) for p in paths]
        if any(root not in p.parents for p in logical):
            raise Rejected('manifest image path escapes the source tree')
        files = [str(p) for p in logical if p in images]
        row = dict(id=key, kind=kind, manifest=str(origin), row=number,
                   source=value, files=files, **extra)
        records.append(row)
        for p in files:
            images[Path(p)]['records'].append(key)
        if not files:
            issues.append(dict(record=key, reason='declared image unavailable' if paths or kind=='walk' else 'non-image source record'))

    for manifest in sorted((root / '_walks').glob('*/photos.jsonl')):
        for n, row in enumerate(read_lines(manifest), 1):
            pid = row['photo_id']
            paths = [p for p in by_stem[pid] if manifest.parent in p.parents]
            location = 'available' if row.get('lat') is not None and row.get('lon') is not None else 'unknown'
            record('walk', manifest, n, row, paths, location=location,
                   candidates=indexed.get(pid, {}).get('hits', []),
                   visual_confirmation=confirmed.get(pid, {}),
                   original_digest=row.get('sha256'))

    for manifest in sorted(root.glob('*/sources.json')):
        rows = json.loads(manifest.read_text())
        rows = rows if isinstance(rows, list) else rows.get('sources', [])
        for n, row in enumerate(rows, 1):
            file = row.get('file')
            paths = [manifest.parent / file] if isinstance(file, str) and file else []
            record('source-manifest', manifest, n, row, paths,
                   catalog_group=manifest.parent.name, location='unknown')
    manifest = root / 'manifest.json'
    if manifest.exists():
        for n, row in enumerate(json.loads(manifest.read_text()).get('images', []), 1):
            file = row.get('file')
            record('library-manifest', manifest, n, row,
                   [root / file] if isinstance(file, str) and file else [],
                   catalog_group=row.get('building'), location='unknown')

    # Exact-byte duplicates only. Re-encodes remain separate; walk records join known derivatives.
    by_hash = defaultdict(list)
    for row in images.values():
        by_hash[row['sha256']].append(row['file'])
        row['status'] = 'recorded' if row['records'] else 'unassigned'
    counts = Counter(r['kind'] for r in records)
    summary = dict(image_files=len(images), exact_byte_contents=len(by_hash),
                   exact_duplicate_copies=sum(len(v)-1 for v in by_hash.values()),
                   unassigned_images=sum(not r['records'] for r in images.values()),
                   records=dict(counts), records_without_images=len(issues),
                   missing_declared_images=sum(i['reason']=='declared image unavailable' for i in issues),
                   non_image_source_records=sum(i['reason']=='non-image source record' for i in issues),
                   walk_missing_location=sum(r['kind']=='walk' and r['location']=='unknown' for r in records),
                   walk_visual_confirmations=sum(r['kind']=='walk' and bool(r.get('visual_confirmation')) for r in records),
                   elapsed_seconds=round(time.monotonic()-started, 3))
    result = dict(schema=1, kind='private-photo-catalog', root=str(root),
                  summary=summary, records=records, images=list(images.values()), issues=issues)
    write_json(output, result)
    return result


def read_lines(path):
    for number, line in enumerate(path.read_text().splitlines(), 1):
        if line.strip():
            try:
                yield json.loads(line)
            except json.JSONDecodeError as exc:
                raise Rejected(f'invalid metadata JSON at line {number}: {path}') from exc


def packet(catalog_path, plan_path, output_dir):
    """Make metadata-free model inputs from explicit, visually reviewed selections."""
    from PIL import Image, ImageOps
    from accept import asset
    catalog = json.loads(Path(catalog_path).read_text())
    plan = json.loads(Path(plan_path).read_text())
    output_dir = private_path(output_dir)
    if output_dir.exists() and any(output_dir.iterdir()):
        raise Rejected('packet output must be empty; preserve previous trials')
    images = {row['file']: row for row in catalog['images']}
    resolved_images = {row.get('resolved_file', str(Path(row['file']).resolve())): row for row in catalog['images']}
    records = {row['id']: row for row in catalog['records']}
    rows, groups, hashes, originals = [], {}, {}, {}
    for number, item in enumerate(plan['views'], 1):
        file = str(Path(item['file']).expanduser().absolute())
        row = images.get(file) or resolved_images.get(str(Path(file).resolve()))
        if row is None or item.get('reviewed') is not True:
            raise Rejected('each input must be cataloged and explicitly visually reviewed')
        role, group = item.get('role'), item.get('viewpoint_group')
        if role not in ('build', 'holdout') or not isinstance(group, str) or not group:
            raise Rejected('each input needs a build/holdout role and viewpoint group')
        categories = item.get('categories', [])
        if not categories or set(categories) - {'building', 'ground', 'decoration'}:
            raise Rejected('categories must name building, ground or decoration')
        if digest(Path(file)) != row['sha256']:
            raise Rejected('source changed after cataloging')
        for table, key in [(groups, group), (hashes, row['sha256'])] + [
                (originals, records[r]['original_digest']) for r in row['records']
                if records[r].get('original_digest')]:
            if key in table and table[key] != role:
                raise Rejected('build and holdout share a viewpoint, image, or known original')
            table[key] = role
        with Image.open(file) as source:
            picture = ImageOps.exif_transpose(source).convert('RGB')
            crop = item.get('crop')
            if crop is not None:
                if (len(crop) != 4 or any(type(v) is not int for v in crop)
                        or not 0 <= crop[0] < crop[2] <= picture.width
                        or not 0 <= crop[1] < crop[3] <= picture.height):
                    raise Rejected('crop outside orientation-normalized image')
                picture = picture.crop(crop)
            # New image drops EXIF and other source metadata, including embedded thumbnails.
            clean = Image.new('RGB', picture.size)
            clean.paste(picture)
        rows.append((item, clean, row))
    if not any(item['role']=='build' for item, _, _ in rows) or not any(item['role']=='holdout' for item, _, _ in rows):
        raise Rejected('packet needs build and withheld viewpoints')
    output_dir.mkdir(parents=True, exist_ok=True)
    sealed = []
    for n, (item, clean, source) in enumerate(rows, 1):
        path = output_dir / f"{item['role']}-{n:02}.jpg"
        clean.save(path, quality=95)
        sealed.append(dict(input=asset(path), source_sha256=source['sha256'],
                           role=item['role'], viewpoint_group=item['viewpoint_group'],
                           categories=item['categories'], observation=item.get('observation', ''),
                           uncertainty=item.get('uncertainty', ''), crop=item.get('crop')))
    result = dict(schema=1, kind='private-feature-packet', catalog=asset(catalog_path),
                  plan=asset(plan_path), views=sealed,
                  note='Viewpoint groups and identities are reviewer assertions, not geometric proof.')
    write_json(output_dir / 'packet.json', result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('build')
    p.add_argument('--root', required=True)
    p.add_argument('--index', required=True)
    p.add_argument('--out', required=True)
    p = sub.add_parser('packet')
    p.add_argument('--catalog', required=True)
    p.add_argument('--plan', required=True)
    p.add_argument('--out', required=True)
    args = parser.parse_args()
    if args.command == 'build':
        print(json.dumps(build(args.root, args.index, args.out)['summary'], indent=2))
    else:
        result = packet(args.catalog, args.plan, args.out)
        print(f"Prepared {len(result['views'])} reviewed views; originals unchanged.")


if __name__ == '__main__':
    main()
