import { useState } from "react";
import { ROLES, type State, type Team, type Role } from "../domain/types";
import { rank } from "../domain/scoring";
import { place, record } from "../domain/state";
import { names, Portrait } from "../components/Champions";
import type { Picker } from "../App";
interface Props {
  state: State;
  uid: string;
  host: boolean;
  editPool: (id: string, pool: string[]) => void;
  busy: boolean;
  change: (fn: (s: State) => State) => Promise<void>;
  setPicker: (p: Picker) => void;
  setMode: (m: "replace" | "unassign") => void;
}
export default function DraftPage({
  state,
  uid,
  host,
  editPool,
  busy,
  change,
  setPicker,
  setMode,
}: Props) {
  const [view, setView] = useState("board");
  return (
    <section aria-label="Draft" className="draft-page">
      <nav className="mobile-tabs">
        <button onClick={() => setView("board")}>Board</button>
        <button onClick={() => setView("rankings")}>Recommendations</button>
      </nav>
      <div className="workspace">
        <section
          className={"card board " + (view !== "board" ? "mobile-hidden" : "")}
        >
          <div className="section-heading">
            <h2>Draft board</h2>
            <span className="badge">
              {state!.phase === "setup"
                ? "PREPARATION"
                : state!.phase === "live"
                  ? "LIVE"
                  : "ENDED"}
            </span>
          </div>
          <div className="board-head">
            <span>ROLE</span>
            <b className="blue">OUR TEAM</b>
            <b className="red">OPPONENTS</b>
          </div>
          {ROLES.map((role) => (
            <div className="board-row" key={role}>
              <span className="role-label">{role}</span>
              {(["ally", "enemy"] as Team[]).map((team) => {
                const pick = state!.picks[team].find((p) => p.role === role);
                return (
                  <div key={team} className={"pick " + team}>
                    {pick ? (
                      <>
                        <Portrait id={pick.championId} />
                        <div className="pick-info">
                          <b>{names[pick.championId]}</b>
                          <select
                            aria-label={`Move ${names[pick.championId]} ${team}`}
                            disabled={busy || state!.phase === "finished"}
                            value={role}
                            onChange={(e) =>
                              void change((s) => {
                                const p = s.picks[team].find(
                                  (p) => p.championId === pick.championId,
                                )!;
                                if (e.target.value === "unknown") {
                                  p.role = null;
                                  return record(
                                    s,
                                    `${names[p.championId]} · unassigned role`,
                                  );
                                }
                                return place(
                                  s,
                                  team,
                                  e.target.value as Role,
                                  p.championId,
                                );
                              })
                            }
                          >
                            {ROLES.map((r) => (
                              <option key={r}>{r}</option>
                            ))}
                            <option value="unknown">Unassigned role</option>
                          </select>
                        </div>
                        <button
                          className="icon-button"
                          aria-label={`Remove ${names[pick.championId]} ${team}`}
                          disabled={busy || state!.phase === "finished"}
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
                      </>
                    ) : null}
                    <button
                      className={pick ? "edit-button" : "empty-pick"}
                      aria-label={`${pick ? "Edit" : "Choose"} ${role} ${team}`}
                      disabled={busy || state!.phase === "finished"}
                      onClick={() => {
                        setMode("replace");
                        setPicker({ kind: "pick", team, role });
                      }}
                    >
                      {pick ? (
                        "✎"
                      ) : (
                        <>
                          <span>＋</span> Choose champion
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
          <div className="ban-row">
            <span>BANS</span>
            {(["ally", "enemy"] as Team[]).map((team) => (
              <div className="bans" key={team}>
                {state!.bans[team].map((id, slot) => (
                  <div key={slot}>
                    <button
                      aria-label={`Ban ${slot + 1} ${team}`}
                      disabled={busy || state!.phase === "finished"}
                      onClick={() => setPicker({ kind: "ban", team, slot })}
                    >
                      {id ? <Portrait id={id} /> : <span>＋</span>}
                    </button>
                    {id && (
                      <button
                        className="remove-ban"
                        aria-label={`Remove ban ${names[id]}`}
                        disabled={busy || state!.phase === "finished"}
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
            ))}
          </div>
          {(["ally", "enemy"] as Team[]).map((team) => {
            const unknown = state!.picks[team].filter((p) => !p.role);
            return unknown.length ? (
              <div className="unknown" key={team}>
                <b>
                  {team === "ally" ? "Allies" : "Opponents"} · unassigned role
                </b>
                {unknown.map((p) => (
                  <div className="unknown-pick" key={p.championId}>
                    <Portrait id={p.championId} />
                    {names[p.championId]}
                    <select
                      aria-label={`Assign ${names[p.championId]}`}
                      value=""
                      disabled={busy || state!.phase === "finished"}
                      onChange={(e) =>
                        void change((s) =>
                          place(s, team, e.target.value as Role, p.championId),
                        )
                      }
                    >
                      <option value="" disabled>
                        Assign / swap
                      </option>
                      {ROLES.map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </select>
                    <button
                      disabled={busy || state!.phase === "finished"}
                      onClick={() =>
                        void change((s) => {
                          s.picks[team] = s.picks[team].filter(
                            (x) => x.championId !== p.championId,
                          );
                          return s;
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : null;
          })}
          <p className="muted board-hint">
            Use a pick’s role menu to move it or swap roles.
          </p>
          <details className="history">
            <summary>History · {state!.history.length} events</summary>
            {state!.history.map((h, i) => (
              <p key={i}>{h}</p>
            ))}
          </details>
        </section>
        <aside
          className={"rankings " + (view !== "rankings" ? "mobile-hidden" : "")}
        >
          <div className="section-heading">
            <h2>Recommendations</h2>
            <span className="muted">DELTA 2 SCORE</span>
          </div>
          {ROLES.map((role) => {
            const p = state!.players.find((p) => p.role === role),
              locked = state!.picks.ally.find((p) => p.role === role),
              ranking = rank(p?.pool ?? [], role, state!, names);
            return (
              <section
                className={"card ranking " + (p?.id === uid ? "mine" : "")}
                key={role}
              >
                <div className="ranking-heading">
                  <b>{role}</b>
                  <span>{p?.name ?? "Available"}</span>
                  {locked && <span className="badge">PICK</span>}
                  {host && p && state.phase === "live" && (
                    <button
                      className="edit-pool"
                      disabled={busy}
                      onClick={() => editPool(p.id, p.pool)}
                    >
                      Edit pool
                    </button>
                  )}
                </div>
                {locked ? (
                  <div className="locked">
                    <Portrait id={locked.championId} />
                    <b>{names[locked.championId]}</b>
                  </div>
                ) : (
                  <>
                    {ranking.every((r) => r.value === null) && (
                      <p className="muted">No contextual data yet</p>
                    )}
                    {ranking.map((r, i) => (
                      <details className="recommendation" key={r.id}>
                        <summary>
                          <span className="position">
                            {r.value === null
                              ? "—"
                              : String(i + 1).padStart(2, "0")}
                          </span>
                          <Portrait id={r.id} />
                          <b>{names[r.id]}</b>
                          <span className="score-block">
                            <strong
                              className={
                                r.value !== null && r.value < 0
                                  ? "negative"
                                  : "positive"
                              }
                            >
                              {r.value === null
                                ? "N/A"
                                : `${r.value >= 0 ? "+" : ""}${r.value.toFixed(2)}`}
                            </strong>
                            <small>
                              {r.known}/{r.total} pairs
                            </small>
                          </span>
                        </summary>
                        <div className="contributions">
                          {r.contributions.length ? (
                            r.contributions.map((c, j) => (
                              <div key={j}>
                                <span>
                                  {c.relation === "vs" ? "Against" : "With"}{" "}
                                  {names[c.championId]} · {c.role}
                                </span>
                                <b>
                                  {c.delta2 === null
                                    ? "Missing"
                                    : `${c.delta2 > 0 ? "+" : ""}${c.delta2.toFixed(2)} × ${c.weight.toFixed(3)}`}
                                </b>
                              </div>
                            ))
                          ) : (
                            <p>No assigned picks. No score available.</p>
                          )}
                        </div>
                      </details>
                    ))}
                    {!ranking.length && (
                      <p className="muted">
                        {p
                          ? "No available champions in this pool."
                          : "No player assigned."}
                      </p>
                    )}
                  </>
                )}
              </section>
            );
          })}
          <p className="muted">
            Weighted Delta 2 average, in percentage points.
          </p>
        </aside>
      </div>
    </section>
  );
}
