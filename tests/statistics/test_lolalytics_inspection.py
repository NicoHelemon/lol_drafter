"""Small real public HTML excerpts, with separate synthetic corruptions.

Provenance/comparison: docs/statistics/public-poc-2026-11-12.json.
These tests prove Against decoding, not permission or a complete source adapter.
"""
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/statistics'))
from inspect_lolalytics import inspect, QwikHTML, References, verify_display
from pipeline import validate

FIXTURES = Path(__file__).parent / 'fixtures/lolalytics'


class LolalyticsInspectionTests(unittest.TestCase):
    def read(self, champion='renekton', lane='top', raw=None):
        return inspect(raw or (FIXTURES / f'{champion}.html').read_bytes(),
                       f'https://lolalytics.com/lol/{champion}/build/?lane={lane}&patch=14')

    def mutate(self, change):
        parser = QwikHTML()
        parser.feed((FIXTURES / 'renekton.html').read_text())
        data = json.loads(parser.blocks[0])
        change(data['objs'])
        return ('<script type="qwik/json">' + json.dumps(data) + '</script>').encode()

    def test_real_observations_match_displayed_delta2_not_winrate_or_delta1(self):
        for champion, lane, other, role, delta, games in [
            ('renekton', 'top', '799', 'Top', 2.09, 8509),
            ('renekton', 'top', '103', 'Mid', -0.79, 8663),
            ('ahri', 'middle', '64', 'Jungle', -0.31, 17102),
            ('jhin', 'bottom', '145', 'ADC', -2.07, 74649),
        ]:
            with self.subTest(champion=champion, other=other):
                audit = self.read(champion, lane)
                row = next(r for r in audit['observations'] if r['otherChampionId'] == other and r['otherRole'] == role)
                self.assertEqual((row['delta2'], row['games']), (delta, games))
                self.assertEqual(row['relation'], 'vs')

    def test_real_zeros_preserved_and_missing_pair_never_filled(self):
        audit = self.read()
        self.assertEqual(audit['zeroCount'], 3)
        self.assertTrue(any(r['otherChampionId'] == '266' and r['delta2'] == 0 for r in audit['observations']))
        self.assertFalse(any(r['otherChampionId'] == '122' for r in audit['observations']))
        self.assertFalse(any(r['relation'] == 'with' for r in audit['observations']))

    def test_audit_cannot_be_imported_as_verified_dataset(self):
        audit = self.read()
        self.assertFalse(audit['publicationEligible'])
        with self.assertRaises(ValueError):
            validate(audit)

    def test_wrong_filters_or_url_are_rejected(self):
        raw = (FIXTURES / 'renekton.html').read_bytes()
        for url in ['https://lolalytics.com/lol/renekton/build/?lane=top&patch=30',
                    'https://lolalytics.com/lol/renekton/build/?lane=middle&patch=14',
                    'https://a1.lolalytics.com/lol/renekton/build/?lane=top&patch=14']:
            with self.subTest(url=url), self.assertRaises(ValueError):
                inspect(raw, url)
        def change(objs):
            index = objs.index('emerald_plus')
            objs[index] = 'diamond_plus'
        with self.assertRaises(ValueError):
            self.read(raw=self.mutate(change))

    def test_unknown_column_layout_fails_closed(self):
        def change(objs):
            objs[objs.index('d2')] = 'wr_delta'
        with self.assertRaisesRegex(ValueError, 'column schema'):
            self.read(raw=self.mutate(change))

    def test_synthetic_low_games_are_kept_and_null_is_not_zero(self):
        def change(objs):
            root = next(o for o in objs if isinstance(o, dict) and 'enemy_h' in o)
            groups = objs[int(root['enemy'], 36)]
            rows = objs[int(groups['top'], 36)]
            first = objs[int(rows[0], 36)]
            objs[int(first[5], 36)] = 99
            second = objs[int(rows[1], 36)]
            objs[int(second[3], 36)] = None
        audit = self.read(raw=self.mutate(change))
        self.assertEqual(audit['rejected'], {})
        self.assertTrue(any(r['games'] == 99 for r in audit['observations']))
        self.assertEqual(audit['nullCount'], 3)  # The original three zeros shared one Qwik reference.
        self.assertEqual(audit['zeroCount'], 0)

    def test_independent_rendered_samples_match_pruned_public_excerpts(self):
        report = json.loads((Path(__file__).resolve().parents[2] / 'docs/statistics/public-poc-2026-11-12.json').read_text())
        for page, lane in zip(report['pages'], ['top', 'middle', 'bottom']):
            rows = [dict(href=s['matchupHref'], name=s['otherName'], cells=s['displayedCells']) for s in page['samples']]
            audit = self.read(page['champion'], lane)
            self.assertEqual(verify_display(audit, rows), len(rows))
            rows[0]['cells'] = list(rows[0]['cells'])
            rows[0]['cells'][2] = '99.00'
            with self.assertRaisesRegex(ValueError, 'differ'):
                verify_display(audit, rows)

    def test_probe_recognizes_qwik_without_claiming_numeric_verification(self):
        from probe import inspect as probe_inspect
        result = probe_inspect((FIXTURES / 'renekton.html').read_bytes())
        self.assertEqual(result['embeddedJSON'][0]['rootKeys'], ['objs'])
        self.assertTrue(result['embeddedJSON'][0]['validJSON'])
        self.assertEqual(result['verifiedObservations'], 0)

    def test_invalid_or_cyclic_reference_is_rejected(self):
        for objects, ref in [([['0']], '0'), ([None], '7'), ([None], '0!')]:
            with self.subTest(ref=ref), self.assertRaises(ValueError):
                References(objects).read(ref)


if __name__ == '__main__':
    unittest.main()
