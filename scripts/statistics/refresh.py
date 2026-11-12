"""Daily import of a JSON export obtained from an authorized source.

The source adapter for Lolalytics remains unverified. This deliberately does not
pretend to convert their HTML/private API into an authorized export.
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
    source = os.environ['STATISTICS_IMPORT_URL']
    url = urlparse(source)
    if url.scheme != 'https' or not url.hostname or url.username or url.password:
        raise ValueError('Configure an authorized HTTPS JSON export URL')
    if url.hostname == 'lolalytics.com' or url.hostname.endswith('.lolalytics.com'):
        raise ValueError('Lolalytics source adapter and collection permission are not yet verified')
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


if __name__ == '__main__':
    refresh()
