import json,sys
from pathlib import Path
import numpy as np
sys.path.insert(0,'scripts/experiments');from exceptional_pick_calibration import load,features,describe,flags,ROLES
out=Path('work/exceptional-picks/analysis');data=load(Path('work/exceptional-picks'));sim=np.load(out/'simulation.npz');teams=sim['teams'];bans=sim['bans'];catalogue=data['source']['catalogue']['entries'];byname={n:i for i,n in enumerate(data['names'])};chosen=[]
for r in range(5):
 f=describe(sim[f'vals_{r}'],sim[f'available_{r}']);fp,fn=flags(f,'p95_gap050_sign');choices=[]
 for i,c in np.argwhere(fp):
  d=teams[i];meta=[]
  for team in range(2):
   for role in range(5):
    if team==0 and role==r:continue
    e=next((x for x in catalogue if int(x['championId'])==data['ids'][d[team,role]] and x['role']==ROLES[role]),None)
    meta.append(bool(e and e['lanePercent']>=40 and e['pickPercent']>=1.))
  if all(meta):choices.append((i,c))
 if not choices:continue
 i,c=min(choices,key=lambda ic:abs(f['score'][tuple(ic)]-.6));chosen.append({'role':ROLES[r],'champion':data['names'][c],'score':float(f['score'][i,c]),'median':float(f['median'][i,0]),'q95':float(f['q95'][i,0]),'gap':float(f['gap'][i,c]),'ally':{ROLES[k]:data['names'][teams[i,0,k]] for k in range(5) if k!=r},'enemy':{ROLES[k]:data['names'][teams[i,1,k]] for k in range(5)}})
# A fully specified, illustrative Sylas/Malphite comparison using the actual pairs.
ally=['Sylas','Lee Sin','Orianna','Jinx','Thresh'];enemy=['Malphite','Amumu','Viktor','Jhin','Alistar'];t=np.array([[[byname[n] for n in ally],[byname[n] for n in enemy]]]);b=np.zeros((1,0),int);vals,av,_=features(data,t,b,0,17020);f=describe(vals,av);p,n=flags(f,'p95_gap050_sign');c=byname['Sylas'];match=data['adjusted'][0,c,1,0,byname['Malphite']]
example={'champion':'Sylas','role':'Top','ally':dict(zip(ROLES,ally)),'enemy':dict(zip(ROLES,enemy)),'vs_malphite_adjusted':float(match),'overall':float(f['score'][0,c]),'median':float(f['median'][0,0]),'q95':float(f['q95'][0,0]),'gap':float(f['gap'][0,c]),'highlight':bool(p[0,c]),'known':int(f['known'][0,c])}
# Synthetic edge cases verify that the rule does not force winners or label an
# entirely negative slate as an excellent positive fit.
from exceptional_pick_calibration import RULES
edge={}
for name,scores in [('flat',[0.1]*40),('all_negative',np.linspace(-2,-.1,40)),('all_positive',np.linspace(.1,2,40)),('one_zero_among_negative',[-1.]*39+[0.])]:
 v=np.repeat(np.array(scores)[None,:,None],9,axis=2);desc=describe(v,np.ones((1,40),bool));pp,nn=flags(desc,'p95_gap050_sign');edge[name]={'positive':int(pp.sum()),'negative':int(nn.sum())}
result={'common_role_examples':chosen,'sylas_malphite_example':example,'edge_cases':edge};(out/'examples.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
