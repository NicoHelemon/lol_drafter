import {scoreForTeam} from './candidates';
import {pairKey,unavailable} from './scoring';
import type {Pair,Role,State,Team} from './types';

export function teamScore(team:Team,state:State,index=new Map(state.dataset.pairs.map(p=>[pairKey(p),p]))) {
 const picks=state.picks[team];
 const scores=picks.map(p=>scoreForTeam(p.championId,p.role,team,state,index));
 const known=scores.filter(s=>s.value!==null);
 const pairs=scores.reduce((n,s)=>n+s.known,0),possible=scores.reduce((n,s)=>n+s.total,0);
 return {value:known.length ? known.reduce((n,s)=>n+s.value!,0)/known.length : null,
  picks:picks.length,scored:known.length,known:pairs,total:possible,
  provisional:state.picks.ally.length<5 || state.picks.enemy.length<5 || pairs<possible || known.length<picks.length};
}

export function candidateImpact(id:string,role:Role,team:Team,state:State,index?:Map<string,Pair>) {
 const selected=state.picks[team].find(p=>p.role===role);
 if(unavailable(state).has(id)&&selected?.championId!==id) return null;
 const next:State={...state,picks:{...state.picks,[team]:[...state.picks[team].filter(p=>p.role!==role),{championId:id,role}]}};
 const before=teamScore(team,state,index),after=teamScore(team,next,index);
 return {before,after,change:before.value===null || after.value===null ? null : after.value-before.value};
}
