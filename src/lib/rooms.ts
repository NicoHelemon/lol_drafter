import { createClient } from "@supabase/supabase-js";
import type { Room, State, RoleSwapRequest } from "../domain/types";
import { initialState, DemoProvider } from "../data/provider";
import { validateState } from "../domain/state";
const url = import.meta.env.VITE_SUPABASE_URL,
  key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = url && key ? createClient(url, key) : null;
let identityPromise: Promise<string> | null = null;
export function identity() {
  return (identityPromise ??= resolveIdentity().catch((e) => {
    identityPromise = null;
    throw e;
  }));
}
async function resolveIdentity() {
  if (!supabase) return "local-player";
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session.user.id;
  const result = await supabase.auth.signInAnonymously();
  if (result.error) throw result.error;
  return result.data.user!.id;
}
export async function createRoom(
  name: string,
): Promise<{ room: Room; token: string }> {
  const uid = await identity(),
    state = initialState(uid, name),
    token = crypto.randomUUID() + crypto.randomUUID();
  state.dataset = await new DemoProvider().load();
  if (!supabase) {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "player";
    const room = {
      id: crypto.randomUUID(),
      slug: `${base}s-room`,
      name: `${name}'s room`,
      host_id: uid,
      version: 0,
      state,
    };
    localStorage.setItem("draftroom-demo", JSON.stringify(room));
    return { room, token: "" };
  }
  const { data, error } = await supabase.rpc("create_room", {
    initial_state: state,
    invite_token: token,
  });
  if (error) throw error;
  return { room: data as Room, token };
}
export async function joinRoom(
  slug: string,
  token: string,
  name: string,
): Promise<Room> {
  await identity();
  if (!supabase) throw Error("Shared rooms are unavailable in local demo mode");
  const { data, error } = await supabase.rpc("join_room", {
    room_slug: slug,
    invite_token: token,
    nickname: name,
  });
  if (error) throw error;
  return data;
}
export async function resolveRoom(slug: string): Promise<Room> {
  if (!supabase) {
    const stored = localStorage.getItem("draftroom-demo");
    if (!stored) throw Error("Room not found");
    const r = JSON.parse(stored) as Room;
    if (r.slug !== slug) throw Error("Room not found");
    return r;
  }
  const { data, error } = await supabase
    .from("rooms")
    .select("*")
    .eq("slug", slug)
    .single();
  if (error) throw error;
  return data;
}
export async function readRoom(id: string): Promise<Room> {
  if (!supabase) {
    const stored = localStorage.getItem("draftroom-demo");
    if (!stored) throw Error("Room not found");
    const room = JSON.parse(stored) as Room;
    if (room.id !== id) throw Error("Room not found");
    return room;
  }
  const { data, error } = await supabase
    .from("rooms")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}
export async function saveRoom(room: Room, next: State): Promise<Room> {
  validateState(next);
  if (!supabase) {
    const stored = await readRoom(room.id);
    if (stored.version !== room.version)
      throw Error("Conflict: room updated. Please try again.");
    const updated = { ...room, state: next, version: room.version + 1 };
    localStorage.setItem("draftroom-demo", JSON.stringify(updated));
    return updated;
  }
  const { data, error } = await supabase.rpc("save_room", {
    room_id: room.id,
    expected_version: room.version,
    next_state: next,
  });
  if (error) throw error;
  return data;
}
export function watchRoom(
  id: string,
  receive: (r: Room) => void,
  status: (s: string) => void,
) {
  if (!supabase) {
    status("Local demo");
    return () => {};
  }
  const refresh = () =>
    readRoom(id)
      .then(receive)
      .catch(() => status("Reconnecting…"));
  const channel = supabase
    .channel(`room:${id}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "rooms",
        filter: `id=eq.${id}`,
      },
      refresh,
    )
    .subscribe((s) => {
      status(s === "SUBSCRIBED" ? "Connected" : s);
      if (s === "SUBSCRIBED") void refresh();
    });
  const timer = setInterval(() => {
    void supabase!.rpc("heartbeat", { room_id: id });
    void refresh();
  }, 20000);
  window.addEventListener("online", refresh);
  return () => {
    clearInterval(timer);
    window.removeEventListener("online", refresh);
    void supabase!.removeChannel(channel);
  };
}
export async function presence(id: string) {
  if (!supabase) return ["local-player"];
  const { data } = await supabase
    .from("room_members")
    .select("user_id,last_seen")
    .eq("room_id", id);
  return (data ?? [])
    .filter((p) => Date.now() - Date.parse(p.last_seen) < 65000)
    .map((p) => p.user_id as string);
}

export async function leaveRoom(room: Room): Promise<void> {
  if (!supabase) {
    localStorage.removeItem("draftroom-demo");
    return;
  }
  const { error } = await supabase.rpc("leave_room", {
    room_id: room.id,
  });
  if (error) throw error;
}
export async function readSwaps(roomId: string): Promise<RoleSwapRequest[]> {
  if (!supabase)
    return JSON.parse(
      localStorage.getItem(`draftroom-swaps-${roomId}`) ?? "[]",
    );
  const { data, error } = await supabase
    .from("role_swap_requests")
    .select("*")
    .eq("room_id", roomId)
    .gt("expires_at", new Date().toISOString());
  if (error) throw error;
  return data ?? [];
}
export async function requestRoleSwap(
  room: Room,
  targetId: string,
): Promise<Room> {
  if (!supabase)
    throw Error("Role swaps require a shared room with another player");
  const { data, error } = await supabase.rpc("request_role_swap", {
    room_id: room.id,
    target_id: targetId,
    expected_version: room.version,
  });
  if (error) throw error;
  return data;
}
export async function respondRoleSwap(
  room: Room,
  requestId: string,
  accept: boolean,
): Promise<Room> {
  if (!supabase)
    throw Error("Role swaps require a shared room with another player");
  const { data, error } = await supabase.rpc("respond_role_swap", {
    room_id: room.id,
    request_id: requestId,
    accept,
  });
  if (error) throw error;
  return data;
}
