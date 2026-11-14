import type {Role,Room,State,RoleSwapRequest} from './types';
import {ROLES} from './types';
import {validateState} from './state';

export function exchangeLiveRoles(state:State,from:Role,to:Role):State {
 if(state.phase!=='live'||!ROLES.includes(from)||!ROLES.includes(to))throw Error('Live role moves require a draft');
 const next=structuredClone(state);
 for(const p of next.players){if(p.role===from)p.role=to;else if(p.role===to)p.role=from;}
 for(const p of next.picks.ally){if(p.role===from)p.role=to;else if(p.role===to)p.role=from;}
 validateState(next);return next;
}
export function makeRoleSwap(room:Room,actor:string,to:Role,now=Date.now()):RoleSwapRequest {
 const me=room.state.players.find(p=>p.id===actor),other=room.state.players.find(p=>p.role===to);
 if(!me?.role||!other||other.id===actor)throw Error('Both players must have different roles');
 return {id:crypto.randomUUID(),room_id:room.id,requester_id:actor,target_id:other.id,from_role:me.role,to_role:to,
  created_at:new Date(now).toISOString(),expires_at:new Date(now+5000).toISOString(),phase:room.state.phase,
  from_champion_id:room.state.picks.ally.find(p=>p.role===me.role)?.championId??null,
  to_champion_id:room.state.picks.ally.find(p=>p.role===to)?.championId??null};
}
export function matchesRoleSwap(q:RoleSwapRequest,s:State) {
 return (q.phase??'setup')===s.phase
  && s.players.some(p=>p.id===q.requester_id&&p.role===q.from_role)&&s.players.some(p=>p.id===q.target_id&&p.role===q.to_role)
  && (s.phase!=='live'||((s.picks.ally.find(p=>p.role===q.from_role)?.championId??null)===(q.from_champion_id??null)
   && (s.picks.ally.find(p=>p.role===q.to_role)?.championId??null)===(q.to_champion_id??null)));
}
