import type {State} from '../domain/types';
import {advanceDraft,stage} from '../domain/progression';
export default function DraftProgress({state,host,busy,change,undoCount,redoCount,onHistory}:{state:State;host:boolean;busy:boolean;change:(fn:(s:State)=>State)=>Promise<void>;undoCount:number;redoCount:number;onHistory:(action:'undo'|'redo')=>void}){
 if(!state.draftMode)return null;
 const current=stage(state);
 return <div className={`draft-progress ${state.openDraft?'open':current?.side??'both'}`} role="region" aria-label="Draft progression">
  <h3>{state.openDraft?'Open draft':current?.label??'Draft complete'}</h3>
  {host&&<div className="actions">
   <button aria-label="Undo" title="Undo (Ctrl + Z)" aria-keyshortcuts="Control+z" disabled={busy||!undoCount} onClick={()=>onHistory('undo')}>Undo <kbd>Ctrl Z</kbd></button>
   <button aria-label="Redo" title="Redo (Ctrl + Y)" aria-keyshortcuts="Control+y" disabled={busy||!redoCount} onClick={()=>onHistory('redo')}>Redo <kbd>Ctrl Y</kbd></button>
   {current&&current.kind!=='pick'&&<button disabled={busy} onClick={()=>void change(advanceDraft)}>{current.kind==='ban'?'No ban':'Skip remaining bans'}</button>}
  </div>}
 </div>;
}
