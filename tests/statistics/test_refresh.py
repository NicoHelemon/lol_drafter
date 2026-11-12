"""Lifecycle orchestration tested without remote requests or real publication."""
import copy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/statistics'))
import refresh
import maintenance
from pipeline import build, verify
from test_pipeline import fixture


def manifest():
    return dict(metadata=dict(fictional=False, importedAt=datetime.now(timezone.utc).isoformat(),
                             source='test', context={'windowDays':14}),
                shards={str(i):{} for i in range(10)}, pairCount=100, coverage={'vs':60,'with':40})


def previous():
    m = manifest()
    return dict(snapshotId='a'*64, source=m['metadata']['source'],context=m['metadata']['context'],
                shards=10,pairs=100,coverage=m['coverage'])


class RefreshTests(unittest.TestCase):
    def test_global_coverage_gate_accepts_twenty_percent_drop_but_rejects_each_metric_beyond_it(self):
        m = manifest(); refresh.validate_refresh(m, previous())
        for metric in ['shards','pairs','vs','with']:
            with self.subTest(metric=metric):
                changed = copy.deepcopy(m)
                if metric == 'shards': changed['shards'] = dict(list(m['shards'].items())[:8])
                elif metric == 'pairs': changed['pairCount'] = 80
                else: changed['coverage'][metric] *= .8
                refresh.validate_refresh(changed, previous())
                if metric == 'shards': changed['shards'].pop('0')
                elif metric == 'pairs': changed['pairCount'] = 79
                else: changed['coverage'][metric] -= 1
                with self.assertRaisesRegex(ValueError, 'coverage drop'):
                    refresh.validate_refresh(changed, previous())

    def test_stale_future_fictional_incomplete_or_changed_context_is_rejected(self):
        for case in ['stale','future','fictional','missing','source','context']:
            with self.subTest(case=case):
                m = manifest()
                if case == 'stale': m['metadata']['importedAt'] = (datetime.now(timezone.utc)-timedelta(hours=49)).isoformat()
                if case == 'future': m['metadata']['importedAt'] = (datetime.now(timezone.utc)+timedelta(minutes=6)).isoformat()
                if case == 'fictional': m['metadata']['fictional'] = True
                if case == 'missing': m['coverage']['with'] = 0
                if case == 'source': m['metadata']['source'] = 'changed'
                if case == 'context': m['metadata']['context']['windowDays'] = 30
                with self.assertRaises(ValueError): refresh.validate_refresh(m,previous())

    def test_verified_real_flagged_test_data_preserves_small_game_counts_and_publishes_then_checks_health(self):
        # Artificial values; false flag exercises isolated publishing, never a remote service.
        data = fixture(); data['fictional'] = False
        data['importedAt'] = datetime.now(timezone.utc).isoformat()
        data['pairs'][0]['games'] = 1
        with tempfile.TemporaryDirectory() as folder:
            m = build(data,folder); directory = Path(folder)/m['metadata']['snapshotId']
            _, groups = verify(directory)
            self.assertTrue(any(p['games'] == 1 for rows in groups.values() for p in rows))
            result = dict(snapshotId=m['metadata']['snapshotId'],pairs=m['pairCount'],shards=len(m['shards']))
            with patch.object(refresh,'publish',return_value=result) as publish, \
                    patch.object(refresh,'health',return_value=result), \
                    patch.object(refresh,'maintain',return_value={}) as maintain:
                self.assertEqual(refresh.publish_refresh(directory,None),result)
                publish.assert_called_once_with(directory)
                maintain.assert_called_once_with(dry_run=False)
            bad = dict(previous(),source=data['source'],context=data['context'],pairs=1_000)
            with patch.object(refresh,'publish') as publish, self.assertRaisesRegex(ValueError,'coverage drop'):
                refresh.publish_refresh(directory,bad)
            publish.assert_not_called()

    def test_missing_credentials_or_lifecycle_fails_before_collecting(self):
        import collect_lolalytics
        with patch.dict('os.environ',{'STATISTICS_SOURCE':'lolalytics','SUPABASE_ACCESS_TOKEN':''}), \
                patch.object(collect_lolalytics,'collect') as collect, self.assertRaises(ValueError):
            refresh.refresh()
        collect.assert_not_called()
        with patch.dict('os.environ',{'STATISTICS_SOURCE':'lolalytics','SUPABASE_ACCESS_TOKEN':'test','SUPABASE_PROJECT_REF':'test'}), \
                patch.object(refresh,'health',side_effect=RuntimeError('missing migration')), \
                patch.object(collect_lolalytics,'collect') as collect, self.assertRaises(RuntimeError):
            refresh.refresh()
        collect.assert_not_called()

    def test_maintenance_defaults_to_preview_and_audit_contains_only_reads(self):
        queries=[]
        def execute(sql):
            queries.append(sql)
            return [dict(maintenance={'dryRun':'true' in sql}, health=None)]
        self.assertTrue(maintenance.maintain(execute)['dryRun'])
        self.assertFalse(maintenance.maintain(execute,dry_run=False)['dryRun'])
        self.assertIsNone(maintenance.health(execute))
        maintenance.audit(execute)
        self.assertTrue(all(q.strip().lower().startswith('select') for q in queries))

    def test_postpublication_health_mismatch_is_visible(self):
        with patch.object(refresh,'verify',return_value=(manifest(),{})), \
                patch.object(refresh,'publish',return_value={'snapshotId':'a'*64,'pairs':100,'shards':10}), \
                patch.object(refresh,'health',return_value={'snapshotId':'b'*64}), \
                self.assertRaisesRegex(RuntimeError,'health mismatch'):
            refresh.publish_refresh(Path('isolated-test'),None)

    def test_cleanup_failure_does_not_mask_collection_error(self):
        import collect_lolalytics
        with patch.dict('os.environ',{'STATISTICS_SOURCE':'lolalytics','SUPABASE_ACCESS_TOKEN':'test','SUPABASE_PROJECT_REF':'test'}), \
                patch.object(refresh,'health',return_value=None), \
                patch.object(refresh,'maintain',side_effect=[{},RuntimeError('maintenance failed')]), \
                patch.object(collect_lolalytics,'collect',side_effect=ValueError('source failed')), \
                self.assertRaisesRegex(ValueError,'source failed'):
            refresh.refresh()


if __name__ == '__main__':
    unittest.main()
