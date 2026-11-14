import { useState,useMemo } from "react";
import { champions, byId } from "../data/provider";
import {catalogueChoices,ROLE_SHARE_MIN} from '../domain/catalogue';
import {ROLES,type Role,type RoleCatalogue} from '../domain/types';
import {roleName} from '../domain/roles';
import {RoleIcon} from './RoleIcon';
export const names = Object.fromEntries(champions.map((c) => [c.id, c.name]));
export function Portrait({ id }: { id: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span aria-hidden="true" className="portrait fallback">
      {(names[id] ?? "?").slice(0, 2)}
    </span>
  ) : (
    <img
      className="portrait"
      alt=""
      src={byId[id]?.portrait}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
export function Search({
  selected = [],
  blocked = new Set(),
  onChoose,
  disabled = false,
  catalogue,pinned=[],
}: {
  selected?: string[];
  disabled?: boolean;
  blocked?: Set<string>;
  onChoose: (id: string) => void;
  catalogue?:RoleCatalogue;pinned?:string[];
}) {
  const [q, setQ] = useState("");
  const [role,setRole]=useState<Role|'all'>('all'),[sort,setSort]=useState<'alphabetical'|'popularity'>('alphabetical');
  const choices=useMemo(()=>catalogueChoices(champions,catalogue,{role,sort,query:q,pinned:[...selected,...pinned]}),[catalogue,role,sort,q,selected,pinned]);
  return (
    <>
      <input
        autoFocus
        aria-label="Search champions"
        placeholder="Search champions…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="champion-filters">
        <div className="role-filter-buttons" role="group" aria-label="Filter by role">
          {ROLES.map(r=><button key={r} type="button" aria-label={`Filter ${roleName(r)}`} aria-pressed={role===r}
            title={role===r?`${roleName(r)} · click again to show all roles`:roleName(r)} disabled={!catalogue}
            onClick={()=>setRole(current=>current===r?'all':r)}><RoleIcon role={r}/></button>)}
        </div>
        <div className="sort-filter-buttons" role="group" aria-label="Sort champions">
          <button type="button" aria-label="Sort alphabetically" title="Alphabetical" aria-pressed={sort==='alphabetical'} onClick={()=>setSort('alphabetical')}>
            <svg aria-hidden="true" viewBox="0 0 24 24"><text x="3" y="10">A</text><text x="3" y="22">Z</text><path d="M18 3v18m-4-4 4 4 4-4"/></svg>
          </button>
          <button type="button" aria-label="Sort by popularity" title="Popularity" aria-pressed={sort==='popularity'} disabled={!catalogue} onClick={()=>setSort('popularity')}>
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 20V14h3v6zm6 0V9h3v11zm6 0V3h3v17z" className="popularity-bars"/></svg>
          </button>
        </div>
      </div>
      <p className="picker-filter-note" role="status">{choices.length} champions{role!=='all'&&catalogue?` · ${roleName(role)} · At least ${ROLE_SHARE_MIN}% of their games in this role. Click the active role to show all.`:catalogue?' · All roles':''}
        {!catalogue&&' · Role popularity data unavailable; showing all champions.'}</p>
      <div className="champion-grid">
        {choices.map((c) => (
            <button
              key={c.id}
              disabled={disabled || blocked.has(c.id)}
              className={
                selected.includes(c.id) ? "champion selected" : "champion"
              }
              onClick={() => onChoose(c.id)}
            >
              <Portrait id={c.id} />
              <span>{c.name}</span>
              {sort==='popularity'&&catalogue&&<small>{c.popularity===undefined?c.games===undefined?'No role data':`${c.games.toLocaleString('en-US')} recorded games`:`${c.popularity.toFixed(2)}% pick`}</small>}
              {selected.includes(c.id) && <b aria-hidden="true">✓</b>}
            </button>
          ))}
      </div>
      {catalogue&&<small className="picker-provenance">{catalogue.fictional?'Fictional demo role data':`Lolalytics · ${catalogue.context.windowDays} days · ${String(catalogue.context.tier).replace('_plus','+').replace(/^./,c=>c.toUpperCase())}`} · {new Date(catalogue.capturedAt).toLocaleDateString('en-GB',{timeZone:'Europe/Zurich'})}</small>}
    </>
  );
}
