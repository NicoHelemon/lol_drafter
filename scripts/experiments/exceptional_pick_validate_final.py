import sys,json
from pathlib import Path
import numpy as np
sys.path.insert(0,'scripts/experiments');from exceptional_pick_calibration import load,sample,features,describe,ROLES
out=Path('work/exceptional-picks/analysis');data=load(Path('work/exceptional-picks'));teams,bans=sample(data,2500,17021);report={'seed':17021,'drafts':2500,'rule_fixed_before_this_run':True,'rule':'positive score > 0, >= q95; score-median >= .5*9/m, full known coverage. Negative symmetric q05.','roles':{}}
def classify(f,m):
 return f['valid']&(f['score']>0)&(f['score']>=f['q95'])&(f['gap']>=.5*9/m),f['valid']&(f['score']<0)&(f['score']<=f['q05'])&(f['gap']<=-.5*9/m)
for r,role in enumerate(ROLES):
 vals,av,order=features(data,teams,bans,r,17121+r);full=describe(vals,av);fp,fn=classify(full,9);stages={};others=np.stack([teams[:,rel,k] for rel,k in [(0,k) for k in range(5) if k!=r]+[(1,k) for k in range(5)]],axis=1);ordered=np.take_along_axis(others,order,axis=1)
 for m in [1,3,5,6,7,8,9]:
  stageav=np.zeros_like(av);stageav[:,data['eligible'][r]]=True
  for b in bans.T:stageav[np.arange(len(teams)),b]=False
  for pick in ordered[:,:m].T:stageav[np.arange(len(teams)),pick]=False
  part=describe(vals,stageav,m);pp,pn=classify(part,m);rawpositive=int(pp.sum());unavailable=int((pp&~av).sum());pp&=av;pn&=av
  stages[str(m)]={'positive':int(pp.sum()),'positive_all_at_stage':rawpositive,'later_unavailable':unavailable,'negative':int(pn.sum()),'positive_retained':int((pp&fp).sum()),'negative_retained':int((pn&fn).sum()),'positive_above_final_median':int((pp&(full['gap']>0)).sum()),'positive_sign_reversed':int((pp&(full['score']<=0)).sum())}
 report['roles'][role]={'eligible':int(full['valid'].sum()),'contexts':len(teams),'positive':int(fp.sum()),'negative':int(fn.sum()),'positive_role_cases':int((fp.sum(axis=1)>0).sum()),'negative_role_cases':int((fn.sum(axis=1)>0).sum()),'positive_max_count':int(fp.sum(axis=1).max()),'score_quantiles':np.nanquantile(np.where(full['valid'],full['score'],np.nan),[.01,.05,.5,.95,.99]).tolist(),'partial':stages}
report['overall']={k:sum(report['roles'][r][k] for r in ROLES) for k in ['eligible','contexts','positive','negative','positive_role_cases','negative_role_cases']}
(out/'final-validation.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report['overall']))
for m in ['1','3','5','6','7','8','9']:
 rows=[report['roles'][r]['partial'][m] for r in ROLES];n=sum(x['positive'] for x in rows);print(m,n,'positive remains exceptional',sum(x['positive_retained'] for x in rows)/max(1,n),'above median',sum(x['positive_above_final_median'] for x in rows)/max(1,n))
