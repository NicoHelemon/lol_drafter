import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {initialState} from '../src/data/provider';
import {place} from '../src/domain/state';
import type {Room,State} from '../src/domain/types';
function hostState(){const s=initialState(ids[0],'Host');s.players[0].role='Top';s.players[0].pool=['58'];return s;}
let db:PGlite,room:Room;const ids=Array.from({length:6},(_,i)=>`00000000-0000-4000-8000-00000000000${i+1}`),token='a'.repeat(72);
async function as<T>(uid:string,sql:string,args:unknown[]=[]):Promise<T>{await db.exec(`set role authenticated; set request.jwt.claim.sub='${uid}';`);try{const r=await db.query<T>(sql,args);return r.rows[0];}finally{await db.exec('reset role');}}
const save=(uid:string,s:State,version=room.version)=>as<{r:Room}>(uid,'select to_jsonb(public.save_room($1,$2,$3::jsonb)) as r',[room.id,version,JSON.stringify(s)]);
beforeAll(async()=>{db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);for(const id of ids)await db.query('insert into auth.users values($1)',[id]);for(const file of readdirSync('supabase/migrations').sort())await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));const r=await as<{r:Room}>(ids[0],'select to_jsonb(public.create_room($1::jsonb,$2)) as r',[JSON.stringify(hostState()),token]);room=r.r;},30000);
afterAll(()=>db.close());
it('joins five authenticated clients, reconnects same seat, rejects a sixth and bad invites',async()=>{await expect(as(ids[1],'select public.join_room($1,$2,$3)',[room.id,'bad','B'])).rejects.toThrow('Invitation');for(let i=1;i<5;i++){room=(await as<{r:Room}>(ids[i],'select to_jsonb(public.join_room($1,$2,$3)) as r',[room.id,token,`Player ${i}`])).r;}expect(room.state.players).toHaveLength(5);expect((await as<{r:Room}>(ids[1],'select to_jsonb(public.join_room($1,$2,$3)) as r',[room.id,token,'B'])).r.state.players).toHaveLength(5);await expect(as(ids[5],'select public.join_room($1,$2,$3)',[room.id,token,'Six'])).rejects.toThrow('complète');});
it('protects reads and table writes with RLS and grants',async()=>{const result=await as<{count:number}>(ids[5],'select count(*)::int as count from public.rooms');expect(result.count).toBe(0);await expect(as(ids[1],"update public.rooms set version=99")).rejects.toThrow('permission');await expect(as(ids[1],'select * from public.room_invites')).rejects.toThrow('permission');});
it('allows all members to edit, rejects stale concurrent updates and double picks/bans',async()=>{const a=place(room.state,'enemy','ADC','202');const stale=room.version;room=(await save(ids[2],a)).r;await expect(save(ids[3],place(a,'enemy','ADC','51'),stale)).rejects.toThrow('Conflit');await expect(as(ids[3],'select public.save_room($1,null,$2::jsonb)',[room.id,JSON.stringify(a)])).rejects.toThrow('Conflit');const b=structuredClone(room.state);b.bans.ally[0]='202';await expect(save(ids[3],b)).rejects.toThrow('déjà');room=(await save(ids[3],place(room.state,'enemy','Jungle','202'))).r;room=(await save(ids[4],place(room.state,'enemy','ADC','51'))).r;expect(room.state.picks.enemy).toHaveLength(2);for(const id of ids.slice(0,5)){const result=await as<{state:State}>(id,'select state from public.rooms where id=$1',[room.id]);expect(result.state.picks.enemy).toEqual(room.state.picks.enemy);}});
it('enforces host rights, unique seats, pool permissions and frozen datasets',async()=>{let s=structuredClone(room.state);s.side='red';await expect(save(ids[1],s)).rejects.toThrow('hôte');s=structuredClone(room.state);s.players[0].pool=['202'];await expect(save(ids[1],s)).rejects.toThrow('modifiable');s=structuredClone(room.state);s.players[1].role='Top';await expect(save(ids[1],s)).rejects.toThrow('Siège');const roles=['Top','Jungle','Mid','ADC','Support'] as const;for(let i=0;i<5;i++){s=structuredClone(room.state);s.players[i].role=roles[i];s.players[i].pool=['58'];s.players[i].ready=true;room=(await save(ids[i],s)).r;}s=structuredClone(room.state);s.phase='live';room=(await save(ids[0],s)).r;s=structuredClone(room.state);s.dataset.id='changed';await expect(save(ids[0],s)).rejects.toThrow('figé');s=structuredClone(room.state);s.players[0].pool=['202'];room=(await save(ids[0],s)).r;expect(room.state.players[0].pool).toEqual(['202']);});

async function freshRoom(){return (await as<{r:Room}>(ids[0],'select public.create_room($1::jsonb,$2) as r',[JSON.stringify(hostState()),token])).r;}
it('ends a room before anyone is ready, restricts the action to the host and freezes edits',async()=>{
 const r=await freshRoom();const joined=(await as<{r:Room}>(ids[1],'select public.join_room($1,$2,$3) as r',[r.id,token,'Second'])).r;
 await expect(as(ids[1],'select public.end_room($1,$2)',[r.id,joined.version])).rejects.toThrow('Only the host');
 await expect(as(ids[0],'select public.end_room($1,$2)',[r.id,null])).rejects.toThrow('Conflict');
 const ended=(await as<{r:Room}>(ids[0],'select public.end_room($1,$2) as r',[r.id,joined.version])).r;expect(ended.state.phase).toBe('finished');
 const edited=place(ended.state,'enemy','ADC','202');await expect(as(ids[1],'select public.save_room($1,$2,$3::jsonb)',[r.id,ended.version,JSON.stringify(edited)])).rejects.toThrow('terminée');
});
it('releases a departing player’s membership and role, rejects outsiders and stale clients',async()=>{
 let r=await freshRoom();r=(await as<{r:Room}>(ids[1],'select public.join_room($1,$2,$3) as r',[r.id,token,'Second'])).r;
 const s=structuredClone(r.state);s.players[1].role='Jungle';s.players[1].pool=['64'];r=(await as<{r:Room}>(ids[1],'select public.save_room($1,$2,$3::jsonb) as r',[r.id,r.version,JSON.stringify(s)])).r;
 await expect(as(ids[5],'select public.leave_room($1,$2)',[r.id,r.version])).rejects.toThrow('Access denied');
 await expect(as(ids[1],'select public.leave_room($1,$2)',[r.id,r.version-1])).rejects.toThrow('Conflict');
 await as(ids[1],'select public.leave_room($1,$2)',[r.id,r.version]);
 expect((await as<{count:number}>(ids[1],'select count(*)::int as count from public.rooms where id=$1',[r.id])).count).toBe(0);
 r=(await as<{r:Room}>(ids[2],'select public.join_room($1,$2,$3) as r',[r.id,token,'Replacement'])).r;
 expect(r.state.players.map(p=>p.id)).toEqual([ids[0],ids[2]]);expect(r.state.players.some(p=>p.role==='Jungle')).toBe(false);
});
it('transfers host controls on departure and deletes the last player’s empty room',async()=>{
 let r=await freshRoom();r=(await as<{r:Room}>(ids[1],'select public.join_room($1,$2,$3) as r',[r.id,token,'Second'])).r;
 await as(ids[0],'select public.leave_room($1,$2)',[r.id,r.version]);
 r=await as<Room>(ids[1],'select * from public.rooms where id=$1',[r.id]);expect(r.host_id).toBe(ids[1]);expect(r.state.players).toHaveLength(1);
 r=(await as<{r:Room}>(ids[1],'select public.end_room($1,$2) as r',[r.id,r.version])).r;expect(r.state.phase).toBe('finished');
 await as(ids[1],'select public.leave_room($1,$2)',[r.id,r.version]);
 expect((await db.query<{count:number}>('select count(*)::int as count from public.rooms where id=$1',[r.id])).rows[0].count).toBe(0);
 expect((await db.query<{count:number}>('select count(*)::int as count from public.room_invites where room_id=$1',[r.id])).rows[0].count).toBe(0);
});

async function swapRoom(){
 let r=await freshRoom();r=(await as<{r:Room}>(ids[1],'select public.join_room($1,$2,$3) as r',[r.id,token,'Second'])).r;
 const s=structuredClone(r.state);s.players[1].role='ADC';s.players[1].pool=['202','51'];s.players[1].ready=true;
 r=(await as<{r:Room}>(ids[1],'select public.save_room($1,$2,$3::jsonb) as r',[r.id,r.version,JSON.stringify(s)])).r;
 return r;
}
async function pendingSwap(r:Room){return (await as<{id:string}>(ids[1],'select id from public.role_swap_requests where room_id=$1',[r.id]))?.id;}
it('requires consent from the target, atomically swaps roles and preserves each player’s pool',async()=>{
 let r=await swapRoom();const original=structuredClone(r.state.players);
 const forced=structuredClone(r.state);forced.players[0].role='ADC';forced.players[1].role='Top';
 await expect(as(ids[0],'select public.save_room($1,$2,$3::jsonb)',[r.id,r.version,JSON.stringify(forced)])).rejects.toThrow('request a swap');
 r=(await as<{r:Room}>(ids[0],'select public.request_role_swap($1,$2,$3) as r',[r.id,ids[1],r.version])).r;
 const requestId=await pendingSwap(r);
 await expect(as(ids[0],'select public.respond_role_swap($1,$2,true,$3)',[r.id,requestId,r.version])).rejects.toThrow('Only the requested');
 await expect(as(ids[5],'select * from public.role_swap_requests where room_id=$1',[r.id])).resolves.toBeUndefined();
 r=(await as<{r:Room}>(ids[1],'select public.respond_role_swap($1,$2,true,$3) as r',[r.id,requestId,r.version])).r;
 expect(r.state.players.map(p=>p.role)).toEqual(['ADC','Top']);expect(r.state.players.map(p=>p.pool)).toEqual(original.map(p=>p.pool));expect(r.state.players.every(p=>!p.ready)).toBe(true);
 expect(await pendingSwap(r)).toBeUndefined();
});
it('supports decline and cancellation, rejects conflicting requests and stale versions',async()=>{
 let r=await swapRoom();const roles=r.state.players.map(p=>p.role);
 await expect(as(ids[0],'select public.request_role_swap($1,$2,$3)',[r.id,ids[1],-1])).rejects.toThrow('Conflict');
 await expect(as(ids[5],'select public.request_role_swap($1,$2,$3)',[r.id,ids[1],r.version])).rejects.toThrow('Access denied');
 r=(await as<{r:Room}>(ids[0],'select public.request_role_swap($1,$2,$3) as r',[r.id,ids[1],r.version])).r;let requestId=await pendingSwap(r);
 await expect(as(ids[1],'select public.request_role_swap($1,$2,$3)',[r.id,ids[0],r.version])).rejects.toThrow('already pending');
 await expect(as(ids[1],'update public.role_swap_requests set to_role=$1',['Jungle'])).rejects.toThrow('permission');
 r=(await as<{r:Room}>(ids[1],'select public.respond_role_swap($1,$2,false,$3) as r',[r.id,requestId,r.version])).r;expect(r.state.players.map(p=>p.role)).toEqual(roles);
 r=(await as<{r:Room}>(ids[0],'select public.request_role_swap($1,$2,$3) as r',[r.id,ids[1],r.version])).r;requestId=await pendingSwap(r);
 r=(await as<{r:Room}>(ids[0],'select public.respond_role_swap($1,$2,false,$3) as r',[r.id,requestId,r.version])).r;
 expect(r.state.players.map(p=>p.role)).toEqual(roles);
});
it('blocks draft start with pending swaps and removes a request when roles change or a participant leaves',async()=>{
 let r=await swapRoom();const s=structuredClone(r.state);s.players[0].ready=true;r=(await as<{r:Room}>(ids[0],'select public.save_room($1,$2,$3::jsonb) as r',[r.id,r.version,JSON.stringify(s)])).r;
 r=(await as<{r:Room}>(ids[0],'select public.request_role_swap($1,$2,$3) as r',[r.id,ids[1],r.version])).r;
 const live={...r.state,phase:'live'};await expect(as(ids[0],'select public.save_room($1,$2,$3::jsonb)',[r.id,r.version,JSON.stringify(live)])).rejects.toThrow('pending role swaps');
 const moved=structuredClone(r.state);moved.players[0].role='Jungle';moved.players[0].ready=false;r=(await as<{r:Room}>(ids[0],'select public.save_room($1,$2,$3::jsonb) as r',[r.id,r.version,JSON.stringify(moved)])).r;
 expect(await pendingSwap(r)).toBeUndefined();
 r=(await as<{r:Room}>(ids[0],'select public.request_role_swap($1,$2,$3) as r',[r.id,ids[1],r.version])).r;
 await as(ids[1],'select public.leave_room($1,$2)',[r.id,r.version]);
 expect((await as<{n:number}>(ids[0],'select count(*)::int as n from public.role_swap_requests where room_id=$1',[r.id])).n).toBe(0);
});
