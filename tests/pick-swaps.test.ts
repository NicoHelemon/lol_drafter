import { PGlite } from '@electric-sql/pglite';
import { readFileSync,readdirSync } from 'node:fs';
import { beforeAll,afterAll,beforeEach,afterEach,it,expect } from 'vitest';
import { initialState } from '../src/data/provider';
import { place } from '../src/domain/state';
import type { Room,State,PickSwapRequest,Role,Team } from '../src/domain/types';
let db:PGlite;
const ids=Array.from({length:4},(_,i)=>`00000000-0000-4000-8000-00000000000${i+1}`),token='a'.repeat(72);
async function as<T>(uid:string,sql:string,args:unknown[]=[]):Promise<T>{
 await db.exec('savepoint acting_identity');
 await db.exec(`set role authenticated;set request.jwt.claim.sub='${uid}'`);
 try{return (await db.query<T>(sql,args)).rows[0];}
 catch(e){await db.exec('rollback to acting_identity');throw e;}
 finally{await db.exec('reset role;release acting_identity');}
}
async function save(r:Room,state:State,uid=ids[0]){return (await as<{r:Room}>(uid,'select public.save_room($1,$2,$3::jsonb) r',[r.id,r.version,JSON.stringify(state)])).r;}
async function setup(empty=false,third=false){
 let r=(await as<{r:Room}>(ids[0],'select public.create_room($1::jsonb,$2) r',[JSON.stringify(initialState(ids[0],'Host')),token])).r;
 for(const i of third?[1,2]:[1])r=(await as<{r:Room}>(ids[i],'select public.join_room($1,$2,$3) r',[r.slug,token,`Player ${i}`])).r;
 let s=structuredClone(r.state);s.players[0].role='Top';s.players[0].pool=['58'];r=await save(r,s);
 s=structuredClone(r.state);s.players[1].role='Mid';s.players[1].pool=['103'];r=await save(r,s,ids[1]);
 s=structuredClone(r.state);s.phase='live';s.picks.ally=[{championId:'58',role:'Top'},...(empty?[]:[{championId:'103',role:'Mid' as const}])];
 s.picks.enemy=[{championId:'202',role:'Top'},{championId:'51',role:'Jungle'}];
 return save(r,s);
}
async function move(r:Room,team:Team='ally',from:Role='Top',to:Role='Mid',uid=ids[0],version=r.version){return(await as<{r:Room}>(uid,'select public.move_draft_pick($1,$2,$3,$4,$5) r',[r.id,team,from,to,version])).r;}
async function pending(r:Room){return as<PickSwapRequest>(ids[0],'select * from public.pick_swap_requests where room_id=$1',[r.id]);}
async function respond(r:Room,q:PickSwapRequest,accept=true,uid=ids[1]){return(await as<{r:Room}>(uid,'select public.respond_pick_swap($1,$2,$3) r',[r.id,q.id,accept])).r;}
async function fails(fn:()=>Promise<unknown>,message:string){await db.exec('savepoint expected_error');await expect(fn()).rejects.toThrow(message);await db.exec('rollback to expected_error');}
beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
 for(const id of ids)await db.query('insert into auth.users values($1)',[id]);
 for(const file of readdirSync('supabase/migrations').sort())await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));
},30000);
afterAll(()=>db.close());beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));

it('moves enemy selections immediately, swapping occupied roles without losing either champion',async()=>{
 let r=await setup();r=await move(r,'enemy','Top','Jungle');
 expect(r.state.picks.enemy).toEqual([{championId:'202',role:'Jungle'},{championId:'51',role:'Top'}]);
 expect(await pending(r)).toBeUndefined();
 r=await move(r,'enemy','Jungle','ADC');expect(r.state.picks.enemy).toContainEqual({championId:'202',role:'ADC'});
});
it('requires recipient consent, swaps only selected champions and preserves roles and pools',async()=>{
 let r=await setup();const before=structuredClone(r.state),old=r.version;
 r=await move(r);const q=await pending(r);
 expect(q).toMatchObject({from_accepted:true,to_accepted:false,from_champion_id:'58',to_champion_id:'103'});
 expect(r.state.picks).toEqual(before.picks);expect(r.version).toBe(old+1);
 await fails(()=>respond(r,q,true,ids[3]),'Access denied');
 r=await respond(r,q,true,ids[0]);expect(r.state.picks).toEqual(before.picks);
 r=await respond(r,q);
 expect(r.state.picks.ally).toEqual([{championId:'58',role:'Mid'},{championId:'103',role:'Top'}]);
 expect(r.state.players).toEqual(before.players);expect(r.state.dataset).toEqual(before.dataset);
 expect(await pending(r)).toBeUndefined();
});
it('lets an unselected recipient receive a champion and clears the sender selection',async()=>{
 let r=await move(await setup(true));const q=await pending(r);expect(q.to_champion_id).toBeNull();
 r=await respond(r,q);expect(r.state.picks.ally).toEqual([{championId:'58',role:'Mid'}]);
 expect(r.state.players.map(p=>p.role)).toEqual(['Top','Mid']);expect(r.state.players[0].pool).toEqual(['58']);
});
it('requires both players when a third member proposes the transfer',async()=>{
 let r=await setup(false,true);r=await move(r,'ally','Top','Mid',ids[2]);const q=await pending(r);
 expect(q).toMatchObject({from_accepted:false,to_accepted:false,requester_id:ids[2]});
 await fails(()=>respond(r,q,true,ids[2]),'affected players');
 r=await respond(r,q,true,ids[0]);expect(r.state.picks.ally[0]).toEqual({championId:'58',role:'Top'});
 expect(await pending(r)).toMatchObject({from_accepted:true,to_accepted:false});
 r=await respond(r,q,true,ids[1]);expect(r.state.picks.ally[0]).toEqual({championId:'58',role:'Mid'});
});
it('declines, cancels and expires without changing picks, and cannot reuse an approval',async()=>{
 let r=await setup();const picks=structuredClone(r.state.picks);
 r=await move(r);r=await respond(r,await pending(r),false);expect(r.state.picks).toEqual(picks);
 r=await move(r);r=await respond(r,await pending(r),false,ids[0]);expect(await pending(r)).toBeUndefined();
 r=await move(r);const q=await pending(r);
 await db.query("update public.pick_swap_requests set expires_at=clock_timestamp()-interval '1 second' where id=$1",[q.id]);
 r=await respond(r,q);expect(r.state.picks).toEqual(picks);expect(await pending(r)).toBeUndefined();
 r=await respond(r,q);expect(r.state.picks).toEqual(picks);
});
it('does not overwrite changed selections and preserves unrelated changes while approving',async()=>{
 let r=await move(await setup());const q=await pending(r);
 r=await save(r,place(r.state,'ally','Top','266'));expect(await pending(r)).toBeUndefined();
 r=await respond(r,q);expect(r.state.picks.ally.find(p=>p.role==='Top')?.championId).toBe('266');
 r=await move(r);const current=await pending(r);
 r=await move(r,'enemy','Top','Jungle');r=await respond(r,current);
 expect(r.state.picks.enemy).toEqual([{championId:'202',role:'Jungle'},{championId:'51',role:'Top'}]);
 expect(r.state.picks.ally.find(p=>p.role==='Mid')?.championId).toBe('266');
});
it('blocks generic save bypasses, forged flags, overlapping requests and direct approval writes',async()=>{
 let r=await setup();await db.exec("set local draftroom.pick_transfer='on'");
 await fails(()=>save(r,place(r.state,'ally','Mid','58')),'require consent');
 r=await move(r);const q=await pending(r);
 await fails(()=>as(ids[0],'update public.pick_swap_requests set to_accepted=true where id=$1',[q.id]),'permission');
 await fails(()=>move(r),'already pending');
 await fails(()=>save(r,place(r.state,'ally','Mid','58')),'require consent');
 expect((await as<{n:number}>(ids[3],'select count(*)::int n from public.pick_swap_requests where room_id=$1',[r.id])).n).toBe(0);
});
it('allows moves through unoccupied allied roles and rejects stale versions and setup-phase requests',async()=>{
 let r=await setup();const stale=r.version;
 r=await move(r,'ally','Top','Jungle');expect(await pending(r)).toBeUndefined();
 expect(r.state.picks.ally.find(p=>p.role==='Jungle')?.championId).toBe('58');
 await fails(()=>move(r,'enemy','Top','Mid',ids[0],stale),'Conflict');
 await db.query("update public.rooms set state=jsonb_set(state,'{phase}','\"setup\"') where id=$1",[r.id]);
 await fails(()=>move(r,'enemy','Top','Mid'),'during the draft');
});
it('cascades requests when a room expires and prunes them when a player leaves',async()=>{
 let r=await move(await setup());await as(ids[0],'select public.leave_room($1)',[r.id]);
 expect((await db.query<{n:number}>('select count(*)::int n from public.pick_swap_requests where room_id=$1',[r.id])).rows[0].n).toBe(0);
 r=await move(await setup(false,true),'ally','Top','Mid',ids[2]);await as(ids[2],'select public.leave_room($1)',[r.id]);expect(await pending(r)).toBeUndefined();
 r=await move(await setup());await db.query('delete from public.rooms where id=$1',[r.id]);
 expect((await db.query<{n:number}>('select count(*)::int n from public.pick_swap_requests where room_id=$1',[r.id])).rows[0].n).toBe(0);
});
