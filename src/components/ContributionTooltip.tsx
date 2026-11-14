import { createPortal } from 'react-dom';
import { useLayoutEffect, useRef, useState } from 'react';
import type { CandidateScore } from '../domain/candidates';
import { scoreLabel } from '../domain/candidates';
import { ROLES, type Role, type State, type Team } from '../domain/types';
import { roleName } from '../domain/roles';
import { RoleIcon } from './RoleIcon';
import { names, Portrait } from './Champions';
import {candidateImpact} from '../domain/teamScore';

export default function ContributionTooltip({ id, champion, role, team, state, result, anchor }: {
  id: string; champion: string; role: Role; team: Team; state: State; result: CandidateScore; anchor: HTMLElement;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8, visibility: 'hidden' as 'hidden' | 'visible' });
  useLayoutEffect(() => {
    const update = () => {
      const box = anchor.getBoundingClientRect(), rect = panel.current!.getBoundingClientRect();
      const below = box.bottom + 8;
      setPosition({
        left: Math.max(8, Math.min(innerWidth - rect.width - 8, box.left + box.width / 2 - rect.width / 2)),
        top: Math.max(8, below + rect.height <= innerHeight - 8 ? below : box.top - rect.height - 8),
        visibility: 'visible',
      });
    };
    update(); window.addEventListener('resize', update); window.addEventListener('scroll', update, true);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
  }, [anchor, result]);
  const other: Team = team === 'ally' ? 'enemy' : 'ally';
  const impact=candidateImpact(champion,role,team,state);
  const selected=state.picks[team].some(p=>p.role===role&&p.championId===champion);
  const replaced=state.picks[team].find(p=>p.role===role);
  function cell(rowRole: Role, relation: 'with' | 'vs') {
    const ownRole = relation === 'with' && rowRole === role;
    const pick = ownRole ? undefined : state.picks[relation === 'with' ? team : other].find(p => p.role === rowRole && p.championId !== champion);
    const value = pick ? result.contributions.find(c => c.relation === relation && c.role === rowRole && c.championId === pick.championId)?.delta2 ?? null : null;
    return <div className={`contribution-cell ${relation}${ownRole ? ' contribution-self' : ''}`}
      aria-label={`${relation === 'with' ? 'With' : 'Against'} ${roleName(rowRole)}${ownRole ? ': candidate role' : pick ? ` ${names[pick.championId]}: ${scoreLabel(value)}` : ': no pick'}`}>
      <RoleIcon role={rowRole} />
      {pick ? <Portrait id={pick.championId} /> : <span className="contribution-empty" aria-hidden="true">{ownRole ? '·' : '—'}</span>}
      <b className={value === null ? 'muted' : value < 0 ? 'negative' : value > 0 ? 'positive' : 'neutral'}>{pick ? scoreLabel(value) : '—'}</b>
    </div>;
  }
  return createPortal(<div id={id} ref={panel} className="contribution-tooltip" role="tooltip" style={position}>
    <div className="contribution-heading"><strong>{names[champion]} <span>· {roleName(role)}</span></strong><div className="individual-score"><small>Individual score</small><b>{scoreLabel(result.value)}</b></div></div>
    <div className="contribution-columns"><span>Allies</span><span>Opponents</span></div>
    <div className="contribution-matrix">{ROLES.map(rowRole => <div className="contribution-row" key={rowRole}>{cell(rowRole, 'with')}{cell(rowRole, 'vs')}</div>)}</div>
    <div className="contribution-footer">{result.known}/{result.total} pairs <span>Adjusted values · equal average</span></div>
    {impact&&<div className="team-impact" aria-label="Team score preview">
      {selected?<div><span>Current team</span><b>{scoreLabel(impact.after.value)}</b></div>:<>
        <strong className="replacement-caption">{replaced?`${names[replaced.championId]} → ${names[champion]}`:`Add ${names[champion]} · ${roleName(role)}`}</strong>
        <div className="team-comparison"><span>Current team<b>{scoreLabel(impact.before.value)}</b></span><span aria-hidden="true">→</span><span>With {names[champion]}<b>{scoreLabel(impact.after.value)}</b></span></div>
        <div><span>Team score change</span><b className={impact.change===null?'muted':impact.change<0?'negative':impact.change>0?'positive':'neutral'}>{scoreLabel(impact.change)}{impact.change===null?'':impact.change<0?' ↓':impact.change>0?' ↑':' —'}</b></div>
      </>}
      <small>{impact.after.provisional?'Provisional · ':''}{impact.after.scored}/{impact.after.picks} picks scored · {impact.after.known}/{impact.after.total} pairs</small>
    </div>}
  </div>, document.body);
}
