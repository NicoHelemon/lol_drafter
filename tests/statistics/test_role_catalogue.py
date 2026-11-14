from pathlib import Path
import json
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts/statistics'))
from role_catalogue import inspect_tierlist,document,validate
from pipeline import build,verify
from publish import publish
from test_pipeline import fixture

class RoleCatalogueTests(unittest.TestCase):
    def test_real_public_role_rows_preserve_lane_share_pick_rate_and_games(self):
        root=Path(__file__).parent/'fixtures/role-catalogue'
        for lane in ('top','middle'):
            source=json.loads((root/(lane+'-source.json')).read_text())
            rows=inspect_tierlist((root/(lane+'.html')).read_bytes(),lane)
            for value,row in zip(source['samples'],rows):
                self.assertEqual(row['championId'],str(value['cid']))
                self.assertEqual(row['games'],value['row']['games'])
                self.assertEqual(row['lanePercent'],value['row']['pctLane'])
                self.assertEqual(row['pickPercent'],value['row']['pr'])
            with self.assertRaises(ValueError):inspect_tierlist((root/(lane+'.html')).read_bytes(),'support')

    def test_catalogue_sidecar_is_verified_and_does_not_change_raw_pairs_or_identity(self):
        row={'championId':'58','role':'Top','lanePercent':95,'pickPercent':6,'games':1000}
        with tempfile.TemporaryDirectory() as folder:
            data=fixture();base=build(data,folder)
            data['roleCatalogue']=document([row]);model=build(data,folder)
            self.assertEqual(model['metadata'],base['metadata'])
            path=Path(folder)/model['metadata']['snapshotId'];verify(path)
            (path/'role-catalogue.json').write_text('{}')
            with self.assertRaisesRegex(ValueError,'Corrupt role catalogue'):verify(path)
        with self.assertRaisesRegex(ValueError,'duplicate'):validate(document([row,row]))

    def test_publisher_adds_role_catalogue_inside_atomic_promotion_only(self):
        data=fixture();data['fictional']=False
        data['roleCatalogue']=document([{'championId':'58','role':'Top','lanePercent':95,'pickPercent':6,'games':1000}])
        with tempfile.TemporaryDirectory() as folder:
            m=build(data,folder);queries=[]
            publish(Path(folder)/m['metadata']['snapshotId'],lambda q:queries.append(q) or [])
            self.assertIn('statistics_role_catalogues',queries[-1]);self.assertIn('Role catalogue conflict',queries[-1])
            self.assertFalse(any('statistics_role_catalogues' in q for q in queries[:-1]))
