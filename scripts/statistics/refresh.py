"""Refresh a full 14-day snapshot, validate coverage, then publish atomically.

Source permissions are distinct from technical verification. This command writes
production data: use the workflow's default validation mode before approval.
"""
import json
import os
from pathlib import Path
import tempfile
from datetime import datetime, timezone
from urllib.parse import urlparse
from urllib.request import Request, build_opener
from pipeline import build, verify
from publish import publish
from maintenance import health, maintain
from probe import NoRedirects


def validate_refresh(manifest, previous):
    metadata = manifest['metadata']
    captured = datetime.fromisoformat(metadata['importedAt'].replace('Z', '+00:00'))
    age = (datetime.now(timezone.utc) - captured).total_seconds()
    if age < -300 or age > 48 * 3600:
        raise ValueError('Daily export must be dated within the last 48 hours')
    if metadata['fictional'] or any(manifest['coverage'].get(r, 0) <= 0 for r in ('vs', 'with')):
        raise ValueError('Fresh real Against and Synergy observations are required')
    if not previous:
        return
    if metadata.get('context') != previous.get('context') or metadata['source'] != previous['source']:
        raise ValueError('Daily source/context changed; review before promotion')
    # Aggregate safety gate only. Never filter low-game or marginal-role pairs.
    counts = {'shards': len(manifest['shards']), 'pairs': manifest['pairCount'], **manifest['coverage']}
    baseline = {'shards': previous['shards'], 'pairs': previous['pairs'], **previous['coverage']}
    for metric, old in baseline.items():
        if old and counts.get(metric, 0) < old * .8:
            raise ValueError(f'Abnormal coverage drop in {metric}: {counts.get(metric, 0)} versus {old}; current snapshot preserved')


def publish_refresh(directory, previous):
    manifest = verify(directory)[0]
    validate_refresh(manifest, previous)
    result = publish(directory)
    after = health()
    if not after or after['snapshotId'] != result['snapshotId'] or after['pairs'] != result['pairs'] or after['shards'] != result['shards']:
        raise RuntimeError('Post-publication health mismatch; inspect the pointer before retrying')
    print(json.dumps({'publication':result, 'health':after, 'maintenanceAfter':maintain(dry_run=False)}))
    return result


def refresh():
    mode = os.environ.get('STATISTICS_SOURCE', 'export')
    if mode not in ('export', 'lolalytics'):
        raise ValueError('STATISTICS_SOURCE must be export or lolalytics')
    if not os.environ.get('SUPABASE_ACCESS_TOKEN') or not os.environ.get('SUPABASE_PROJECT_REF', '').isalnum():
        raise ValueError('Configure backend SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF before refreshing')
    # Fail early if lifecycle migration/credentials are unavailable.
    previous = health()
    print(json.dumps({'before':previous, 'maintenance':maintain(dry_run=False)}))
    try:
        if mode == 'lolalytics':
            from collect_lolalytics import collect
            with tempfile.TemporaryDirectory() as folder:
                result = collect(folder, all_candidates=True, interval=1.)
                return publish_refresh(Path(folder) / 'snapshots' / result['snapshotId'], previous)
        source = os.environ['STATISTICS_IMPORT_URL']
        url = urlparse(source)
        if url.scheme != 'https' or not url.hostname or url.username or url.password:
            raise ValueError('Configure an authorized HTTPS JSON export URL')
        if url.hostname == 'lolalytics.com' or url.hostname.endswith('.lolalytics.com'):
            raise ValueError('Use STATISTICS_SOURCE=lolalytics to collect the source; export mode expects a dataset JSON')
        with build_opener(NoRedirects).open(Request(source, headers={'Accept': 'application/json'}), timeout=60) as response:
            raw = response.read(512_000_001)
            if len(raw) > 512_000_000:
                raise ValueError('Source exceeds the 512 MB import limit')
        with tempfile.TemporaryDirectory() as folder:
            manifest = build(json.loads(raw), folder)
            return publish_refresh(Path(folder) / manifest['metadata']['snapshotId'], previous)
    except Exception:
        # Cleanup failure must not hide the source/publication error.
        try:
            print(json.dumps({'maintenanceAfterFailure':maintain(dry_run=False)}))
        except Exception:
            print('Maintenance after failed refresh also failed; inspect the database', flush=True)
        raise


if __name__ == '__main__':
    refresh()
