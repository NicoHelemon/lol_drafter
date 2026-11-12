"""Synthetic API-shaped tables: no claim of live Synergy extraction."""
import copy
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/statistics'))
from inspect_lolalytics import normalize_groups, COLUMNS
from pipeline import CONTEXT, LEGACY_CONTEXT, build, verify, validate


def document(pairs, context=CONTEXT):
    return dict(id='synthetic-no-cutoff', patch='14', tier='Emerald+',
                source='Synthetic schema test, no live Synergy data', fictional=True,
                importedAt='2026-11-12T00:00:00Z', context=dict(context), pairs=pairs)


class PairNormalizationTests(unittest.TestCase):
    def test_same_champion_in_different_roles_keeps_both_directional_rows(self):
        pairs, _, _ = normalize_groups({'top': [[64, 50, 1, -2.5, 0, 1]],
                                       'jungle': [[64, 50, 1, 0, 0, 7]]}, 'vs', 58, 'top', COLUMNS)
        self.assertEqual([(r['otherRole'], r['delta2'], r['games']) for r in pairs],
                         [('Top', -2.5, 1), ('Jungle', 0, 7)])
        self.assertTrue(all(r['candidateRole'] == 'Top' and r['candidateChampionId'] == '58' for r in pairs))

    def test_synergy_preserves_points_games_zero_null_and_missing_role(self):
        pairs, _, _ = normalize_groups({'middle': [[103, 50, 2, 1.25, 0, 3]],
                                       'bottom': [[202, 50, 2, 0, 0, 1]],
                                       'jungle': [[64, 50, 2, None, 0, 0]]}, 'with', 58, 'top', COLUMNS)
        self.assertEqual([p['delta2'] for p in pairs], [1.25, 0, None])
        self.assertFalse(any(p['otherRole'] == 'Support' for p in pairs))
        self.assertTrue(all(p['relation'] == 'with' for p in pairs))

    def test_invalid_shapes_values_duplicates_and_same_role_synergy_fail(self):
        cases = [({'middle': [[103, 50, 1, True, 0, 3]]}, 'with'),
                 ({'middle': [[103, 50, 1, float('nan'), 0, 3]]}, 'with'),
                 ({'middle': [[103, 50, 1, 1, 0, -1]]}, 'with'),
                 ({'middle': [[103, 50, 1, 1, 0]]}, 'with'),
                 ({'mid': [[103, 50, 1, 1, 0, 3]]}, 'with'),
                 ({'top': [[103, 50, 1, 1, 0, 3]]}, 'with'),
                 ({'middle': [[103, 50, 1, 1, 0, 3]] * 2}, 'vs')]
        for groups, relation in cases:
            with self.subTest(groups=groups), self.assertRaises(ValueError):
                normalize_groups(groups, relation, 58, 'top', COLUMNS)
        with self.assertRaises(ValueError):
            normalize_groups({}, 'vs', 58, 'top', ['id', 'wr', 'd1', 'wr_delta', 'pr', 'n'])

    def test_new_snapshot_roundtrip_has_both_relations_without_sample_cutoffs(self):
        against, _, _ = normalize_groups({'jungle': [[64, 50, 1, -2.5, 0, 7]]}, 'vs', 58, 'top', COLUMNS)
        synergy, _, _ = normalize_groups({'middle': [[103, 50, 1, 0, 0, 1]]}, 'with', 58, 'top', COLUMNS)
        with tempfile.TemporaryDirectory() as directory:
            manifest = build(document(against + synergy), directory)
            verified, groups = verify(Path(directory) / manifest['metadata']['snapshotId'])
            self.assertEqual(verified['coverage'], {'vs': 1, 'with': 1})
            self.assertEqual({p['games'] for p in groups['58:Top']}, {1, 7})
            self.assertEqual(manifest['metadata']['context']['minGames'], 0)
            self.assertEqual(manifest['metadata']['context']['minLanePercent'], 0)
            self.assertTrue(manifest['metadata']['fictional'])

    def test_old_snapshot_context_and_sample_policy_remain_verifiable(self):
        rows, _, _ = normalize_groups({'jungle': [[64, 50, 1, 1, 0, 100]]}, 'vs', 58, 'top', COLUMNS)
        with tempfile.TemporaryDirectory() as directory:
            manifest = build(document(rows, LEGACY_CONTEXT), directory)
            verified, _ = verify(Path(directory) / manifest['metadata']['snapshotId'])
            self.assertEqual(verified['metadata']['context'], LEGACY_CONTEXT)
        old = document(copy.deepcopy(rows), LEGACY_CONTEXT)
        old['pairs'][0]['games'] = 99
        with self.assertRaises(ValueError):
            validate(old)
        validate(document(old['pairs']))


if __name__ == '__main__':
    unittest.main()
