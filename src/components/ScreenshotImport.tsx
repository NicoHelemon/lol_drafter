import {useEffect,useMemo,useRef,useState} from 'react';
import {ROLES,type State,type Role} from '../domain/types';
import {proposeScreenshot,proposalAdditions,mergeScreenshot,type ScreenshotReading,type ImportProposal,type ScreenshotAdditions} from '../domain/screenshot';
import {names,Portrait} from './Champions';
import {roleName} from '../domain/roles';

export default function ScreenshotImport({state,version,busy,onImport}:{state:State;version:number;busy:boolean;onImport:(additions:ScreenshotAdditions,version:number)=>Promise<void>}){
 const fileInput=useRef<HTMLInputElement>(null),worker=useRef<Worker|null>(null),sequence=useRef(0),modal=useRef<HTMLDivElement>(null);
 const [working,setWorking]=useState(false),[stage,setStage]=useState(''),[progress,setProgress]=useState(0),[drag,setDrag]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [reading,setReading]=useState<ScreenshotReading|null>(null),[proposal,setProposal]=useState<ImportProposal|null>(null),[preview,setPreview]=useState(''),[previewVersion,setPreviewVersion]=useState(version);
 const active=useRef({busy,version});active.current={busy,version};
 const currentState=useRef(state);currentState.current=state;
 const stop=()=>{sequence.current++;worker.current?.terminate();worker.current=null;setWorking(false);setDrag(false);};
 useEffect(()=>()=>{sequence.current++;worker.current?.terminate();},[]);
 useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview);},[preview]);
 useEffect(()=>{if(reading){if(previewVersion!==version)setError('The room changed. Suggestions have been refreshed; review them before importing.');setProposal(proposeScreenshot(currentState.current,reading));setPreviewVersion(version);}},[version,reading]);
 useEffect(()=>{if(proposal){const el=document.activeElement as HTMLElement|null;modal.current?.querySelector<HTMLButtonElement>('button')?.focus();return()=>el?.focus();}},[!!proposal]);
 useEffect(()=>{if(proposal){const previous=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=previous;};}},[!!proposal]);
 const ingest=useRef<(file:File)=>Promise<void>>(async()=>{});
 ingest.current=async(file:File)=>{
  if(active.current.busy)return;
  stop();setReading(null);setProposal(null);setError('');setNotice('');
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)){setError('Choose a PNG, JPEG or WebP screenshot.');return;}
  if(file.size>20*1024*1024){setError('The image must be smaller than 20 MB.');return;}
  const token=sequence.current;setWorking(true);setStage('Opening screenshot');setProgress(0);
  try{
   const bitmap=await createImageBitmap(file);
   if(token!==sequence.current){bitmap.close();return;}
   if(bitmap.width<480||bitmap.height<270||bitmap.width*bitmap.height>16000000||bitmap.width/bitmap.height<.9||bitmap.width/bitmap.height>3.5){bitmap.close();throw Error('Use a landscape champion-select screenshot, at least 480 × 270 and at most 16 megapixels.');}
   setPreview(URL.createObjectURL(file));
   const engine=new Worker(new URL('../vision/recognizer.worker.ts',import.meta.url),{type:'module'});worker.current=engine;
   const timeout=setTimeout(()=>{if(token===sequence.current){stop();setError('Recognition took too long. Try a screenshot cropped to the game client.');}},180000);
   engine.onmessage=event=>{
    if(token!==sequence.current)return;
    const data=event.data;
    if(data.kind==='progress'){setStage(data.message);setProgress(data.value);}
    else {clearTimeout(timeout);engine.terminate();worker.current=null;setWorking(false);
     if(data.kind==='result'){setReading(data.reading);setProposal(proposeScreenshot(currentState.current,data.reading));setPreviewVersion(active.current.version);}
     else setError('Could not read this screenshot. '+(data.message??'Try cropping it to the game client.'));
    }
   };
   engine.onerror=()=>{if(token===sequence.current){clearTimeout(timeout);stop();setError('The recognition tools could not load. Reload the page and try again.');}};
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
 const additions=useMemo(()=>proposal?proposalAdditions(proposal):null,[proposal]);
 const count=additions?Object.values(additions.picks).flat().length+Object.values(additions.bans).flat().length:0;
 let validation='';if(additions&&count)try{mergeScreenshot(state,additions);}catch(e){validation=e instanceof Error?e.message:'Review the additions';}
 function changeRole(key:string,role:Role){setProposal(old=>{if(!old)return old;const next=structuredClone(old),pick=next.picks.find(p=>p.key===key)!;const other=next.picks.find(p=>p.team===pick.team&&p.key!==key&&p.role===role);if(other)other.role=pick.role;pick.role=role;pick.estimated=false;return next;});}
 async function apply(){if(!additions||!count||validation)return;setError('');try{await onImport(additions,previewVersion);setReading(null);setProposal(null);setNotice(`Imported ${count} selections · Undo with Ctrl + Z`);}catch(e){setError(e instanceof Error?e.message:'Import failed. Review the room and try again.');}}
 return <>
  <section className={`screenshot-panel${drag?' image-drop-active':''}`} aria-label="Screenshot import">
   <div className="screenshot-panel-heading"><strong>Import screenshot</strong><span className="muted">Host</span></div>
   <div className="screenshot-drop-area">
    <span className="image-import-symbol" aria-hidden="true">▧</span>
    <div><b>{working?stage:'Drop a champion-select screenshot here'}</b><small>{working?'Recognition runs on your device.':'Or paste with Ctrl + V anywhere on the draft.'}</small></div>
    {working?<button onClick={()=>{stop();setNotice('Recognition cancelled');}}>Cancel</button>:<button disabled={busy} onClick={()=>fileInput.current?.click()}>Choose image</button>}
   </div>
   <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Choose draft screenshot" hidden onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void ingest.current(file);}}/>
   {working&&<div className="image-progress" role="progressbar" aria-label="Screenshot recognition" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{width:`${progress}%`}}/></div>}
   <small className="screenshot-privacy">Processed locally · crop to the client for faster recognition</small>
   {!proposal&&error&&<p className="screenshot-error" role="alert">{error}</p>}
   {notice&&<p className="screenshot-notice" role="status">{notice}</p>}
   <span className="sr-only" role="status">{working?stage:''}</span>
  </section>
  {proposal&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy){setReading(null);setProposal(null);}}}>
   <div ref={modal} className="modal screenshot-review" role="dialog" aria-modal="true" aria-label="Review screenshot import" onKeyDown={e=>{
    if(e.key==='Escape'&&!busy){e.stopPropagation();setReading(null);setProposal(null);}
    if(e.key==='Tab'){const nodes=modal.current?.querySelectorAll<HTMLElement>('button:enabled,input:enabled,select:enabled');if(!nodes?.length)return;const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
   }}>
    <div className="section-heading"><h2>Review screenshot import</h2><button aria-label="Close screenshot review" disabled={busy} onClick={()=>{setReading(null);setProposal(null);}}>×</button></div>
    <div className="screenshot-review-body">
     <img className="screenshot-preview" src={preview} alt="Screenshot being reviewed"/>
     <p className="screenshot-preserve">Existing picks, bans and role placements stay unchanged. Left panel = Ally team.</p>
     {!state.openDraft&&count>0&&<p className="image-mode-notice"><strong>This will switch to Open draft.</strong> Picks and bans can then be edited in any order. Undo removes this import while keeping Open draft active.</p>}
     {(['ally','enemy'] as const).map(team=><section className="screenshot-team-review" key={team} aria-label={`${team==='ally'?'Ally':'Enemy'} screenshot additions`}>
      <h3>{team==='ally'?'Ally team':'Enemy team'}</h3>
      {proposal.picks.filter(p=>p.team===team).map(p=><div className="image-pick-row" key={p.key}>
       <label><input type="checkbox" aria-label={`Import ${names[p.championId]} ${team} pick`} checked={p.included} disabled={busy} onChange={e=>{const checked=e.target.checked;setProposal(old=>old&&({...old,picks:old.picks.map(v=>v.key===p.key?{...v,included:checked}:v)}));}}/><Portrait id={p.championId}/><span>{names[p.championId]}<small>{p.estimated?'Estimated role':'Role from client'}</small></span></label>
       <select aria-label={`${names[p.championId]} ${team} role`} value={p.role} disabled={busy} onChange={e=>changeRole(p.key,e.target.value as Role)}>{ROLES.filter(r=>!state.picks[team].some(v=>v.role===r)).map(r=><option value={r} key={r}>{roleName(r)}</option>)}</select>
      </div>)}
      <div className="image-bans-review">{proposal.bans.filter(b=>b.team===team).map(b=><label key={b.key}><input type="checkbox" aria-label={`Import ${names[b.championId]} ${team} ban ${b.slot+1}`} checked={b.included} disabled={busy} onChange={e=>{const checked=e.target.checked;setProposal(old=>old&&({...old,bans:old.bans.map(v=>v.key===b.key?{...v,included:checked}:v)}));}}/><Portrait id={b.championId}/><span>{names[b.championId]}<small>Ban {b.slot+1}</small></span></label>)}</div>
      {!proposal.picks.some(p=>p.team===team)&&!proposal.bans.some(b=>b.team===team)&&<small className="muted">No new confirmed selections</small>}
     </section>)}
     {proposal.pending>0&&<p className="muted">{proposal.pending} hover or in-progress picks left out.</p>}
     <p className="muted">Uncertain or obscured portraits are left out. Check the suggestions before importing.</p>
     {proposal.notes.map(n=><p className="image-mode-notice" key={n}>{n}</p>)}
     {validation&&<p className="screenshot-error" role="alert">{validation}</p>}
     {error&&<p className="screenshot-error" role="alert">{error}</p>}
     {!count&&<p className="screenshot-notice">No new picks or bans to add. Existing selections are unchanged.</p>}
    </div>
    <div className="modal-actions"><span>{count} additions · one Undo action</span><button className="primary" disabled={busy||!count||!!validation} onClick={()=>void apply()}>{state.openDraft?'Import selections':'Switch to Open draft & import'}</button></div>
   </div>
  </div>}
 </>;
}
