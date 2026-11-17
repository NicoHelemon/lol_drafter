import {rolePool,toggleRoleCandidate} from '../domain/rolePools';
import {automaticPool} from '../domain/automaticCandidates';
import {canPick,canBan} from '../domain/progression';
import {canSelectPick,canRequestPickMove} from '../domain/pickPermissions';
import DraftProgress from '../components/DraftProgress';
import { useState, useEffect, useMemo, type DragEvent } from 'react';
import {pairKey} from '../domain/scoring';
import { ROLES, type State, type Team, type Role } from '../domain/types';
import { roleName } from '../domain/roles';
import { RoleIcon } from '../components/RoleIcon';
import { candidates } from '../domain/candidates';
import { record } from '../domain/state';
import { names, Portrait } from '../components/Champions';
import DraftChampion from '../components/DraftChampion';
import TeamSummary from '../components/TeamSummary';
import StatisticsNote from '../components/StatisticsNote';
import type { Picker } from '../App';
interface Props {
  state: State; uid: string; host:boolean; busy: boolean;readOnly?:boolean;
  change: (fn: (s: State) => State) => Promise<void>;
  setPicker: (p: Picker) => void;
  onMove: (team: Team, from: Role, to: Role) => Promise<void>;
  onRoleMove:(to:Role)=>Promise<void>;
  onSavePool?:(role:Role)=>void;claimRole:(role:Role)=>void;pendingRoles?: Set<Role>;undoCount:number;redoCount:number;onHistory:(action:'undo'|'redo')=>void;
}
type DragPick = { team: Team; role: Role; championId: string };
export default function DraftPage({ state, uid, host, busy,readOnly=false,claimRole,onSavePool, change, setPicker, onMove,onRoleMove,undoCount,redoCount,onHistory, pendingRoles = new Set() }: Props) {
  const associatedPlayers = new Map(state.players.map(player => [player.role, player]));
  const pairIndex=useMemo(()=>new Map(state.dataset.pairs.map(p=>[pairKey(p),p])),[state.dataset.pairs]);
  const [activeTooltip,setActiveTooltip] = useState<string|null>(null);
  const [dragged, setDragged] = useState<DragPick | null>(null), [over, setOver] = useState<string | null>(null);
  const [roleDrag,setRoleDrag]=useState<Role|null>(null),[roleOver,setRoleOver]=useState<Role|null>(null);
  const myRole=state.players.find(p=>p.id===uid)?.role;
  useEffect(()=>{if(roleDrag&&roleDrag!==myRole){setRoleDrag(null);setRoleOver(null);}},[myRole,roleDrag]);
  useEffect(() => {
    if (dragged && !state.picks[dragged.team].some(p => p.role === dragged.role && p.championId === dragged.championId)) {
      setDragged(null); setOver(null);
    }
  }, [state.picks, dragged]);
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setActiveTooltip(null); setDragged(null); setOver(null);setRoleDrag(null);setRoleOver(null); }
    };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, []);
  const blockedRole = (team: Team, role: Role) => readOnly||team === 'ally' && pendingRoles.has(role);
  const canDrop = (team: Team, role: Role) => !!dragged && !busy && dragged.team === team && dragged.role !== role
    && !blockedRole(team, role) && !blockedRole(team, dragged.role)
    && canRequestPickMove(state,uid,host,team,dragged.role,role)
    && state.picks[team].some(p => p.role === dragged.role && p.championId === dragged.championId);
  function finish(team: Team, role: Role) {
    if (!canDrop(team, role) || !dragged) return;
    const from = dragged.role; setDragged(null); setOver(null); void onMove(team, from, role);
  }
  function start(e: DragEvent, team: Team, role: Role, championId: string) {
    if (busy || blockedRole(team, role)||!canSelectPick(state,uid,host,team,role)) { e.preventDefault(); return; }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-draftroom-pick', JSON.stringify({team, role, championId}));
    setDragged({team, role, championId});
    setRoleDrag(null);setRoleOver(null);
  }
  const roleTarget=(role:Role)=>!!roleDrag&&roleDrag===myRole&&role!==roleDrag&&!busy&&!pendingRoles.has(role)&&!pendingRoles.has(roleDrag);
  function finishRole(role:Role){if(roleTarget(role)){setRoleDrag(null);setRoleOver(null);void onRoleMove(role);}}
  return <section aria-label="Draft" className={`draft-page side-${state.side}`} onKeyDown={e => {
    if (e.key === 'Escape') { setDragged(null); setOver(null); }
  }}>
    <section className="card board integrated-board">
      <div className="section-heading"><h2>Draft board</h2><span className="badge">LIVE</span></div>
      <DraftProgress state={state} host={host} busy={busy} change={change} undoCount={undoCount} redoCount={redoCount} onHistory={onHistory}/>
      <div className="draft-bans" role="region" aria-label="Bans">
        {(['ally','enemy'] as Team[]).map(team => <section className={`team-bans ${team}${state.draftMode&&!state.openDraft&&state.bans[team].some((_,i)=>canBan(state,team,i))?' current-bans':''}`}  aria-label={team === 'ally' ? 'Ally bans' : 'Enemy bans'} key={team}>
          <b>{team === 'ally' ? 'ALLY BANS' : 'ENEMY BANS'}</b><div className="bans">
            {state.bans[team].map((id, slot) => <div key={slot}>
              <button aria-label={`Ban ${slot + 1} ${team}`} disabled={busy||readOnly||!canBan(state,team,slot)} onClick={() => setPicker(state.draftMode==='ranked'?{kind:'bans',team}:{kind:'ban',team,slot})}>
                {id ? <Portrait id={id} /> : <span>+</span>}
              </button>
              {id&&state.openDraft && <button className="remove-ban" aria-label={`Remove ban ${names[id]}`} disabled={busy||readOnly||!canBan(state,team,slot)} onClick={() => void change(s => {
                s.bans[team][slot] = null; return record(s,`Ban removed · ${names[id]}`);
              })}>×</button>}
            </div>)}
          </div>
        </section>)}
      </div>
      <p className="draft-move-hint" id="pick-move-help" role="status">{readOnly?'Hover champions to inspect scores.':roleDrag ? 'Choose a role. You keep your champion; another player must accept an exchange.' : dragged
        ? `Move ${names[dragged.championId]}: choose another ${dragged.team === 'ally' ? 'allied' : 'opponent'} role. Escape to cancel.`
        : 'Drag your role panel to change roles with your champion. Drag portraits to move champions only. Hover candidates to compare team scores.'}</p>
      <div className="board-head"><span>ROLE</span><TeamSummary team="ally" state={state}/><TeamSummary team="enemy" state={state}/></div>
      {ROLES.map(role => <div className="board-row" key={role}>
          <button className={`role-label draft-role-handle${roleTarget(role)?' role-drop-target':''}${roleOver===role?' role-drop-over':''}`} aria-label={myRole===role?`Move your ${roleName(role)} role`:`Move to ${roleName(role)} role`}
            title={!myRole&&!associatedPlayers.has(role)?'Take this role and load your candidates':myRole===role?'Drag to change role with your champion':'Drop your role here'}
            disabled={busy||pendingRoles.has(role)||!!myRole&&myRole!==role&&!roleTarget(role)||!myRole&&associatedPlayers.has(role)}
            draggable={myRole===role&&!busy&&!pendingRoles.has(role)} aria-pressed={roleDrag===role}
            onClick={()=>{if(!myRole&&!associatedPlayers.has(role))claimRole(role);}}
            onDragStart={e=>{if(myRole!==role){e.preventDefault();return;}e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('application/x-draftroom-role',role);setRoleDrag(role);setRoleOver(null);setDragged(null);setOver(null);setActiveTooltip(null);}}
            onDragEnd={()=>{setRoleDrag(null);setRoleOver(null);}}
            onDragOver={e=>{if(roleTarget(role)){e.preventDefault();e.dataTransfer.dropEffect='move';setRoleOver(role);}}}
            onDragLeave={e=>{if(!(e.relatedTarget instanceof Node)||!e.currentTarget.contains(e.relatedTarget))setRoleOver(null);}}
            onDrop={e=>{e.preventDefault();if(e.dataTransfer.types.includes('application/x-draftroom-role'))finishRole(role);}}><RoleIcon role={role}/><span>{roleName(role)}</span>
          {associatedPlayers.get(role) && <small className="role-player" title={associatedPlayers.get(role)!.name}>{associatedPlayers.get(role)!.name}</small>}
          </button>
        {(['ally','enemy'] as Team[]).map(team => {
          const player = team === 'ally' ? associatedPlayers.get(role) : undefined;
          const pick = state.picks[team].find(p => p.role === role);
          const explicit=rolePool(state,team,role),pool=automaticPool(state,team,role);
          const options = candidates(pool,role,team,state,names,pairIndex);
          const editable=!readOnly&&canSelectPick(state,uid,host,team,role)&&canPick(state,team,pick?.championId);
          const pending = blockedRole(team,role), available = canDrop(team,role), roleAvailable=team==='ally'&&roleTarget(role), key = `${team}:${role}`;
          return <section key={team} className={`draft-cell ${team}${player?.id === uid ? ' mine' : ''}${available ? ' drop-available' : ''}${over === key ? ' drop-over' : ''}${pending ? ' transfer-pending' : ''}${state.draftMode&&!state.openDraft&&editable?' current-pick':''}${roleAvailable?' role-drop-target':''}${roleAvailable&&roleOver===role?' role-drop-over':''}`}
            aria-label={`${roleName(role)} ${team} picks`} data-drop-team={team} data-drop-role={role}
            aria-describedby={available||roleAvailable ? 'pick-move-help' : undefined} tabIndex={available||roleAvailable ? 0 : undefined}
            onDragOver={e => { if(roleAvailable){e.preventDefault();e.dataTransfer.dropEffect='move';setRoleOver(role);}else if (available) { e.preventDefault(); e.dataTransfer.dropEffect='move'; setOver(key); } }}
            onDragLeave={e => { if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) {setOver(null);if(roleAvailable)setRoleOver(null);} }}
            onDrop={e => { e.preventDefault(); if(roleAvailable&&e.dataTransfer.types.includes('application/x-draftroom-role'))finishRole(role);else if (e.dataTransfer.types.includes('application/x-draftroom-pick')) finish(team,role); }}
>
            <div className="draft-cell-heading"><span>{pick ? names[pick.championId] : ''}</span>
              {player?.id===uid&&onSavePool&&<button className="save-personal" disabled={busy} title={`Save these candidates to your personal ${roleName(role)} pool`} onClick={()=>onSavePool(role)}>Save pool</button>}
              {pending && <span className="pick-pending-label">Swap pending</span>}
              {pick&&state.openDraft && <div className="pick-actions">
                <button aria-label={`Remove ${names[pick.championId]} ${team}`} disabled={busy || pending||!editable} onClick={() => void change(s => {
                  s.picks[team] = s.picks[team].filter(p => p.championId !== pick.championId);
                  return record(s,`Pick removed · ${names[pick.championId]}`);
                })}>×</button>
              </div>}
            </div>
            <div className="draft-options">
              {options.map(option => <DraftChampion key={option.id} id={option.id} role={role} team={team} state={state} result={option}
                selected={option.selected} blocked={option.blocked} busy={busy || pending} pickDisabled={!editable||!!state.draftMode&&!state.openDraft&&option.selected} automatic={!!state.draftMode&&!option.selected&&!explicit.includes(option.id)} toggle={true}
                dragDisabled={!canSelectPick(state,uid,host,team,role)}
                active={activeTooltip===`${team}:${role}:${option.id}`}
                onActivate={()=>setActiveTooltip(`${team}:${role}:${option.id}`)}
                onDeactivate={()=>setActiveTooltip(old=>old===`${team}:${role}:${option.id}` ? null : old)}
                onPick={() => void change(s=>toggleRoleCandidate(s,team,role,option.id))}
                onDragStart={e => start(e,team,role,option.id)} onDragEnd={() => {setDragged(null);setOver(null);}} dragging={!!dragged} />)}
              {<button className="add-champion board-add"
                aria-label={`Add ${roleName(role)}${team==='enemy'?' enemy':''} candidates`}
                disabled={busy || pending} onClick={() => setPicker({kind:'candidates',team,role})}>+</button>}
            </div>
          </section>;
        })}
      </div>)}
      <details className="history"><summary>History · {state.history.length} events</summary>{state.history.map((h,i) => <p key={i}>{h}</p>)}</details>
      <StatisticsNote state={state}/>
    </section>
  </section>;
}
