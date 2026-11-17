import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest';
import {initialState} from '../src/data/provider';
import {draftStages,stage,teamFor,advanceDraft,backDraft,startDraft,validateGuidedTransition,finishChoice,chooseBan,resetDraft} from '../src/domain/progression';
import {automaticPool} from '../src/domain/automaticCandidates';
import {setRolePool} from '../src/domain/rolePools';
import type {Room,State,DraftMode,Team} from '../src/domain/types';
const ids=Array.from({length:11},(_,i)=>`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
let db:PGlite;
async function as<T>(uid:string,sql:string,args:unknown[]=[]){await db.exec('savepoint actor');await db.exec(`set role authenticated;set request.jwt.claim.sub='${uid}'`);try{return (await db.query<T>(sql,args)).rows[0];}catch(e){await db.exec('rollback to actor');throw e;}finally{await db.exec('reset role;release actor');}}
const save=async(r:Room,s:State,uid=ids[0])=>(await as<{r:Room}>(uid,'select public.save_room($1,$2,$3::jsonb) r',[r.id,r.version,JSON.stringify(s)])).r;
async function room(mode:DraftMode,side:'blue'|'red'='blue'){const s=initialState(ids[0],'Host',mode);s.dataset.pairs=[];s.side=side;return (await as<{r:Room}>(ids[0],'select public.create_room($1::jsonb,$2) r',[JSON.stringify(s),'a'.repeat(72)])).r;}
async function fails(fn:()=>Promise<unknown>,message:string){await db.exec('savepoint expected');await expect(Promise.resolve().then(fn)).rejects.toThrow(message);await db.exec('rollback to expected');}
beforeAll(async()=>{db=new PGlite();await db.exec("create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;");for(const id of ids)await db.query('insert into auth.users values($1)',[id]);for(const f of readdirSync('supabase/migrations').filter(f=>f<'202611160018').sort())await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));},30000);
afterAll(()=>db.close());beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));
for(const mode of ['ranked','tournament'] as DraftMode[])for(const side of ['blue','red'] as const)it(`completes ${mode} on allied ${side}, with automatic choices, locks, role moves and backtracking`,async()=>{
 let r=await room(mode,side);r=await save(r,startDraft(r.state));let serial=100;
 while(stage(r.state)){
  const current=stage(r.state)!;let s=structuredClone(r.state);
  if(current.kind==='pick'){
   const team=teamFor(s,current.side!);const free=['Top','Jungle','Mid','ADC','Support'].filter(role=>!s.picks[team].some(p=>p.role===role));
   for(let i=0;i<current.count;i++)s.picks[team].push({role:free[i] as 'Top',championId:String(serial++)});
  }else if(current.kind==='ban')s.bans[teamFor(s,current.side!)][current.slot!]=String(serial++);
  else {s.bans.ally=['1','2','3','6','7'];s.bans.enemy=['1','4','5','8','9'];}
  const before=r.state;s=finishChoice(s);validateGuidedTransition(before,s,true);r=await save(r,s);expect(r.state.draftStep).toBe((before.draftStep??0)+1);
 }
 expect(r.state.picks.ally).toHaveLength(5);expect(r.state.picks.enemy).toHaveLength(5);
 let s=structuredClone(r.state);s.picks.ally[0].championId='999';await fails(()=>save(r,s),'Confirmed picks');
 s=structuredClone(r.state);const a=s.picks.ally[0].role;s.picks.ally[0].role=s.picks.ally[1].role;s.picks.ally[1].role=a;r=await save(r,s);
 r=await save(r,backDraft(r.state));expect(stage(r.state)?.side).toBe('red');
});
it('enforces opponent lobby privacy, immutable modes, host progression and no skipped stages',async()=>{
 let r=await room('ranked');await fails(()=>save(r,setRolePool(r.state,'enemy','Top',['58'])),'Enemy candidates');
 await fails(()=>save(r,{...r.state,draftMode:'tournament'}),'mode is fixed');
 await fails(()=>save(r,{...startDraft(r.state),picks:{ally:[{role:'Top',championId:'58'}],enemy:[]}}),'Start at');
 r=(await as<{r:Room}>(ids[1],'select public.join_room($1,$2,$3) r',[r.slug,'a'.repeat(72),'Guest'])).r;
 r=await save(r,startDraft(r.state));await fails(()=>save(r,{...r.state,draftStep:2,draftHistory:[{},{}] as never}),'one draft step');
 await fails(()=>save(r,advanceDraft(r.state),ids[1]),'Only the host');r=await save(r,advanceDraft(r.state));
 await fails(()=>save(r,advanceDraft(r.state)),'Complete the current');
 let s=structuredClone(r.state);s.picks.enemy=[{role:'Top',championId:'58'}];await fails(()=>save(r,s),'pick order');
 s=structuredClone(r.state);s.bans.ally[0]='64';await fails(()=>save(r,s),'ban order');
 await fails(()=>as(ids[2],'select public.save_room($1,$2,$3)',[r.id,r.version,r.state]),'Access denied');
});
it('honours tournament second ban phase red-first and bans cannot duplicate',async()=>{
 const stages=draftStages('tournament');expect(stages.filter(s=>s.kind==='ban').map(s=>`${s.side}:${s.slot}`)).toEqual(['blue:0','red:0','blue:1','red:1','blue:2','red:2','red:3','blue:3','red:4','blue:4']);
 let r=await room('tournament');r=await save(r,startDraft(r.state));let s=structuredClone(r.state);s.bans.enemy[0]='58';await fails(()=>save(r,s),'ban order');
 s=structuredClone(r.state);s.bans.ally[0]='58';r=await save(r,s);r=await save(r,advanceDraft(r.state));s=structuredClone(r.state);s.bans.enemy[0]='58';await fails(()=>save(r,s),'Champion already');
});
it('popular fallback only fills an empty explicit list and never mutates pools',()=>{
 let s=startDraft(initialState(ids[0],'P','ranked'));s=setRolePool(s,'ally','Top',['103']);const before=structuredClone(s);
 expect(automaticPool(s,'ally','Top')).toEqual(['103']);expect(s).toEqual(before);
 s=setRolePool(s,'ally','Top',[]);expect(automaticPool(s,'ally','Top')).toHaveLength(5);expect(automaticPool(s,'ally','Top').slice(0,3)).toEqual(['164','122','58']);
 s.bans.enemy[0]='164';s.picks.enemy=[{role:'Mid',championId:'122'}];const next=automaticPool(s,'ally','Top');expect(next).not.toContain('164');expect(next).not.toContain('122');expect(next).toHaveLength(5);
 s=setRolePool(s,'ally','Top',['103','164']);expect(automaticPool(s,'ally','Top')).toEqual(['103','164']);
});
it('keeps real role consent operational while picks are confirmed and step history stays fixed',async()=>{
 let r=await room('ranked');r=(await as<{r:Room}>(ids[1],'select public.join_room($1,$2,$3) r',[r.slug,'a'.repeat(72),'Guest'])).r;
 let s=structuredClone(r.state);s.players[0].role='Top';r=await save(r,s);s=structuredClone(r.state);s.players[1].role='Mid';r=await save(r,s,ids[1]);r=await save(r,startDraft(r.state));r=await save(r,advanceDraft(r.state));
 s=structuredClone(r.state);s.picks.ally=[{role:'Top',championId:'58'}];r=await save(r,s);r=await save(r,advanceDraft(r.state));
 s=structuredClone(r.state);s.picks.enemy=[{role:'Top',championId:'122'},{role:'Mid',championId:'84'}];r=await save(r,s);r=await save(r,advanceDraft(r.state));
 s=structuredClone(r.state);s.picks.ally.push({role:'Mid',championId:'103'});r=await save(r,s);const history=r.state.draftHistory;
 r=(await as<{r:Room}>(ids[0],'select public.move_live_role($1,$2,$3) r',[r.id,'Mid',r.version])).r;
 const q=(await db.query<{id:string}>('select id from public.role_swap_requests where room_id=$1',[r.id])).rows[0];
 r=(await as<{r:Room}>(ids[1],'select public.respond_role_swap($1,$2,true) r',[r.id,q.id])).r;
 expect(r.state.picks.ally).toContainEqual({role:'Mid',championId:'58'});expect(r.state.picks.ally).toContainEqual({role:'Top',championId:'103'});expect(r.state.draftHistory).toEqual(history);
});
it('rejects forged confirmations, edited checkpoints, draft-side changes and fractional steps',async()=>{
 let r=await room('ranked');r=await save(r,startDraft(r.state));
 let s=advanceDraft(r.state);s.bans.ally[0]='58';await fails(()=>save(r,s),'Invalid draft completion');
 r=await save(r,advanceDraft(r.state));s=structuredClone(r.state);s.side='red';await fails(()=>save(r,s),'Side is locked');
 s=structuredClone(r.state);s.draftHistory![0].picks.ally=['58'];await fails(()=>save(r,s),'history is locked');
 s=structuredClone(r.state);s.draftStep=1.5;await fails(()=>save(r,s),'Invalid draft step');
 const invalid=initialState(ids[0],'Old fixture');invalid.dataset.pairs=[];await fails(()=>as(ids[0],'select public.create_room($1::jsonb,$2)',[JSON.stringify(invalid),'z'.repeat(72)]),'Choose ranked');
});

it('lets an invited member complete a selection and advances only after both grouped picks',async()=>{
 let r=await room('ranked');r=(await as<{r:Room}>(ids[1],'select public.join_room($1,$2,$3) r',[r.slug,'a'.repeat(72),'Guest'])).r;
 r=await save(r,startDraft(r.state));r=await save(r,advanceDraft(r.state));
 let s=structuredClone(r.state);s.picks.ally=[{role:'Top',championId:'58'}];s=finishChoice(s);
 validateGuidedTransition(r.state,s,false);r=await save(r,s,ids[1]);expect(r.state.draftStep).toBe(2);
 s=structuredClone(r.state);s.picks.enemy=[{role:'Top',championId:'122'}];s=finishChoice(s);r=await save(r,s,ids[1]);expect(r.state.draftStep).toBe(2);
 s=structuredClone(r.state);s.picks.enemy.push({role:'Mid',championId:'103'});s=finishChoice(s);validateGuidedTransition(r.state,s,false);r=await save(r,s,ids[1]);expect(r.state.draftStep).toBe(3);
});
it('checks the old turn before locking an automatic checkpoint, including wrong bans and extra picks',async()=>{
 let r=await room('tournament');r=await save(r,startDraft(r.state));
 let s=structuredClone(r.state);s.bans.enemy[0]='58';s=advanceDraft(s);await fails(()=>save(r,s),'ban order');expect(()=>validateGuidedTransition(r.state,s,true)).toThrow('ban order');
 s=structuredClone(r.state);s.picks.ally=[{role:'Top',championId:'58'}];s=advanceDraft(s);await fails(()=>save(r,s),'pick order');
 r=await save(r,chooseBan(r.state,'ally',0,'58'));expect(r.state.draftStep).toBe(1);
 s=structuredClone(r.state);s.bans.ally[0]=null;s=advanceDraft(s);await fails(()=>save(r,s),'ban order');
});
for(const mode of ['ranked','tournament'] as DraftMode[])it(`clears a completed ${mode} atomically while preserving roles, explicit pools and statistics`,async()=>{
 let r=await room(mode,'red');r=await save(r,{...setRolePool(r.state,'ally','Top',['58','164']),players:[{...r.state.players[0],role:'Mid',pool:['103','84']}]});
 if(mode==='tournament')r=await save(r,setRolePool(r.state,'enemy','Top',['122']));
 r=await save(r,startDraft(r.state));let serial=200;
 while(stage(r.state)){
  const current=stage(r.state)!;let s=structuredClone(r.state);
  if(current.kind==='pick'){
   const team=teamFor(s,current.side!);for(const role of ['Top','Jungle','Mid','ADC','Support'] as const)if(s.picks[team].length<r.state.picks[team].length+current.count&&!s.picks[team].some(p=>p.role===role))s.picks[team].push({role,championId:String(serial++)});s=finishChoice(s);
  }else s=advanceDraft(s);
  r=await save(r,s);
 }
 const before=structuredClone(r),expected=resetDraft(r.state);
 r=(await as<{r:Room}>(ids[0],'select public.clear_draft($1,$2) r',[r.id,r.version])).r;
 expect(r.version).toBe(before.version+1);expect(r.state.picks).toEqual(expected.picks);expect(r.state.bans).toEqual(expected.bans);expect(r.state.draftHistory).toEqual([]);expect(r.state.draftStep).toBe(0);
 for(const key of ['players','rolePools','dataset','side','draftMode','phase'] as const)expect(r.state[key]).toEqual(before.state[key]);
 await fails(()=>as(ids[0],'select public.clear_draft($1,$2)',[r.id,before.version]),'Conflict');
});
it('restricts Clear to the host and removes pending consent without removing members',async()=>{
 let r=await room('ranked');r=(await as<{r:Room}>(ids[1],'select public.join_room($1,$2,$3) r',[r.slug,'a'.repeat(72),'Guest'])).r;
 await fails(()=>as(ids[0],'select public.clear_draft($1,$2)',[r.id,r.version]),'Start the draft');
 let s=structuredClone(r.state);s.players[0].role='Top';r=await save(r,s);s=structuredClone(r.state);s.players[1].role='Mid';r=await save(r,s,ids[1]);r=await save(r,startDraft(r.state));
 await fails(()=>as(ids[1],'select public.clear_draft($1,$2)',[r.id,r.version]),'Only the host');await fails(()=>as(ids[2],'select public.clear_draft($1,$2)',[r.id,r.version]),'Access denied');
 r=(await as<{r:Room}>(ids[0],'select public.move_live_role($1,$2,$3) r',[r.id,'Mid',r.version])).r;
 expect((await db.query('select * from public.role_swap_requests where room_id=$1',[r.id])).rows).toHaveLength(1);
 r=(await as<{r:Room}>(ids[0],'select public.clear_draft($1,$2) r',[r.id,r.version])).r;
 expect((await db.query('select * from public.role_swap_requests where room_id=$1',[r.id])).rows).toHaveLength(0);expect(r.state.players).toHaveLength(2);
 expect((await db.query('select * from public.room_members where room_id=$1',[r.id])).rows).toHaveLength(2);
});
const control=async(r:Room,action:string,uid=ids[0])=>(await as<{r:Room}>(uid,'select public.control_draft($1,$2,$3) r',[r.id,r.version,action])).r;
it('undoes and redoes individual choices and grouped turn boundaries without undoing candidate edits',async()=>{
 let r=await room('ranked');r=await save(r,startDraft(r.state));r=await save(r,advanceDraft(r.state));
 let s=structuredClone(r.state);s.picks.ally=[{role:'Top',championId:'58'}];r=await save(r,finishChoice(s));expect(r.undo_count).toBe(2);
 const picked=structuredClone(r.state);r=await save(r,setRolePool(r.state,'ally','Top',['58','164']));
 r=await control(r,'undo');expect(r.state.draftStep).toBe(1);expect(r.state.picks.ally).toEqual([]);expect(r.redo_count).toBe(1);expect(r.state.rolePools?.ally?.Top).toEqual(['58','164']);
 r=await control(r,'redo');expect(r.state.picks).toEqual(picked.picks);expect(r.state.draftHistory).toEqual(picked.draftHistory);
 s=structuredClone(r.state);s.picks.enemy=[{role:'Top',championId:'122'}];r=await save(r,finishChoice(s));const partial=structuredClone(r.state);
 s=structuredClone(r.state);s.picks.enemy.push({role:'Mid',championId:'103'});r=await save(r,finishChoice(s));expect(r.state.draftStep).toBe(3);
 r=await control(r,'undo');expect(r.state.draftStep).toBe(2);expect(r.state.picks).toEqual(partial.picks);r=await control(r,'redo');expect(r.state.draftStep).toBe(3);
 r=await control(r,'undo');s=structuredClone(r.state);s.picks.enemy.push({role:'Mid',championId:'84'});r=await save(r,finishChoice(s));expect(r.redo_count).toBe(0);await fails(()=>control(r,'redo'),'Nothing to redo');
});
it('Open draft discards guided history and retains choices through Clear/Undo/Redo until controlled restart',async()=>{
 let r=await room('tournament');r=await save(r,startDraft(r.state));r=await save(r,chooseBan(r.state,'ally',0,'58'));
 r=await control(r,'open');expect(r.state.openDraft).toBe(true);expect(r.state.bans.ally[0]).toBe('58');expect(r.undo_count).toBe(0);expect(r.redo_count).toBe(0);await fails(()=>control(r,'undo'),'Nothing to undo');
 let s=structuredClone(r.state);s.picks.enemy=[{role:'Support',championId:'25'}];r=await save(r,s);s=structuredClone(r.state);s.bans.enemy[4]='122';r=await save(r,s);
 r=await control(r,'undo');expect(r.state.bans.enemy[4]).toBeNull();expect(r.state.picks.enemy).toHaveLength(1);r=await control(r,'redo');const before=structuredClone(r.state);
 r=await control(r,'clear');expect(r.state.openDraft).toBe(true);expect(r.state.picks.enemy).toHaveLength(0);r=await control(r,'undo');expect(r.state.picks).toEqual(before.picks);expect(r.state.bans).toEqual(before.bans);expect(r.state.openDraft).toBe(true);
 s=structuredClone(r.state);s.openDraft=false;await fails(()=>save(r,s),'host restart control');await fails(()=>control(r,'open'),'already open');
});
it('keeps the restoration ticket private and controls host-only, member-only and versioned',async()=>{
 let r=await room('tournament');r=(await as<{r:Room}>(ids[1],'select public.join_room($1,$2,$3) r',[r.slug,'a'.repeat(72),'Guest'])).r;r=await save(r,startDraft(r.state));
 await fails(()=>control(r,'open',ids[1]),'Only the host');await fails(()=>control(r,'undo',ids[2]),'Access denied');await fails(()=>control(r,'bogus'),'Invalid draft control');
 await fails(()=>as(ids[0],"update public.draft_timelines set restoring=true where room_id=$1",[r.id]),'permission denied');await fails(()=>as(ids[0],"select * from public.draft_timelines"),'permission denied');
 const stale=r;r=await save(r,chooseBan(r.state,'ally',0,'58'));await fails(()=>control(stale,'undo'),'Conflict');expect(r.undo_count).toBe(1);
 r=await control(r,'undo');expect(r.state.draftStep).toBe(0);r=await control(r,'redo');expect(r.state.draftStep).toBe(1);
});
it('consented champion/role assignment changes establish a new history baseline',async()=>{
 let r=await room('ranked');r=await save(r,startDraft(r.state));r=await control(r,'open');let s=structuredClone(r.state);s.picks.enemy=[{role:'Top',championId:'122'}];r=await save(r,s);expect(r.undo_count).toBe(1);
 s=structuredClone(r.state);s.picks.enemy[0].role='Mid';r=await save(r,s);expect(r.undo_count).toBe(0);expect(r.redo_count).toBe(0);await fails(()=>control(r,'undo'),'Nothing to undo');
});
it('bounds shared choice history at sixty positions',async()=>{
 let r=await room('ranked');r=await save(r,startDraft(r.state));r=await control(r,'open');
 for(let i=0;i<65;i++){const s=structuredClone(r.state);s.bans.ally[0]=i%2?'58':'164';r=await save(r,s);}
 expect(r.undo_count).toBe(60);for(let i=0;i<60;i++)r=await control(r,'undo');expect(r.undo_count).toBe(0);expect(r.redo_count).toBe(60);await fails(()=>control(r,'undo'),'Nothing to undo');
});
it('restarts guided mode only through a host control and clears choices/history while keeping roles and candidates',async()=>{
 let r=await room('tournament','red');r=await save(r,setRolePool(r.state,'enemy','Top',['122']));r=await save(r,setRolePool(r.state,'ally','Mid',['103','84']));r=await save(r,startDraft(r.state));r=await control(r,'open');
 let s=structuredClone(r.state);s.picks.enemy=[{role:'Top',championId:'122'}];s.bans.ally[4]='58';r=await save(r,s);const before=structuredClone(r.state);
 r=await control(r,'guided');expect(r.state.openDraft).toBe(false);expect(r.state.phase).toBe('live');expect(r.state.draftStep).toBe(0);expect(r.state.picks).toEqual({ally:[],enemy:[]});expect(r.state.bans.ally.every(x=>x===null)).toBe(true);expect(r.undo_count).toBe(0);expect(r.redo_count).toBe(0);
 for(const key of ['players','rolePools','dataset','side','draftMode'] as const)expect(r.state[key]).toEqual(before[key]);await fails(()=>control(r,'undo'),'Nothing to undo');expect(stage(r.state)?.label).toContain('Blue team');
 r=await control(r,'lobby');expect(r.state.phase).toBe('setup');expect(r.state.rolePools).toEqual(before.rolePools);r=await save(r,startDraft(r.state));expect(r.state.phase).toBe('live');
});
it('returns ranked rooms to setup, retaining allies and clearing enemy preparation for the next game',async()=>{
 let r=await room('ranked');r=await save(r,setRolePool(r.state,'ally','Top',['58']));r=await save(r,startDraft(r.state));r=await control(r,'open');r=await save(r,setRolePool(r.state,'enemy','Mid',['103']));r=await control(r,'lobby');
 expect(r.state.phase).toBe('setup');expect(r.state.rolePools?.ally?.Top).toEqual(['58']);expect(r.state.rolePools?.enemy).toBeUndefined();expect(r.undo_count).toBe(0);
});
const join=async(r:Room,uid:string,observer=false)=>(await as<{r:Room}>(uid,'select public.join_room($1,$2,$3,$4) r',[r.slug,'a'.repeat(72),`Member ${uid.slice(-2)}`,observer])).r;
it('admits five players plus three observers, preserves undo when observers join, and rejects overflow',async()=>{
 let r=await room('tournament');for(const uid of ids.slice(1,5))r=await join(r,uid);
 await fails(()=>join(r,ids[5]),'Room is full');r=await save(r,startDraft(r.state));r=await save(r,chooseBan(r.state,'ally',0,'58'));const undo=r.undo_count;
 for(const uid of ids.slice(5,8))r=await join(r,uid,true);expect(r.state.players).toHaveLength(8);expect(r.state.players.filter(p=>(p as {observer?:boolean}).observer)).toHaveLength(3);expect(r.undo_count).toBe(undo);
 await fails(()=>join(r,ids[8],true),'Room is full');await fails(()=>join(r,ids[8]),'Draft already started');
 r=await control(r,'undo');expect(r.state.draftStep).toBe(0);expect(r.state.players).toHaveLength(8);
});
it('observers can read, heartbeat and quit, but every editing RPC and the private authorization helper are protected',async()=>{
 let r=await room('tournament');r=await join(r,ids[1],true);const spectator=ids[1];
 expect((await as<{n:number}>(spectator,'select count(*)::int n from public.rooms where id=$1',[r.id])).n).toBe(1);await as(spectator,'select public.heartbeat($1)',[r.id]);
 await fails(()=>save(r,setRolePool(r.state,'enemy','Top',['58']),spectator),'Observers can watch');await fails(()=>as(spectator,'select public.set_role_candidates($1,$2,$3,$4,$5)',[r.id,'enemy','Top',['58'],r.version]),'Observers can watch');
 for(const [rpc,args] of [['move_draft_pick',[r.id,'enemy','Top','Mid',r.version]],['move_live_role',[r.id,'Top',r.version]],['request_role_swap',[r.id,ids[0],r.version]],['respond_role_swap',[r.id,crypto.randomUUID(),true]],['respond_pick_swap',[r.id,crypto.randomUUID(),true]],['add_draft_candidate',[r.id,ids[0],'58',r.version]]] as [string,unknown[]][]){await fails(()=>as(spectator,`select public.${rpc}(${args.map((_,i)=>'$'+(i+1)).join(',')})`,args),'Observers can watch');}
 await fails(()=>as(spectator,'select public.assert_room_editor($1)',[r.id]),'permission denied');
 r=await save(r,startDraft(r.state));await fails(()=>control(r,'lobby',spectator),'Only the host');await as(spectator,'select public.leave_room($1)',[r.id]);const remaining=(await db.query<{state:State}>('select state from public.rooms where id=$1',[r.id])).rows[0].state;expect(remaining.players).toHaveLength(1);expect(remaining.players[0].id).toBe(ids[0]);
});
it('participant types cannot be forged and host departure prefers a player over an observer',async()=>{
 let r=await room('tournament');r=await join(r,ids[1],true);r=await join(r,ids[2]);let s=structuredClone(r.state);(s.players[1] as {observer?:boolean}).observer=false;await fails(()=>save(r,s),'Participant type is fixed');
 s=structuredClone(r.state);s.players[1].role='Top';await fails(()=>save(r,s),'Observers cannot occupy');await as(ids[0],'select public.leave_room($1)',[r.id]);const next=(await db.query<Room>('select * from public.rooms where id=$1',[r.id])).rows[0];expect(next.host_id).toBe(ids[2]);expect(next.state.players).toHaveLength(2);
});
