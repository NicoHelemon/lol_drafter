import { useState,useMemo } from "react";
import { champions, byId } from "../data/provider";
import {catalogueChoices,ROLE_SHARE_MIN} from '../domain/catalogue';
import {ROLES,type Role,type RoleCatalogue} from '../domain/types';
import {roleName} from '../domain/roles';
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
        <label>Role<select aria-label="Filter by role" value={role} disabled={!catalogue} onChange={e=>setRole(e.target.value as Role|'all')}>
          <option value="all">All roles</option>{ROLES.map(r=><option key={r} value={r}>{roleName(r)}</option>)}
        </select></label>
        <label>Sort<select aria-label="Sort champions" value={sort} onChange={e=>setSort(e.target.value as 'alphabetical'|'popularity')}>
          <option value="alphabetical">Alphabetical</option><option value="popularity" disabled={!catalogue}>Popularity</option>
        </select></label>
      </div>
      <p className="picker-filter-note" role="status">{choices.length} champions{role!=='all'&&catalogue?` · At least ${ROLE_SHARE_MIN}% of their games in this role. Selected champions stay visible.`:''}
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
