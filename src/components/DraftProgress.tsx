import type {State} from '../domain/types';
import {advanceDraft,backDraft,canAdvance,draftStages,stage} from '../domain/progression';
export default function DraftProgress({state,host,busy,change}:{state:State;host:boolean;busy:boolean;change:(fn:(s:State)=>State)=>Promise<void>}){
 if(!state.draftMode)return null;
 const current=stage(state),index=state.draftStep??0,total=draftStages(state.draftMode).length;
 const noBan=current?.kind==='ban'&&!state.bans[state.side===current.side?'ally':'enemy'][current.slot!];
 return <div className={`draft-progress ${current?.side??'both'}`} role="region" aria-label="Draft progression"><div><small>{state.draftMode==='ranked'?'Ranked draft':'Tournament draft'} · {current?`Step ${index+1}/${total}`:'Complete'}</small><h3>{current?.label??'Draft complete'}</h3><p>{!current?'You can still rearrange champions and roles.':current.kind==='pick'?`Select ${current.count===2?'both champions':'a champion'}, then confirm to continue.`:current.kind==='bans'?'Enter both teams’ bans together. Empty slots mean no ban.':'Choose a ban, or confirm no ban. No timer.'}</p></div><div className="actions">{host?<><button disabled={busy||!index} onClick={()=>void change(backDraft)}>Previous step</button>{current&&<button className="primary" disabled={busy||!canAdvance(state)} onClick={()=>void change(advanceDraft)}>{noBan?'Confirm no ban':current.kind==='pick'?`Confirm ${current.count===2?'2 picks':'pick'}`:current.kind==='bans'?'Confirm bans':'Confirm ban'}</button>}</>:<span className="muted">The host confirms each step.</span>}</div></div>;
}
