import {scoreForTeam} from './candidates';
import {pairKey,unavailable} from './scoring';
import type {Pair,Role,State,Team} from './types';
export const TEAM_DENOMINATOR=5;

export function teamScore(team:Team,state:State,index=new Map(state.dataset.pairs.map(p=>[pairKey(p),p]))) {
 const picks=state.picks[team];
 const scores=picks.map(p=>scoreForTeam(p.championId,p.role,team,state,index));
 const known=scores.filter(s=>s.known>0);
 const pairs=scores.reduce((n,s)=>n+s.known,0),possible=scores.reduce((n,s)=>n+s.total,0);
 const complete=scores.reduce((n,s)=>n+s.complete,0);
 return {value:state.shrinkage?scores.reduce((n,s)=>n+(s.value??0),0)/TEAM_DENOMINATOR:null,
  picks:picks.length,scored:known.length,known:pairs,complete,total:possible,
  provisional:state.picks.ally.length<5 || state.picks.enemy.length<5 || complete<possible || !state.shrinkage};
}

export function teamAdvantage(state:State,index?:Map<string,Pair>){
 const ally=teamScore('ally',state,index),enemy=teamScore('enemy',state,index);
 return {ally,enemy,value:ally.value===null||enemy.value===null?null:ally.value-enemy.value,
  provisional:ally.provisional||enemy.provisional};
}

export function candidateImpact(id:string,role:Role,team:Team,state:State,index?:Map<string,Pair>) {
 const selected=state.picks[team].find(p=>p.role===role);
 if(unavailable(state).has(id)&&selected?.championId!==id) return null;
 const next:State={...state,picks:{...state.picks,[team]:[...state.picks[team].filter(p=>p.role!==role),{championId:id,role}]}};
 index??=new Map(state.dataset.pairs.map(p=>[pairKey(p),p]));
 const before=teamScore(team,state,index),after=teamScore(team,next,index);
 const advantageBefore=teamAdvantage(state,index).value,advantageAfter=teamAdvantage(next,index).value;
 // Positive always means improvement for the candidate's own team.
 const advantageChange=advantageBefore===null||advantageAfter===null?null:(team==='ally'?1:-1)*(advantageAfter-advantageBefore);
 return {before,after,change:before.value===null || after.value===null ? null : after.value-before.value,advantageChange};
}
