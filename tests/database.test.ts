import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {initialState} from '../src/data/provider';
import {place} from '../src/domain/state';
import type {Room,State} from '../src/domain/types';
let db:PGlite,room:Room;const ids=Array.from({length:6},(_,i)=>`00000000-0000-4000-8000-00000000000${i+1}`),token='a'.repeat(72);
async function as<T>(uid:string,sql:string,args:unknown[]=[]):Promise<T>{await db.exec(`set role authenticated; set request.jwt.claim.sub='${uid}';`);try{const r=await db.query<T>(sql,args);return r.rows[0];}finally{await db.exec('reset role');}}
const save=(uid:string,s:State,version=room.version)=>as<{r:Room}>(uid,'select to_jsonb(public.save_room($1,$2,$3::jsonb)) as r',[room.id,version,JSON.stringify(s)]);
beforeAll(async()=>{db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);for(const id of ids)await db.query('insert into auth.users values($1)',[id]);for(const file of readdirSync('supabase/migrations').sort())await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));const r=await as<{r:Room}>(ids[0],'select to_jsonb(public.create_room($1::jsonb,$2)) as r',[JSON.stringify(initialState(ids[0],'Host')),token]);room=r.r;},30000);
afterAll(()=>db.close());
it('joins five authenticated clients, reconnects same seat, rejects a sixth and bad invites',async()=>{await expect(as(ids[1],'select public.join_room($1,$2,$3)',[room.id,'bad','B'])).rejects.toThrow('Invitation');for(let i=1;i<5;i++){room=(await as<{r:Room}>(ids[i],'select to_jsonb(public.join_room($1,$2,$3)) as r',[room.id,token,`Player ${i}`])).r;}expect(room.state.players).toHaveLength(5);expect((await as<{r:Room}>(ids[1],'select to_jsonb(public.join_room($1,$2,$3)) as r',[room.id,token,'B'])).r.state.players).toHaveLength(5);await expect(as(ids[5],'select public.join_room($1,$2,$3)',[room.id,token,'Six'])).rejects.toThrow('complète');});
it('protects reads and table writes with RLS and grants',async()=>{const result=await as<{count:number}>(ids[5],'select count(*)::int as count from public.rooms');expect(result.count).toBe(0);await expect(as(ids[1],"update public.rooms set version=99")).rejects.toThrow('permission');await expect(as(ids[1],'select * from public.room_invites')).rejects.toThrow('permission');});
it('allows all members to edit, rejects stale concurrent updates and double picks/bans',async()=>{const a=place(room.state,'enemy','ADC','202');const stale=room.version;room=(await save(ids[2],a)).r;await expect(save(ids[3],place(a,'enemy','ADC','51'),stale)).rejects.toThrow('Conflit');await expect(as(ids[3],'select public.save_room($1,null,$2::jsonb)',[room.id,JSON.stringify(a)])).rejects.toThrow('Conflit');const b=structuredClone(room.state);b.bans.ally[0]='202';await expect(save(ids[3],b)).rejects.toThrow('déjà');room=(await save(ids[3],place(room.state,'enemy','Jungle','202'))).r;room=(await save(ids[4],place(room.state,'enemy','ADC','51'))).r;expect(room.state.picks.enemy).toHaveLength(2);for(const id of ids.slice(0,5)){const result=await as<{state:State}>(id,'select state from public.rooms where id=$1',[room.id]);expect(result.state.picks.enemy).toEqual(room.state.picks.enemy);}});
it('enforces host rights, unique seats, pool permissions and frozen datasets',async()=>{let s=structuredClone(room.state);s.side='red';await expect(save(ids[1],s)).rejects.toThrow('hôte');s=structuredClone(room.state);s.players[0].pool=['202'];await expect(save(ids[1],s)).rejects.toThrow('modifiable');s=structuredClone(room.state);s.players[1].role='Top';await expect(save(ids[1],s)).rejects.toThrow('Siège');s=structuredClone(room.state);const roles=['Top','Jungle','Mid','ADC','Support'] as const;s.players.forEach((p,i)=>{p.role=roles[i];p.pool=['58'];p.ready=true;});room=(await save(ids[0],s)).r;s=structuredClone(room.state);s.phase='live';room=(await save(ids[0],s)).r;s=structuredClone(room.state);s.dataset.id='changed';await expect(save(ids[0],s)).rejects.toThrow('figé');s=structuredClone(room.state);s.players[0].pool=['202'];room=(await save(ids[0],s)).r;expect(room.state.players[0].pool).toEqual(['202']);});

async function freshRoom(){return (await as<{r:Room}>(ids[0],'select public.create_room($1::jsonb,$2) as r',[JSON.stringify(initialState(ids[0],'Host')),token])).r;}
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
