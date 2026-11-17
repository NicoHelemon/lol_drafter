import sys,json,warnings
from pathlib import Path
import numpy as np
sys.path.insert(0,'scripts/experiments');from exceptional_pick_calibration import load,features,describe,sample,ROLES
out=Path('work/exceptional-picks/analysis');data=load(Path('work/exceptional-picks'));sim=np.load(out/'simulation.npz');teams=sim['teams'];bans=sim['bans'];allresults={};thresholds={};examples=[]
def flag(f,floor=.5,power=0,m=9,q=95):
 gap=f['gap'];limit=floor*(9/m)**power;hi=f['q95'] if q==95 else f['q975'];lo=f['q05'] if q==95 else f['q025'];return (f['valid']&(f['score']>0)&(f['score']>=hi)&(gap>=limit),f['valid']&(f['score']<0)&(f['score']<=lo)&(gap<=-limit))
for r,role in enumerate(ROLES):
 vals=sim[f'vals_{r}'];av=sim[f'available_{r}'];f=describe(vals,av);fp,fn=flag(f);parts={}
 # Reproduce the random reveal order used in the primary experiment.
 _,_,order=features(data,teams,bans,r,17012+100+r)
 pairs=[(0,k) for k in range(5) if k!=r]+[(1,k) for k in range(5)];other=np.stack([teams[:,rel,k] for rel,k in pairs],axis=1);ordered=np.take_along_axis(other,order,axis=1)
 for m in [1,3,5,6,7,8,9]:
  stageav=np.zeros_like(av);stageav[:,data['eligible'][r]]=True
  for b in bans.T:stageav[np.arange(len(teams)),b]=False
  for p in ordered[:,:m].T:stageav[np.arange(len(teams)),p]=False
  partial=describe(vals,stageav,m);stages={}
  for power in [0,.5,1]:
   pp,pn=flag(partial,power=power,m=m);latergone=pp&~av;pp&=av;pn&=av
   stages[str(power)]={'positive':int(pp.sum()),'negative':int(pn.sum()),'positive_available_denominator':int((partial['valid']&av).sum()),'positive_later_unavailable':int(latergone.sum()),'positive_still_flagged':int((pp&fp).sum()),'positive_above_final_median':int((pp&(f['gap']>0)).sum()),'positive_sign_reversed':int((pp&(f['score']<=0)).sum()),'negative_still_flagged':int((pn&fn).sum()),'positive_final_score_median':float(np.median(f['score'][pp])) if pp.any() else None}
  parts[str(m)]=stages
 threshold={}
 for cut in [.3,.35,.4,.45,.5,.55,.6,.65,.7,.75,1.]:
  pp,pn=flag(f,cut);threshold[str(cut)]={'eligible':int(f['valid'].sum()),'positive':int(pp.sum()),'negative':int(pn.sum()),'roles':len(teams),'positive_roles':int((pp.sum(axis=1)>0).sum())}
 thresholds[role]=threshold
 # Score and label sensitivity to a single relationship being removed.
 drop=[]
 for j in range(9):
  reduced=describe(np.delete(vals,j,axis=-1),av,8);dp,dn=flag(reduced)
  drop.append({'positive_total':int(fp.sum()),'positive_still_flagged':int((fp&dp).sum()),'positive_above_median':int((fp&(reduced['gap']>0)).sum()),'negative_total':int(fn.sum()),'negative_still_flagged':int((fn&dn).sum())})
 allresults[role]={'partial_policies':parts,'leave_one_out':drop,'positive_complete':int(fp.sum()),'negative_complete':int(fn.sum())}
 # Representative real-value compositions, ordered by closeness to +0.65 score.
 candidates=np.argwhere(fp)
 if len(candidates):
  i,c=min(candidates,key=lambda ic:abs(f['score'][tuple(ic)]-.65));names=data['names'];entry={'role':role,'champion':names[c],'score':float(f['score'][i,c]),'median':float(f['median'][i,0]),'q95':float(f['q95'][i,0]),'gap':float(f['gap'][i,c]),'ally':{ROLES[k]:names[teams[i,0,k]] for k in range(5) if k!=r},'enemy':{ROLES[k]:names[teams[i,1,k]] for k in range(5)},'contributions':[]}
  for rel,k in pairs:
   otherid=teams[i,rel,k];entry['contributions'].append({'relation':'with' if rel==0 else 'vs','role':ROLES[k],'champion':names[otherid],'adjusted':float(data['adjusted'][r,c,rel,k,otherid]),'games':int(data['games'][r,c,rel,k,otherid])})
  examples.append(entry)
result={'partial_and_influence':allresults,'threshold_grid':thresholds,'illustrative_compositions':examples};(out/'refinement-results.json').write_text(json.dumps(result,indent=2)+'\n')
for m in ['1','3','5','6','7','8','9']:
 print('stage',m)
 for power in ['0','0.5','1']:
  rows=[allresults[r]['partial_policies'][m][power] for r in ROLES];n=sum(x['positive'] for x in rows);print(power,'positive',n,'freq%',round(n/sum(x['positive_available_denominator'] for x in rows)*100,3),'keep%',round(sum(x['positive_still_flagged'] for x in rows)/max(1,n)*100,1),'above_median%',round(sum(x['positive_above_final_median'] for x in rows)/max(1,n)*100,1),'reversed%',round(sum(x['positive_sign_reversed'] for x in rows)/max(1,n)*100,2))
print('threshold frequency')
for cut in thresholds['Top']:
 rows=[thresholds[r][cut] for r in ROLES];print(cut,round(sum(x['positive'] for x in rows)/sum(x['eligible'] for x in rows)*100,4),round(sum(x['negative'] for x in rows)/sum(x['eligible'] for x in rows)*100,4),round(sum(x['positive_roles'] for x in rows)/sum(x['roles'] for x in rows)*100,1))
