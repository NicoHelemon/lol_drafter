import { useEffect, useState } from 'react';
import type { PickSwapRequest, State } from '../domain/types';
import { roleName } from '../domain/roles';
import { names, Portrait } from './Champions';
import { RoleIcon } from './RoleIcon';
export default function PickSwapPrompt({ request, state, uid, busy, onRespond }: {
  request:PickSwapRequest; state:State; uid:string; busy:boolean; onRespond:(accept:boolean)=>void;
}) {
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),50);return()=>clearInterval(timer);},[request.id]);
  const remaining=Math.max(0,Date.parse(request.expires_at)-now);
  const needsReply=(uid===request.from_player_id&&!request.from_accepted)||(uid===request.to_player_id&&!request.to_accepted);
  if(!remaining) return null;
  const from=state.players.find(p=>p.id===request.from_player_id)?.name ?? 'Player';
  const to=state.players.find(p=>p.id===request.to_player_id)?.name ?? 'Player';
  const receiving=uid===request.to_player_id && !request.to_champion_id;
  const title=!needsReply ? 'Waiting for champion swap' : receiving ? 'Receive champion?' : request.to_champion_id ? 'Champion swap request' : 'Give champion?';
  const percent=Math.min(100,100*remaining/Math.max(1,Date.parse(request.expires_at)-Date.parse(request.created_at)));
  return <div className="modal-backdrop swap-prompt">
    <section className="modal" role="dialog" aria-modal="true" aria-label={needsReply ? 'Champion swap request' : 'Champion swap pending'}>
      <div className="section-heading"><h2>{title}</h2><span className="muted" aria-label="Time remaining">{Math.ceil(remaining/1000)}s</span></div>
      <p>{request.to_champion_id ? <>Swap the selected champions of <strong>{from}</strong> and <strong>{to}</strong>?</>
        : <><strong>{from}</strong> gives {names[request.from_champion_id]} to <strong>{to}</strong>. {from} will have no selected champion.</>}</p>
      <div className="pick-swap-preview">
        <div><RoleIcon role={request.from_role}/><Portrait id={request.from_champion_id}/><b>{names[request.from_champion_id]}</b><small>{from} · {roleName(request.from_role)}</small></div>
        <span aria-hidden="true">{request.to_champion_id ? '⇄' : '→'}</span>
        <div><RoleIcon role={request.to_role}/>{request.to_champion_id ? <Portrait id={request.to_champion_id}/> : <span className="swap-empty-pick">+</span>}<b>{request.to_champion_id ? names[request.to_champion_id] : 'No selection'}</b><small>{to} · {roleName(request.to_role)}</small></div>
      </div>
      {!needsReply && <p className="swap-wait">Waiting for player approval…</p>}
      <div className="swap-timer" role="progressbar" aria-label="Champion swap time remaining" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}><div style={{width:`${percent}%`}}/></div>
      <div className="modal-actions">
        <button disabled={busy} onClick={()=>onRespond(false)}>{needsReply ? 'Decline' : 'Cancel'}</button>
        {needsReply && <button className="primary" disabled={busy} onClick={()=>onRespond(true)}>{receiving ? 'Receive champion' : 'Accept'}</button>}
      </div>
    </section>
  </div>;
}
