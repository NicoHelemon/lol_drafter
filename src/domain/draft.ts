import type { Role, State } from "./types";
import { place, record, validateState } from "./state";
export function addDraftCandidate(
  state: State,
  playerId: string,
  championId: string,
): State {
  if (state.phase !== "live")
    throw Error("Draft candidates can only be added during the draft");
  if (!/^\d{1,5}$/.test(championId)) throw Error("Invalid champion");
  const next = structuredClone(state),
    player = next.players.find((p) => p.id === playerId);
  if (!player?.role) throw Error("Player must have an assigned role");
  if (player.pool.includes(championId)) return next;
  player.pool.push(championId);
  validateState(next);
  return record(next, `Candidate added · ${championId}`);
}
export function toggleDraftCandidate(
  state: State,
  role: Role,
  championId: string,
): State {
  const selected = state.picks.ally.find((p) => p.role === role);
  if (selected?.championId === championId) {
    const next = structuredClone(state);
    next.picks.ally = next.picks.ally.filter((p) => p.role !== role);
    return record(next, `Pick cleared · ${role}`);
  }
  const player = state.players.find((p) => p.role === role);
  if (!player?.pool.includes(championId))
    throw Error("Champion is not a candidate for this role");
  return place(state, "ally", role, championId);
}
