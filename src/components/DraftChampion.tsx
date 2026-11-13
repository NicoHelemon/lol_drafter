import { useId, useRef, type DragEvent } from 'react';
import type { CandidateScore } from '../domain/candidates';
import { scoreLabel } from '../domain/candidates';
import type { Role, Team, State } from '../domain/types';
import { roleName } from '../domain/roles';
import { names, Portrait } from './Champions';
import ContributionTooltip from './ContributionTooltip';
export default function DraftChampion({ id, role, team, state, result, selected, blocked, busy,
  onPick, pickLabel, toggle = true, onDragStart, onDragEnd, dragging = false, active, onActivate, onDeactivate }: {
  id: string; role: Role; team: Team; state: State; result: CandidateScore;
  selected: boolean; blocked: boolean; busy: boolean; onPick: () => void;
  active:boolean; onActivate:()=>void; onDeactivate:()=>void;
  pickLabel?: string; toggle?: boolean; onDragStart: (e: DragEvent) => void; onDragEnd: () => void; dragging?: boolean;
}) {
  const label = scoreLabel(result.value), tooltipId = useId(), anchor = useRef<HTMLDivElement>(null);
  const open = !dragging && active;
  return <div ref={anchor}
    className={`draft-champion-tile${selected ? ' tile-selected' : ''}${blocked ? ' tile-unavailable' : ''}`}
    data-champion={id} draggable={selected && !busy}
    onDragStart={e => { onDeactivate(); onDragStart(e); }} onDragEnd={onDragEnd}
    onMouseEnter={onActivate} onMouseLeave={onDeactivate}
    onFocusCapture={onActivate} onBlurCapture={e => { if (!e.currentTarget.contains(e.relatedTarget)) onDeactivate(); }}
    onKeyDown={e => { if (e.key === 'Escape') onDeactivate(); }}>
    <button className="champion-choice" aria-label={pickLabel ?? `Pick ${names[id]} ${roleName(role)} ${team}`}
      aria-pressed={toggle ? selected : undefined} aria-describedby={open ? tooltipId : undefined}
      disabled={busy || blocked} onClick={onPick}>
      <Portrait id={id} />
      {selected && <span className="picked-mark" aria-hidden="true">✓</span>}
    </button>
    <span className={`tile-score ${result.value === null ? 'muted' : result.value < 0 ? 'negative' : result.value > 0 ? 'positive' : 'neutral'}`}>
      {label}{result.known < result.total && <span className="partial-score" aria-label="Partial coverage">•</span>}
    </span>
    {open && anchor.current && <ContributionTooltip id={tooltipId} champion={id} role={role} team={team} state={state} result={result} anchor={anchor.current} />}
  </div>;
}
