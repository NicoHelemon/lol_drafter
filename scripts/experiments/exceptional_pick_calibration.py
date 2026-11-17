"""Offline analysis only: real adjusted pair scores in simulated drafts.
No win-outcome validation, no production writes, no frontend integration.
"""
from __future__ import annotations
import argparse,gzip,hashlib,json,time,warnings
from pathlib import Path
import numpy as np
ROLES=['Top','Jungle','Mid','ADC','Support']

def load(source_dir:Path):
 source=json.loads((source_dir/'source.json').read_text());champions=json.loads(Path('src/data/champions.json').read_text());ids=[int(c['id']) for c in champions];index={v:i for i,v in enumerate(ids)};C=len(ids)
 raw=np.full((5,C,2,5,C),np.nan);games=np.zeros_like(raw);pairs=0
 for file in sorted(source_dir.glob('chunk-*.json.gz')):
  for shard in json.loads(gzip.decompress(file.read_bytes())):
   cid,role=shard['candidate_key'].split(':');r=ROLES.index(role);c=index[int(cid)]
   for rel,other,otherrole,delta,n in shard['pairs']:
    pairs+=1
    if delta is None or not n or n<=0:continue
    raw[r,c,rel,otherrole,index[other]]=delta;games[r,c,rel,otherrole,index[other]]=n
 k=source['model']['k'];adjusted=raw*games/(games+k)
 entries=source['catalogue']['entries'];eligible=[];weights=[]
 for role in ROLES:
  es=[e for e in entries if e['role']==role and e['lanePercent']>=5];eligible.append(np.array([index[int(e['championId'])] for e in es]));w=np.array([e['games'] for e in es],float);weights.append(w/w.sum())
 overall=np.zeros(C)
 for e in entries:overall[index[int(e['championId'])]]+=e['games']
 overall/=overall.sum()
 return dict(source=source,ids=ids,index=index,names=[c['name'] for c in champions],C=C,raw=raw,games=games,adjusted=adjusted,eligible=eligible,weights=weights,overall=overall,pairs=pairs)

def sample(data,n,seed,uniform=False,bans=10):
 rng=np.random.default_rng(seed);teams=np.zeros((n,2,5),int);banarray=np.zeros((n,bans),int)
 for i in range(n):
  used=set()
  for side in range(2):
   for role in range(5):
    es=data['eligible'][role];w=data['weights'][role]
    while True:
     c=int(rng.choice(es,p=None if uniform else w))
     if c not in used:break
    teams[i,side,role]=c;used.add(c)
  w=data['overall'].copy();w[list(used)]=0;w/=w.sum();banarray[i]=rng.choice(data['C'],size=bans,replace=False,p=w)
 return teams,banarray

def features(data,teams,bans,role,seed,adjusted=None):
 n=len(teams);C=data['C'];tensor=data['adjusted'] if adjusted is None else adjusted
 picks=[(0,r) for r in range(5) if r!=role]+[(1,r) for r in range(5)]
 vals=np.stack([tensor[role,:,rel,r,teams[:,rel,r]] for rel,r in picks],axis=-1)
 assert vals.shape==(n,C,9),vals.shape
 available=np.ones((n,C),bool)
 for rel,r in picks:available[np.arange(n),teams[:,rel,r]]=False
 for b in bans.T:available[np.arange(n),b]=False
 eligible=np.zeros(C,bool);eligible[data['eligible'][role]]=True;available&=eligible[None,:]
 rng=np.random.default_rng(seed);order=np.argsort(rng.random((n,9)),axis=1);vals=np.take_along_axis(vals,order[:,None,:],axis=-1)
 return vals,available,order

def describe(vals,available,m=9,coverage=1.):
 x=vals[:,:,:m];known=np.sum(np.isfinite(x),axis=-1);s=np.nansum(x,axis=-1)/np.maximum(known,1);s[known==0]=np.nan
 valid=available&(known>=max(1,int(np.ceil(m*coverage))))
 ref=np.where(valid,s,np.nan)
 with warnings.catch_warnings():
  warnings.simplefilter('ignore',RuntimeWarning)
  med=np.nanmedian(ref,axis=1);q=np.nanquantile(ref,[.025,.05,.95,.975],axis=1);mad=np.nanmedian(np.abs(ref-med[:,None]),axis=1)*1.4826
 valid&=(np.sum(valid,axis=1)>=20)[:,None]
 return dict(score=s,valid=valid,median=med[:,None],gap=s-med[:,None],q025=q[0,:,None],q05=q[1,:,None],q95=q[2,:,None],q975=q[3,:,None],sigma=mad[:,None],known=known)

RULES={
 'old_p95_gap050':(95,.5,0,False),
 'p95_gap050_sign':(95,.5,0,True),
 'p975_gap050':(97.5,.5,0,True),
 'p95_gap075':(95,.75,0,True),
 'p975_gap075':(97.5,.75,0,True),
 'p95_gap100':(95,1.,0,True),
 'p95_robust25_floor050':(95,.5,2.5,True),
 'p95_robust30_floor050':(95,.5,3.,True),
 'p975_robust20_floor050':(97.5,.5,2.,True),
}
def flags(f,name):
 percentile,floor,z,sign=RULES[name];s=f['score'];gap=f['gap'];limit=np.maximum(floor,z*f['sigma']);hi=f['q95'] if percentile==95 else f['q975'];lo=f['q05'] if percentile==95 else f['q025']
 positive=f['valid']&(s>=hi)&(gap>=limit);negative=f['valid']&(s<=lo)&(gap<=-limit)
 if sign:positive&=s>0;negative&=s<0
 return positive,negative

def aggregate(f,fp,fn):
 n=len(f['score']);v=f['valid'];total=int(v.sum());return dict(contexts=n,eligible_candidates=total,positive=int(fp.sum()),negative=int(fn.sum()),positive_rate=float(fp.sum()/max(total,1)),negative_rate=float(fn.sum()/max(total,1)),mean_positive_per_role=float(fp.sum()/n),mean_negative_per_role=float(fn.sum()/n),no_positive_fraction=float(np.mean(fp.sum(axis=1)==0)),no_negative_fraction=float(np.mean(fn.sum(axis=1)==0)),more_than_two_positive_fraction=float(np.mean(fp.sum(axis=1)>2)),positive_median_score=float(np.median(f['score'][fp])) if fp.any() else None,negative_median_score=float(np.median(f['score'][fn])) if fn.any() else None)

def run(data,n,seed,uniform=False):
 teams,bans=sample(data,n,seed,uniform);out={};details={};started=time.monotonic()
 for role in range(5):
  vals,av,order=features(data,teams,bans,role,seed+100+role);f=describe(vals,av);details[role]=(vals,av,order,f)
  summaries={}
  for name in RULES:
   p,neg=flags(f,name);summaries[name]=aggregate(f,p,neg)
  out[ROLES[role]]={'reference_count':len(data['eligible'][role]),'coverage_complete_fraction':float(f['valid'].sum()/max(1,av.sum())),'score_quantiles':np.nanquantile(np.where(f['valid'],f['score'],np.nan),[.01,.025,.05,.5,.95,.975,.99]).tolist(),'median_sigma':float(np.median(f['sigma'])),'rules':summaries}
 print('completed',n,seed,uniform,round(time.monotonic()-started,2),flush=True)
 return out,details,(teams,bans)

def main():
 p=argparse.ArgumentParser();p.add_argument('--source',type=Path,default=Path('work/exceptional-picks'));p.add_argument('--output',type=Path,default=Path('work/exceptional-picks/analysis'));args=p.parse_args();args.output.mkdir(exist_ok=True);started=time.monotonic();data=load(args.source)
 outputs={'source_snapshot':data['source']['snapshot_id'],'source_metadata':data['source']['metadata'],'k':data['source']['model']['k'],'pairs':data['pairs'],'method':'real pairwise values in simulated distinct-champion drafts, not observed game outcomes','candidate_universe':'existing lanePercent>=5 filter, remove the other nine picks and ten popularity-weighted bans; no personal-pool restriction','rules':RULES}
 train,train_details,_=run(data,2000,17011);outputs['development']=train;(args.output/'development.json').write_text(json.dumps(train,indent=2))
 held,held_details,held_drafts=run(data,4000,17012);outputs['validation']=held
 uniform,_,_=run(data,1500,17013,True);outputs['uniform_sensitivity']=uniform
 # Partial-draft stability and one-pick influence; this is stress testing, not confidence intervals.
 stability={}
 for role,(vals,av,order,full) in held_details.items():
  r={}
  teams,bans=held_drafts;other=np.stack([teams[:,rel,r] for rel,r in [(0,r) for r in range(5) if r!=role]+[(1,r) for r in range(5)]],axis=1);ordered=np.take_along_axis(other,order,axis=1);partials={}
  for m in [1,3,5,6,7,8]:
   partial_av=np.zeros_like(av);partial_av[:,data['eligible'][role]]=True
   for b in bans.T:partial_av[np.arange(len(teams)),b]=False
   for pick in ordered[:,:m].T:partial_av[np.arange(len(teams)),pick]=False
   partials[m]=describe(vals,partial_av,m)
  for name in RULES:
   full_p,full_n=flags(full,name);stages={}
   for m in [1,3,5,6,7,8]:
    partial=partials[m];pp,pn=flags(partial,name);became_unavailable=pp&~av;pp=pp&av;pn=pn&av;samep=pp&full_p;samen=pn&full_n
    stages[str(m)]={'positive':int(pp.sum()),'positive_unavailable_later':int(became_unavailable.sum()),'positive_retained_to_full':float(samep.sum()/max(1,pp.sum())),'positive_still_above_final_median':float((pp&(full['gap']>0)).sum()/max(1,pp.sum())),'positive_sign_reversal':float((pp&(full['score']<=0)).sum()/max(1,pp.sum())),'negative':int(pn.sum()),'negative_retained_to_full':float(samen.sum()/max(1,pn.sum()))}
   r[name]=stages
  stability[ROLES[role]]=r
 outputs['partial_stability']=stability
 np.savez_compressed(args.output/'simulation.npz',teams=held_drafts[0],bans=held_drafts[1],**{f'vals_{r}':v[0] for r,v in held_details.items()},**{f'available_{r}':v[1] for r,v in held_details.items()})
 outputs['elapsed_seconds']=round(time.monotonic()-started,2);(args.output/'initial-results.json').write_text(json.dumps(outputs,indent=2)+'\n');print('saved',outputs['elapsed_seconds'],flush=True)
if __name__=='__main__':main()
