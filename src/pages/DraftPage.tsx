import { toggleDraftCandidate } from "../domain/draft";
import { useState } from "react";
import { ROLES, type State, type Team, type Role } from "../domain/types";
import { roleName } from "../domain/roles";
import { RoleIcon } from "../components/RoleIcon";
import { candidates, scoreLabel, scoreForTeam } from "../domain/candidates";
import { place, record } from "../domain/state";
import { names, Portrait } from "../components/Champions";
import DraftChampion, {
  type ScoreSelection,
} from "../components/DraftChampion";
import type { Picker } from "../App";
interface Props {
  state: State;
  uid: string;
  busy: boolean;
  change: (fn: (s: State) => State) => Promise<void>;
  setPicker: (p: Picker) => void;
}
export default function DraftPage({
  state,
  uid,
  busy,
  change,
  setPicker,
}: Props) {
  const associatedPlayers = new Map(
    state.players.map((player) => [player.role, player]),
  );
  const [details, setDetails] = useState<ScoreSelection | null>(null);
  const detailScore = details
    ? scoreForTeam(details.id, details.role, details.team, state)
    : null;
  return (
    <section aria-label="Draft" className="draft-page">
      <section className="card board integrated-board">
        <div className="section-heading">
          <h2>Draft board</h2>
          <span className="badge">LIVE</span>
        </div>
        <div className="draft-bans" role="region" aria-label="Bans">
          {(["ally", "enemy"] as Team[]).map((team) => (
            <section
              className={`team-bans ${team}`}
              aria-label={team === "ally" ? "Our bans" : "Opponent bans"}
              key={team}
            >
              <b>{team === "ally" ? "OUR BANS" : "OPPONENT BANS"}</b>
              <div className="bans">
                {state.bans[team].map((id, slot) => (
                  <div key={slot}>
                    <button
                      aria-label={`Ban ${slot + 1} ${team}`}
                      disabled={busy}
                      onClick={() => setPicker({ kind: "ban", team, slot })}
                    >
                      {id ? <Portrait id={id} /> : <span>+</span>}
                    </button>
                    {id && (
                      <button
                        className="remove-ban"
                        aria-label={`Remove ban ${names[id]}`}
                        disabled={busy}
                        onClick={() =>
                          void change((s) => {
                            s.bans[team][slot] = null;
                            return record(s, `Ban removed · ${names[id]}`);
                          })
                        }
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
        <div className="board-head">
          <span>ROLE</span>
          <b className="blue">OUR TEAM</b>
          <b className="red">OPPONENTS</b>
        </div>
        {ROLES.map((role) => (
          <div className="board-row" key={role}>
            <span className="role-label">
              <RoleIcon role={role} />
              {roleName(role)}
              {associatedPlayers.get(role) && (
                <small
                  className="role-player"
                  title={associatedPlayers.get(role)!.name}
                >
                  {associatedPlayers.get(role)!.name}
                </small>
              )}
            </span>
            {(["ally", "enemy"] as Team[]).map((team) => {
              const player =
                  team === "ally" ? associatedPlayers.get(role) : undefined,
                pick = state.picks[team].find((p) => p.role === role),
                options = candidates(
                  player?.pool ?? [],
                  role,
                  team,
                  state,
                  names,
                );
              return (
                <section
                  className={`draft-cell ${team}${player?.id === uid ? " mine" : ""}`}
                  aria-label={`${roleName(role)} ${team} picks`}
                  key={team}
                >
                  <div className="draft-cell-heading">
                    <span>{pick ? names[pick.championId] : ""}</span>
                    {pick && (
                      <div className="pick-actions">
                        <select
                          aria-label={`Move ${names[pick.championId]} ${team}`}
                          value={role}
                          disabled={busy}
                          onChange={(e) =>
                            void change((s) =>
                              place(
                                s,
                                team,
                                e.target.value as Role,
                                pick.championId,
                              ),
                            )
                          }
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {roleName(r)}
                            </option>
                          ))}
                        </select>
                        <button
                          aria-label={`Remove ${names[pick.championId]} ${team}`}
                          disabled={busy}
                          onClick={() =>
                            void change((s) => {
                              s.picks[team] = s.picks[team].filter(
                                (p) => p.championId !== pick.championId,
                              );
                              return record(
                                s,
                                `Pick removed · ${names[pick.championId]}`,
                              );
                            })
                          }
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="draft-options">
                    {options.map((option) => (
                      <DraftChampion
                        key={option.id}
                        id={option.id}
                        role={role}
                        team={team}
                        result={option}
                        selected={option.selected}
                        blocked={option.blocked}
                        busy={busy}
                        toggle={!!player}
                        pickLabel={
                          player
                            ? undefined
                            : `Change ${names[option.id]} ${roleName(role)} ${team}`
                        }
                        onPick={() => {
                          if (player)
                            void change((s) =>
                              toggleDraftCandidate(s, role, option.id),
                            );
                          else setPicker({ kind: "pick", team, role });
                        }}
                        onDetails={() =>
                          setDetails({ id: option.id, role, team })
                        }
                      />
                    ))}
                    {(player || !pick) && (
                      <button
                        className="add-champion board-add"
                        aria-label={
                          player
                            ? `Add ${roleName(role)} candidates`
                            : `Choose ${roleName(role)} ${team}`
                        }
                        disabled={busy}
                        onClick={() =>
                          setPicker(
                            player
                              ? { kind: "candidates", player: player.id, role }
                              : { kind: "pick", team, role },
                          )
                        }
                      >
                        +
                      </button>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        ))}
        <details className="history">
          <summary>History · {state.history.length} events</summary>
          {state.history.map((h, i) => (
            <p key={i}>{h}</p>
          ))}
        </details>
      </section>
      {details && detailScore && (
        <div className="modal-backdrop" onClick={() => setDetails(null)}>
          <section
            className="modal score-details"
            role="dialog"
            aria-modal="true"
            aria-label="Score details"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="section-heading">
              <h2>
                {names[details.id]} · {roleName(details.role)}
              </h2>
              <button
                aria-label="Close score details"
                onClick={() => setDetails(null)}
              >
                ×
              </button>
            </div>
            <p className="score-total">
              Score {scoreLabel(detailScore.value)}{" "}
              <span className="muted">
                {detailScore.known}/{detailScore.total} pairs
              </span>
            </p>
            <div className="contributions">
              {detailScore.contributions.length ? (
                detailScore.contributions.map((c, i) => (
                  <div key={i}>
                    <span>
                      {c.relation === "vs" ? "Against" : "With"}{" "}
                      {names[c.championId]} · {roleName(c.role)}
                    </span>
                    <b>
                      {c.delta2 === null
                        ? "Missing"
                        : `${c.delta2 > 0 ? "+" : ""}${c.delta2.toFixed(2)} × ${c.weight.toFixed(3)}`}
                    </b>
                  </div>
                ))
              ) : (
                <p>No contextual data yet.</p>
              )}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
