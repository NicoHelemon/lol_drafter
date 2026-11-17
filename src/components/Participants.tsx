import type {Player} from '../domain/types';
export default function Participants({players,hostId,online,uid,busy,onTransfer,onObserve}:{players:Player[];hostId:string;online:string[];uid:string;busy:boolean;onTransfer:(id:string)=>void;onObserve:()=>void}){
 const observing=!players.find(p=>p.id===uid)?.role,chip=(p:Player)=><span className={`participant-chip${p.id===uid?' participant-self':''}`} key={p.id}><i className={online.includes(p.id)?'dot':'dot off'}/><span title={p.name}>{p.name}</span>{p.id===hostId&&<b className="host-badge">HOST</b>}{uid===hostId&&p.id!==hostId&&<button className="transfer-host" title={`Transfer hosting to ${p.name}`} aria-label={`Make ${p.name} host`} disabled={busy} onClick={()=>onTransfer(p.id)}>♛</button>}</span>;
 return <section className="participants" aria-label="Room participants">
  <div className="participant-count">{players.length}<span>/10 participants</span></div>
  {players.some(p=>p.role)&&<div className="participant-list" aria-label="Players">{players.filter(p=>p.role).map(chip)}</div>}
  <section className={`observer-area${observing?' observing':''}`} aria-label="Observers"
   onClick={e=>{if(!busy&&!observing&&e.target instanceof Element&&!e.target.closest('button'))onObserve();}}
   onDragOver={e=>{if(!busy&&!observing&&e.dataTransfer.types.includes('application/x-draftroom-role')){e.preventDefault();e.dataTransfer.dropEffect='move';}}}
   onDrop={e=>{if(!busy&&!observing&&e.dataTransfer.getData('application/x-draftroom-role')===players.find(p=>p.id===uid)?.role){e.preventDefault();onObserve();}}}>
   <button className="observer-place" aria-label="Join observers" aria-pressed={observing} title="Leave your role and observe; your selected champion stays in its slot" disabled={busy||observing} onClick={onObserve}>Observers{!observing&&<small>Join ↗</small>}</button>
   <div className="participant-list">{players.filter(p=>!p.role).map(chip)}</div>
  </section>
 </section>;
}
