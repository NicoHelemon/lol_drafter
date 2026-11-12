"""Daily import of a JSON export obtained from an authorized source.

Supports a configured JSON export or the unofficial Lolalytics collector.
Source permissions are distinct from technical verification.
"""
import json
import os
from pathlib import Path
import tempfile
from datetime import datetime, timezone
from urllib.parse import urlparse
from urllib.request import Request, build_opener
from pipeline import build
from publish import publish
from probe import NoRedirects


def refresh():
    mode = os.environ.get('STATISTICS_SOURCE', 'export')
    if mode == 'lolalytics':
        if not os.environ.get('SUPABASE_ACCESS_TOKEN') or not os.environ.get('SUPABASE_PROJECT_REF', '').isalnum():
            raise ValueError('Configure backend SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF before refreshing')
        from collect_lolalytics import collect
        with tempfile.TemporaryDirectory() as folder:
            result = collect(folder, all_candidates=True, interval=1.)
            published = publish(Path(folder) / 'snapshots' / result['snapshotId'])
        print(json.dumps(published))
        return published
    if mode != 'export':
        raise ValueError('STATISTICS_SOURCE must be export or lolalytics')
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
    data = json.loads(raw)
    captured = datetime.fromisoformat(data['importedAt'].replace('Z', '+00:00'))
    age = (datetime.now(timezone.utc) - captured).total_seconds()
    if age < -300 or age > 48 * 3600:
        raise ValueError('Daily export must be dated within the last 48 hours')
    with tempfile.TemporaryDirectory() as folder:
        manifest = build(data, folder)
        result = publish(Path(folder) / manifest['metadata']['snapshotId'])
    print(json.dumps(result))
    return result


if __name__ == '__main__':
    refresh()
