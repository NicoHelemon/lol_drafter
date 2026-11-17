"""Synthetic calibration tests, not claims of temporal predictive validation."""
from datetime import datetime, timedelta, timezone
import math
from pathlib import Path
import random
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts/statistics'))
from calibration import fit, summarize, reusable, context_key
import publish

NOW=datetime(2026,11,14,5,0,tzinfo=timezone.utc)
META={'snapshotId':'a'*64,'source':'Synthetic fixture','tier':'Test','context':{'windowDays':14}}


class CalibrationTests(unittest.TestCase):
    def test_recovers_known_normal_variance_and_common_k_from_both_relations(self):
        # With constant n the MLE is exactly mean(d²)-2500/n (centred at zero).
        groups={'test':[{'relation':r,'games':1000,'delta2':d}
                        for r in ('vs','with') for d in (-math.sqrt(6.5), math.sqrt(6.5))]}
        model=fit(*summarize(groups),META,NOW)
        self.assertAlmostEqual(model['priorVariance'],4,places=5)
        self.assertAlmostEqual(model['k'],625,places=3)
        self.assertEqual(model['relationCounts'],{'vs':2,'with':2})

    def test_heterogeneous_sample_sizes_recover_synthetic_signal_without_mutating_pairs(self):
        rng=random.Random(24)
        groups={'test':[{'relation':'vs' if i%2 else 'with','games':n,'delta2':rng.gauss(0,math.sqrt(4+2500/n))}
                        for i in range(8000) for n in [20,100,1000,10000]]}
        original=[dict(p) for p in groups['test']]
        model=fit(*summarize(groups),META,NOW)
        self.assertLess(abs(model['k']-625),60)
        self.assertEqual(groups['test'],original)

    def test_zero_signal_boundary_is_explicit_and_missing_counts_are_not_invented(self):
        rows=[{'relation':r,'games':100,'delta2':0} for r in ('vs','with')]
        rows.extend([{'relation':'vs','games':0,'delta2':12},{'relation':'with','games':100,'delta2':None}])
        m=fit(*summarize({'test':rows}),META,NOW)
        self.assertIsNone(m['k']);self.assertEqual(m['priorVariance'],0);self.assertEqual(m['observations'],2)
        with self.assertRaises(ValueError):fit([],{'vs':0,'with':0},META,NOW)

    def test_calibration_reused_for_thirty_days_only_in_identical_context(self):
        m=fit([{'games':1000,'count':2,'sumSquares':13}],{'vs':1,'with':1},META,NOW)
        self.assertTrue(reusable(m,META,NOW+timedelta(days=29,hours=23)))
        self.assertFalse(reusable(m,META,NOW+timedelta(days=30)))
        self.assertFalse(reusable(m,META,NOW-timedelta(seconds=1)))
        changed={**META,'tier':'Other'}
        self.assertNotEqual(context_key(META),context_key(changed));self.assertFalse(reusable(m,changed,NOW))

    def test_publisher_reuses_a_recent_model_and_keeps_model_failure_before_promotion(self):
        import tempfile
        from pipeline import build
        from test_pipeline import fixture
        data=fixture();data['fictional']=False
        with tempfile.TemporaryDirectory() as folder:
            m=build(data,folder);directory=Path(folder)/m['metadata']['snapshotId']
            recent=fit([{'games':1000,'count':2,'sumSquares':13}],{'vs':1,'with':1},m['metadata'])
            queries=[]
            def execute(sql):
                queries.append(sql)
                return [{'model':recent}] if 'select c.model' in sql else []
            with patch.object(publish,'fit',side_effect=AssertionError('Should reuse model')):
                result=publish.publish(directory,execute)
            self.assertEqual(result['calibration'],recent)
            self.assertIn('statistics_calibrations',queries[-1]);self.assertIn('Calibration conflict',queries[-1])
            queries=[]
            def unavailable(sql):
                queries.append(sql)
                if 'select model' in sql:raise RuntimeError('model store unavailable')
                return []
            with self.assertRaises(RuntimeError):publish.publish(directory,unavailable)
            self.assertFalse(any('statistics_current' in q for q in queries))
