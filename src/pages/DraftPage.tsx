import { toggleDraftCandidate } from '../domain/draft';
import { useState, useEffect, type DragEvent } from 'react';
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
  state: State; uid: string; busy: boolean;
  change: (fn: (s: State) => State) => Promise<void>;
  setPicker: (p: Picker) => void;
  onMove: (team: Team, from: Role, to: Role) => Promise<void>;
  pendingRoles?: Set<Role>;
}
type DragPick = { team: Team; role: Role; championId: string; tap?: boolean };
export default function DraftPage({ state, uid, busy, change, setPicker, onMove, pendingRoles = new Set() }: Props) {
  const associatedPlayers = new Map(state.players.map(player => [player.role, player]));
  const [activeTooltip,setActiveTooltip] = useState<string|null>(null);
  const [dragged, setDragged] = useState<DragPick | null>(null), [over, setOver] = useState<string | null>(null);
  useEffect(() => {
    if (dragged && !state.picks[dragged.team].some(p => p.role === dragged.role && p.championId === dragged.championId)) {
      setDragged(null); setOver(null);
    }
  }, [state.picks, dragged]);
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setActiveTooltip(null); setDragged(null); setOver(null); }
    };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, []);
  const blockedRole = (team: Team, role: Role) => team === 'ally' && pendingRoles.has(role);
  const canDrop = (team: Team, role: Role) => !!dragged && !busy && dragged.team === team && dragged.role !== role
    && !blockedRole(team, role) && !blockedRole(team, dragged.role)
    && state.picks[team].some(p => p.role === dragged.role && p.championId === dragged.championId);
  function finish(team: Team, role: Role) {
    if (!canDrop(team, role) || !dragged) return;
    const from = dragged.role; setDragged(null); setOver(null); void onMove(team, from, role);
  }
  function start(e: DragEvent, team: Team, role: Role, championId: string) {
    if (busy || blockedRole(team, role)) { e.preventDefault(); return; }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-draftroom-pick', JSON.stringify({team, role, championId}));
    setDragged({team, role, championId});
  }
  return <section aria-label="Draft" className="draft-page" onKeyDown={e => {
    if (e.key === 'Escape') { setDragged(null); setOver(null); }
  }}>
    <section className="card board integrated-board">
      <div className="section-heading"><h2>Draft board</h2><span className="badge">LIVE</span></div>
      <div className="draft-bans" role="region" aria-label="Bans">
        {(['ally','enemy'] as Team[]).map(team => <section className={`team-bans ${team}`} aria-label={team === 'ally' ? 'Our bans' : 'Opponent bans'} key={team}>
          <b>{team === 'ally' ? 'OUR BANS' : 'OPPONENT BANS'}</b><div className="bans">
            {state.bans[team].map((id, slot) => <div key={slot}>
              <button aria-label={`Ban ${slot + 1} ${team}`} disabled={busy} onClick={() => setPicker({kind:'ban',team,slot})}>
                {id ? <Portrait id={id} /> : <span>+</span>}
              </button>
              {id && <button className="remove-ban" aria-label={`Remove ban ${names[id]}`} disabled={busy} onClick={() => void change(s => {
                s.bans[team][slot] = null; return record(s,`Ban removed · ${names[id]}`);
              })}>×</button>}
            </div>)}
          </div>
        </section>)}
      </div>
      <p className="draft-move-hint" id="pick-move-help" role="status">{dragged
        ? `Move ${names[dragged.championId]}: choose another ${dragged.team === 'ally' ? 'allied' : 'opponent'} role. Escape to cancel.`
        : 'Drag selected champions between roles. Hover a candidate for adjusted matchups and its effect on the team score.'}</p>
      <div className="board-head"><span>ROLE</span><TeamSummary team="ally" state={state}/><TeamSummary team="enemy" state={state}/></div>
      {ROLES.map(role => <div className="board-row" key={role}>
        <span className="role-label"><RoleIcon role={role} />{roleName(role)}
          {associatedPlayers.get(role) && <small className="role-player" title={associatedPlayers.get(role)!.name}>{associatedPlayers.get(role)!.name}</small>}
        </span>
        {(['ally','enemy'] as Team[]).map(team => {
          const player = team === 'ally' ? associatedPlayers.get(role) : undefined;
          const pick = state.picks[team].find(p => p.role === role);
          const options = candidates(player?.pool ?? [],role,team,state,names);
          const pending = blockedRole(team,role), available = canDrop(team,role), key = `${team}:${role}`;
          return <section key={team} className={`draft-cell ${team}${player?.id === uid ? ' mine' : ''}${available ? ' drop-available' : ''}${over === key ? ' drop-over' : ''}${pending ? ' transfer-pending' : ''}`}
            aria-label={`${roleName(role)} ${team} picks`} data-drop-team={team} data-drop-role={role}
            aria-describedby={available ? 'pick-move-help' : undefined} tabIndex={available ? 0 : undefined}
            onDragOver={e => { if (available) { e.preventDefault(); e.dataTransfer.dropEffect='move'; setOver(key); } }}
            onDragLeave={e => { if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) setOver(null); }}
            onDrop={e => { e.preventDefault(); if (e.dataTransfer.types.includes('application/x-draftroom-pick')) finish(team,role); }}
            onClickCapture={e => { if (dragged?.tap && available) { e.preventDefault(); e.stopPropagation(); finish(team,role); } }}
            onKeyDown={e => { if (available && e.target === e.currentTarget && ['Enter',' '].includes(e.key)) { e.preventDefault(); finish(team,role); } }}>
            <div className="draft-cell-heading"><span>{pick ? names[pick.championId] : ''}</span>
              {pending && <span className="pick-pending-label">Swap pending</span>}
              {pick && <div className="pick-actions">
                <button aria-label={`Move ${names[pick.championId]} ${team}`} title="Move champion: choose a role" disabled={busy || pending}
                  aria-pressed={dragged?.tap && dragged.team === team && dragged.role === role}
                  onClick={() => setDragged(old => old?.role === role && old.team === team ? null : {team,role,championId:pick.championId,tap:true})}>↕</button>
                <button aria-label={`Remove ${names[pick.championId]} ${team}`} disabled={busy || pending} onClick={() => void change(s => {
                  s.picks[team] = s.picks[team].filter(p => p.championId !== pick.championId);
                  return record(s,`Pick removed · ${names[pick.championId]}`);
                })}>×</button>
              </div>}
            </div>
            <div className="draft-options">
              {options.map(option => <DraftChampion key={option.id} id={option.id} role={role} team={team} state={state} result={option}
                selected={option.selected} blocked={option.blocked} busy={busy || pending} toggle={!!player}
                active={activeTooltip===`${team}:${role}:${option.id}`}
                onActivate={()=>setActiveTooltip(`${team}:${role}:${option.id}`)}
                onDeactivate={()=>setActiveTooltip(old=>old===`${team}:${role}:${option.id}` ? null : old)}
                pickLabel={player ? undefined : `Change ${names[option.id]} ${roleName(role)} ${team}`}
                onPick={() => { if (player) void change(s => toggleDraftCandidate(s,role,option.id)); else setPicker({kind:'pick',team,role}); }}
                onDragStart={e => start(e,team,role,option.id)} onDragEnd={() => {setDragged(null);setOver(null);}} dragging={!!dragged} />)}
              {(player || !pick) && <button className="add-champion board-add"
                aria-label={player ? `Add ${roleName(role)} candidates` : `Choose ${roleName(role)} ${team}`}
                disabled={busy || pending} onClick={() => setPicker(player ? {kind:'candidates',player:player.id,role} : {kind:'pick',team,role})}>+</button>}
            </div>
          </section>;
        })}
      </div>)}
      <details className="history"><summary>History · {state.history.length} events</summary>{state.history.map((h,i) => <p key={i}>{h}</p>)}</details>
      <StatisticsNote state={state}/>
    </section>
  </section>;
}
