import { ROLES, type State, type RoleSwapRequest } from "../domain/types";
import { roleName } from "../domain/roles";
import { Portrait, names } from "../components/Champions";
import { RoleIcon, SwapIcon } from "../components/RoleIcon";
interface Props {
  state: State;
  uid: string;
  host: boolean;
  busy: boolean;
  online: string[];
  readiness: { known: number; total: number };
  swaps: RoleSwapRequest[];
  change: (fn: (s: State) => State) => Promise<void>;
  editPool: (id: string) => void;
  onImport: (file?: File) => void;
  requestSwap: (target: string) => void;
  respondSwap: (id: string, accept: boolean) => void;
}
export default function SetupPage({
  state,
  uid,
  host,
  busy,
  online,
  readiness,
  swaps,
  change,
  editPool,
  onImport,
  requestSwap,
  respondSwap,
}: Props) {
  const me = state.players.find((p) => p.id === uid);
  function removeChampion(playerId: string, championId: string) {
    void change((s) => {
      const p = s.players.find((p) => p.id === playerId)!;
      p.pool = p.pool.filter((id) => id !== championId);
      p.ready = false;
      return s;
    });
  }
  return (
    <section aria-label="Room preparation" className="setup-page">
      {state.players.some((p) => !p.role) && (
        <p className="muted">
          Choose a role:{" "}
          {state.players
            .filter((p) => !p.role)
            .map((p) => p.name)
            .join(", ")}
        </p>
      )}
      {swaps
        .filter((r) => r.requester_id === uid || r.target_id === uid)
        .map((r) => {
          const incoming = r.target_id === uid,
            other = state.players.find(
              (p) => p.id === (incoming ? r.requester_id : r.target_id),
            );
          return (
            <div className="swap-request" role="status" key={r.id}>
              <SwapIcon />
              <span>
                {incoming
                  ? `${other?.name ?? "Player"} wants to swap ${roleName(r.from_role)} for ${roleName(r.to_role)}.`
                  : `Waiting for ${other?.name ?? "player"} to accept the role swap.`}
              </span>
              <div>
                {incoming && (
                  <button
                    disabled={busy}
                    onClick={() => respondSwap(r.id, true)}
                  >
                    Accept
                  </button>
                )}
                <button
                  disabled={busy}
                  onClick={() => respondSwap(r.id, false)}
                >
                  {incoming ? "Decline" : "Cancel"}
                </button>
              </div>
            </div>
          );
        })}
      <section className="roster">
        {ROLES.map((role) => {
          const p = state.players.find((p) => p.role === role),
            editable = !!p && (p.id === uid || host),
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
                {p && (
                  <span className="muted">
                    {p.ready ? "Ready ✓" : "Not ready"}
                  </span>
                )}
              </div>
              <div className="seat-name">
                <i
                  className={online.includes(p?.id ?? "") ? "dot" : "dot off"}
                />
                {p?.name ?? "Available"}
                {p?.id === uid && <small>you</small>}
              </div>
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
                      className="swap-role"
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
                      <SwapIcon />
                      Swap role
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
                      player.ready = false;
                      return s;
                    })
                  }
                >
                  Choose role
                </button>
              )}
            </div>
          );
        })}
      </section>
      {me?.role && (
        <div className="preparation">
          <button
            disabled={
              busy ||
              !me.pool.length ||
              swaps.some((r) => r.requester_id === uid || r.target_id === uid)
            }
            onClick={() =>
              void change((s) => {
                const p = s.players.find((p) => p.id === uid)!;
                p.ready = !p.ready;
                return s;
              })
            }
          >
            {me.ready ? "Not ready" : "Ready ✓"}
          </button>
        </div>
      )}
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
