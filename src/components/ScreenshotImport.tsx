import {useEffect,useRef,useState} from 'react';
import type {State} from '../domain/types';
import {assertScreenshotTarget,proposeScreenshot,proposalAdditions,mergeScreenshot,type ScreenshotAdditions} from '../domain/screenshot';

export default function ScreenshotImport({state,version,busy,onImport}:{state:State;version:number;busy:boolean;onImport:(additions:ScreenshotAdditions,version:number)=>Promise<void>}){
 const fileInput=useRef<HTMLInputElement>(null),worker=useRef<Worker|null>(null),sequence=useRef(0),timeout=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const [working,setWorking]=useState(false),[stage,setStage]=useState(''),[progress,setProgress]=useState(0),[drag,setDrag]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const active=useRef({busy,version,state,onImport});active.current={busy,version,state,onImport};
 const stop=()=>{sequence.current++;clearTimeout(timeout.current);worker.current?.terminate();worker.current=null;setWorking(false);setDrag(false);};
 useEffect(()=>()=>{sequence.current++;clearTimeout(timeout.current);worker.current?.terminate();},[]);
 const ingest=useRef<(file:File)=>Promise<void>>(async()=>{});
 ingest.current=async(file:File)=>{
  if(active.current.busy)return;
  stop();setError('');setNotice('');
  try{assertScreenshotTarget(active.current.state);}catch(e){setError((e as Error).message);return;}
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)){setError('Choose a PNG, JPEG or WebP screenshot.');return;}
  if(file.size>20*1024*1024){setError('The image must be smaller than 20 MB.');return;}
  const token=sequence.current;setWorking(true);setStage('Opening screenshot');setProgress(0);
  try{
   const bitmap=await createImageBitmap(file);
   if(token!==sequence.current){bitmap.close();return;}
   if(bitmap.width<480||bitmap.height<270||bitmap.width*bitmap.height>16000000||bitmap.width/bitmap.height<.9||bitmap.width/bitmap.height>3.5){bitmap.close();throw Error('Use a landscape champion-select screenshot, at least 480 × 270 and at most 16 megapixels.');}
   try{assertScreenshotTarget(active.current.state);}catch(e){bitmap.close();throw e;}
   const engine=new Worker(new URL('../vision/recognizer.worker.ts',import.meta.url),{type:'module'});worker.current=engine;
   timeout.current=setTimeout(()=>{if(token===sequence.current){stop();setError('Recognition took too long. Try a screenshot cropped to the game client.');}},180000);
   engine.onmessage=async event=>{
    if(token!==sequence.current)return;
    const data=event.data;
    if(data.kind==='progress'){setStage(data.message);setProgress(data.value);return;}
    clearTimeout(timeout.current);engine.terminate();worker.current=null;
    try{
     if(data.kind!=='result')throw Error('Could not read this screenshot. '+(data.message??'Try cropping it to the game client.'));
     const current=active.current;assertScreenshotTarget(current.state);
     if(current.busy)throw Error('The room is being updated. Try importing again.');
     const proposal=proposeScreenshot(current.state,data.reading),additions=proposalAdditions(proposal);
     const count=Object.values(additions.picks).flat().length+Object.values(additions.bans).flat().length;
     if(!count){
      if(data.reading.slots.some((s:{championId:string|null;status:string})=>s.championId&&s.status==='locked')||data.reading.bans.some((b:{championId:string|null})=>b.championId)){setNotice('No new selections detected. Existing picks and bans are unchanged.');return;}
      throw Error('No confirmed picks or bans were detected. Try a clearer screenshot cropped to the game client.');
     }
     mergeScreenshot(current.state,additions);
     setStage('Importing selections');setProgress(100);
     await current.onImport(additions,current.version);
     if(token===sequence.current)setNotice(`Imported ${count} selections · Undo with Ctrl + Z`);
    }catch(e){if(token===sequence.current)setError(e instanceof Error?e.message:'This image could not be imported.');}
    finally{if(token===sequence.current)setWorking(false);}
   };
   engine.onerror=()=>{if(token===sequence.current){stop();setError('The recognition tools could not load. Reload the page and try again.');}};
   engine.postMessage({bitmap},[bitmap]);
  }catch(e){if(token===sequence.current){setWorking(false);setError(e instanceof Error?e.message:'This image could not be opened.');}}
 };
 useEffect(()=>{
  const editable=(target:EventTarget|null)=>target instanceof Element&&!!target.closest('input,textarea,select,[contenteditable="true"],[role="textbox"],[role="dialog"]');
  const paste=(e:ClipboardEvent)=>{if(e.defaultPrevented||editable(e.target)||active.current.busy)return;const file=[...(e.clipboardData?.items??[])].find(i=>i.kind==='file'&&i.type.startsWith('image/'))?.getAsFile();if(file){e.preventDefault();void ingest.current(file);}};
  const dragOver=(e:DragEvent)=>{if(e.dataTransfer?.types.includes('Files')&&!active.current.busy){e.preventDefault();e.dataTransfer.dropEffect='copy';setDrag(true);}};
  const drop=(e:DragEvent)=>{if(!e.dataTransfer?.types.includes('Files'))return;e.preventDefault();setDrag(false);const file=e.dataTransfer.files[0];if(file)void ingest.current(file);};
  const leave=(e:DragEvent)=>{if(!e.relatedTarget)setDrag(false);};
  window.addEventListener('paste',paste);window.addEventListener('dragover',dragOver);window.addEventListener('drop',drop);window.addEventListener('dragleave',leave);
  return()=>{window.removeEventListener('paste',paste);window.removeEventListener('dragover',dragOver);window.removeEventListener('drop',drop);window.removeEventListener('dragleave',leave);};
 },[]);
 return <section className={`screenshot-panel${drag?' image-drop-active':''}`} aria-label="Screenshot import">
  <div className="screenshot-panel-heading"><strong>Import screenshot</strong><span className="muted">Host</span></div>
  <div className="screenshot-drop-area">
   <span className="image-import-symbol" aria-hidden="true">▧</span>
   <div><b>{working?stage:'Drop a champion-select screenshot here'}</b><small>{working?'Recognition runs on your device.':'Or paste with Ctrl + V anywhere on the draft.'}</small></div>
   {working?<button disabled={busy} onClick={()=>{stop();setNotice('Recognition cancelled');}}>Cancel</button>:<button disabled={busy} onClick={()=>fileInput.current?.click()}>Choose image</button>}
  </div>
  <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Choose draft screenshot" hidden onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void ingest.current(file);}}/>
  {working&&<div className="image-progress" role="progressbar" aria-label="Screenshot recognition" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{width:`${progress}%`}}/></div>}
  <small className="screenshot-import-note">Imports directly into Open draft. Existing selections are kept; correct roles in the draft.</small>
  <small className="screenshot-privacy">Processed locally · crop to the client for faster recognition</small>
  {error&&<p className="screenshot-error" role="alert">{error}</p>}
  {notice&&<p className="screenshot-notice" role="status">{notice}</p>}
  <span className="sr-only" role="status">{working?stage:''}</span>
 </section>;
}
