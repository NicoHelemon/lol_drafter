"""Stress test candidates outside the usual role filter, against its same reference."""
import json,sys
from pathlib import Path
import numpy as np
sys.path.insert(0,'scripts/experiments')
from exceptional_pick_calibration import load,describe,flags,ROLES
root=Path('work/exceptional-picks/analysis');data=load(Path('work/exceptional-picks'));s=np.load(root/'simulation.npz');teams,bans=s['teams'],s['bans'];results={}
for r,role in enumerate(ROLES):
 f=describe(s[f'vals_{r}'],s[f'available_{r}']);av=np.ones_like(f['valid']);av[:,data['eligible'][r]]=False
 for side,j in [(0,j) for j in range(5) if j!=r]+[(1,j) for j in range(5)]:av[np.arange(len(teams)),teams[:,side,j]]=False
 for b in bans.T:av[np.arange(len(teams)),b]=False
 nall=int(av.sum());f['valid']=av&(f['known']==9);p,n=flags(f,'p95_gap050_sign');results[role]={'offrole_available':nall,'fully_known':int(f['valid'].sum()),'positive':int(p.sum()),'negative':int(n.sum())}
(root/'offrole.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(results))
