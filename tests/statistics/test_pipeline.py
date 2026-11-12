"""Explicitly SYNTHETIC fixtures: these numbers are not from Lolalytics."""
import copy
import gzip
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/statistics'))
from pipeline import CONTEXT, build, validate, verify
from publish import publish
from probe import capture, inspect, probe


def fixture():
    pairs = []
    for candidate, role, other, other_role in [('58', 'Top', '122', 'Top'),
                                              ('103', 'Mid', '84', 'Mid'),
                                              ('202', 'ADC', '51', 'ADC')]:
        pairs.extend([
            dict(relation='vs', candidateChampionId=candidate, candidateRole=role,
                 otherChampionId=other, otherRole=other_role, delta2=0, games=100),
            dict(relation='with', candidateChampionId=candidate, candidateRole=role,
                 otherChampionId='64', otherRole='Jungle', delta2=-1.25, games=210),
            dict(relation='vs', candidateChampionId=candidate, candidateRole=role,
                 otherChampionId='117', otherRole='Support', delta2=None, games=120),
        ])
    return dict(id='synthetic-test', patch='Test only', tier='Emerald+', source='Synthetic test fixture',
                importedAt='2026-11-12T00:00:00Z', fictional=True, context=CONTEXT, pairs=pairs)


class PipelineTests(unittest.TestCase):
    def test_roundtrip_shards_counts_real_zero_null_and_compression(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest = build(fixture(), directory)
            loaded, groups = verify(Path(directory) / manifest['metadata']['snapshotId'])
            self.assertEqual(loaded, manifest)
            self.assertEqual(manifest['pairCount'], 9)
            self.assertEqual(len(groups), 3)
            self.assertEqual(manifest['coverage'], {'vs': 6, 'with': 3})
            self.assertEqual(manifest['observations'], {'known': 6, 'null': 3, 'zero': 3})
            self.assertEqual({r['delta2'] for r in groups['58:Top']}, {None, 0, -1.25})
            self.assertLess(sum(s['gzipBytes'] for s in manifest['shards'].values()),
                            sum(s['bytes'] for s in manifest['shards'].values()))

    def test_invalid_refresh_keeps_last_good_pointer(self):
        with tempfile.TemporaryDirectory() as directory:
            build(fixture(), directory)
            pointer = (Path(directory) / 'current.json').read_bytes()
            broken = fixture()
            broken['pairs'].append(copy.deepcopy(broken['pairs'][0]))
            with self.assertRaisesRegex(ValueError, 'Duplicate'):
                build(broken, directory)
            self.assertEqual((Path(directory) / 'current.json').read_bytes(), pointer)

    def test_context_and_raw_winrate_are_not_delta2(self):
        for mutation in ('context', 'delta', 'games', 'identity', 'role'):
            data = fixture()
            data['context'] = dict(CONTEXT)
            if mutation == 'context': data['context']['windowDays'] = 30
            if mutation == 'delta': data['pairs'][0].pop('delta2'); data['pairs'][0]['winrate'] = 52.3
            if mutation == 'games': data['pairs'][0]['games'] = 99
            if mutation == 'identity': data['pairs'][0]['candidateChampionId'] = 'missing'
            if mutation == 'role': data['pairs'][0]['otherRole'] = 'Unassigned'
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                validate(data)

    def test_corrupt_or_mixed_snapshots_fail_verification(self):
        with tempfile.TemporaryDirectory() as directory:
            m = build(fixture(), directory)
            folder = Path(directory) / m['metadata']['snapshotId']
            file = folder / m['shards']['58:Top']['file']
            file.write_bytes(gzip.compress(b'[]'))
            with self.assertRaisesRegex(ValueError, 'Corrupt'):
                verify(folder)

    def test_reordered_input_has_same_snapshot_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            data = fixture()
            one = build(data, directory)
            data['pairs'].reverse()
            two = build(data, directory)
            self.assertEqual(one, two)

    def test_publish_failure_cannot_advance_current(self):
        with tempfile.TemporaryDirectory() as directory:
            data = fixture()
            # Only for testing the publishing transaction. Still synthetic values.
            data['fictional'] = False
            m = build(data, directory)
            queries = []
            def fail_on_shard(sql):
                queries.append(sql)
                if 'insert into public.statistics_shards' in sql:
                    raise OSError('Simulated service outage')
                return []
            with self.assertRaises(OSError):
                publish(Path(directory) / m['metadata']['snapshotId'], fail_on_shard)
            self.assertFalse(any('statistics_current' in sql for sql in queries))

    def test_fictional_data_cannot_be_promoted(self):
        with tempfile.TemporaryDirectory() as directory:
            m = build(fixture(), directory)
            with self.assertRaisesRegex(ValueError, 'fictional'):
                publish(Path(directory) / m['metadata']['snapshotId'], lambda sql: self.fail(sql))

    def test_success_promotes_in_final_transaction_after_shards(self):
        with tempfile.TemporaryDirectory() as directory:
            data = fixture(); data['fictional'] = False
            m = build(data, directory)
            queries = []
            def execute(sql): queries.append(sql); return []
            publish(Path(directory) / m['metadata']['snapshotId'], execute)
            self.assertEqual(sum('insert into public.statistics_shards' in q for q in queries), 3)
            self.assertIn('begin;', queries[-1])
            self.assertIn('statistics_current', queries[-1])
            self.assertIn('Incomplete snapshot', queries[-1])

    def test_discovery_reports_labels_without_claiming_verified_numbers(self):
        result = inspect(b'<table><tr><th>Delta 2</th></tr><tr><td>0</td></tr></table>'
                         b'<script id="__NEXT_DATA__" type="application/json">{"props":{}}</script>')
        self.assertEqual(result['tables'], [[['Delta 2'], ['0']]])
        self.assertEqual(result['embeddedJSON'][0]['rootKeys'], ['props'])
        self.assertEqual(result['verifiedObservations'], 0)

    def test_private_endpoints_are_rejected_and_failures_stop_probe(self):
        with self.assertRaises(ValueError): capture('https://a3.lolalytics.com/')
        with tempfile.TemporaryDirectory() as directory, patch('probe.capture', return_value=({'status': 403}, None)) as request:
            result = probe(['https://lolalytics.com/robots.txt', 'https://lolalytics.com/lol/ahri/build/'], Path(directory))
            self.assertEqual(request.call_count, 1)
            self.assertEqual(result['verifiedObservations'], 0)


if __name__ == '__main__':
    unittest.main()
