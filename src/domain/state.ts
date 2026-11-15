import {roleName} from './roles';
import {ROLES,type State,type Team} from './types';
import {validatePool} from './rolePools';
import {validateGuidedState} from './progression';
export function validateState(s:State,ids?:Set<string>){
 if(!['setup','live'].includes(s.phase)||!['blue','red'].includes(s.side))throw Error('Invalid state');
 validateGuidedState(s);
 const seen=new Set<string>();
 for(const t of ['ally','enemy'] as Team[]){
  if(s.picks[t].length>5||s.bans[t].length!==5)throw Error('Each team can have at most five picks and five bans');
  const roles=new Set<string>();
  for(const p of s.picks[t]){if(!ROLES.includes(p.role)||roles.has(p.role))throw Error('Role already occupied');roles.add(p.role);}
  for(const c of [...s.picks[t].map(p=>p.championId),...s.bans[t].filter(Boolean)] as string[]){if(seen.has(c)&&!(s.draftMode==='ranked'&&t==='enemy'&&s.bans.ally.includes(c)&&s.bans.enemy.filter(x=>x===c).length===1&&![...s.picks.ally,...s.picks.enemy].some(p=>p.championId===c)))throw Error('Champion already picked or banned');if(ids&&!ids.has(c))throw Error('Unknown champion');seen.add(c);}
 }
 if(s.players.length>8||s.players.filter(p=>!p.observer).length>5||s.players.filter(p=>p.observer).length>3||new Set(s.players.map(p=>p.id)).size!==s.players.length)throw Error('Room is full');
 const roles=s.players.map(p=>p.role).filter(Boolean);if(new Set(roles).size!==roles.length)throw Error('Role already taken');
 for(const p of s.players){if(p.observer!==undefined&&typeof p.observer!=='boolean'||p.observer&&(p.role!==null||p.pool.length))throw Error('Observers cannot occupy roles or have candidate pools');validatePool(p.pool,ids);}
 if(s.rolePools!==undefined){
  if(!s.rolePools||typeof s.rolePools!=='object'||Array.isArray(s.rolePools)||Object.keys(s.rolePools).some(t=>!['ally','enemy'].includes(t)))throw Error('Invalid role pools');
  for(const pools of Object.values(s.rolePools)){
   if(!pools||typeof pools!=='object'||Array.isArray(pools)||Object.keys(pools).some(r=>!ROLES.includes(r as typeof ROLES[number])))throw Error('Invalid role pools');
   for(const pool of Object.values(pools))validatePool(pool,ids);
  }
 }
}
export function record(s:State,message:string){s.history=[message,...s.history].slice(0,25);return s;}
export function place(s:State,team:Team,role:typeof ROLES[number],championId:string){
 const next=structuredClone(s), occupied=next.picks[team].find(p=>p.role===role), existing=next.picks[team].find(p=>p.championId===championId);
 if(existing){const old=existing.role;existing.role=role;if(occupied&&occupied!==existing)occupied.role=old;}
 else {if(occupied)next.picks[team]=next.picks[team].filter(p=>p!==occupied);next.picks[team].push({championId,role});}
 validateState(next);return record(next,`${team==='ally'?'Ally team':'Enemy team'} · ${championId} → ${roleName(role)}`);
}
