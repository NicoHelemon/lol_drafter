import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest';
import {initialState} from '../src/data/provider';
import {draftStages,stage,teamFor,advanceDraft,backDraft,startDraft,validateGuidedTransition,finishChoice,chooseBan,resetDraft} from '../src/domain/progression';
import {automaticPool} from '../src/domain/automaticCandidates';
import {setRolePool} from '../src/domain/rolePools';
import type {Room,State,DraftMode,Team} from '../src/domain/types';
const ids=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003'];
let db:PGlite;
async function as<T>(uid:string,sql:string,args:unknown[]=[]){await db.exec('savepoint actor');await db.exec(`set role authenticated;set request.jwt.claim.sub='${uid}'`);try{return (await db.query<T>(sql,args)).rows[0];}catch(e){await db.exec('rollback to actor');throw e;}finally{await db.exec('reset role;release actor');}}
const save=async(r:Room,s:State,uid=ids[0])=>(await as<{r:Room}>(uid,'select public.save_room($1,$2,$3::jsonb) r',[r.id,r.version,JSON.stringify(s)])).r;
async function room(mode:DraftMode,side:'blue'|'red'='blue'){const s=initialState(ids[0],'Host',mode);s.dataset.pairs=[];s.side=side;return (await as<{r:Room}>(ids[0],'select public.create_room($1::jsonb,$2) r',[JSON.stringify(s),'a'.repeat(72)])).r;}
async function fails(fn:()=>Promise<unknown>,message:string){await db.exec('savepoint expected');await expect(Promise.resolve().then(fn)).rejects.toThrow(message);await db.exec('rollback to expected');}
beforeAll(async()=>{db=new PGlite();await db.exec("create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;");for(const id of ids)await db.query('insert into auth.users values($1)',[id]);for(const f of readdirSync('supabase/migrations').sort())await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));},30000);
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
it('automatic candidates preserve explicit choices, fill to five available choices and do not mutate pools',()=>{
 let s=startDraft(initialState(ids[0],'P','ranked'));s=setRolePool(s,'ally','Top',['103']);const before=structuredClone(s);
 const first=automaticPool(s,'ally','Top');expect(first[0]).toBe('103');expect(first).toHaveLength(5);expect(first.slice(1,4)).toEqual(['164','122','58']);expect(s).toEqual(before);
 s.bans.enemy[0]='164';s.picks.enemy=[{role:'Mid',championId:'122'}];const next=automaticPool(s,'ally','Top');expect(next).not.toContain('164');expect(next).not.toContain('122');expect(next).toHaveLength(5);
 s=setRolePool(s,'ally','Top',['103','164']);expect(automaticPool(s,'ally','Top').length).toBe(6);
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
