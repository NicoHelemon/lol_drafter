import type {State} from '../domain/types';
import {advanceDraft,backDraft,stage} from '../domain/progression';
export default function DraftProgress({state,host,busy,change}:{state:State;host:boolean;busy:boolean;change:(fn:(s:State)=>State)=>Promise<void>}){
 if(!state.draftMode)return null;
 const current=stage(state),index=state.draftStep??0;
 return <div className={`draft-progress ${current?.side??'both'}`} role="region" aria-label="Draft progression">
  <h3>{current?.label??'Draft complete'}</h3>
  {host&&<div className="actions">
   <button disabled={busy||!index} onClick={()=>void change(backDraft)}>Previous step</button>
   {current&&current.kind!=='pick'&&<button disabled={busy} onClick={()=>void change(advanceDraft)}>{current.kind==='ban'?'No ban':'Skip remaining bans'}</button>}
  </div>}
 </div>;
}
