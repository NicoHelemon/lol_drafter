import { ROLES, type State, type Role } from "../domain/types";
import { defaultPools } from "../data/provider";
import { supabase } from "../lib/rooms";
import { Portrait } from "../components/Champions";
interface Props {
  state: State;
  uid: string;
  host: boolean;
  busy: boolean;
  online: string[];
  readiness: { known: number; total: number };
  change: (fn: (s: State) => State) => Promise<void>;
  editPool: (id: string, pool: string[]) => void;
  onImport: (file?: File) => void;
}
export default function SetupPage({
  state,
  uid,
  host,
  busy,
  online,
  readiness,
  change,
  editPool,
  onImport,
}: Props) {
  const me = state.players.find((p) => p.id === uid);
  return (
    <section aria-label="Room preparation" className="setup-page">
      {state.players.some(p=>!p.role)&&<p className="muted">Waiting for role: {state.players.filter(p=>!p.role).map(p=>p.name).join(', ')}</p>}
      <section className="roster">
        {ROLES.map((role) => {
          const p = state!.players.find((p) => p.role === role);
          return (
            <div className={"seat " + (p?.id === uid ? "mine" : "")} key={role}>
              <div className="seat-top">
                <span className="role-icon">{role.slice(0, 1)}</span>
                <b>{role}</b>
                <span className="muted">
                  {p?.ready ? "Ready ✓" : "Not ready"}
                </span>
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
                  <div className="mini-pool">
                    {p.pool.slice(0, 6).map((id) => (
                      <Portrait key={id} id={id} />
                    ))}
                    {p.pool.length > 6 && <span>+{p.pool.length - 6}</span>}
                  </div>
                  <button
                    disabled={
                      busy ||
                      (!host && p.id !== uid) ||
                      (state!.phase !== "setup" && !host)
                    }
                    onClick={() => {
                      editPool(p.id, p.pool);
                    }}
                  >
                    Pool · {p.pool.length} champions
                  </button>
                </>
              ) : (
                <button
                  disabled={busy || state!.phase !== "setup"}
                  onClick={() =>
                    void change((s) => {
                      let player = s.players.find((p) => p.id === uid);
                      if (!supabase && player?.role) {
                        s.players.push({
                          id: `demo-${role}`,
                          name: `Demo ${role}`,
                          role,
                          pool: defaultPools[role],
                          ready: true,
                        });
                      } else if (player) {
                        player.role = role;
                        player.pool = defaultPools[role];
                        player.ready = false;
                      }
                      return s;
                    })
                  }
                >
                  {!supabase ? "Add demo player" : "Choose role"}
                </button>
              )}
            </div>
          );
        })}
      </section>
      {me && state!.phase === "setup" && (
        <div className="preparation">
          <label>
            My role
            <select
              aria-label="My role"
              value={me.role ?? ""}
              onChange={(e) =>
                void change((s) => {
                  const p = s.players.find((p) => p.id === uid)!;
                  p.role = e.target.value as Role;
                  p.pool = defaultPools[p.role];
                  p.ready = false;
                  return s;
                })
              }
            >
              <option value="" disabled>
                Choose
              </option>
              {ROLES.map((r) => (
                <option
                  disabled={state!.players.some(
                    (p) => p.id !== uid && p.role === r,
                  )}
                  key={r}
                >
                  {r}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={busy || !me.pool.length}
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
        <summary>Dataset settings</summary>{" "}
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
        <div className="preparation">
          {host && (
            <>
              <label>
                Side
                <select
                  value={state!.side}
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
            </>
          )}
        </div>
      </details>
    </section>
  );
}
