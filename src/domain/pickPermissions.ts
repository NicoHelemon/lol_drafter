import type {Role,State,Team} from './types';
export function canSelectPick(state:State,actor:string,host:boolean,team:Team,role:Role){
 const me=state.players.find(p=>p.id===actor);if(!me||!host&&!me.role)return false;
 const owner=team==='ally'?state.players.find(p=>p.role===role):undefined;
 return host||!owner||owner.id===actor;
}
export function canRequestPickMove(state:State,actor:string,host:boolean,team:Team,from:Role,to:Role){
 if(!canSelectPick(state,actor,host,team,from))return false;
 if(canSelectPick(state,actor,host,team,to))return true;
 // Both owners must explicitly accept the established trade request.
 return team==='ally'&&state.players.some(p=>p.id===actor&&p.role===from)&&state.players.some(p=>p.role===to);
}
