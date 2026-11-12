"""Real pruned source fixtures; HTTP, corruption and publication paths isolated."""
from collections import Counter
from datetime import datetime, timezone
import gzip
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/statistics'))
import collect_lolalytics as collector
from inspect_lolalytics import verify_display, inspect
from pipeline import verify

FIXTURES = Path(__file__).parent / 'fixtures/lolalytics'
ROOT = Path(__file__).resolve().parents[2]


class Response(io.BytesIO):
    status = 200
    headers = {'Content-Type': 'application/json', 'Date': 'Thu, 12 Nov 2026 18:00:00 GMT'}


class FixtureFetcher:
    def __init__(self, fail=False):
        self.network_requests = 0
        self.fail = fail

    def get(self, url):
        self.network_requests += 1
        is_team = 'a1.lolalytics' in url
        if is_team and self.fail:
            raise RuntimeError('Source unavailable')
        raw = (FIXTURES / ('renekton-team.json' if is_team else 'renekton.html')).read_bytes()
        return raw, dict(url=url, status=200, sha256=hashlib.sha256(raw).hexdigest(),
                         fetchedAt=datetime.now(timezone.utc).isoformat())


class CollectionTests(unittest.TestCase):
    def test_real_synergy_samples_match_independent_browser_cells(self):
        proof = json.loads((ROOT / 'docs/statistics/live-synergy-verified.json').read_text())
        for page, candidate in zip(proof['pages'], [58, 103, 202]):
            raw = (FIXTURES / (page['champion'] + '-team.json')).read_bytes()
            pairs = collector.parse_team(raw, candidate, page['role'])
            self.assertTrue(all(p['relation'] == 'with' for p in pairs))
            audit = dict(sourceUrl=page['buildUrl'], observations=pairs)
            self.assertEqual(verify_display(audit, page['samples'], 'with'), 4)
            # Against and Synergy can share the same champion/role: relation stays part of the key.
            against = inspect((FIXTURES / (page['champion'] + '.html')).read_bytes(), page['buildUrl'])
            combined = dict(sourceUrl=page['buildUrl'], observations=pairs + against['observations'])
            self.assertEqual(verify_display(combined, page['samples'], 'with'), 4)
            broken = json.loads(raw); broken['team_h'][3] = 'd1'
            with self.assertRaises(ValueError):
                collector.parse_team(json.dumps(broken), candidate, page['role'])

    def test_one_real_candidate_builds_verifiable_both_relation_snapshot(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(collector, 'catalogue_map', return_value={'renekton':58}):
            fetcher = FixtureFetcher()
            result = collector.collect(folder, candidates=['renekton:top'], fetcher=fetcher, workers=1)
            manifest, groups = verify(Path(folder) / 'snapshots' / result['snapshotId'])
            self.assertFalse(manifest['metadata']['fictional'])
            self.assertEqual(set(manifest['coverage']), {'vs', 'with'})
            self.assertTrue(all(p['candidateChampionId'] == '58' for p in groups['58:Top']))
            # Idempotent completed resume does not rebuild a new timestamped snapshot.
            repeated = collector.collect(folder, candidates=['renekton:top'], fetcher=FixtureFetcher(), workers=1)
            self.assertEqual(repeated['snapshotId'], result['snapshotId'])

    def test_failed_collection_keeps_last_snapshot_pointer(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(collector, 'catalogue_map', return_value={'renekton':58}):
            pointer = Path(folder) / 'snapshots/current.json'
            pointer.parent.mkdir(); pointer.write_text('previous verified pointer')
            with self.assertRaisesRegex(RuntimeError, 'Source unavailable'):
                collector.collect(folder, candidates=['renekton:top'], fetcher=FixtureFetcher(fail=True), workers=1)
            self.assertEqual(pointer.read_text(), 'previous verified pointer')
            self.assertFalse((Path(folder) / 'dataset.json').exists())

    def test_cache_resume_hash_check_and_expiry(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(collector.time, 'sleep'):
            client = collector.Fetcher(folder)
            def respond(request, **kwargs):
                return Response(b'User-agent: *\nAllow: /\n' if request.full_url.endswith('/robots.txt') else b'payload')
            client.opener.open = Mock(side_effect=respond)
            url = collector.urls('renekton', 'top')[1]
            first, record = client.get(url)
            second, _ = client.get(url)
            self.assertEqual(first, second)
            self.assertEqual(client.opener.open.call_count, 2)  # robots + payload, no repeat HTTP
            key = hashlib.sha256(url.encode()).hexdigest()
            record['fetchedAt'] = '2000-01-01T00:00:00+00:00'
            Path(folder, key + '.json').write_text(json.dumps(record))
            with self.assertRaisesRegex(ValueError, 'older than 48h'):
                client.get(url)
            Path(folder, key + '.gz').write_bytes(gzip.compress(b'corrupted'))
            with self.assertRaisesRegex(ValueError, 'corrupted'):
                client.get(url)

    def test_429_honors_retry_after_and_403_does_not_retry_or_cache(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(collector.time, 'sleep') as sleep:
            client = collector.Fetcher(folder)
            url = 'https://a1.lolalytics.com/robots.txt'
            client.opener.open = Mock(side_effect=[HTTPError(url,429,'rate',{'Retry-After':'2'},None), Response(b'Allow: /')])
            client.get(url)
            self.assertTrue(any(call.args and call.args[0] >= 1.9 for call in sleep.call_args_list))
            url2 = 'https://lolalytics.com/robots.txt'
            client.opener.open = Mock(side_effect=HTTPError(url2,403,'denied',{},None))
            with self.assertRaises(HTTPError):
                client.get(url2)
            self.assertEqual(client.opener.open.call_count, 1)
            self.assertFalse(Path(folder, hashlib.sha256(url2.encode()).hexdigest() + '.json').exists())

    def test_daily_refresh_collects_before_publishing_and_rejects_bad_mode(self):
        import refresh
        with patch.dict('os.environ', {'STATISTICS_SOURCE':'lolalytics','SUPABASE_ACCESS_TOKEN':'unit-test-placeholder','SUPABASE_PROJECT_REF':'test'}), \
                patch.object(collector, 'collect', return_value={'snapshotId':'a'*64}) as collect, \
                patch.object(refresh, 'publish', return_value={'snapshotId':'a'*64}) as publish:
            self.assertEqual(refresh.refresh(), {'snapshotId':'a'*64})
            collect.assert_called_once(); publish.assert_called_once()
        with patch.dict('os.environ', {'STATISTICS_SOURCE':'typo'}), self.assertRaises(ValueError):
            refresh.refresh()
        with patch.dict('os.environ', {'STATISTICS_SOURCE':'lolalytics','SUPABASE_ACCESS_TOKEN':'unit-test-placeholder','SUPABASE_PROJECT_REF':'test'}), \
                patch.object(collector, 'collect', side_effect=RuntimeError('failed source')), \
                patch.object(refresh, 'publish') as publish:
            with self.assertRaises(RuntimeError):
                refresh.refresh()
            publish.assert_not_called()


if __name__ == '__main__':
    unittest.main()
