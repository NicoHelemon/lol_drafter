import { ROLES, type State, type RoleSwapRequest } from "../domain/types";
import { roleName } from "../domain/roles";
import { Portrait, names } from "../components/Champions";
import { RoleIcon, SwapIcon } from "../components/RoleIcon";
interface Props {
  state: State;
  uid: string;
  host: boolean;
  hostId: string;
  busy: boolean;
  online: string[];
  readiness: { known: number; total: number };
  swaps: RoleSwapRequest[];
  change: (fn: (s: State) => State) => Promise<void>;
  editPool: (id: string) => void;
  onImport: (file?: File) => void;
  requestSwap: (target: string) => void;
}
export default function SetupPage({
  state,
  uid,
  host,
  hostId,
  busy,
  online,
  readiness,
  swaps,
  change,
  editPool,
  onImport,
  requestSwap,
}: Props) {
  const me = state.players.find((p) => p.id === uid);
  function removeChampion(playerId: string, championId: string) {
    void change((s) => {
      const p = s.players.find((p) => p.id === playerId)!;
      p.pool = p.pool.filter((id) => id !== championId);
      return s;
    });
  }
  return (
    <section aria-label="Room preparation" className="setup-page">
      {swaps
        .filter((r) => r.requester_id === uid)
        .map((r) => (
          <p className="swap-wait" role="status" key={r.id}>
            Waiting for{" "}
            {state.players.find((p) => p.id === r.target_id)?.name ?? "player"}{" "}
            to accept the role swap…
          </p>
        ))}
      <section className="roster">
        {ROLES.map((role) => {
          const p = state.players.find((p) => p.role === role),
            editable = !!p && p.id === uid,
            canSwap = !!me?.role && !!p && p.id !== uid;
          return (
            <div
              role="group"
              aria-label={`${roleName(role)} role`}
              className={"seat " + (p?.id === uid ? "mine" : "")}
              key={role}
            >
              <div className="seat-top">
                <RoleIcon role={role} />
                <b>{roleName(role)}</b>
              </div>
              {p && (
                <div className="seat-name">
                  <i className={online.includes(p.id) ? "dot" : "dot off"} />
                  {p.name}
                  {p.id === hostId && <b className="host-badge">HOST</b>}
                  {p.id === uid && <small>you</small>}
                </div>
              )}
              {p ? (
                <>
                  <div className="pool-tiles">
                    {p.pool.map((id) => (
                      <div className="pool-tile" key={id} title={names[id]}>
                        <Portrait id={id} />
                        {editable && (
                          <button
                            className="remove-champion"
                            aria-label={`Remove ${names[id]} from ${roleName(role)} pool`}
                            disabled={busy}
                            onClick={() => removeChampion(p.id, id)}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                    {editable && (
                      <button
                        className="add-champion"
                        aria-label={`Add champion to ${roleName(role)} pool`}
                        disabled={busy}
                        onClick={() => editPool(p.id)}
                      >
                        +
                      </button>
                    )}
                  </div>
                  {canSwap && (
                    <button
                      className="swap-overlay"
                      aria-label={`Swap role with ${p.name}`}
                      disabled={
                        busy ||
                        swaps.some(
                          (r) =>
                            [r.requester_id, r.target_id].includes(uid) ||
                            [r.requester_id, r.target_id].includes(p.id),
                        )
                      }
                      onClick={() => requestSwap(p.id)}
                    >
                      <RoleIcon role={role} />
                      <SwapIcon />
                      <span>Swap role</span>
                    </button>
                  )}
                </>
              ) : (
                <button
                  disabled={busy}
                  onClick={() =>
                    void change((s) => {
                      const player = s.players.find((p) => p.id === uid)!;
                      player.role = role;
                      return s;
                    })
                  }
                >
                  Join
                </button>
              )}
            </div>
          );
        })}
      </section>
      <details className="data-details">
        <summary>Dataset settings</summary>
        <div className="data-status">
          <i className="dot amber" />
          <b>
            {readiness.total && readiness.known === readiness.total
              ? "Data ready"
              : readiness.known
                ? "Partial data"
                : "Data unavailable"}
          </b>
          <span>
            {readiness.known.toLocaleString("en")} /{" "}
            {readiness.total.toLocaleString("en")} potential pairs available
          </span>
        </div>
        {host && (
          <div className="preparation">
            <label>
              Side
              <select
                value={state.side}
                onChange={(e) =>
                  void change((s) => {
                    s.side = e.target.value as "blue" | "red";
                    return s;
                  })
                }
              >
                <option value="blue">Blue</option>
                <option value="red">Red</option>
              </select>
            </label>
            <label className="file-button">
              Import JSON / CSV
              <input
                type="file"
                accept=".json,.csv"
                onChange={(e) => {
                  onImport(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        )}
      </details>
    </section>
  );
}
