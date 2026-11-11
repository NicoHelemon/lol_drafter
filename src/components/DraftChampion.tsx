import type { CandidateScore } from "../domain/candidates";
import { scoreLabel } from "../domain/candidates";
import type { Role, Team } from "../domain/types";
import { roleName } from "../domain/roles";
import { names, Portrait } from "./Champions";
export interface ScoreSelection {
  id: string;
  role: Role;
  team: Team;
}
export default function DraftChampion({
  id,
  role,
  team,
  result,
  selected,
  blocked,
  busy,
  onPick,
  pickLabel,
  toggle = true,
  onDetails,
}: {
  id: string;
  role: Role;
  team: Team;
  result: CandidateScore;
  selected: boolean;
  blocked: boolean;
  busy: boolean;
  onPick: () => void;
  pickLabel?: string;
  toggle?: boolean;
  onDetails: () => void;
}) {
  const label = scoreLabel(result.value);
  return (
    <div
      className={`draft-champion-tile${selected ? " tile-selected" : ""}${blocked ? " tile-unavailable" : ""}`}
      data-champion={id}
      title={`${names[id]} · ${blocked ? "Unavailable · " : ""}${label} · ${result.known}/${result.total} pairs`}
    >
      <button
        className="champion-choice"
        aria-label={pickLabel ?? `Pick ${names[id]} ${roleName(role)} ${team}`}
        aria-pressed={toggle ? selected : undefined}
        disabled={busy || blocked}
        onClick={onPick}
      >
        <Portrait id={id} />
        {selected && (
          <span className="picked-mark" aria-hidden="true">
            ✓
          </span>
        )}
      </button>
      <button
        className={`tile-score ${result.value === null ? "muted" : result.value < 0 ? "negative" : "positive"}`}
        aria-label={`Score details for ${names[id]} ${roleName(role)} ${team}`}
        onClick={onDetails}
      >
        {label}
        {result.known < result.total && (
          <span className="partial-score" aria-label="Partial coverage">
            •
          </span>
        )}
      </button>
    </div>
  );
}
