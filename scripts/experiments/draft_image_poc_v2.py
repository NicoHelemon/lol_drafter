"""Offline v2: fixed client geometry + portrait templates, bans, separate pick states.
All supplied images may inform rule development. No held-out/generalization claim.
Annotations are read only by evaluation; recognition sees pixels and public assets.
"""
from __future__ import annotations
import argparse,json,time,itertools,math,hashlib,csv,io,subprocess
from collections import Counter
from pathlib import Path
import cv2
import numpy as np
from PIL import Image
from draft_image_poc import Recognizer as OldRecognizer,norm,ROLES
class Recognizer(OldRecognizer):
 def __init__(self,repo,catalogue):
  super().__init__(repo,catalogue);self.repo=repo
  self.squaremask=np.ones((16,16),bool);self.squaremask[0]=False;self.squaremask[-1]=False;self.squaremask[:,0]=False;self.squaremask[:,-1]=False
  # The red ban slash/outer frame is not part of the portrait.
  # Compare the full inner face at a resolution supported by the tiny icons.
  self.banrefs=[]
  for c in self.champions:
   im=np.array(Image.open(repo/'public'/c['portrait'].lstrip('/')).convert('RGB'));self.banrefs.append(self.banfeature(im))
  self.banrefs=np.array(self.banrefs,np.float32)
 def portrait(self,im,cx,cy,r):
  vectors=[]
  for scale in [.82,.90,.98,1.06]:
   for dx,dy in itertools.product(range(-6,7,2),range(-6,7,2)):
    radius=r*scale;box=[round(cx+dx-radius),round(cy+dy-radius),round(cx+dx+radius),round(cy+dy+radius)]
    if min(box[:2])<0 or box[2]>im.shape[1] or box[3]>im.shape[0]:continue
    patch=cv2.resize(im[box[1]:box[3],box[0]:box[2]],(32,32));vectors.append(self.feature(patch))
  if not vectors:return None,0,0
  scores=(np.array(vectors)@self.refs.T).max(axis=0);a,b=np.argsort(scores)[-2:][::-1];return self.names[a],float(scores[a]),float(scores[a]-scores[b])
 def banrow(self,im,box,side):
  l,t,w,h=box;key=(tuple(round(v,2) for v in box),side)
  if key in self.rowcache:return self.rowcache[key]
  poses=list(itertools.product(range(-12,15),range(-7,6),[.80,.85,.90,.95,1.,1.05]));vectors=[]
  for dx,dy,scale in poses:
   for i in range(5):
    x=l+w*((.023+.03125*i) if side=='ally' else(.85+.03125*i))+dx;y=t+h*.059+dy;r=w*.012*scale;rect=[round(x-r),round(y-r),round(x+r),round(y+r)]
    if min(rect[:2])<0 or rect[2]>im.shape[1] or rect[3]>im.shape[0] or rect[2]<=rect[0] or rect[3]<=rect[1]:vectors.append(np.zeros(self.banrefs.shape[1],np.float32));continue
    vectors.append(self.banfeature(im[rect[1]:rect[3],rect[0]:rect[2]]))
  scores=(np.array(vectors,dtype=np.float32)@self.banrefs.T).reshape(len(poses),5,-1);order=np.argsort(scores,axis=2);indices=order[:,:,-1];best=np.take_along_axis(scores,order[:,:,-2:],axis=2);margins=best[:,:,1]-best[:,:,0];sim=best[:,:,1];q=np.maximum(0,sim-.7)*np.minimum(.25,margins);quality=np.sort(q,axis=1)[:,2:].sum(axis=1)+q.sum(axis=1)*.1;pose=int(quality.argmax());result=[]
  dx,dy,scale=poses[pose]
  for i in range(5):
   x=l+w*((.023+.03125*i) if side=='ally' else(.85+.03125*i))+dx;y=t+h*.059+dy;refinements=[]
   for ddx,ddy,dscale in itertools.product([-1,0,1],[-1,0,1],[-.025,0,.025]):
    radius=w*.012*(scale+dscale);rect=[round(x+ddx-radius),round(y+ddy-radius),round(x+ddx+radius),round(y+ddy+radius)]
    if min(rect[:2])<0 or rect[2]>im.shape[1] or rect[3]>im.shape[0]:continue
    refinements.append(self.banfeature(im[rect[1]:rect[3],rect[0]:rect[2]]))
   scores_i=scores[pose,i] if not refinements else (np.array(refinements)@self.banrefs.T).max(axis=0);a,b=np.argsort(scores_i)[-2:][::-1];name=self.names[a];score=float(scores_i[a]);margin=float(scores_i[a]-scores_i[b]);accepted=(score>=.80 and margin>=.05) or (score>=.75 and margin>=.10)
   result.append({'team':side,'slot':i+1,'champion':name if accepted else None,'best_template':name,'similarity':round(score,4),'margin':round(margin,4),'alignment':list(poses[pose])})
  self.rowcache[key]=result;return result
 def banfeature(self,im):
  im=cv2.resize(im,(16,16),interpolation=cv2.INTER_AREA)
  rgb=im[self.squaremask].astype(np.float32);rgb-=rgb.mean();gray=cv2.cvtColor(im,cv2.COLOR_RGB2GRAY)[self.squaremask].astype(np.float32);gray-=gray.mean();rgb=rgb.ravel();return np.concatenate((rgb/max(np.linalg.norm(rgb),1e-6)*.85,gray/max(np.linalg.norm(gray),1e-6)*math.sqrt(1-.85**2)))
 def quick(self,im,box):
  l,t,w,h=box;vectors=[];groups=[]
  for side in ['ally','enemy']:
   for row in range(5):
    y=t+h*(.186+row/9);xs=[l+w*.0667,l+w*.042] if side=='ally' else [l+w*.95625];start=len(vectors)
    for x in xs:
     for fraction in [.0188,.0207,.0225,.0244]:
      for dx,dy in [(0,0),(-1,0),(1,0),(0,-1),(0,1)]:
       r=w*fraction;patch=im[max(0,round(y+dy-r)):round(y+dy+r),max(0,round(x+dx-r)):round(x+dx+r)]
       if patch.shape[0]<5 or patch.shape[1]<5:continue
       vectors.append(self.feature(cv2.resize(patch,(32,32))))
    groups.append((start,len(vectors)))
  scores=np.array(vectors)@self.refs.T;quality=0
  for a,b in groups:
   if b>a:
    order=np.sort(scores[a:b].max(axis=0));quality+=max(0,float(order[-1])-.60)*min(.25,float(order[-1]-order[-2]))
  vectors=[];groups=[]
  for side in ['ally','enemy']:
   for i in range(5):
    x=l+w*((.023+.03125*i) if side=='ally' else (.85+.03125*i));y=t+h*.059;start=len(vectors)
    for factor in [.88,1,1.12]:
     for dx in [-1,0,1]:
      r=w*.012*factor;patch=im[max(0,round(y-r)):round(y+r),max(0,round(x+dx-r)):round(x+dx+r)]
      if min(patch.shape[:2])<5:continue
      vectors.append(self.banfeature(cv2.resize(patch,(32,32))))
    groups.append((start,len(vectors)))
  if vectors:
   scores=np.array(vectors)@self.banrefs.T
   for a,b in groups:
    if b>a:
     order=np.sort(scores[a:b].max(axis=0));quality+=max(0,float(order[-1])-.65)*min(.25,float(order[-1]-order[-2]))
  return quality
 def evidence(self,im,b):
  l,t,w,h=b;pc=bc=0;quality=0
  for side in ['ally','enemy']:
   for row in range(5):
    y=t+h*(.186+row/9);xs=[l+w*.0667,l+w*.042] if side=='ally' else [l+w*.95625]
    results=[self.portrait(im,x,y,w*.023) for x in xs];name,score,margin=max(results,key=lambda v:v[1]);pc+=score>=.64 and margin>=.055;quality+=max(0,score-.6)*min(margin,.25)
   row=self.banrow(im,b,side)
   for ban in row:
    bc+=ban['champion'] is not None;quality+=max(0,ban['similarity']-.65)*min(ban['margin'],.25)
  return pc,bc,pc+bc*2+quality
 def bananchors(self,im):
  gray=cv2.cvtColor(im[:round(im.shape[0]*.65)],cv2.COLOR_RGB2GRAY);hits=[]
  for c in self.champions:
   ref=cv2.imread(str(self.repo/'public'/c['portrait'].lstrip('/')),cv2.IMREAD_GRAYSCALE)
   for size in [10,12,14,16,18,20,22]:
    template=cv2.resize(ref,(size,size),interpolation=cv2.INTER_AREA);result=cv2.matchTemplate(gray,template,cv2.TM_CCOEFF_NORMED);_,score,_,xy=cv2.minMaxLoc(result)
    if score>=.70:hits.append((score,xy[0]+size/2,xy[1]+size/2,size))
  hits.sort(reverse=True);unique=[]
  for hit in hits:
   if all(abs(hit[1]-x[1])+abs(hit[2]-x[2])>6 for x in unique):unique.append(hit)
   if len(unique)>=30:break
  boxes=[]
  for score,x,y,size in unique:
   for fraction in [.021875,.023,.0208]:
    cw=size/fraction;ch=cw*9/16
    if cw<400 or cw>im.shape[1]*1.03:continue
    for offset in [.023+.03125*i for i in range(5)]+[.85+.03125*i for i in range(5)]:
     left=x-offset*cw;top=y-ch*.059
     if left>=-3 and top>=-3 and left+cw<=im.shape[1]+6 and top+ch<=im.shape[0]+6:boxes.append([left,top,cw,ch])
  return boxes
 def locate(self,im):
  h,w=im.shape[:2];full=[0,0,w,h];pc,bc,_=self.evidence(im,full)
  if pc>=2 and bc>=4:return full,[],'full_frame_verified_by_portraits_and_bans'
  gray=cv2.GaussianBlur(cv2.cvtColor(im,cv2.COLOR_RGB2GRAY),(3,3),0);circles=cv2.HoughCircles(gray,cv2.HOUGH_GRADIENT,dp=1.1,minDist=17,param1=95,param2=18,minRadius=7,maxRadius=30)
  circles=[] if circles is None else circles[0].tolist();candidates=[(0,[0,0,w,h])];columns=[c for c in circles if c[0]>.55*w]
  for x,y,r in columns:
   for xx,yy,rr in columns:
    if abs(xx-x)>r*.5 or yy<=y:continue
    for gap in range(1,5):
     step=(yy-y)/gap
     if not 2.1*r<step<3.7*r:continue
     for first in range(5):
      top=y-first*step;cw=16*step;ch=9*step;left=x-.95625*cw;upper=top-1.675*step
      if left<-.025*cw or upper<-.025*ch or left+cw>w*1.025 or upper+ch>h*1.04:continue
      count=sum(any(abs(cx-x)<r*.5 and abs(cy-(top+i*step))<r*.5 and .6*r<cr<1.6*r for cx,cy,cr in columns) for i in range(5))
      if count>=3:candidates.append((count,[left,upper,cw,ch]))
  # Embedded client windows have long rectangular borders. These anchors avoid
  # mistaking circles in the central champion grid for the player columns.
  lines=cv2.HoughLinesP(cv2.Canny(gray,10,40),1,np.pi/180,threshold=65,minLineLength=220,maxLineGap=12)
  horizontals=[] if lines is None else [v.tolist() for v in lines.reshape(-1,4) if abs(v[1]-v[3])<3]
  lineboxes=[]
  for x1,y1,x2,y2 in horizontals:
   for a1,b1,a2,b2 in horizontals:
    if b1<=y1+130:continue
    ch=b1-y1;cw=ch*16/9
    if abs((x2-x1)-cw)>cw*.2 or abs((a2-a1)-cw)>cw*.2:continue
    for left in [min(x1,x2),max(x1,x2)-cw,min(a1,a2),max(a1,a2)-cw]:
     if left>=0 and left+cw<=w+3 and b1<=h+3:lineboxes.append([left,y1,cw,ch])
  candidates.sort(key=lambda c:-c[0]);unique={}
  for n,b in candidates:
   key=tuple(round(x/4) for x in b)
   if key not in unique:unique[key]=(n,b)
  options=[b for n,b in list(unique.values())[:40]]+lineboxes+self.bananchors(im)+[full];options=sorted(options,key=lambda b:self.quick(im,b),reverse=True)[:12];best=max(options,key=lambda b:self.evidence(im,b)[2]);return best,circles,'template_checked_geometry_and_ban_anchors'
 def slottext(self,im,box,side,row,cache,masked=False):
  l,t,w,h=box;cy=t+h*(.186+row/9);xr=(.089,.23) if side=='ally' else(.78,.935);rect=(max(0,round(l+w*xr[0])),max(0,round(cy-h*.043)),min(im.shape[1],round(l+w*xr[1])),min(im.shape[0],round(cy+h*.016)))
  patch=im[rect[1]:rect[3],rect[0]:rect[2]]
  if min(patch.shape[:2])<2:return []
  key=hashlib.sha256(patch.tobytes()+str(masked).encode()+b'psm6-up4-v2').hexdigest();target=cache/(key+'.slot.json')
  if target.exists():return json.loads(target.read_text())
  patch=cv2.resize(patch,None,fx=4,fy=4,interpolation=cv2.INTER_CUBIC)
  if masked:
   lo=patch.min(axis=2);hi=patch.max(axis=2);white=(lo>155)&((hi-lo)<100);gold=(patch[:,:,0]>150)&(patch[:,:,1]>125)&(patch[:,:,2]<patch[:,:,1]*.8);patch=np.where(white|gold,0,255).astype(np.uint8)
  buf=io.BytesIO();Image.fromarray(patch).save(buf,format='PNG');result=subprocess.run(['tesseract','stdin','stdout','--psm','6','-l','eng','tsv'],input=buf.getvalue(),capture_output=True,check=True);words=[]
  for v in csv.DictReader(io.StringIO(result.stdout.decode()),delimiter='\t'):
   if v.get('text','').strip() and float(v['conf'])>=30:words.append({'text':v['text'],'confidence':float(v['conf']),'dy':(rect[1]+(int(v['top'])+int(v['height'])/2)/4-cy)/h,'x':(int(v['left'])+int(v['width'])/2)/4})
  target.write_text(json.dumps(words));return words
 def read(self,path,cache):
  self.rowcache={};started=time.monotonic();ori=Image.open(path).convert('RGB');im=np.array(ori.resize((960,round(ori.height*960/ori.width))));box,circles,method=self.locate(im);l,t,w,h=box;words=self.ocr(path,cache);slots=[]
  for side in ['ally','enemy']:
   for row in range(5):
    y=t+h*(.186+row/9);x=l+w*(.0667 if side=='ally' else .95625);portrait=self.portrait(im,x,y,w*.023);shift=False
    if side=='ally':
     hover=self.portrait(im,l+w*.042,y,w*.023)
     if hover[1]>=.64 and hover[2]>=.055 and hover[1]>portrait[1]+.05:portrait=hover;shift=True
    name,similarity,margin=portrait;xr=(.09,.285) if side=='ally' else (.75,.932)
    text=[v for v in words if l+w*xr[0]<v['x']*im.shape[1]<l+w*xr[1] and abs(v['y']*im.shape[0]-y)<h*.043];text.sort(key=lambda v:(round(v['y']*im.shape[0]/10),v['x']));tokens=[norm(v['text']) for v in text];labeltokens=[norm(v['text']) for v in text if abs(v['y']*im.shape[0]-y)<h*.023 and v['confidence']>=60];label=None
    for width in [3,2,1]:
     for k in range(max(0,len(labeltokens)-width+1)):
      label=self.lookup.get(''.join(labeltokens[k:k+width]))
      if label:break
     if label:break
    local=self.slottext(np.array(ori),[v*ori.width/im.shape[1] for v in box],side,row,cache)
    local_tokens=[norm(v['text']) for v in local];local_label_tokens=[norm(v['text']) for v in local if v['dy']<.014 and v['confidence']>=65];local_label=None
    for width in [3,2,1]:
     for k in range(max(0,len(local_label_tokens)-width+1)):
      local_label=self.lookup.get(''.join(local_label_tokens[k:k+width]))
      if local_label:break
     if local_label:break
    if local_label:label=local_label
    if not label or side=='ally' and not any(v in ('top','jungle','mid','middle','bottom','bot','adc','support') for v in local_tokens):
     masked=self.slottext(np.array(ori),[v*ori.width/im.shape[1] for v in box],side,row,cache,True);masked_tokens=[norm(v['text']) for v in masked];masked_label_tokens=[norm(v['text']) for v in masked if v['dy']<.014 and v['confidence']>=65];masked_label=None
     for width in [3,2,1]:
      for k in range(max(0,len(masked_label_tokens)-width+1)):
       masked_label=self.lookup.get(''.join(masked_label_tokens[k:k+width]))
       if masked_label:break
      if masked_label:break
     if not label and masked_label:label=masked_label
     local_tokens+=masked_tokens
    tokens=local_tokens+tokens
    edge=im[max(0,round(y-h*.05)):round(y+h*.05),max(0,round(l+w*.991)):min(im.shape[1],round(l+w*.999))].astype(float)
    active_enemy=side=='enemy' and edge.size>0 and float(((edge[:,:,0]>90)&(edge[:,:,0]>edge[:,:,1]*1.5)&(edge[:,:,0]>edge[:,:,2]*1.1)).mean())>.3
    picking=active_enemy or any(v.startswith(('picking','choosing','seleccionando')) or v in ('pcking','picling','piclung','piding') for v in tokens)
    accepted=similarity>=.64 and margin>=.055
    if label and not shift:accepted=True;name=label
    status='hover' if shift else 'picking' if picking else 'locked';role=None
    for tok in tokens:
     if tok in ('top','jungle','mid','middle','bottom','bot','adc','support'):role={'middle':'mid','bottom':'bot','adc':'bot'}.get(tok,tok);break
    slots.append({'team':side,'slot':row+1,'champion':name if accepted else None,'status':status if accepted else 'unknown','similarity':round(similarity,4),'margin':round(margin,4),'best_template':name,'ocr_label':label,'role':role if accepted else None,'role_source':'client_text' if accepted and role else None})
  for side in ['ally','enemy']:
   picks=[s for s in slots if s['team']==side and s['champion'] and s['status']=='locked'];fixed=[s['role'] for s in picks if s['role']]
   if len(fixed)!=len(set(fixed)):
    for s in picks:s['role']=None;s['role_source']=None
   if not self.priors:continue
   options=[]
   for rs in itertools.permutations(ROLES,len(picks)):
    if any(s['role'] and s['role']!=r for s,r in zip(picks,rs)):continue
    options.append((sum(math.log(self.priors.get((self.ids[s['champion']],r),.001)) for s,r in zip(picks,rs)),rs))
   if options:
    _,roles=max(options)
    for s,r in zip(picks,roles):
     if not s['role']:s['role']=r;s['role_source']='popularity_estimate'
  bans=self.banrow(im,box,'ally')+self.banrow(im,box,'enemy')
  reject_duplicate_bans(bans)
  return {'image_id':path.stem,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'client_box_scaled':[round(v,2) for v in box],'localization':method,'slots':slots,'bans':bans,'seconds':round(time.monotonic()-started,3)}
def reject_duplicate_bans(bans):
 # Repeated identities in one row are ambiguous: do not force a choice between
 # multiple competing detections. The same ban on opposite teams remains valid.
 for team in ['ally','enemy']:
  counts=Counter(b['champion'] for b in bans if b['team']==team and b['champion'])
  for b in bans:
   if b['team']==team and b['champion'] and counts[b['champion']]>1:b.update(champion=None,status='duplicate_conflict')
 for b in bans:b.setdefault('status','recognized' if b['champion'] else 'unresolved')
def evaluate(prediction,a):
 tp=fp=fn=0;confirmed=confirmedtotal=0
 for side in ['ally','enemy']:
  want=[e['champion'] for e in a[side+'_team'].values() if e['champion']!='Unknown']+a['unassigned_'+side+'_champions'];got=[s['champion'] for s in prediction['slots'] if s['team']==side and s['champion'] and s['status']=='locked'];match=sum((Counter(want)&Counter(got)).values());tp+=match;fp+=len(got)-match;fn+=len(want)-match
  for role,e in a[side+'_team'].items():
   if e['champion']!='Unknown' and e['role_confidence']=='confirmed':confirmedtotal+=1;confirmed+=any(s['champion']==e['champion'] and s['role']==role and s['status']=='locked' for s in prediction['slots'] if s['team']==side)
 btp=bfp=bfn=empty=emptyok=unknown=0
 for s in prediction['bans']:
  expected=a[s['team']+'_bans'][s['slot']-1];got=s['champion']
  if expected=='Unknown':unknown+=1;continue
  if expected is None:empty+=1;emptyok+=got is None;bfp+=got is not None
  elif got==expected:btp+=1
  else:bfn+=1;bfp+=got is not None
 pending_expected=Counter((t,int(e['slot']),e['champion'],e['status']) for t in ['ally','enemy'] for e in a['pending_'+t+'_picks']);pending_got=Counter((s['team'],s['slot'],s['champion'],s['status']) for s in prediction['slots'] if s['champion'] and s['status'] in ['hover','picking']);pending_tp=sum((pending_expected&pending_got).values())
 return {'pending_tp':pending_tp,'pending_fp':sum(pending_got.values())-pending_tp,'pending_fn':sum(pending_expected.values())-pending_tp,'exact_known_bans':int(bfp==0 and bfn==0 and empty==emptyok),'tp':tp,'fp':fp,'fn':fn,'exact_picks':int(fp==0 and fn==0),'ban_tp':btp,'ban_fp':bfp,'ban_fn':bfn,'empty_bans':empty,'empty_bans_correct':emptyok,'unscored_bans':unknown,'confirmed_roles_correct':confirmed,'confirmed_roles':confirmedtotal}
def main():
 p=argparse.ArgumentParser();p.add_argument('--dataset',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--catalogue',type=Path,default=None);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True);cache=a.output/'ocr-cache';cache.mkdir(exist_ok=True);r=Recognizer(Path('.'),a.catalogue);results=[]
 for path in sorted((a.dataset/'images').glob('*')):
  result=r.read(path,cache);annotation=json.loads((a.dataset/'annotations'/(path.stem+'.json')).read_text());result['evaluation']=evaluate(result,annotation);(a.output/(path.stem+'.json')).write_text(json.dumps(result,indent=2));results.append(result);print(path.stem,result['client_box_scaled'],result['evaluation'],flush=True)
 summary={k:sum(r['evaluation'][k] for r in results) for k in results[0]['evaluation']};summary['images']=len(results);summary['exploratory_all_images']=True;(a.output/'summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary))
if __name__=='__main__':main()
