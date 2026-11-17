import sys,json
from pathlib import Path
import numpy as np
sys.path.insert(0,'scripts/experiments');from exceptional_pick_calibration import load,describe,flags,ROLES
out=Path('work/exceptional-picks/analysis');data=load(Path('work/exceptional-picks'));sim=np.load(out/'simulation.npz');rng=np.random.default_rng(17030);results={}
for r,role in enumerate(ROLES):
 av=sim[f'available_{r}'];f=describe(sim[f'vals_{r}'],av);p,n=flags(f,'p95_gap050_sign');scores={};es=data['eligible'][r];w=data['weights'][r];order=es[np.argsort(w)[::-1]]
 for mode in ['popular5','personal_weighted5','personal_uniform5','personal_weighted10']:
  masks=np.zeros_like(av);count=10 if mode.endswith('10') else 5
  for i in range(len(av)):
   if mode=='popular5':chosen=order[av[i,order]][:count]
   else:
    allowed=es[av[i,es]];weights=w[av[i,es]];weights/=weights.sum();chosen=rng.choice(allowed,size=count,replace=False,p=None if 'uniform' in mode else weights)
   masks[i,chosen]=True
  scores[mode]={'displayed':int(masks.sum()),'positive':int((masks&p).sum()),'negative':int((masks&n).sum()),'contexts':len(av),'positive_role_cases':int(((masks&p).sum(axis=1)>0).sum()),'negative_role_cases':int(((masks&n).sum(axis=1)>0).sum())}
 results[role]=scores
(out/'visible-pools.json').write_text(json.dumps(results,indent=2)+'\n')
for mode in results['Top']:
 rows=[results[role][mode] for role in ROLES];print(mode,'positive%',sum(r['positive'] for r in rows)/sum(r['displayed'] for r in rows)*100,'roles_anypositive%',sum(r['positive_role_cases'] for r in rows)/sum(r['contexts'] for r in rows)*100,'negative%',sum(r['negative'] for r in rows)/sum(r['displayed'] for r in rows)*100)
