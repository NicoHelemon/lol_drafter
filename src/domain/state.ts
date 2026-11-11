import {roleName} from './roles';
import {ROLES,type State,type Team} from './types';
export function validateState(s:State,ids?:Set<string>){
 if(!['setup','live','finished'].includes(s.phase)||!['blue','red'].includes(s.side))throw Error('Invalid state');
 const seen=new Set<string>();
 for(const t of ['ally','enemy'] as Team[]){
  if(s.picks[t].length>5||s.bans[t].length!==5)throw Error('Each team can have at most five picks and five bans');
  const roles=new Set<string>();
  for(const p of s.picks[t])if(p.role){if(!ROLES.includes(p.role)||roles.has(p.role))throw Error('Role already occupied');roles.add(p.role);}
  for(const c of [...s.picks[t].map(p=>p.championId),...s.bans[t].filter(Boolean)] as string[]){if(seen.has(c))throw Error('Champion already picked or banned');if(ids&&!ids.has(c))throw Error('Unknown champion');seen.add(c);}
 }
 if(s.players.length>5||new Set(s.players.map(p=>p.id)).size!==s.players.length)throw Error('Room is full');
 const roles=s.players.map(p=>p.role).filter(Boolean);if(new Set(roles).size!==roles.length)throw Error('Role already taken');
}
export function record(s:State,message:string){s.history=[message,...s.history].slice(0,25);return s;}
export function place(s:State,team:Team,role:typeof ROLES[number],championId:string,mode:'replace'|'unassign'='replace'){
 const next=structuredClone(s), occupied=next.picks[team].find(p=>p.role===role), existing=next.picks[team].find(p=>p.championId===championId);
 if(existing){const old=existing.role;existing.role=role;if(occupied&&occupied!==existing)occupied.role=old;}
 else {if(occupied){if(mode==='unassign')occupied.role=null;else next.picks[team]=next.picks[team].filter(p=>p!==occupied);}next.picks[team].push({championId,role});}
 validateState(next);return record(next,`${team==='ally'?'Allies':'Opponents'} · ${championId} → ${roleName(role)}`);
}
