import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest';
import {initialState} from '../src/data/provider';
import {place} from '../src/domain/state';
import {exchangeLiveRoles} from '../src/domain/roleSwaps';
import type {Room,State,Role,RoleSwapRequest} from '../src/domain/types';
const ids=Array.from({length:4},(_,i)=>`00000000-0000-4000-8000-00000000000${i+1}`),token='b'.repeat(72);
let db:PGlite;
async function as<T>(uid:string,sql:string,args:unknown[]=[]):Promise<T>{
 await db.exec('savepoint acting');await db.exec(`set role authenticated;set request.jwt.claim.sub='${uid}'`);
 try{return(await db.query<T>(sql,args)).rows[0];}catch(e){await db.exec('rollback to acting');throw e;}finally{await db.exec('reset role;release acting');}
}
const save=async(r:Room,s:State,uid=ids[0])=>(await as<{r:Room}>(uid,'select public.save_room($1,$2,$3::jsonb) r',[r.id,r.version,JSON.stringify(s)])).r;
async function setup(empty=false){
 let r=(await as<{r:Room}>(ids[0],'select public.create_room($1::jsonb,$2) r',[JSON.stringify(initialState(ids[0],'Host')),token])).r;
 r=(await as<{r:Room}>(ids[1],'select public.join_room($1,$2,$3) r',[r.slug,token,'Guest'])).r;
 let s=structuredClone(r.state);s.players[0].role='Top';s.players[0].pool=['58','164'];r=await save(r,s);
 s=structuredClone(r.state);s.players[1].role='Mid';s.players[1].pool=['103'];r=await save(r,s,ids[1]);
 s=structuredClone(r.state);s.phase='live';s.picks.ally=[{championId:'58',role:'Top'},...(empty?[]:[{championId:'103',role:'Mid' as const}]),{championId:'202',role:'Jungle'}];s.picks.enemy=[{championId:'122',role:'Top'},{championId:'84',role:'Mid'}];return save(r,s);
}
const move=async(r:Room,to:Role='Mid',uid=ids[0],version=r.version)=>(await as<{r:Room}>(uid,'select public.move_live_role($1,$2,$3) r',[r.id,to,version])).r;
const pending=(r:Room)=>as<RoleSwapRequest>(ids[0],'select * from public.role_swap_requests where room_id=$1',[r.id]);
const reply=async(r:Room,q:RoleSwapRequest,accept=true,uid=ids[1])=>(await as<{r:Room}>(uid,'select public.respond_role_swap($1,$2,$3) r',[r.id,q.id,accept])).r;
async function fails(fn:()=>Promise<unknown>,message:string){await db.exec('savepoint expected');await expect(fn()).rejects.toThrow(message);await db.exec('rollback to expected');}
beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
 for(const id of ids)await db.query('insert into auth.users values($1)',[id]);
 for(const file of readdirSync('supabase/migrations').sort())await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));
},30000);
afterAll(()=>db.close());beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));
it('carries each player, pool and selected champion after consent, preserving enemies and dataset',async()=>{
 let r=await setup();const before=structuredClone(r.state);r=await move(r);const q=await pending(r);
 expect(q).toMatchObject({phase:'live',from_champion_id:'58',to_champion_id:'103'});expect(r.state).toEqual(before);
 await fails(()=>reply(r,q,true,ids[0]),'requested player');await fails(()=>reply(r,q,true,ids[3]),'Access denied');
 r=await reply(r,q);expect(r.state).toEqual(exchangeLiveRoles(before,'Top','Mid'));expect(await pending(r)).toBeUndefined();
 r=await reply(r,q);expect(r.state.players.map(p=>p.role)).toEqual(['Mid','Top']);
});
it('moves into a free role, exchanging an anonymous selection without changing the opponent column',async()=>{
 let r=await setup();const before=structuredClone(r.state);r=await move(r,'Jungle');
 expect(r.state).toEqual(exchangeLiveRoles(before,'Top','Jungle'));expect(r.state.picks.ally).toContainEqual({championId:'202',role:'Top'});
 expect(r.state.picks.ally).toContainEqual({championId:'58',role:'Jungle'});expect(await pending(r)).toBeUndefined();
});
it('carries an empty selection too and preserves both owners pools',async()=>{
 let r=await move(await setup(true));const q=await pending(r);expect(q.to_champion_id).toBeNull();r=await reply(r,q);
 expect(r.state.picks.ally.some(p=>p.role==='Top')).toBe(false);expect(r.state.picks.ally).toContainEqual({championId:'58',role:'Mid'});
 expect(r.state.players.map(p=>p.pool)).toEqual([['58','164'],['103']]);
});
it('declines, cancels and expires without moving roles, and rejects stale room versions',async()=>{
 let r=await setup();const before=structuredClone(r.state),version=r.version;r=await move(r);
 await fails(()=>move(r,'Jungle',ids[0],version),'Conflict');r=await reply(r,await pending(r),false);expect(r.state).toEqual(before);
 r=await move(r);r=await reply(r,await pending(r),false,ids[0]);expect(await pending(r)).toBeUndefined();
 r=await move(r);const q=await pending(r);await db.query("update public.role_swap_requests set expires_at=clock_timestamp()-interval '1 second' where id=$1",[q.id]);r=await reply(r,q);expect(r.state).toEqual(before);
});
it('keeps unrelated edits but cancels a request if a concerned champion changes',async()=>{
 let r=await move(await setup());const q=await pending(r);
 r=await save(r,place(r.state,'enemy','Top','266'));r=await reply(r,q);
 expect(r.state.picks.enemy).toContainEqual({championId:'266',role:'Top'});
 r=await move(r,'Top');const next=await pending(r);r=await save(r,place(r.state,'ally','Mid','164'));
 expect(await pending(r)).toBeUndefined();const state=structuredClone(r.state);r=await reply(r,next);expect(r.state).toEqual(state);
});
it('blocks role/champion request overlaps, client approval writes and generic live role edits',async()=>{
 let r=await setup();await fails(()=>save(r,exchangeLiveRoles(r.state,'Top','Mid')),'Roles are locked');
 await fails(()=>save(r,exchangeLiveRoles(r.state,'Top','Jungle')),'Roles are locked');
 await db.exec("set local draftroom.role_swap='approved'");
 await fails(()=>db.query('update public.rooms set state=$2 where id=$1',[r.id,JSON.stringify(exchangeLiveRoles(r.state,'Top','Mid'))]),'require player consent');
 r=await move(r);const q=await pending(r);
 await fails(()=>as(ids[1],'update public.role_swap_requests set accepted=true where id=$1',[q.id]),'permission');
 await fails(()=>as(ids[0],"select public.move_draft_pick($1,'ally','Top','Mid',$2)",[r.id,r.version]),'role swap is already pending');
 await fails(()=>move(r,'Jungle'),'already pending');
 r=await reply(r,q,false);r=(await as<{r:Room}>(ids[0],"select public.move_draft_pick($1,'ally','Top','Mid',$2) r",[r.id,r.version])).r;
 await fails(()=>move(r),'champion swap is already pending');
});
it('cleans requests when a member quits or a room expires and leaves lobby rules operational',async()=>{
 let r=await move(await setup());await as(ids[1],'select public.leave_room($1)',[r.id]);expect(await pending(r)).toBeUndefined();
 r=await move(await setup());await db.query('delete from public.rooms where id=$1',[r.id]);expect((await db.query<{n:number}>('select count(*)::int n from public.role_swap_requests where room_id=$1',[r.id])).rows[0].n).toBe(0);
});
