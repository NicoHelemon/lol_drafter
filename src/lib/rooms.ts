import { RoomExpiredError } from "./errors";
import { makePickSwap, moveDraftPick, pickOwners, approvePickSwap, matchesPickSwap } from "../domain/pickSwaps";
import { addDraftCandidate } from "../domain/draft";
import { createClient } from "@supabase/supabase-js";
import type { Room, State, RoleSwapRequest, PickSwapRequest, Role, Team } from "../domain/types";
import { initialState, DemoProvider } from "../data/provider";
import { validateState } from "../domain/state";
import { StatisticsCache, persistedState, snapshotMetadata } from "../data/shared";
const url = import.meta.env.VITE_SUPABASE_URL,
  key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = url && key ? createClient(url, key) : null;
const statistics = new StatisticsCache(async (snapshot, keys) => {
  if (!supabase) throw Error('Shared statistics require Supabase');
  const { data, error } = await supabase.from('statistics_shards')
    .select('candidate_key,pairs').eq('snapshot_id', snapshot).in('candidate_key', keys);
  if (error) throw error;
  return data ?? [];
});
const hydrated = (room: Room) => statistics.hydrate(room);
export const clearStatisticsCache = () => statistics.clear();
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
  const current = await supabase.from('statistics_current').select('snapshot_id').maybeSingle();
  if (current.error) throw current.error;
  if (current.data) {
    const snapshot = await supabase.from('statistics_snapshots').select('metadata').eq('id', current.data.snapshot_id).single();
    if (snapshot.error) throw snapshot.error;
    state.dataset = snapshotMetadata(snapshot.data.metadata);
  }
  const { data, error } = await supabase.rpc("create_room", {
    initial_state: state,
    invite_token: token,
  });
  if (error) throw error;
  return { room: await hydrated(data as Room), token };
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
  if (error?.message === "Room not found") throw new RoomExpiredError();
  if (error) throw error;
  if (!data) throw new RoomExpiredError();
  return hydrated(data);
}
export async function resolveRoom(slug: string): Promise<Room> {
  if (!supabase) {
    const stored = localStorage.getItem("draftroom-demo");
    if (!stored) throw new RoomExpiredError();
    const r = JSON.parse(stored) as Room;
    if (r.slug !== slug) throw new RoomExpiredError();
    return r;
  }
  const { data, error } = await supabase
    .from("rooms")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new RoomExpiredError();
  return hydrated(data);
}
export async function readRoom(id: string): Promise<Room> {
  if (!supabase) {
    const stored = localStorage.getItem("draftroom-demo");
    if (!stored) throw new RoomExpiredError();
    const room = JSON.parse(stored) as Room;
    if (room.id !== id) throw new RoomExpiredError();
    return room;
  }
  const { data, error } = await supabase
    .from("rooms")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new RoomExpiredError();
  return hydrated(data);
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
    next_state: persistedState(next),
  });
  if (error) throw error;
  if (!data) throw new RoomExpiredError();
  return hydrated(data);
}
export function watchRoom(
  id: string,
  receive: (r: Room) => void,
  status: (s: string) => void,
  expired: () => void,
) {
  let active = true;
  const refresh = () =>
    readRoom(id)
      .then(r => { if (active) receive(r); })
      .catch(error => {
        if (!active) return;
        if (error instanceof RoomExpiredError) { active = false; expired(); }
        else status("Reconnecting…");
      });
  if (!supabase) {
    status("Local demo");
    const timer = setInterval(refresh, 20000);
    return () => { active = false; clearInterval(timer); };
  }
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
    // PostgREST builders are lazy thenables: void alone never sends the RPC.
    void supabase!.rpc("heartbeat", { room_id: id }).then(
      ({ error }) => { if (error && active) status("Reconnecting…"); },
      () => { if (active) status("Reconnecting…"); },
    );
    void refresh();
  }, 20000);
  window.addEventListener("online", refresh);
  return () => {
    active = false;
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
  if (!data) throw new RoomExpiredError();
  return hydrated(data);
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
  if (!data) throw new RoomExpiredError();
  return hydrated(data);
}

export async function addCandidate(
  room: Room,
  playerId: string,
  championId: string,
): Promise<Room> {
  if (!supabase)
    return saveRoom(room, addDraftCandidate(room.state, playerId, championId));
  const { data, error } = await supabase.rpc("add_draft_candidate", {
    room_id: room.id,
    player_id: playerId,
    champion_id: championId,
    expected_version: room.version,
  });
  if (error) throw error;
  if (!data) throw new RoomExpiredError();
  return hydrated(data);
}


export async function readPickSwaps(roomId:string):Promise<PickSwapRequest[]> {
  if (!supabase) return JSON.parse(localStorage.getItem(`draftroom-pick-swaps-${roomId}`) ?? '[]')
    .filter((r:PickSwapRequest) => Date.parse(r.expires_at)>Date.now());
  const {data,error}=await supabase.from('pick_swap_requests').select('*').eq('room_id',roomId).gt('expires_at',new Date().toISOString());
  if(error) throw error;
  return data ?? [];
}
export async function movePick(room:Room, team:Team, from:Role, to:Role):Promise<Room> {
  const actor=await identity();
  if (!supabase) {
    const current=await readRoom(room.id);
    if(current.version!==room.version) throw Error('Conflict: room updated. Please try again.');
    const [a,b]=pickOwners(current.state,from,to);
    if(team==='ally' && a && b && from!==to) {
      const pending=await readPickSwaps(room.id);
      if(pending.some(q=>[q.from_role,q.to_role].some(r=>r===from||r===to))) throw Error('A champion swap is already pending');
      const request=makePickSwap(current,from,to,actor);
      localStorage.setItem(`draftroom-pick-swaps-${room.id}`,JSON.stringify([...pending,request]));
      const next={...current,version:current.version+1};
      localStorage.setItem('draftroom-demo',JSON.stringify(next));
      return next;
    }
    return saveRoom(current,moveDraftPick(current.state,team,from,to));
  }
  const {data,error}=await supabase.rpc('move_draft_pick',{room_id:room.id,team,from_role:from,to_role:to,expected_version:room.version});
  if(error) throw error;
  return hydrated(data);
}
export async function respondPickSwap(room:Room, requestId:string, accept:boolean):Promise<Room> {
  if(!supabase) {
    const current=await readRoom(room.id),actor=await identity(),pending=await readPickSwaps(room.id);
    const request=pending.find(r=>r.id===requestId);
    if(!request) return current;
    const nextRequest=approvePickSwap(request,actor,accept);
    const valid=matchesPickSwap(request,current.state);
    const apply=valid && nextRequest?.from_accepted && nextRequest?.to_accepted;
    const rest=pending.filter(r=>r.id!==requestId);
    if(nextRequest && valid && !apply) rest.push(nextRequest);
    localStorage.setItem(`draftroom-pick-swaps-${room.id}`,JSON.stringify(rest));
    const next={...current,version:current.version+1,state:apply ? moveDraftPick(current.state,'ally',request.from_role,request.to_role) : current.state};
    localStorage.setItem('draftroom-demo',JSON.stringify(next));
    return next;
  }
  const {data,error}=await supabase.rpc('respond_pick_swap',{room_id:room.id,request_id:requestId,accept});
  if(error) throw error;
  return hydrated(data);
}
