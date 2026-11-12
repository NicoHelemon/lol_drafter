"""Offline snapshot builder. No requests to Lolalytics; no third-party dependencies."""
import argparse
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import tempfile
from datetime import datetime
from collections import Counter

ROOT = Path(__file__).resolve().parents[2]
ROLES = ('Top', 'Jungle', 'Mid', 'ADC', 'Support')
CONTEXT = dict(tier='emerald_plus', region='global', queue='ranked_solo_duo',
               windowDays=14, minLanePercent=2, minGames=100, minPickPercent=0,
               metric='delta2', unit='percentage_points')


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'),
                      allow_nan=False).encode('utf-8')


def digest(value):
    return hashlib.sha256(value).hexdigest()


def validate(document):
    """Require declared filters and observed deltas, never derive them from winrates."""
    if document.get('context') != CONTEXT:
        raise ValueError('Context must exactly match the fixed acquisition filters')
    for key in ('id', 'patch', 'tier', 'source', 'importedAt'):
        if not isinstance(document.get(key), str) or not document[key].strip():
            raise ValueError(f'Missing metadata: {key}')
    if type(document.get('fictional')) is not bool:
        raise ValueError('Explicit fictional flag required')
    if datetime.fromisoformat(document['importedAt'].replace('Z', '+00:00')).tzinfo is None:
        raise ValueError('importedAt needs a timezone')
    ids = {c['id'] for c in json.loads((ROOT / 'src/data/champions.json').read_text())}
    rows = document.get('pairs')
    if not isinstance(rows, list) or not rows or len(rows) > 2_000_000:
        raise ValueError('Expected 1..2,000,000 directional observations')
    seen = set()
    groups = {}
    for row in rows:
        key = tuple(row.get(k) for k in ('relation', 'candidateChampionId', 'candidateRole',
                                        'otherChampionId', 'otherRole'))
        relation, candidate, role, other, other_role = key
        if relation not in ('vs', 'with') or role not in ROLES or other_role not in ROLES:
            raise ValueError('Invalid relation or role')
        if candidate not in ids or other not in ids or candidate == other:
            raise ValueError('Invalid champion identity')
        if relation == 'with' and role == other_role:
            raise ValueError('Same-role synergy is not supported')
        if key in seen:
            raise ValueError('Duplicate directional observation')
        seen.add(key)
        delta = row.get('delta2', 'missing')
        if delta is not None and (type(delta) not in (float, int) or
                                  not math.isfinite(delta) or abs(delta) > 100):
            raise ValueError('delta2 must be null or a finite observed number in points')
        if type(row.get('games')) is not int or row['games'] < CONTEXT['minGames']:
            raise ValueError('Each exported observation needs games >= 100')
        normalized = dict(zip(('relation', 'candidateChampionId', 'candidateRole',
                               'otherChampionId', 'otherRole'), key), delta2=delta, games=row['games'])
        groups.setdefault(f'{candidate}:{role}', []).append(normalized)
    for rows in groups.values():
        rows.sort(key=lambda r: (r['relation'], r['otherRole'], r['otherChampionId']))
    return groups


def atomic_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as f:
        tmp = Path(f.name)
        try:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
            os.replace(tmp, path)
        finally:
            tmp.unlink(missing_ok=True)


def build(document, destination):
    groups = validate(document)  # Validate everything before changing current.json.
    metadata = {k: document[k] for k in ('id', 'patch', 'tier', 'source', 'importedAt', 'fictional', 'context')}
    normalized = {**metadata, 'pairs': [r for key in sorted(groups) for r in groups[key]]}
    snapshot_id = digest(encoded(normalized))
    metadata['snapshotId'] = snapshot_id
    directory = Path(destination) / snapshot_id
    manifest = dict(schemaVersion=1, metadata=metadata, shards={},
                    pairCount=len(normalized['pairs']),
                    coverage=dict(Counter(r['relation'] for r in normalized['pairs'])),
                    observations=dict(known=sum(r['delta2'] is not None for r in normalized['pairs']),
                                      null=sum(r['delta2'] is None for r in normalized['pairs']),
                                      zero=sum(r['delta2'] == 0 for r in normalized['pairs'])),
                    missingPolicy='absent-or-null-is-missing-zero-is-observed')
    for key, rows in sorted(groups.items()):
        raw = encoded(rows)
        compressed = gzip.compress(raw, mtime=0)
        filename = key.replace(':', '-') + '.json.gz'
        atomic_write(directory / filename, compressed)
        manifest['shards'][key] = dict(file=filename, sha256=digest(raw), pairs=len(rows),
                                      bytes=len(raw), gzipBytes=len(compressed))
    atomic_write(directory / 'manifest.json', encoded(manifest))
    verify(directory)
    atomic_write(Path(destination) / 'current.json', encoded({'snapshotId': snapshot_id}))
    return manifest


def verify(directory):
    directory = Path(directory)
    manifest = json.loads((directory / 'manifest.json').read_text())
    if manifest.get('schemaVersion') != 1 or not manifest.get('shards'):
        raise ValueError('Invalid snapshot manifest')
    pairs = []
    for key, shard in manifest['shards'].items():
        filename = shard['file']
        if Path(filename).name != filename or filename != key.replace(':', '-') + '.json.gz':
            raise ValueError('Invalid shard path')
        compressed = (directory / filename).read_bytes()
        raw = gzip.decompress(compressed)
        rows = json.loads(raw)
        if digest(raw) != shard['sha256'] or len(rows) != shard['pairs']:
            raise ValueError('Corrupt shard')
        if any(f"{r['candidateChampionId']}:{r['candidateRole']}" != key for r in rows):
            raise ValueError('Mixed candidate/role shards')
        pairs.extend(rows)
    metadata = dict(manifest['metadata'])
    snapshot_id = metadata.pop('snapshotId')
    document = {**metadata, 'pairs': pairs}
    groups = validate(document)
    document['pairs'] = [r for key in sorted(groups) for r in groups[key]]
    if (digest(encoded(document)) != snapshot_id or len(pairs) != manifest['pairCount'] or
            dict(Counter(r['relation'] for r in pairs)) != manifest['coverage']):
        raise ValueError('Snapshot identity/count mismatch')
    return manifest, groups


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest='command', required=True)
    b = subs.add_parser('build')
    b.add_argument('input', type=Path)
    b.add_argument('--output', type=Path, required=True)
    v = subs.add_parser('verify')
    v.add_argument('directory', type=Path)
    args = parser.parse_args()
    if args.command == 'build':
        manifest = build(json.loads(args.input.read_text()), args.output)
    else:
        manifest, _ = verify(args.directory)
    print(json.dumps({k: manifest[k] for k in ('metadata', 'pairCount', 'coverage')}, indent=2))


if __name__ == '__main__':
    main()
