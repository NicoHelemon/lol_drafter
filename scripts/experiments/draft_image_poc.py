"""Offline experiment only. No website endpoint and no training on the evaluation labels.
Requires numpy, Pillow, opencv-python-headless and the tesseract executable.
"""
from __future__ import annotations
import argparse,csv,hashlib,io,itertools,json,math,re,subprocess,time
from collections import Counter
from pathlib import Path
import cv2
import numpy as np
from PIL import Image
ROLES=['top','jungle','mid','bot','support']
def norm(s):return re.sub('[^a-z0-9]','',s.lower())
class Recognizer:
 def __init__(self,repo:Path,catalogue:Path|None):
  self.champions=json.loads((repo/'src/data/champions.json').read_text());self.names=[c['name'] for c in self.champions];self.ids={c['name']:c['id'] for c in self.champions};self.lookup={norm(n):n for n in self.names}
  self.lookup.update({'wukong':'Wukong','monkeyking':'Wukong','nunu':'Nunu & Willump','renataglasc':'Renata Glasc'})
  y,x=np.mgrid[-1:1:32j,-1:1:32j];self.mask=(x*x+y*y<.75**2);self.refs=[]
  for c in self.champions:
   path=repo/'public'/c['portrait'].removeprefix('/');im=np.array(Image.open(path).convert('RGB').resize((32,32)));self.refs.append(self.feature(im))
  self.refs=np.array(self.refs,np.float32);self.priors={}
  if catalogue:
   cat=json.loads(catalogue.read_text());mapped={'Top':'top','Jungle':'jungle','Mid':'mid','ADC':'bot','Support':'support'}
   for e in cat['entries']:self.priors[(str(e['championId']),mapped[e['role']])]=max(e['lanePercent']/100,.001)
 def feature(self,im):
  a=im[self.mask].astype(np.float32);a-=a.mean(axis=0,keepdims=True);v=a.ravel();return v/max(np.linalg.norm(v),1e-6)
 def locate(self,im):
  # Five vertically aligned circular slots on the enemy side locate the client,
  # including client windows embedded inside a stream/desktop capture.
  h,w=im.shape[:2];gray=cv2.GaussianBlur(cv2.cvtColor(im,cv2.COLOR_RGB2GRAY),(3,3),0)
  circles=cv2.HoughCircles(gray,cv2.HOUGH_GRADIENT,dp=1.1,minDist=20,param1=95,param2=23,minRadius=8,maxRadius=30)
  circles=[] if circles is None else circles[0].tolist();best=None
  for x,y,r in circles:
   for xx,yy,rr in circles:
    if abs(xx-x)>r*.4 or yy<=y:continue
    for gap in range(1,5):
     step=(yy-y)/gap
     if not 2.3*r<step<3.4*r:continue
     for first in range(5):
      top=y-first*step;cw=16*step;ch=9*step;left=x-.95625*cw;upper=top-1.675*step
      if left<-.04*cw or upper<-.04*ch or left+cw>w*1.05 or upper+ch>h*1.08:continue
      matches=sum(any(abs(cx-x)<r*.45 and abs(cy-(top+i*step))<r*.35 and .65*r<cr<1.35*r for cx,cy,cr in circles) for i in range(5))
      score=matches*100-cw*.005-abs(step/r-2.75)
      if matches>=4 and (best is None or score>best[0]):best=(score,[left,upper,cw,ch],circles)
  return (best[1],best[2],'circle_geometry') if best else ([0,0,w,h],circles,'full_frame_fallback')
 def portrait(self,im,cx,cy,r):
  vectors=[]
  for scale in [.82,.90,.98,1.06]:
   for dx,dy in [(0,0),(-1,0),(1,0),(0,-1),(0,1)]:
    radius=r*scale;box=[round(cx+dx-radius),round(cy+dy-radius),round(cx+dx+radius),round(cy+dy+radius)]
    if min(box[:2])<0 or box[2]>im.shape[1] or box[3]>im.shape[0]:continue
    patch=cv2.resize(im[box[1]:box[3],box[0]:box[2]],(32,32));vectors.append(self.feature(patch))
  if not vectors:return None,0,0
  scores=(np.array(vectors)@self.refs.T).max(axis=0);order=np.argsort(scores)[::-1];a,b=order[:2]
  return self.names[a],float(scores[a]),float(scores[a]-scores[b])
 def ocr(self,path:Path,cache:Path):
  fingerprint=hashlib.sha256(path.read_bytes()).hexdigest();target=cache/(fingerprint+'.json')
  if target.exists():return json.loads(target.read_text())
  im=Image.open(path).convert('RGB');factor=max(1,1920/im.width);im=im.resize((round(im.width*factor),round(im.height*factor)))
  buf=io.BytesIO();im.save(buf,format='PNG')
  result=subprocess.run(['tesseract','stdin','stdout','--psm','11','-l','eng','tsv'],input=buf.getvalue(),capture_output=True,check=True)
  words=[]
  for row in csv.DictReader(io.StringIO(result.stdout.decode()),delimiter='\t'):
   if row.get('text','').strip() and float(row['conf'])>=30:words.append({'text':row['text'],'confidence':float(row['conf']),'x':(int(row['left'])+int(row['width'])/2)/im.width,'y':(int(row['top'])+int(row['height'])/2)/im.height})
  target.write_text(json.dumps(words));return words
 def read(self,path:Path,cache:Path):
  started=time.monotonic();original=Image.open(path).convert('RGB');im=np.array(original.resize((960,round(original.height*960/original.width))))
  box,circles,method=self.locate(im);left,top,cw,ch=box;words=self.ocr(path,cache);slots=[]
  for team in ['ally','enemy']:
   for row in range(5):
    cy=top+ch*(.186+row/9);expected_x=left+cw*(.0667 if team=='ally' else .95625);r=cw*.023
    possible=[(x,y,rr) for x,y,rr in circles if abs(y-cy)<r*.6 and abs(x-expected_x)<r*(1.7 if team=='ally' else .65) and .65*r<rr<1.4*r]
    if possible:cx,cy,r=min(possible,key=lambda c:abs(c[1]-cy)+abs(c[0]-expected_x)*.3)
    else:cx=expected_x
    champion,similarity,margin=self.portrait(im,cx,cy,r)
    # Read only the side-panel text associated with the portrait, never the central champion grid.
    xr=(.09,.285) if team=='ally' else (.75,.932)
    textwords=[v for v in words if left+cw*xr[0]<v['x']*im.shape[1]<left+cw*xr[1] and cy-ch*.045<v['y']*im.shape[0]<cy+ch*.043]
    textwords.sort(key=lambda v:(round(v['y']*im.shape[0]/10),v['x']));tokens=[norm(v['text']) for v in textwords];label_tokens=[norm(v['text']) for v in textwords if abs(v['y']*im.shape[0]-cy)<ch*.023 and v['confidence']>=65];label=None
    for width in [3,2,1]:
     for k in range(max(0,len(label_tokens)-width+1)):
      joined=''.join(label_tokens[k:k+width]);candidate=self.lookup.get(joined)
      if candidate:label=candidate;break
     if label:break
    role=None
    if team=='ally':
     for v in tokens:
      if v in ('top','jungle','mid','middle','bottom','bot','adc','support'):role={'middle':'mid','bottom':'bot','adc':'bot'}.get(v,v);break
    picking=any(v.startswith('picking') or v.startswith('choosing') for v in tokens)
    # Shifted left portraits denote intentions; active choosing slots must not be treated as locked.
    shifted=team=='ally' and cx<left+cw*.054
    accepted=bool(label and not picking and not shifted)
    slots.append({'team':team,'slot':row+1,'portrait_champion':champion,'portrait_only_accepted':similarity>=.60 and margin>=.03 and not shifted,'similarity':round(similarity,4),'margin':round(margin,4),'champion':label if accepted else None,'status':'locked' if accepted else 'not_confirmed','role':role if accepted else None,'role_source':'client_text' if accepted and role else None})
  counts=Counter(s['champion'] for s in slots if s['champion'])
  for slot in slots:
   if slot['champion'] and counts[slot['champion']]>1:slot.update(champion=None,status='duplicate_conflict',role=None,role_source=None)
  # Role assignment is a separate constrained search, never a visual row-order assumption.
  for team in ['ally','enemy']:
   picks=[s for s in slots if s['team']==team and s['champion']];fixed=[s['role'] for s in picks if s['role']]
   if len(fixed)!=len(set(fixed)):
    for s in picks:s['role']=None;s['role_source']=None
   possibilities=[]
   for roles in itertools.permutations(ROLES,len(picks)):
    if any(s['role'] and s['role']!=r for s,r in zip(picks,roles)):continue
    value=sum(math.log(self.priors.get((self.ids[s['champion']],r),.001)) for s,r in zip(picks,roles));possibilities.append((value,roles))
   if possibilities:
    possibilities.sort(reverse=True);best=possibilities[0]
    for s,r in zip(picks,best[1]):
     if not s['role']:s['role']=r;s['role_source']='popularity_estimate'
  return {'image_id':path.stem,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'client_box_scaled':list(map(lambda v:round(v,1),box)),'localization':method,'slots':slots,'elapsed_seconds':round(time.monotonic()-started,3)}
def evaluate(prediction,annotation):
 expected={t:[v['champion'] for v in annotation[t+'_team'].values() if v['champion']!='Unknown']+annotation['unassigned_'+t+'_champions'] for t in ['ally','enemy']}
 tp=fp=fn=correct_roles=role_total=confirmed_roles=confirmed_correct=0;raw_tp=raw_fp=raw_fn=0
 for team in ['ally','enemy']:
  actual=[s for s in prediction['slots'] if s['team']==team and s['champion']];detected=[s['champion'] for s in actual];want=expected[team]
  raw=[s['portrait_champion'] for s in prediction['slots'] if s['team']==team and s['portrait_only_accepted']];raw_match=sum((Counter(raw)&Counter(want)).values());raw_tp+=raw_match;raw_fp+=len(raw)-raw_match;raw_fn+=len(want)-raw_match;matched=sum((Counter(detected)&Counter(want)).values());tp+=matched;fp+=len(detected)-matched;fn+=len(want)-matched
  for role,e in annotation[team+'_team'].items():
   if e['champion']=='Unknown':continue
   role_total+=1;match=any(s['champion']==e['champion'] and s['role']==role for s in actual);correct_roles+=int(match)
   if e['role_confidence']=='confirmed':confirmed_roles+=1;confirmed_correct+=int(match)
 return {'portrait_only_tp':raw_tp,'portrait_only_fp':raw_fp,'portrait_only_fn':raw_fn,'true_positive':tp,'false_positive':fp,'false_negative':fn,'correct_assigned_roles':correct_roles,'annotated_roles':role_total,'confirmed_role_correct':confirmed_correct,'confirmed_role_total':confirmed_roles,'exact_champion_sets':fp==0 and fn==0}
def main():
 p=argparse.ArgumentParser();p.add_argument('--dataset',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--repo',type=Path,default=Path('.'));p.add_argument('--catalogue',type=Path);p.add_argument('--limit',type=int);args=p.parse_args();args.output.mkdir(parents=True,exist_ok=True);cache=args.output/'ocr-cache';cache.mkdir(exist_ok=True)
 recognizer=Recognizer(args.repo,args.catalogue);reports=[]
 for image in sorted((args.dataset/'images').glob('*'))[:args.limit]:
  result=recognizer.read(image,cache);annotation=json.loads((args.dataset/'annotations'/(image.stem+'.json')).read_text());result['evaluation']=evaluate(result,annotation);reports.append(result);(args.output/(image.stem+'.json')).write_text(json.dumps(result,indent=2));print(image.stem,result['evaluation'],flush=True)
 summary={k:sum(r['evaluation'][k] for r in reports) for k in ['portrait_only_tp','portrait_only_fp','portrait_only_fn','true_positive','false_positive','false_negative','correct_assigned_roles','annotated_roles','confirmed_role_correct','confirmed_role_total','exact_champion_sets']};summary['images']=len(reports);summary['precision']=summary['true_positive']/max(1,summary['true_positive']+summary['false_positive']);summary['recall']=summary['true_positive']/max(1,summary['true_positive']+summary['false_negative']);summary['method']='classical circle detection, portrait correlation, existing Tesseract OCR, popularity assignment; no LLM or model training';summary['bans_evaluated']=False
 (args.output/'summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary))
if __name__=='__main__':main()
