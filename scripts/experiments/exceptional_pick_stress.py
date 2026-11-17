import json,sys,gzip,hashlib,math
from pathlib import Path
import numpy as np
sys.path.insert(0,'scripts/experiments');from exceptional_pick_calibration import load,features,describe,sample,ROLES,flags
out=Path('work/exceptional-picks/analysis');data=load(Path('work/exceptional-picks'));sim=np.load(out/'simulation.npz');teams,bans=sim['teams'],sim['bans'];rule='p95_gap050_sign';output={}
# Archived snapshot is a rolling-window sensitivity check, NOT independent temporal validation.
archive=Path('statistics-cache/full-2026-11-12/snapshots/0551fd06485293f646720494eef5e1a4158aca434145a860ac66028fb5ebf0fb');manifest=json.loads((archive/'manifest.json').read_text());oldraw=np.full_like(data['raw'],np.nan);oldgames=np.zeros_like(oldraw);n=0
for key,shard in manifest['shards'].items():
 raw=gzip.decompress((archive/shard['file']).read_bytes());assert hashlib.sha256(raw).hexdigest()==shard['sha256'];c,role=key.split(':');r=ROLES.index(role);c=data['index'][int(c)]
 for p in json.loads(raw):
  if p['delta2'] is None or not p.get('games'):continue
  rel=0 if p['relation']=='with' else 1;otherrole=ROLES.index(p['otherRole']);other=data['index'][int(p['otherChampionId'])];oldraw[r,c,rel,otherrole,other]=p['delta2'];oldgames[r,c,rel,otherrole,other]=p['games'];n+=1
k=data['source']['model']['k'];tensors={'half_k':data['raw']*data['games']/(data['games']+k/2),'double_k':data['raw']*data['games']/(data['games']+k*2),'nov12_same_k':oldraw*oldgames/(oldgames+k)}
for variant,tensor in tensors.items():
 rows=[]
 for r in range(5):
  full=describe(sim[f'vals_{r}'],sim[f'available_{r}']);fp,fn=flags(full,rule);vals,av,_=features(data,teams,bans,r,17112+r,adjusted=tensor);f=describe(vals,av);pp,pn=flags(f,rule)
  rows.append({'role':ROLES[r],'baseline_positive':int(fp.sum()),'positive_retained':int((fp&pp).sum()),'positive_above_median':int((fp&(f['gap']>0)).sum()),'positive_sign_reversed':int((fp&(f['score']<=0)).sum()),'baseline_negative':int(fn.sum()),'negative_retained':int((fn&pn).sum()),'valid_comparisons':int((full['valid']&f['valid']).sum()),'score_differences_q50_q95_q99':np.quantile(np.abs(full['score']-f['score'])[full['valid']&f['valid']],[.5,.95,.99]).tolist()})
 output[variant]=rows
# Conditional recommendations using score-biased incomplete teams: sample 8 slots,
# choose the strongest draft-fit in one other ally and one enemy role, then re-evaluate.
opt_teams,opt_bans=sample(data,1500,17016);sampled=opt_teams.copy()
for slotteam,slotrole in [(0,1),(1,2)]:
 for i in range(len(opt_teams)):
  d=opt_teams[i];used=set(d.flatten());used.remove(d[slotteam,slotrole]);used.update(opt_bans[i]);es=[c for c in data['eligible'][slotrole] if c not in used];scores=[]
  for c in es:
   vals=[data['adjusted'][slotrole,c,0,r,d[slotteam,r]] for r in range(5) if r!=slotrole]+[data['adjusted'][slotrole,c,1,r,d[1-slotteam,r]] for r in range(5)];scores.append(np.nanmean(vals))
  if es:opt_teams[i,slotteam,slotrole]=es[int(np.nanargmax(scores))]
rows=[]
for r in range(5):
 vals,av,_=features(data,opt_teams,opt_bans,r,17017+r);f=describe(vals,av);fp,fn=flags(f,rule);rows.append({'role':ROLES[r],'eligible':int(f['valid'].sum()),'positive':int(fp.sum()),'negative':int(fn.sum()),'contexts':len(opt_teams),'no_positive_fraction':float(np.mean(fp.sum(axis=1)==0))})
output['score_biased_compositions']=rows
# Numerical parity to an independent scalar loop over the same source formula.
checks=0;maxerr=0
for r in range(5):
 vals,av,order=features(data,teams[:30],bans[:30],r,17112+r)
 for i in range(30):
  c=int(data['eligible'][r][i%len(data['eligible'][r])]);picks=[(0,j) for j in range(5) if j!=r]+[(1,j) for j in range(5)]
  for m in [1,3,6,9]:
   expected=[]
   for pos in order[i,:m]:
    rel,j=picks[pos];other=teams[i,rel,j];d=data['raw'][r,c,rel,j,other];games=data['games'][r,c,rel,j,other]
    if np.isfinite(d) and games>0:expected.append(float(d)*float(games)/(float(games)+k))
   actual=vals[i,c,:m];actual=actual[np.isfinite(actual)];a=float(np.mean(actual)) if len(actual) else None;b=math.fsum(expected)/len(expected) if expected else None;assert(a is None)==(b is None)
   if a is not None:maxerr=max(maxerr,abs(a-b));assert abs(a-b)<1e-12
   checks+=1
output['formula_parity']={'cases':checks,'max_absolute_error':maxerr};output['archive']={'snapshot':manifest['metadata']['snapshotId'],'pairs':n,'all_shard_hashes_verified':True,'overlapping_14_day_windows':True};(out/'stress-results.json').write_text(json.dumps(output,indent=2)+'\n')
print('parity',output['formula_parity'])
for name,rows in output.items():
 if not isinstance(rows,list):continue
 if 'baseline_positive' in rows[0]:
  n=sum(r['baseline_positive'] for r in rows);print(name,'retained',sum(r['positive_retained'] for r in rows)/n,'above',sum(r['positive_above_median'] for r in rows)/n)
 else:print(name,'positive',sum(r['positive'] for r in rows)/sum(r['eligible'] for r in rows),'negative',sum(r['negative'] for r in rows)/sum(r['eligible'] for r in rows))
