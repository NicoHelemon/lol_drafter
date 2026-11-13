import type { PickSwapRequest, Role, Room, State, Team } from './types';
import { place } from './state';
export function moveDraftPick(state:State, team:Team, from:Role, to:Role):State {
  if (state.phase !== 'live') throw Error('Champion moves are only available during the draft');
  const selected = state.picks[team].find(p => p.role === from);
  if (!selected) throw Error('No selected champion to move');
  return from === to ? structuredClone(state) : place(state,team,to,selected.championId);
}
export function pickOwners(state:State, from:Role, to:Role) {
  return [state.players.find(p => p.role === from),state.players.find(p => p.role === to)] as const;
}
export function makePickSwap(room:Room, from:Role, to:Role, actor:string, now=Date.now()):PickSwapRequest {
  if (!room.state.players.some(p => p.id === actor)) throw Error('Access denied');
  moveDraftPick(room.state,'ally',from,to);
  const [a,b] = pickOwners(room.state,from,to);
  if (!a || !b || a.id === b.id) throw Error('Two occupied player roles are required');
  return {id:crypto.randomUUID(),room_id:room.id,requester_id:actor,from_role:from,to_role:to,
    from_player_id:a.id,to_player_id:b.id,
    from_champion_id:room.state.picks.ally.find(p => p.role === from)!.championId,
    to_champion_id:room.state.picks.ally.find(p => p.role === to)?.championId ?? null,
    from_accepted:a.id === actor,to_accepted:b.id === actor,
    created_at:new Date(now).toISOString(),expires_at:new Date(now+5000).toISOString()};
}
export function matchesPickSwap(request:PickSwapRequest, state:State) {
  const [a,b] = pickOwners(state,request.from_role,request.to_role);
  return state.phase === 'live' && a?.id === request.from_player_id && b?.id === request.to_player_id
    && state.picks.ally.find(p => p.role === request.from_role)?.championId === request.from_champion_id
    && (state.picks.ally.find(p => p.role === request.to_role)?.championId ?? null) === request.to_champion_id;
}
export function approvePickSwap(request:PickSwapRequest, actor:string, accept:boolean, now=Date.now()):PickSwapRequest|null {
  if (![request.from_player_id,request.to_player_id,...(!accept ? [request.requester_id] : [])].includes(actor)) throw Error('Only the affected players can accept');
  if (!accept || now >= Date.parse(request.expires_at)) return null;
  return {...request,from_accepted:request.from_accepted || actor === request.from_player_id,
    to_accepted:request.to_accepted || actor === request.to_player_id};
}
