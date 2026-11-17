"""Read-only compact export for the offline highlight experiment.

Requires SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN. Never called by the
website. Existing source.json pins the snapshot; use a new directory for a
different snapshot. No Auth users, profiles, rooms or source scraping.
"""
import argparse,concurrent.futures,gzip,hashlib,json,os,sys,time
from pathlib import Path
sys.path.insert(0,'scripts/statistics')
from publish import query

def main():
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,default=Path('work/exceptional-picks'));args=p.parse_args();out=args.output;out.mkdir(parents=True,exist_ok=True)
 assert os.environ['SUPABASE_PROJECT_REF'].isalnum()
 sourcepath=out/'source.json'
 if sourcepath.exists():source=json.loads(sourcepath.read_text())
 else:
  rows=query('select c.snapshot_id,s.metadata,m.model,r.catalogue from public.statistics_current c join public.statistics_snapshots s on s.id=c.snapshot_id join public.statistics_calibrations m on m.snapshot_id=c.snapshot_id join public.statistics_role_catalogues r on r.snapshot_id=c.snapshot_id')
  assert len(rows)==1;source=rows[0];sourcepath.write_text(json.dumps(source))
 sid=source['snapshot_id'];assert len(sid)==64 and all(c in '0123456789abcdef' for c in sid)
 if (out/'fetch-summary.json').exists():assert json.loads((out/'fetch-summary.json').read_text())['snapshotId']==sid,'Use a separate directory for each snapshot'
 keys=[r['candidate_key'] for r in query("select candidate_key from public.statistics_shards where snapshot_id='"+sid+"' order by candidate_key")];assert keys,'Pinned snapshot no longer available';chunks=[keys[i:i+20] for i in range(0,len(keys),20)]
 role="case p->>'otherRole' when 'Top' then 0 when 'Jungle' then 1 when 'Mid' then 2 when 'ADC' then 3 when 'Support' then 4 end"
 def fetch(i):
  path=out/f'chunk-{i:03}.json.gz'
  if path.exists():rows=json.loads(gzip.decompress(path.read_bytes()))
  else:
   selected=','.join("'"+k+"'" for k in chunks[i]);sql=f"select candidate_key,jsonb_agg(jsonb_build_array(case p->>'relation' when 'with' then 0 when 'vs' then 1 end,(p->>'otherChampionId')::integer,{role},(p->>'delta2')::double precision,(p->>'games')::integer)) pairs from public.statistics_shards s cross join lateral jsonb_array_elements(s.pairs) p where snapshot_id='{sid}' and candidate_key in ({selected}) group by candidate_key order by candidate_key"
   rows=query(sql);path.write_bytes(gzip.compress(json.dumps(rows,separators=(',',':')).encode()))
  assert set(r['candidate_key'] for r in rows)==set(chunks[i]);return rows
 started=time.monotonic()
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:results=list(pool.map(fetch,range(len(chunks))))
 rows=[r for chunk in results for r in chunk];assert len(rows)==len(keys)
 report={'snapshotId':sid,'shards':len(rows),'pairs':sum(len(r['pairs']) for r in rows),'chunks':len(chunks),'seconds':round(time.monotonic()-started,2),'readOnly':True,'sha256':hashlib.sha256(json.dumps(rows,sort_keys=True).encode()).hexdigest()}
 (out/'fetch-summary.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
if __name__=='__main__':main()
