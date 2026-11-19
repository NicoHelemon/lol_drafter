import {champions} from '../data/provider';
import {ROLE_SHARE_MIN} from './catalogue';
import {scoreForTeam} from './candidates';
import {referenceContextKey} from './exceptionalPicks';
import {pairKey,unavailable} from './scoring';
import type {Pair,Role,State,Team} from './types';

export const BEST_FIT_MIN_GAMES=5000;
export const BEST_FIT_LIMIT=3;
const names=new Map(champions.map(c=>[c.id,c.name]));

// Compare the whole admissible role catalogue, not just missing pool members.
// Each revealed interaction needs at least one usable direction, as before.
// Requiring both would unnecessarily exclude candidates under consolidation.
export function bestFitCandidates(state:State,team:Team,role:Role,index=new Map(state.dataset.pairs.map(p=>[pairKey(p),p]))):string[]{
 if(state.phase!=='live'||!state.draftMode||!state.shrinkage||!state.roleCatalogue
  ||state.dataset.snapshotId&&state.referenceKey!==referenceContextKey(state))return [];
 const used=unavailable(state),selected=state.picks[team].find(p=>p.role===role)?.championId;
 if(selected)used.delete(selected);
 const eligible=state.roleCatalogue.entries.filter(e=>e.role===role&&e.lanePercent>=ROLE_SHARE_MIN&&e.games>=BEST_FIT_MIN_GAMES&&!used.has(e.championId));
 const scored=eligible.map(e=>({id:e.championId,...scoreForTeam(e.championId,role,team,state,index)}))
  .filter(s=>s.total>0&&s.known===s.total&&s.value!==null)
  .sort((a,b)=>b.value!-a.value!||(names.get(a.id)??a.id).localeCompare(names.get(b.id)??b.id,'en'));
 // Empty contexts, all-zero calibrations and tied scores do not justify an
 // arbitrary alphabetical selection of three supposedly best fits.
 if(scored.length<2||scored[0].value!-scored.at(-1)!.value!<1e-9)return [];
 return scored.slice(0,BEST_FIT_LIMIT).map(s=>s.id);
}
