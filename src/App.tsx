import AccountPanel from './components/AccountPanel';
import {readAccount,signOutAccount,saveRoomPool,type Account} from './lib/accounts';
import {startDraft,chooseBan} from './domain/progression';
import type {DraftMode} from './domain/types';
import Participants from "./components/Participants";
import PickSwapPrompt from "./components/PickSwapPrompt";
import SwapPrompt from "./components/SwapPrompt";
import {rolePool} from "./domain/rolePools";
import { roleName } from "./domain/roles";
import { errorMessage, RoomExpiredError } from "./lib/errors";
import SetupPage from "./pages/SetupPage";
import DraftPage from "./pages/DraftPage";
import { Search, names, Portrait } from "./components/Champions";
import { useEffect, useState, useRef } from "react";
import {
  type Room,
  type Role,
  type State,
  type Team,
  type RoleSwapRequest,
  type PickSwapRequest,
} from "./domain/types";
import { unavailable } from "./domain/scoring";
import { record } from "./domain/state";

import {
  createRoom,
  clearDraft,
  controlDraft,
  claimRole,transferHost,
  joinRoom,
  readRoom,
  saveRoom,
  watchRoom,
  identity,
  presence,
  supabase,
  leaveRoom,
  resolveRoom,
  readSwaps,
  requestRoleSwap,
  respondRoleSwap,
  setCandidates,
  clearStatisticsCache,
  movePick,
  readPickSwaps,
  respondPickSwap,
  moveLiveRole,
} from "./lib/rooms";
export type Picker =
  | {kind:'candidates';team:Team;role:Role}
  | {kind:'ban';team:Team;slot:number}
  | {kind:'bans';team:Team};
export default function App() {
  const [account,setAccount]=useState<Account|null>(null),[accountOpen,setAccountOpen]=useState(false);
  const [draftMode,setDraftMode]=useState<DraftMode>('ranked');
  const [room, setRoom] = useState<Room | null>(null),
    [uid, setUid] = useState(""),
    [nickname, setNickname] = useState(""),
    [error, setError] = useState(""),
    [sync, setSync] = useState("Not connected"),
    [busy, setBusy] = useState(false),
    [picker, setPicker] = useState<Picker | null>(null),
    [swaps, setSwaps] = useState<RoleSwapRequest[]>([]),
    [pickSwaps, setPickSwaps] = useState<PickSwapRequest[]>([]),
    [online, setOnline] = useState<string[]>([]);
  const authView=useRef({room,uid,accountOpen});authView.current={room,uid,accountOpen};
  const clearLatest=useRef(()=>{});clearLatest.current=clearRoom;
  useEffect(()=>{
    if(!supabase)return;
    const {data:{subscription}}=supabase.auth.onAuthStateChange((event,session)=>{
      if(event==='INITIAL_SESSION'||event==='TOKEN_REFRESHED')return;
      const current=authView.current,next=session?.user.id??'';
      if(current.room&&next!==current.uid){clearLatest.current();setAccount(null);setUid(next);setError('Your sign-in changed. Reopen the room from its invitation.');return;}
      if(!current.room){setUid(next);if(!session||session.user.is_anonymous)setAccount(null);else if(!current.accountOpen)setTimeout(()=>{void readAccount().then(value=>{setAccount(value);if(value?.profile?.display_name)setNickname(value.profile.display_name);}).catch(e=>setError(errorMessage(e)));},0);}
    });return()=>subscription.unsubscribe();
  },[]);
  const [invite, setInvite] = useState(() => location.hash.slice(1));
  const [inviteRoom, setInviteRoom] = useState(
    () => location.pathname.match(/^\/rooms\/([^/]+)/)?.[1] ?? null,
  );
  useEffect(() => {
    void run(async () => {
      setUid(await identity());
      const signed=await readAccount();setAccount(signed);if(signed?.profile?.display_name)setNickname(signed.profile.display_name);
      const saved = localStorage.getItem("draftroom-current");
      const id = inviteRoom ?? saved;
      if (id) {
        try {
          setRoom(await resolveRoom(id));
        } catch (e) {
          if (e instanceof RoomExpiredError && (!invite || saved === id)) expireRoom();
          else if (!(e instanceof RoomExpiredError)) throw e;
        }
      }
    });
  }, []);
  useEffect(() => {
    if (!room) return;
    localStorage.setItem("draftroom-current", room.slug);
    const stop = watchRoom(
      room.id,
      (r) =>
        setRoom((old) =>
          old && r.id === old.id && r.version >= old.version ? r : old,
        ),
      setSync,
      expireRoom,
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
  }, [room?.state.phase,room?.state.openDraft,room?.state.draftStep,room?.state.players.map(p=>`${p.id}:${p.role}`).join('|')]);
  useEffect(() => {
    if (!room) return;
    const path = `/rooms/${room.slug}/${room.state.phase === "setup" ? "setup" : "draft"}${invite ? "#" + invite : ""}`;
    history.replaceState(null, "", path);
    document.title = `${room.name} · ${room.state.phase === "setup" ? "Preparation" : "Draft"}`;
  }, [room?.id, room?.state.phase, invite]);
  useEffect(() => {
    if (!room) {setSwaps([]);return;}
    let active = true;
    const refresh = () =>
      readSwaps(room.id)
        .then((data) => {
          if (active) setSwaps(data);
        })
        .catch(() => {
          if (active) setSwaps([]);
        });
    void refresh();
    const timer = setInterval(refresh, 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [room?.id, room?.version, room?.state.phase]);
  useEffect(() => {
    if (!room) return;
    const timers = swaps
      .filter((r) => r.requester_id === uid || r.target_id === uid)
      .map((request) =>
        setTimeout(
          () => {
            setSwaps((current) => current.filter((r) => r.id !== request.id));
            void respondRoleSwap(room, request.id, false)
              .then((next) =>
                setRoom((current) =>
                  current &&
                  current.id === next.id &&
                  next.version >= current.version
                    ? next
                    : current,
                ),
              )
              .catch(() => {});
          },
          Math.max(0, Date.parse(request.expires_at) - Date.now()),
        ),
      );
    return () => timers.forEach(clearTimeout);
  }, [swaps, uid, room?.id]);
  useEffect(() => {
    if (!room || room.state.phase !== 'live') {setPickSwaps([]);return;}
    let active=true;
    const refresh=()=>readPickSwaps(room.id).then(requests=>{if(active)setPickSwaps(requests);}).catch(()=>{if(active)setPickSwaps([]);});
    void refresh();const timer=setInterval(refresh,1000);
    return()=>{active=false;clearInterval(timer);};
  },[room?.id,room?.version,room?.state.phase]);
  async function championMove(team:Team, from:Role, to:Role) {
    if (!room || busy) return;
    await run(async()=>{
      try {setRoom(await movePick(room,team,from,to));}
      catch(e){setRoom(await readRoom(room.id));throw e;}
    });
  }
  async function roleMove(to:Role){
    if(!room||busy)return;
    await run(async()=>{try{setRoom(await moveLiveRole(room,to));}catch(e){setRoom(await readRoom(room.id));throw e;}});
  }
  async function championSwapReply(requestId:string,accept:boolean) {
    if(!room || busy) return;
    await run(async()=>{
      try {setRoom(await respondPickSwap(room,requestId,accept));}
      catch(e){setRoom(await readRoom(room.id));throw e;}
    });
  }
  async function swapAction(targetOrRequest: string, accept?: boolean) {
    if (!room) return;
    await run(async () => {
      try {
        setRoom(
          accept === undefined
            ? await requestRoleSwap(room, targetOrRequest)
            : await respondRoleSwap(room, targetOrRequest, accept),
        );
      } catch (e) {
        setRoom(await readRoom(room.id));
        throw e;
      }
    });
  }
  async function run(fn: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      if (e instanceof RoomExpiredError) expireRoom();
      else setError(errorMessage(e));
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
  async function refreshAccount(next:Account){setAccount(next);setUid(next.id);if(next.profile?.display_name)setNickname(next.profile.display_name);}
  async function takeRole(role:Role|null){if(!room||busy)return;await run(async()=>{try{setRoom(await claimRole(room,role));}catch(e){setRoom(await readRoom(room.id));throw e;}});}
  async function handOver(target:string){if(!room||busy)return;const name=room.state.players.find(p=>p.id===target)?.name;if(!name||!confirm(`Make ${name} the host? You will lose host controls.`))return;await run(async()=>{try{setRoom(await transferHost(room,target));}catch(e){setRoom(await readRoom(room.id));throw e;}});}
  async function savePersonal(role:Role){if(!room||!account||busy)return;const me=room.state.players.find(p=>p.id===uid&&p.role===role);if(!me||!confirm(`Save these ${roleName(role)} candidates as your personal ${roleName(role)} pool?`))return;await run(async()=>{const profile=await saveRoomPool(role,me.pool,me.name);setAccount({...account,profile});setSync('Personal pool saved');});}
  async function historyAction(action:'undo'|'redo'|'open'|'guided'|'lobby'){
    if(action==='guided'&&!confirm('Restart guided draft from the beginning? Picks, bans and undo history will be cleared. Roles and candidates will stay.'))return;
    if(action==='lobby'&&!confirm('Return everyone to the lobby? Picks, bans and undo history will be cleared. Roles and allied candidates will stay.'))return;
    if(!room||busy)return;
    await run(async()=>{try{setRoom(await controlDraft(room,action));setPicker(null);setSwaps([]);setPickSwaps([]);}catch(e){setRoom(await readRoom(room.id));throw e;}});
  }
  useEffect(()=>{
    function shortcut(e:KeyboardEvent){
      if(!room||room.state.phase!=='live'||room.host_id!==uid||busy||picker||e.defaultPrevented||e.isComposing||e.altKey||!e.ctrlKey)return;
      const target=e.target;if(target instanceof HTMLElement&&(target.isContentEditable||target.closest('input,textarea,select,[contenteditable="true"],[role="textbox"],[role="dialog"]')))return;
      const action=e.key.toLowerCase()==='z'&&!e.shiftKey?'undo':e.key.toLowerCase()==='y'&&!e.shiftKey?'redo':null;
      if(action){e.preventDefault();if(action==='undo'?room.undo_count:room.redo_count)void historyAction(action);}
    }
    window.addEventListener('keydown',shortcut);return()=>window.removeEventListener('keydown',shortcut);
  },[room,uid,busy,picker]);
  const state = room?.state,
    host = room?.host_id === uid,
    readOnly=!!room&&!room.state.players.find(p=>p.id===uid)?.role&&!host,
    used = state ? unavailable(state) : new Set<string>();
  function expireRoom() {
    clearRoom();
    setError(new RoomExpiredError().message);
  }
  function clearRoom() {
    localStorage.removeItem("draftroom-current");
    localStorage.removeItem("draftroom-demo");
    if (room) {
      localStorage.removeItem(`draftroom-swaps-${room.id}`);
      localStorage.removeItem(`draftroom-pick-swaps-${room.id}`);
    }
    setRoom(null);
    setPicker(null);
    setInvite("");
    setInviteRoom(null);
    setSwaps([]);
    setPickSwaps([]);
    setOnline([]);
    clearStatisticsCache();
    document.title = "Draftroom";
    setSync("Not connected");
    history.replaceState(null, "", "/");

  }
  async function exitRoom() {
    if (!room || !confirm("Quit this room? Other participants will stay.")) return;
    await run(async () => {
      await leaveRoom(room);
      clearRoom();
    });
  }
  async function updateCandidates(team:Team,role:Role,pool:string[]){
    if(!room||busy)return;
    await run(async()=>{try{setRoom(await setCandidates(room,team,role,pool));}catch(e){setRoom(await readRoom(room.id));throw e;}});
  }
  function choose(id:string){
    if(!picker||!state)return;
    if(picker.kind==='candidates'){
      const pool=rolePool(state,picker.team,picker.role);
      if(!pool.includes(id))void updateCandidates(picker.team,picker.role,[...pool,id]);
      return;
    }
    const p=picker,slot=p.kind==='bans'?state.bans[p.team].indexOf(null):p.slot;
    if(slot<0)return;
    if(p.kind==='ban')setPicker(null);
    void change(s=>record(chooseBan(s,p.team,slot,id),`Ban · ${names[id]}`));
  }
  const pickerPool=picker&&state?picker.kind==='candidates'?rolePool(state,picker.team,picker.role):picker.kind==='bans'?state.bans[picker.team].filter((id):id is string=>!!id):[]:[];
  const link =
    room && invite
      ? `${location.origin}/rooms/${room.slug}/setup#${invite}`
      : "";
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
          <div className="account-home">{account?<><span>Signed in as <b>{account.profile?.display_name||account.email}</b></span><button title="Manage your private login, password, room display name and champion pools" disabled={busy} onClick={()=>setAccountOpen(true)}>My account</button>{(!account.loginName||!account.hasPassword)&&<span className="account-setup-hint">Open My account to set your login name and password. Your champion lists stay.</span>}<button title="Sign out before joining a room" disabled={busy} onClick={()=>void run(async()=>{await signOutAccount();setAccount(null);setUid(await identity());setNickname('');})}>Sign out</button></>:<button title="Optional account to keep your name and champion pools across visits" disabled={busy} onClick={()=>setAccountOpen(true)}>Sign in / Create account</button>}</div>
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

            {!inviteRoom&&<div className="draft-mode-choice" role="group" aria-label="Draft mode">{(['ranked','tournament'] as DraftMode[]).map(mode=><button type="button" key={mode} aria-pressed={draftMode===mode} onClick={()=>setDraftMode(mode)}>{mode==='ranked'?'Ranked draft':'Tournament draft'}</button>)}</div>}
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
                    const result = await createRoom(nickname.trim(),draftMode);
                    setRoom(result.room);
                    setInvite(result.token);
                    if (result.token)
                      history.replaceState(
                        null,
                        "",
                        `/rooms/${result.room.slug}/setup#${result.token}`,
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
            {!supabase&&<p className="muted">Local demo · saved on this browser only.</p>}
          </section>
        </main>
      ) : (
        <main>
          <div className="title-row">
            <div>
              <div className="eyebrow">
                {state!.phase === "setup" ? "Preparation" : "Draft"}
              </div>
              <h1>{room.name}</h1>
            </div>
            <div className="actions">
              {link && (
                <button title="Copy a private link so others can join this room"
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
                  className="primary" title="Start the draft for everyone, following the selected pick and ban order"
                  disabled={busy}
                  onClick={() =>
                    void change((s) => {
                      return record(startDraft(s), "Draft started");
                    })
                  }
                >
                  Start draft →
                </button>
              )}
              {host&&state!.phase==='live'&&!state!.openDraft&&<button disabled={busy} title="Pick and ban in any order." onClick={()=>void historyAction('open')}>Open draft</button>}
              {host&&state!.phase==='live'&&state!.openDraft&&<button title="Restart the guided draft from zero after confirmation; keep roles and candidate lists" disabled={busy} onClick={()=>void historyAction('guided')}>Guided draft</button>}
              {host&&state!.phase==='live'&&<button title="Clear all picks and bans, keeping roles, candidate lists and the current mode" disabled={busy} onClick={()=>void run(async()=>{
                try{setRoom(await clearDraft(room));setPicker(null);setSwaps([]);setPickSwaps([]);}catch(e){setRoom(await readRoom(room.id));throw e;}
              })}>Clear</button>}
              {host&&state!.phase==='live'&&<button title="Return everyone to preparation after confirmation and clear the current draft" disabled={busy} onClick={()=>void historyAction('lobby')}>Return to lobby</button>}
              {state!.players.find(p=>p.id===uid)?.role&&<button title="Leave your role and observe; your selected champion stays in its slot" disabled={busy} onClick={()=>void takeRole(null)}>Observe</button>}
              <button title="Leave this room personally; the others can continue" disabled={busy} onClick={() => void exitRoom()}>
                Quit room
              </button>
            </div>
          </div>
          <Participants
            players={state!.players}
            hostId={room.host_id} uid={uid} busy={busy} onTransfer={id=>void handOver(id)}
            online={online}
          />
          {readOnly&&<p className="observer-notice" role="status">You are observing. Take an available role to participate.</p>}
          {state!.phase === "setup" ? (
            <SetupPage
              state={state!}
              uid={uid}
              host={host} readOnly={readOnly}
              hostId={room.host_id}
              busy={busy}
              online={online}
              swaps={swaps}
              requestSwap={(id) => void swapAction(id)}
              change={change} claimRole={role=>void takeRole(role)} onSavePool={account?role=>void savePersonal(role):undefined}
              editPool={(team,role) => setPicker({kind:"candidates",team,role})}
              updatePool={(team,role,pool)=>void updateCandidates(team,role,pool)}
            />
          ) : (
            <DraftPage
              state={state!}
              uid={uid}
              host={host} readOnly={readOnly}
              busy={busy}
              change={change}
              setPicker={setPicker}
              undoCount={room.undo_count??0} redoCount={room.redo_count??0} onHistory={action=>void historyAction(action)}
              claimRole={role=>void takeRole(role)} onSavePool={account?role=>void savePersonal(role):undefined}
              onMove={championMove}
              onRoleMove={roleMove}
              pendingRoles={new Set([...pickSwaps,...swaps.filter(q=>q.phase==='live')].flatMap(r=>[r.from_role,r.to_role]))}
            />
          )}
        </main>
      )}
      {state &&
        swaps
          .filter((r) => (r.phase??'setup')===state.phase&&(r.target_id === uid || r.requester_id === uid))
          .slice(0, 1)
          .map((request) => (
            <SwapPrompt
              key={request.id}
              request={request}
              name={
                state.players.find(
                  (p) =>
                    p.id ===
                    (request.requester_id === uid
                      ? request.target_id
                      : request.requester_id),
                )?.name ?? "Player"
              }
              outgoing={request.requester_id === uid}
              busy={busy}
              onRespond={(accept) => void swapAction(request.id, accept)}
            />
          ))}
      {state?.phase === 'live' && pickSwaps.filter(r=>[r.requester_id,r.from_player_id,r.to_player_id].includes(uid)).slice(0,1).map(request=>(
        <PickSwapPrompt key={request.id} request={request} state={state} uid={uid} busy={busy} onRespond={accept=>void championSwapReply(request.id,accept)}/>
      ))}
      {!room&&accountOpen&&<AccountPanel account={account} onChange={next=>void refreshAccount(next)} onClose={()=>setAccountOpen(false)}/> }
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
            className={picker.kind==='candidates'?'modal pool-picker':'modal'}
            role="dialog" aria-modal="true" aria-label={picker.kind==='candidates'?'Edit candidates':'Choose champion'}
            onClick={e=>e.stopPropagation()}>
            <div className="section-heading">
              <h2>{picker.kind==='candidates'?`${roleName(picker.role)} candidates${picker.team==='enemy'?' · Enemy team':''}`:picker.kind==='bans'?`${picker.team==='ally'?'Ally':'Enemy'} bans · ${pickerPool.length}/5`:'Choose ban'}</h2>
              <button aria-label="Close" onClick={()=>setPicker(null)}>×</button>
            </div>
            {picker.kind!=='ban'&&<div className="pool-tiles">{pickerPool.map(id=><div className="pool-tile" key={id}>
              <Portrait id={id}/><button className="remove-champion" aria-label={`Remove ${names[id]} from ${picker.kind==='bans'?'bans':'pool'}`} disabled={busy}
                onClick={()=>picker.kind==='candidates'?void updateCandidates(picker.team,picker.role,pickerPool.filter(c=>c!==id)):void change(s=>chooseBan(s,picker.team,s.bans[picker.team].indexOf(id),null))}>×</button>
            </div>)}</div>}
            <Search catalogue={state?.roleCatalogue} initialRole={picker.kind==='candidates'?picker.role:undefined}
              pinned={picker.kind==='candidates'?state?.picks[picker.team].filter(p=>p.role===picker.role).map(p=>p.championId):[]}
              selected={pickerPool}
              blocked={picker.kind==='candidates'?new Set(pickerPool):state?.draftMode==='ranked'?new Set([...state.picks.ally,...state.picks.enemy].map(p=>p.championId).concat(state.bans[picker.team].filter((id):id is string=>!!id))):used}
              disabled={busy||picker.kind==='bans'&&pickerPool.length===5}
              onChoose={choose}
            />
          </section>
        </div>
      )}
    </div>
  );
}
