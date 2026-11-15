import {ROLES,type Role,type State,type Team} from './types';
import {place,record} from './state';

export function rolePool(s:State,team:Team,role:Role):string[]{
 return (team==='ally'?s.players.find(p=>p.role===role)?.pool:undefined)??s.rolePools?.[team]?.[role]??[];
}
export function setRolePool(s:State,team:Team,role:Role,pool:string[]):State{
 validatePool(pool);const next=structuredClone(s),owner=team==='ally'?next.players.find(p=>p.role===role):undefined;
 if(owner)owner.pool=[...pool];
 else {next.rolePools??={};next.rolePools[team]??={};next.rolePools[team]![role]=[...pool];}
 return next;
}
export function validatePool(pool:unknown,ids?:Set<string>):asserts pool is string[]{
 if(!Array.isArray(pool)||pool.length>500||pool.some(c=>typeof c!=='string'||!/^\d{1,5}$/.test(c)||(ids&&!ids.has(c)))||new Set(pool).size!==pool.length)throw Error('Invalid candidate pool');
}
export function reconcileRolePools(before:State,next:State):State{
 const s=structuredClone(next);
 if(s.rolePools===undefined&&before.rolePools)s.rolePools=structuredClone(before.rolePools);
 // Preserve the last pool in a vacated seat. Arriving owners always supersede it.
 for(const p of before.players)if(p.role&&!s.players.some(n=>n.role===p.role)){
  s.rolePools??={};s.rolePools.ally??={};s.rolePools.ally[p.role]=[...p.pool];
 }
 for(const p of s.players)if(p.role&&s.rolePools?.ally)delete s.rolePools.ally[p.role];
 return s;
}
export function toggleRoleCandidate(s:State,team:Team,role:Role,id:string):State{
 const selected=s.picks[team].find(p=>p.role===role);
 if(selected?.championId===id){const next=structuredClone(s);next.picks[team]=next.picks[team].filter(p=>p.role!==role);return record(next,`Pick cleared · ${role}`);}
 if(!rolePool(s,team,role).includes(id))throw Error('Champion is not a candidate for this role');
 return place(s,team,role,id);
}
export function rolePoolEntries(s:State){
 return (['ally','enemy'] as Team[]).flatMap(team=>ROLES.map(role=>({team,role,pool:rolePool(s,team,role)})));
}
