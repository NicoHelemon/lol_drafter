// Classical vision + local OCR. No image, text or identity is sent to a server.
import cvModule from '@techstark/opencv-js';
import {createWorker,PSM,type Worker as OCRWorker,type Word} from 'tesseract.js';
import type {ScreenshotReading,ImageSlot,ImageBan} from '../domain/screenshot';
import type {Team,Role} from '../domain/types';
type CV=any;
type Box=[number,number,number,number];
type Match={index:number;score:number;margin:number};
type Templates={ids:string[];names:string[];pickLength:number;banLength:number};
const scope=self as unknown as {postMessage:(data:unknown)=>void;onmessage:(event:MessageEvent)=>void;location:Location};
const progress=(message:string,value:number)=>scope.postMessage({kind:'progress',message,value});
const norm=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
const teams:Team[]=['ally','enemy'];
const roles:Record<string,Role>={top:'Top',jungle:'Jungle',mid:'Mid',middle:'Mid',bot:'ADC',bottom:'ADC',adc:'ADC',support:'Support'};
class Vision {
 cv:CV;meta:Templates;refs:CV;banrefs:CV;atlas:CV;mask:number[]=[];square:number[]=[];cache=new Map<string,ImageBan[]>();
 constructor(cv:CV,meta:Templates,values:Float32Array,atlas:CV){
  this.cv=cv;this.meta=meta;this.atlas=atlas;
  this.refs=cv.matFromArray(meta.ids.length,meta.pickLength,cv.CV_32F,values.subarray(0,meta.ids.length*meta.pickLength));
  this.banrefs=cv.matFromArray(meta.ids.length,meta.banLength,cv.CV_32F,values.subarray(meta.ids.length*meta.pickLength));
  for(let y=0;y<32;y++)for(let x=0;x<32;x++)if((x/31*2-1)**2+(y/31*2-1)**2<.75**2)this.mask.push(y*32+x);
  for(let y=1;y<15;y++)for(let x=1;x<15;x++)this.square.push(y*16+x);
 }
 dispose(){this.refs.delete();this.banrefs.delete();this.atlas.delete();}
 feature(im:CV,x:number,y:number,r:number,ban=false):Float32Array{
  const cv=this.cv,n=ban?16:32,len=ban?this.meta.banLength:this.meta.pickLength;
  const l=Math.round(x-r),t=Math.round(y-r),rr=Math.round(x+r),bb=Math.round(y+r);
  if(l<0||t<0||rr>im.cols||bb>im.rows||rr<=l||bb<=t)return new Float32Array(len);
  const roi=im.roi(new cv.Rect(l,t,rr-l,bb-t)),small=new cv.Mat();
  cv.resize(roi,small,new cv.Size(n,n),0,0,ban?cv.INTER_AREA:cv.INTER_LINEAR);roi.delete();
  const data=small.data,points=ban?this.square:this.mask,v=new Float32Array(len),sums=[0,0,0];let sum=0,graySum=0;
  for(const p of points){sums[0]+=data[p*3];sums[1]+=data[p*3+1];sums[2]+=data[p*3+2];sum+=data[p*3]+data[p*3+1]+data[p*3+2];graySum+=Math.round(data[p*3]*.299+data[p*3+1]*.587+data[p*3+2]*.114);}
  let sq=0,gq=0;const mean=sum/(points.length*3),gm=graySum/points.length;
  points.forEach((p,i)=>{for(let c=0;c<3;c++){const value=data[p*3+c]-(ban?mean:sums[c]/points.length);v[i*3+c]=value;sq+=value*value;}
   if(ban){const value=Math.round(data[p*3]*.299+data[p*3+1]*.587+data[p*3+2]*.114)-gm;v[points.length*3+i]=value;gq+=value*value;}});
  const scale=(ban?.85:1)/Math.max(Math.sqrt(sq),1e-6);
  for(let i=0;i<points.length*3;i++)v[i]*=scale;
  if(ban)for(let i=points.length*3;i<len;i++)v[i]*=Math.sqrt(1-.85**2)/Math.max(Math.sqrt(gq),1e-6);
  small.delete();return v;
 }
 scores(vectors:Float32Array[],ban=false):Float32Array{
  if(!vectors.length)return new Float32Array();
  const cv=this.cv,length=ban?this.meta.banLength:this.meta.pickLength,flat=new Float32Array(vectors.length*length);
  vectors.forEach((v,i)=>flat.set(v,i*length));
  const input=cv.matFromArray(vectors.length,length,cv.CV_32F,flat),out=new cv.Mat(),empty=new cv.Mat();
  cv.gemm(input,ban?this.banrefs:this.refs,1,empty,0,out,cv.GEMM_2_T);
  const result=new Float32Array(out.data32F);input.delete();out.delete();empty.delete();return result;
 }
 best(scores:Float32Array,start=0,end=scores.length):Match{
  const n=this.meta.ids.length;
  if(end-start===n){let a=0,b=1;for(let i=0;i<n;i++)if(scores[start+i]>scores[start+a])a=i;if(b===a)b=0;for(let i=0;i<n;i++)if(i!==a&&scores[start+i]>scores[start+b])b=i;return {index:a,score:scores[start+a],margin:scores[start+a]-scores[start+b]};}
  const values=new Float32Array(n).fill(-Infinity);
  for(let i=start;i<end;i++)values[(i-start)%n]=Math.max(values[(i-start)%n],scores[i]);
  let a=0,b=1;for(let i=0;i<n;i++)if(values[i]>values[a])a=i;
  if(b===a)b=0;for(let i=0;i<n;i++)if(i!==a&&values[i]>values[b])b=i;
  return {index:a,score:values[a],margin:values[a]-values[b]};
 }
 portrait(im:CV,x:number,y:number,r:number,quick=false):Match{
  const vectors:Float32Array[]=[];
  for(const scale of (quick?[.9,1.06]:[.82,.90,.98,1.06])){
   if(quick)vectors.push(this.feature(im,x,y,r*scale));
   else for(let dx=-6;dx<=6;dx+=2)for(let dy=-6;dy<=6;dy+=2)vectors.push(this.feature(im,x+dx,y+dy,r*scale));
  }
  return this.best(this.scores(vectors));
 }
 banrow(im:CV,box:Box,team:Team):ImageBan[]{
  const key=box.join(',')+team;if(this.cache.has(key))return this.cache.get(key)!;
  const [l,t,w,h]=box,n=this.meta.ids.length,poses:number[][]=[],vectors:Float32Array[]=[];
  for(let dx=-12;dx<15;dx++)for(let dy=-7;dy<6;dy++)for(const scale of [.8,.85,.9,.95,1,1.05]){
   poses.push([dx,dy,scale]);for(let i=0;i<5;i++)vectors.push(this.feature(im,l+w*((team==='ally'?.023:.85)+.03125*i)+dx,t+h*.059+dy,w*.012*scale,true));
  }
  const scores=this.scores(vectors,true);let bestPose=0,quality=-Infinity;
  for(let p=0;p<poses.length;p++){
   const q:number[]=[];for(let i=0;i<5;i++){const a=this.best(scores,(p*5+i)*n,(p*5+i+1)*n);q.push(Math.max(0,a.score-.7)*Math.min(.25,a.margin));}
   const total=q.reduce((s,v)=>s+v,0)*.1+q.sort((a,b)=>a-b).slice(2).reduce((s,v)=>s+v,0);
   if(total>quality){quality=total;bestPose=p;}
  }
  const [dx,dy,scale]=poses[bestPose],result:ImageBan[]=[];
  for(let i=0;i<5;i++){
   const refined:Float32Array[]=[];
   for(const xx of [-1,0,1])for(const yy of [-1,0,1])for(const ds of [-.025,0,.025])refined.push(this.feature(im,l+w*((team==='ally'?.023:.85)+.03125*i)+dx+xx,t+h*.059+dy+yy,w*.012*(scale+ds),true));
   const a=this.best(this.scores(refined,true)),accepted=a.score>=.8&&a.margin>=.05||a.score>=.75&&a.margin>=.10;
   result.push({team,slot:i+1,championId:accepted?this.meta.ids[a.index]:null,similarity:a.score,margin:a.margin});
  }
  this.cache.set(key,result);return result;
 }
 evidence(im:CV,b:Box){
  const [l,t,w,h]=b;let pc=0,bc=0,quality=0;
  for(const team of teams){
   for(let row=0;row<5;row++){
    const y=t+h*(.186+row/9),normal=this.portrait(im,l+w*(team==='ally'?.0667:.95625),y,w*.023),hover=team==='ally'?this.portrait(im,l+w*.042,y,w*.023):normal,a=hover.score>normal.score?hover:normal;
    if(a.score>=.64&&a.margin>=.055)pc++;quality+=Math.max(0,a.score-.6)*Math.min(a.margin,.25);
   }
   const rowBans=this.banrow(im,b,team);
   for(const ban of rowBans){if(ban.championId&&rowBans.filter(v=>v.championId===ban.championId).length===1){bc++;quality+=Math.max(0,ban.similarity-.65)*Math.min(ban.margin,.25);}}
  }
  return {pc,bc,value:pc+bc*2+quality};
 }
 quick(im:CV,b:Box,coarse=false){
  const [l,t,w,h]=b,vectors:Float32Array[]=[],groups:number[][]=[];
  for(const team of teams)for(let row=0;row<5;row++){
   const start=vectors.length;
   for(const x of (team==='ally'?[.0667,.042]:[.95625]))for(const r of (coarse?[.0207,.023]:[.0188,.0207,.0225,.0244]))for(const [dx,dy] of (coarse?[[0,0]]:[[0,0],[-1,0],[1,0],[0,-1],[0,1]]))vectors.push(this.feature(im,l+w*x+dx,t+h*(.186+row/9)+dy,w*r));
   groups.push([start,vectors.length]);
  }
  const scores=this.scores(vectors),n=this.meta.ids.length;let q=0;
  for(const [start,end] of groups){const a=this.best(scores,start*n,end*n);q+=Math.max(0,a.score-.6)*Math.min(.25,a.margin);}
  const bans:Float32Array[]=[],bg:number[][]=[];
  for(const team of teams)for(let i=0;i<5;i++){
   const start=bans.length;
   for(const scale of [.88,1,1.12])for(const dx of (coarse?[0]:[-1,0,1]))bans.push(this.feature(im,l+w*((team==='ally'?.023:.85)+.03125*i)+dx,t+h*.059,w*.012*scale,true));
   bg.push([start,bans.length]);
  }
  const bs=this.scores(bans,true);for(const [start,end] of bg){const a=this.best(bs,start*n,end*n);q+=Math.max(0,a.score-.65)*Math.min(.25,a.margin);}return q;
 }
 locate(im:CV):Box{
  const cv=this.cv,w=im.cols,h=im.rows,full:Box=[0,0,w,h];
  const e=this.evidence(im,full);if(e.pc>=2&&e.bc>=4)return full;
  const gray=new cv.Mat(),blur=new cv.Mat(),circlesMat=new cv.Mat(),edges=new cv.Mat(),linesMat=new cv.Mat();
  cv.cvtColor(im,gray,cv.COLOR_RGB2GRAY);cv.GaussianBlur(gray,blur,new cv.Size(3,3),0);
  cv.HoughCircles(blur,circlesMat,cv.HOUGH_GRADIENT,1.1,17,95,18,7,30);
  const circles:number[][]=[];for(let i=0;i<circlesMat.data32F.length;i+=3)circles.push(Array.from(circlesMat.data32F.slice(i,i+3)));
  const candidates:Box[]=[full],circleCandidates:{count:number;b:Box}[]=[],columns=circles.filter(c=>c[0]>.55*w);
  for(const [x,y,r] of columns)for(const [xx,yy] of columns){
   if(Math.abs(xx-x)>r*.5||yy<=y)continue;
   for(let gap=1;gap<5;gap++){
    const step=(yy-y)/gap;if(!(2.1*r<step&&step<3.7*r))continue;
    for(let first=0;first<5;first++){
     const top=y-first*step,cw=16*step,ch=9*step,left=x-.95625*cw,upper=top-1.675*step;
     if(left<-.025*cw||upper<-.025*ch||left+cw>w*1.025||upper+ch>h*1.04)continue;
     let count=0;for(let i=0;i<5;i++)if(columns.some(([cx,cy,cr])=>Math.abs(cx-x)<r*.5&&Math.abs(cy-(top+i*step))<r*.5&&.6*r<cr&&cr<1.6*r))count++;
     if(count>=3)circleCandidates.push({count,b:[Math.max(0,left),Math.max(0,upper),cw,ch]});
    }
   }
  }
  const circleBoxes=new Map<string,{count:number;b:Box}>();for(const c of circleCandidates.sort((a,b)=>b.count-a.count))if(!circleBoxes.has(c.b.map(v=>Math.round(v/4)).join(',')))circleBoxes.set(c.b.map(v=>Math.round(v/4)).join(','),c);
  candidates.push(...[...circleBoxes.values()].slice(0,40).map(c=>c.b));
  cv.Canny(blur,edges,10,40);cv.HoughLinesP(edges,linesMat,1,Math.PI/180,65,220,12);
  const lines:number[][]=[];for(let i=0;i<linesMat.data32S.length;i+=4){const a=Array.from(linesMat.data32S.slice(i,i+4)) as number[];if(Math.abs(a[1]-a[3])<3)lines.push(a);}
  for(const [x1,y1,x2] of lines)for(const [a1,b1,a2] of lines){
   if(b1<=y1+130)continue;const ch=b1-y1,cw=ch*16/9;
   if(Math.abs(Math.abs(x2-x1)-cw)>cw*.2||Math.abs(Math.abs(a2-a1)-cw)>cw*.2)continue;
   for(const left of [Math.min(x1,x2),Math.max(x1,x2)-cw,Math.min(a1,a2),Math.max(a1,a2)-cw])if(left>=0&&left+cw<=w+3&&b1<=h+3)candidates.push([left,y1,cw,ch]);
  }
  // Small ban portraits provide anchors when the client is embedded in a stream.
  {
   const upper=gray.roi(new cv.Rect(0,0,w,Math.round(h*.65))),hits:number[][]=[];
   for(let c=0;c<this.meta.ids.length;c++){
    const ref=this.atlas.roi(new cv.Rect(c%16*32,Math.floor(c/16)*32,32,32));
    for(const size of [10,12,14,16,18,20,22]){
     const template=new cv.Mat(),result=new cv.Mat();cv.resize(ref,template,new cv.Size(size,size),0,0,cv.INTER_AREA);cv.matchTemplate(upper,template,result,cv.TM_CCOEFF_NORMED);
     const m=cv.minMaxLoc(result);if(m.maxVal>=.70)hits.push([m.maxVal,m.maxLoc.x+size/2,m.maxLoc.y+size/2,size]);template.delete();result.delete();
    }ref.delete();
   }upper.delete();
   const unique:number[][]=[];for(const hit of hits.sort((a,b)=>b[0]-a[0])){if(unique.every(x=>Math.abs(hit[1]-x[1])+Math.abs(hit[2]-x[2])>6))unique.push(hit);if(unique.length>=30)break;}
   for(const [,x,y,size] of unique)for(const fraction of [.021875,.023,.0208]){
    const cw=size/fraction,ch=cw*9/16;if(cw<400||cw>w*1.03)continue;
    for(const side of [.023,.85])for(let i=0;i<5;i++){const left=x-(side+.03125*i)*cw,top=y-ch*.059;if(left>=-3&&top>=-3&&left+cw<=w+6&&top+ch<=h+6)candidates.push([Math.max(0,left),Math.max(0,top),cw,ch]);}
   }
  }
  gray.delete();blur.delete();circlesMat.delete();edges.delete();linesMat.delete();
  const unique=new Map<string,Box>();for(const b of candidates)unique.set(b.map(v=>Math.round(v/4)).join(','),b);
  const shortlist=[...unique.values()].map(b=>({b,q:this.quick(im,b,true)})).sort((a,b)=>b.q-a.q).slice(0,24);
  const ranked=shortlist.map(({b})=>({b,q:this.quick(im,b)})).sort((a,b)=>b.q-a.q).slice(0,8);
  return ranked.map(({b})=>({b,q:this.evidence(im,b).value})).sort((a,b)=>b.q-a.q)[0]?.b??full;
 }
}
async function png(canvas:OffscreenCanvas){return canvas.convertToBlob({type:'image/png'});}
function wordsFrom(data:{blocks:unknown}):Word[]{return ((data.blocks??[]) as any[]).flatMap(b=>(b.paragraphs??[]).flatMap((p:any)=>(p.lines??[]).flatMap((l:any)=>l.words??[])));}
scope.onmessage=async(event)=>{
 let vision:Vision|undefined,ocr:OCRWorker|undefined;
 try{
  const bitmap=event.data.bitmap as ImageBitmap,origin=scope.location.origin;
  progress('Loading local recognition tools',3);
  const [cv,meta,buffer,atlasBlob]=await Promise.all([Promise.resolve(cvModule),fetch('/image-tools/templates.json').then(r=>r.json()),fetch('/image-tools/templates.bin').then(r=>r.arrayBuffer()),fetch('/image-tools/portrait-atlas.png').then(r=>r.blob())]);
  const atlasBitmap=await createImageBitmap(atlasBlob),atlasCanvas=new OffscreenCanvas(atlasBitmap.width,atlasBitmap.height),ax=atlasCanvas.getContext('2d')!;ax.drawImage(atlasBitmap,0,0);atlasBitmap.close();
  const atlasRGBA=cv.matFromImageData(ax.getImageData(0,0,atlasCanvas.width,atlasCanvas.height)),atlas=new cv.Mat();cv.cvtColor(atlasRGBA,atlas,cv.COLOR_RGBA2GRAY);atlasRGBA.delete();
  vision=new Vision(cv,meta,new Float32Array(buffer),atlas);
  const original=new OffscreenCanvas(bitmap.width,bitmap.height);original.getContext('2d')!.drawImage(bitmap,0,0);bitmap.close();
  const scaled=new OffscreenCanvas(960,Math.round(original.height*960/original.width)),sx=scaled.getContext('2d')!;sx.drawImage(original,0,0,scaled.width,scaled.height);
  const rgba=cv.matFromImageData(sx.getImageData(0,0,scaled.width,scaled.height)),im=new cv.Mat();cv.cvtColor(rgba,im,cv.COLOR_RGBA2RGB);rgba.delete();
  progress('Finding the champion-select panels',15);const box=vision.locate(im),[l,t,w,h]=box;
  progress('Reading champion labels and pick states',40);
  ocr=await createWorker('eng',1,{workerPath:origin+'/image-tools/worker.min.js',corePath:origin+'/image-tools/core',langPath:origin+'/image-tools',workerBlobURL:false});
  await ocr.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT});
  const full=new OffscreenCanvas(Math.min(1920,original.width*2),Math.round(original.height*Math.min(1920,original.width*2)/original.width));full.getContext('2d')!.drawImage(original,0,0,full.width,full.height);
  const fullWords=wordsFrom((await ocr.recognize(await png(full),{}, {blocks:true,text:true})).data);
  const montage=new OffscreenCanvas(1240,2000),mx=montage.getContext('2d',{willReadFrequently:true})!;mx.fillStyle='#fff';mx.fillRect(0,0,1240,2000);
  for(let i=0;i<10;i++){
   const team=i<5?'ally':'enemy',row=i%5,cy=t+h*(.186+row/9),xr=team==='ally'?[.089,.23]:[.78,.935],f=original.width/960;
   mx.drawImage(original,(l+w*xr[0])*f,(cy-h*.043)*f,w*(xr[1]-xr[0])*f,h*.059*f,0,i*200,600,160);
   const patch=mx.getImageData(0,i*200,600,160),d=patch.data;
   for(let k=0;k<d.length;k+=4){const lo=Math.min(d[k],d[k+1],d[k+2]),hi=Math.max(d[k],d[k+1],d[k+2]),keep=lo>155&&hi-lo<100||d[k]>150&&d[k+1]>125&&d[k+2]<d[k+1]*.8;d[k]=d[k+1]=d[k+2]=keep?0:255;}
   mx.putImageData(patch,640,i*200);
  }
  const localWords=wordsFrom((await ocr.recognize(await png(montage),{}, {blocks:true,text:true})).data);
  const lookup=new Map(meta.names.map((name:string,i:number)=>[norm(name),meta.ids[i]]));for(const [a,b] of [['nunu','Nunu & Willump'],['monkeyking','Wukong']]){const id=lookup.get(norm(b));if(id)lookup.set(a,id);}
  function label(words:Word[]){const tokens=words.filter(v=>v.confidence>=65).map(v=>norm(v.text));for(const width of [3,2,1])for(let k=0;k<=tokens.length-width;k++){const id=lookup.get(tokens.slice(k,k+width).join(''));if(id)return id;}return null;}
  progress('Recognizing picks and bans',72);const slots:ImageSlot[]=[];
  for(const team of teams)for(let row=0;row<5;row++){
   const y=t+h*(.186+row/9);let match=vision.portrait(im,l+w*(team==='ally'?.0667:.95625),y,w*.023),shift=false;
   if(team==='ally'){const hover=vision.portrait(im,l+w*.042,y,w*.023);if(hover.score>=.64&&hover.margin>=.055&&hover.score>match.score+.05){match=hover;shift=true;}}
   let local=localWords.filter(v=>Math.floor((v.bbox.y0+v.bbox.y1)/2/200)===(team==='ally'?0:5)+row);
   const xr=team==='ally'?[.09,.285]:[.75,.932],full=fullWords.filter(v=>{const x=(v.bbox.x0+v.bbox.x1)/2/Math.min(1920,original.width*2)*960,yy=(v.bbox.y0+v.bbox.y1)/2/Math.min(1920,original.width*2)*960;return x>l+w*xr[0]&&x<l+w*xr[1]&&Math.abs(yy-y)<h*.043;});
   const localLabel=label(local.filter(v=>((v.bbox.y0+v.bbox.y1)/2%200)/160*.059-.043<.014));
   let championLabel=localLabel??label(full);
   if(!championLabel&&(match.score<.64||match.margin<.055)){
    const f=original.width/960,xrange=team==='ally'?[.089,.23]:[.78,.935],width=Math.min(1600,Math.round(w*(xrange[1]-xrange[0])*f*4)),height=Math.round(width*h*.059/(w*(xrange[1]-xrange[0]))),crop=new OffscreenCanvas(width,height),cx=crop.getContext('2d',{willReadFrequently:true})!;
    cx.drawImage(original,(l+w*xrange[0])*f,(y-h*.043)*f,w*(xrange[1]-xrange[0])*f,h*.059*f,0,0,width,height);
    await ocr.setParameters({tessedit_pageseg_mode:PSM.SINGLE_BLOCK});
    for(let pass=0;pass<2&&!championLabel;pass++){
     if(pass){const patch=cx.getImageData(0,0,width,height),d=patch.data;for(let k=0;k<d.length;k+=4){const lo=Math.min(d[k],d[k+1],d[k+2]),hi=Math.max(d[k],d[k+1],d[k+2]),keep=lo>155&&hi-lo<100||d[k]>150&&d[k+1]>125&&d[k+2]<d[k+1]*.8;d[k]=d[k+1]=d[k+2]=keep?0:255;}cx.putImageData(patch,0,0);}
     const words=wordsFrom((await ocr.recognize(await png(crop),{}, {blocks:true,text:true})).data);championLabel=label(words.filter(v=>(v.bbox.y0+v.bbox.y1)/2/height*.059-.043<.014));local=[...local,...words];
    }
   }
   const tokens=[...local,...full].map(v=>norm(v.text));
   let red=0,total=0;if(team==='enemy')for(let yy=Math.max(0,Math.round(y-h*.05));yy<Math.min(im.rows,Math.round(y+h*.05));yy++)for(let x=Math.max(0,Math.round(l+w*.991));x<Math.min(im.cols,Math.round(l+w*.999));x++){const k=(yy*im.cols+x)*3;total++;if(im.data[k]>90&&im.data[k]>im.data[k+1]*1.5&&im.data[k]>im.data[k+2]*1.1)red++;}
   const picking=total>0&&red/total>.3||tokens.some(v=>/^(picking|choosing|seleccionando)/.test(v)||['pcking','picling','piclung','piding'].includes(v));
   const accepted=!!championLabel&&!shift||match.score>=.64&&match.margin>=.055;
   slots.push({team,slot:row+1,championId:accepted?(championLabel&&!shift?String(championLabel):meta.ids[match.index]):null,status:accepted?(shift?'hover':picking?'picking':'locked'):'unknown',role:tokens.map(v=>roles[v]).find(Boolean)??null,similarity:match.score,margin:match.margin});
  }
  progress('Checking ambiguous detections',95);
  const bans=teams.flatMap(team=>vision!.banrow(im,box,team));
  for(const team of teams){for(const ban of bans.filter(b=>b.team===team&&b.championId)){if(bans.filter(b=>b.team===team&&b.championId===ban.championId).length>1){const id=ban.championId;for(const b of bans)if(b.team===team&&b.championId===id)b.championId=null;}}
   const repeated=new Set(slots.filter(s=>s.team===team&&s.championId&&slots.filter(v=>v.team===team&&v.championId===s.championId).length>1).map(s=>s.championId));for(const slot of slots)if(slot.team===team&&repeated.has(slot.championId))slot.championId=null;
  }
  im.delete();await ocr.terminate();ocr=undefined;vision.dispose();vision=undefined;
  const reading:ScreenshotReading={slots,bans,box,width:960,height:scaled.height};scope.postMessage({kind:'result',reading});
 }catch(error){scope.postMessage({kind:'error',message:error instanceof Error?error.message:'Image recognition failed'});}
 finally{if(ocr)await ocr.terminate();vision?.dispose();}
};
