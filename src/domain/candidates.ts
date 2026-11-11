import { score, unavailable, pairKey } from "./scoring";
import type { Role, State, Team, Pair } from "./types";
export type CandidateScore = ReturnType<typeof score>;
export function scoreForTeam(
  championId: string,
  role: Role,
  team: Team,
  state: State,
  index?: Map<string, Pair>,
): CandidateScore {
  const other = team === "ally" ? "enemy" : "ally";
  const context = {
    ...state,
    picks: {
      ally: state.picks[team].filter((p) => p.championId !== championId),
      enemy: state.picks[other].filter((p) => p.championId !== championId),
    },
  };
  return score(championId, role, context, index);
}
export function candidates(
  pool: string[],
  role: Role,
  team: Team,
  state: State,
  names: Record<string, string> = {},
) {
  const index = new Map(state.dataset.pairs.map((p) => [pairKey(p), p]));
  const selected = state.picks[team].find((p) => p.role === role)?.championId,
    used = unavailable(state);
  const ids = [...new Set(selected ? [selected, ...pool] : pool)];
  return ids
    .map((id) => ({
      id,
      selected: id === selected,
      blocked: used.has(id) && id !== selected,
      ...scoreForTeam(id, role, team, state, index),
    }))
    .sort(
      (a, b) =>
        Number(b.selected) - Number(a.selected) ||
        Number(a.blocked) - Number(b.blocked) ||
        (a.value === null && b.value !== null
          ? 1
          : b.value === null && a.value !== null
            ? -1
            : (b.value ?? 0) - (a.value ?? 0)) ||
        (names[a.id] ?? a.id).localeCompare(names[b.id] ?? b.id),
    );
}
export const scoreLabel = (value: number | null) =>
  value === null ? "N/A" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
