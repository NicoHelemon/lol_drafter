import { errorMessage } from "./lib/errors";
import SetupPage from "./pages/SetupPage";
import DraftPage from "./pages/DraftPage";
import { Search, names } from "./components/Champions";
import { useEffect, useMemo, useState } from "react";
import {
  type Room,
  type Role,
  type State,
  type Team,
} from "./domain/types";
import { coverage, unavailable } from "./domain/scoring";
import { place, record } from "./domain/state";
import { champions, championIds } from "./data/provider";
import { importDataset } from "./data/import";
import catalogueMeta from "./data/catalogue-meta.json";
import {
  createRoom,
  joinRoom,
  readRoom,
  saveRoom,
  watchRoom,
  identity,
  presence,
  supabase,
  leaveRoom,
  endRoom,
} from "./lib/rooms";
export type Picker =
  | { kind: "pick"; team: Team; role: Role }
  | { kind: "ban"; team: Team; slot: number }
  | { kind: "pool"; player: string };
export default function App() {
  const [room, setRoom] = useState<Room | null>(null),
    [uid, setUid] = useState(""),
    [nickname, setNickname] = useState(""),
    [error, setError] = useState(""),
    [sync, setSync] = useState("Not connected"),
    [busy, setBusy] = useState(false),
    [picker, setPicker] = useState<Picker | null>(null),
    [poolDraft, setPoolDraft] = useState<string[]>([]),
    [mode, setMode] = useState<"replace" | "unassign">("replace"),
    [online, setOnline] = useState<string[]>([]);
  const [invite, setInvite] = useState(() => location.hash.slice(1));
  const [inviteRoom] = useState(
    () =>
      new URLSearchParams(location.search).get("room") ??
      location.pathname.match(/^\/rooms\/([^/]+)/)?.[1] ??
      null,
  );
  useEffect(() => {
    void run(async () => {
      setUid(await identity());
      const id = inviteRoom ?? localStorage.getItem("draftroom-current");
      if (id) {
        try {
          setRoom(await readRoom(id));
        } catch {
          localStorage.removeItem("draftroom-current");
        }
      }
    });
  }, []);
  useEffect(() => {
    if (!room) return;
    localStorage.setItem("draftroom-current", room.id);
    const stop = watchRoom(
      room.id,
      (r) =>
        setRoom((old) =>
          old && r.id === old.id && r.version >= old.version ? r : old,
        ),
      setSync,
    );
    const update = () => presence(room.id).then(setOnline);
    void update();
    const t = setInterval(update, 15000);
    return () => {
      stop();
      clearInterval(t);
    };
  }, [room?.id]);
  useEffect(() => {
    setPicker(null);
  }, [room?.state.phase]);
  useEffect(() => {
    if (!room) return;
    const path = `/rooms/${room.id}/${room.state.phase === "setup" ? "setup" : "draft"}${invite ? "#" + invite : ""}`;
    history.replaceState(null, "", path);
    document.title =
      room.state.phase === "setup"
        ? "Preparation · Draftroom"
        : "Draft · Draftroom";
  }, [room?.id, room?.state.phase, invite]);
  async function run(fn: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function change(fn: (s: State) => State) {
    if (!room || busy) return;
    await run(async () => {
      try {
        setRoom(await saveRoom(room, fn(structuredClone(room.state))));
      } catch (e) {
        setRoom(await readRoom(room.id));
        throw e;
      }
    });
  }
  const state = room?.state,
    host = room?.host_id === uid,
    used = state ? unavailable(state) : new Set<string>();
  const readiness = useMemo(
    () =>
      state
        ? coverage(
            state.dataset,
            state.players,
            champions.map((c) => c.id),
          )
        : { known: 0, total: 0 },
    [state?.dataset, state?.players],
  );
  function clearRoom() {
    localStorage.removeItem("draftroom-current");
    setRoom(null);
    setPicker(null);
    setInvite("");
    setSync("Not connected");
    history.replaceState(null, "", "/");
    location.assign("/");
  }
  async function exitRoom() {
    if (
      !room ||
      !confirm(
        !supabase
          ? "Leave this local demo?"
          : host
            ? "Leave this room? Host controls pass to the next player. An empty room is deleted."
            : "Leave this room and release your seat?",
      )
    )
      return;
    await run(async () => {
      try {
        await leaveRoom(room);
        clearRoom();
      } catch (e) {
        setRoom(await readRoom(room.id));
        throw e;
      }
    });
  }
  async function finishRoom() {
    if (
      !room ||
      !confirm("End this room for everyone? The draft will become read-only.")
    )
      return;
    await run(async () => {
      try {
        setRoom(await endRoom(room));
        setPicker(null);
      } catch (e) {
        setRoom(await readRoom(room.id));
        throw e;
      }
    });
  }
  function importFile(file?: File) {
    if (!file || !room) return;
    void run(async () => {
      if (file.size > 12000000) throw Error("File limit: 12 MB");
      const text = await file.text();
      let metadata;
      if (file.name.endsWith(".csv")) {
        const raw = prompt(
          "Dataset metadata JSON: id, patch, tier, source, importedAt (ISO), fictional (boolean)",
        );
        if (!raw) return;
        metadata = JSON.parse(raw);
      }
      const dataset = importDataset(
        text,
        file.name.endsWith(".csv") ? "csv" : "json",
        championIds,
        metadata,
      );
      setRoom(await saveRoom(room, { ...room.state, dataset }));
    });
  }
  function choose(id: string) {
    if (!picker) return;
    if (picker.kind === "pool") {
      setPoolDraft((old) =>
        old.includes(id) ? old.filter((x) => x !== id) : [...old, id],
      );
      return;
    }
    const p = picker;
    setPicker(null);
    void change((s) => {
      if (p.kind === "pick") return place(s, p.team, p.role, id, mode);
      s.bans[p.team][p.slot] = id;
      return record(s, `Ban · ${names[id]}`);
    });
  }
  const link =
    room && invite ? `${location.origin}/?room=${room.id}#${invite}` : "";
  return (
    <div className="app">
      <header>
        <a className="brand" href="/">
          ◈{" "}
          <span>
            DRAFT<span className="gold">ROOM</span>
          </span>
        </a>
        <span className="subtitle">LEAGUE OF LEGENDS · TEAM DRAFT</span>
        <span className="connection">
          <i className={supabase ? "dot" : "dot amber"} />
          {sync}
        </span>
      </header>
      {!room ? (
        <main className="welcome">
          <h1>Draftroom</h1>
          <section className="card entry">
            <h2>{inviteRoom ? "Join room" : "Create room"}</h2>
            <label>
              Display name
              <input
                maxLength={32}
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="Your name"
              />
            </label>
            <button
              className="primary"
              disabled={busy || !nickname.trim()}
              onClick={() =>
                void run(async () => {
                  if (inviteRoom) {
                    setRoom(
                      await joinRoom(inviteRoom, invite, nickname.trim()),
                    );
                  } else {
                    const result = await createRoom(nickname.trim());
                    setRoom(result.room);
                    setInvite(result.token);
                    if (result.token)
                      history.replaceState(
                        null,
                        "",
                        `/?room=${result.room.id}#${result.token}`,
                      );
                  }
                })
              }
            >
              {inviteRoom
                ? "Join room"
                : supabase
                  ? "Create private room"
                  : "Open local demo"}{" "}
              →
            </button>
            <p className="muted">
              {supabase
                ? "No account required · up to five players"
                : "Local demo · saved on this browser only."}
            </p>
          </section>
          <p className="notice">Demo statistics are fictional.</p>
        </main>
      ) : (
        <main>
          <div className="title-row">
            <div>
              <div className="eyebrow">ROOM / {room.id.slice(0, 8)}</div>
              <h1>
                {state!.phase === "setup"
                  ? "Preparation"
                  : state!.phase === "finished"
                    ? "Room ended"
                    : "Draft"}
              </h1>
            </div>
            <div className="actions">
              {link && (
                <button
                  onClick={() =>
                    void run(async () => {
                      await navigator.clipboard.writeText(link);
                      setSync("Invitation copied");
                    })
                  }
                >
                  Copy invitation ↗
                </button>
              )}
              {host && state!.phase === "setup" && (
                <button
                  className="primary"
                  disabled={
                    busy ||
                    state!.players.some(
                      (p) => !p.role || !p.pool.length || !p.ready,
                    )
                  }
                  onClick={() =>
                    void change((s) => {
                      s.phase = "live";
                      return record(s, "Draft started");
                    })
                  }
                >
                  Start draft →
                </button>
              )}
              {host && state!.phase !== "finished" && (
                <button disabled={busy} onClick={() => void finishRoom()}>
                  End room
                </button>
              )}
              <button disabled={busy} onClick={() => void exitRoom()}>
                Leave room
              </button>
            </div>
          </div>
          {state!.phase !== "setup" && (
            <div className="room-summary">
              {state!.players.map((p) => (
                <span key={p.id}>
                  <i className={online.includes(p.id) ? "dot" : "dot off"} />
                  {p.name} · {p.role ?? "No role"}
                </span>
              ))}
            </div>
          )}
          <p className="dataset-note">
            {state!.dataset.fictional
              ? "Fictional demo data"
              : `${state!.dataset.source} · ${state!.dataset.patch} / ${state!.dataset.tier}`}{" "}
            · Delta 2 score
          </p>
          {state!.phase === "setup" ? (
            <SetupPage
              state={state!}
              uid={uid}
              host={host}
              busy={busy}
              online={online}
              readiness={readiness}
              change={change}
              editPool={(id, pool) => {
                setPicker({ kind: "pool", player: id });
                setPoolDraft(pool);
              }}
              onImport={importFile}
            />
          ) : (
            <DraftPage
              state={state!}
              uid={uid}
              host={host}
              editPool={(id, pool) => {
                setPicker({ kind: "pool", player: id });
                setPoolDraft(pool);
              }}
              busy={busy}
              change={change}
              setPicker={setPicker}
              setMode={setMode}
            />
          )}
          <footer>
            Riot Data Dragon {catalogueMeta.patch} · {champions.length}{" "}
            champions · champion catalogue <span>Draftroom</span>
          </footer>
        </main>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
          <button onClick={() => setError("")} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}
      {picker && (
        <div className="modal-backdrop" onClick={() => setPicker(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={
              picker.kind === "pool" ? "Edit pool" : "Choose champion"
            }
            onClick={(e) => e.stopPropagation()}
          >
            <div className="section-heading">
              <h2>
                {picker.kind === "pool"
                  ? "Champion pool"
                  : picker.kind === "pick"
                    ? `${picker.role} · ${picker.team === "ally" ? "Our team" : "Opponents"}`
                    : "Choose ban"}
              </h2>
              <button aria-label="Close" onClick={() => setPicker(null)}>
                ×
              </button>
            </div>
            {picker.kind === "pick" &&
              state?.picks[picker.team].some((p) => p.role === picker.role) && (
                <label>
                  Occupied role
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as typeof mode)}
                  >
                    <option value="replace">Replace current pick</option>
                    <option value="unassign">
                      Keep current pick unassigned
                    </option>
                  </select>
                </label>
              )}
            <Search
              selected={picker.kind === "pool" ? poolDraft : []}
              blocked={picker.kind === "pool" ? new Set() : used}
              onChoose={choose}
            />
            {picker.kind === "pool" && (
              <div className="modal-actions">
                <span>{poolDraft.length} champions selected</span>
                <button
                  className="primary"
                  disabled={!poolDraft.length || busy}
                  onClick={() => {
                    const p = picker;
                    void change((s) => {
                      const player = s.players.find((x) => x.id === p.player)!;
                      player.pool = poolDraft;
                      player.ready = false;
                      return record(s, `Pool updated · ${player.name}`);
                    });
                    setPicker(null);
                  }}
                >
                  Save pool
                </button>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
