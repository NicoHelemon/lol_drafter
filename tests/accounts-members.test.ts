import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest';
import {initialState} from '../src/data/provider';
import {startDraft} from '../src/domain/progression';
import {emptyPools} from '../src/lib/accounts';
import type {Room,State,AccountProfile,Role} from '../src/domain/types';
const ids=Array.from({length:13},(_,i)=>`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);let db:PGlite;
async function as<T>(uid:string,sql:string,args:unknown[]=[]){await db.exec('savepoint actor');await db.exec(`set role authenticated;set request.jwt.claim.sub='${uid}'`);try{return (await db.query<T>(sql,args)).rows[0];}catch(e){await db.exec('rollback to actor');throw e;}finally{await db.exec('reset role;release actor');}}
async function fails(fn:()=>Promise<unknown>,message:string){await expect(fn()).rejects.toThrow(message);}
const save=async(r:Room,s:State,uid=ids[0])=>(await as<{r:Room}>(uid,'select public.save_room($1,$2,$3::jsonb) r',[r.id,r.version,JSON.stringify(s)])).r;
const claim=async(r:Room,role:Role|null,uid=ids[0])=>(await as<{r:Room}>(uid,'select public.claim_role($1,$2,$3) r',[r.id,role,r.version])).r;
const control=async(r:Room,action:string,uid=ids[0])=>(await as<{r:Room}>(uid,'select public.control_draft($1,$2,$3) r',[r.id,r.version,action])).r;
const join=async(r:Room,uid:string)=>(await as<{r:Room}>(uid,'select public.join_room($1,$2,$3) r',[r.slug,'a'.repeat(72),'Guest'])).r;
async function room(){const s=initialState(ids[0],'Host','tournament');s.dataset.pairs=[];return(await as<{r:Room}>(ids[0],'select public.create_room($1::jsonb,$2) r',[JSON.stringify(s),'a'.repeat(72)])).r;}
const profile=async(uid:string,pools=emptyPools(),version=0)=>(await as<{p:AccountProfile}>(uid,'select public.save_my_profile($1,$2::jsonb,$3) p',['Nico',JSON.stringify(pools),version])).p;
beforeAll(async()=>{db=new PGlite();await db.exec("create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,is_anonymous boolean default true,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;");for(let i=0;i<ids.length;i++)await db.query('insert into auth.users values($1,$2,$3)',[ids[i],i>1,i<2?'2026-11-16T00:00:00Z':null]);for(const f of readdirSync('supabase/migrations').sort())await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));},30000);
afterAll(()=>db.close());beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));
it('keeps verified profiles private, versioned and distinct from anonymous identities',async()=>{
 await fails(()=>profile(ids[2]),'verified email');let p=await profile(ids[0],{...emptyPools(),Top:['58','164']});expect(p.version).toBe(1);
 expect((await as<{n:number}>(ids[0],'select count(*)::int n from public.user_profiles')).n).toBe(1);expect((await as<{n:number}>(ids[1],'select count(*)::int n from public.user_profiles')).n).toBe(0);
 await fails(()=>as(ids[1],"update public.user_profiles set display_name='Forged' where user_id=$1",[ids[0]]),'permission denied');await fails(()=>profile(ids[0],emptyPools(),0),'Conflict');
 p=await profile(ids[0],{...p.role_pools,Mid:['103']},1);expect(p.version).toBe(2);expect(p.role_pools.Top).toEqual(['58','164']);
 await fails(()=>profile(ids[0],{...emptyPools(),Top:['58','58']},2),'Invalid candidate pool');await fails(()=>as(ids[0],'select public.save_my_profile($1,$2,$3)',['Nico',{Bot:['58']},2]),'Invalid personal role pools');
});
it('loads personal role pools over room preparation, with no silent profile write from room edits',async()=>{
 await profile(ids[0],{...emptyPools(),Top:['58','164'],Mid:['103']});let r=await room();r=(await as<{r:Room}>(ids[0],'select public.set_role_candidates($1,$2,$3,$4,$5) r',[r.id,'ally','Top',['266'],r.version])).r;
 r=await claim(r,'Top');expect(r.state.players[0].pool).toEqual(['58','164']);expect(r.state.rolePools?.ally?.Top).toBeUndefined();
 r=(await as<{r:Room}>(ids[0],'select public.set_role_candidates($1,$2,$3,$4,$5) r',[r.id,'ally','Top',['58','164','516'],r.version])).r;
 const stored=(await as<{role_pools:AccountProfile['role_pools'];version:number}>(ids[0],'select role_pools,version from public.user_profiles')).role_pools;expect(stored.Top).toEqual(['58','164']);expect(stored.Mid).toEqual(['103']);
 const p=await profile(ids[0],{...stored,Top:r.state.players[0].pool},1);expect(p.role_pools.Top).toHaveLength(3);
});
it('changes role with the champion and imports the new role preferences, even an empty list',async()=>{
 await profile(ids[0],{...emptyPools(),Top:['58'],Mid:['103']});let r=await claim(await room(),'Top');r=await save(r,startDraft(r.state));r=await control(r,'open');let s=structuredClone(r.state);s.picks.ally=[{role:'Top',championId:'58'}];r=await save(r,s);
 r=(await as<{r:Room}>(ids[0],'select public.move_live_role($1,$2,$3) r',[r.id,'Mid',r.version])).r;expect(r.state.players[0].pool).toEqual(['103']);expect(r.state.picks.ally).toEqual([{role:'Mid',championId:'58'}]);
 r=(await as<{r:Room}>(ids[0],'select public.move_live_role($1,$2,$3) r',[r.id,'Support',r.version])).r;expect(r.state.players[0].pool).toEqual([]);expect(r.state.picks.ally[0].championId).toBe('58');
});
it('loads both role-specific profiles only after a consented live exchange',async()=>{
 await profile(ids[0],{...emptyPools(),Top:['58'],Mid:['7']});await profile(ids[1],{...emptyPools(),Top:['122'],Mid:['103']});let r=await room();r=await join(r,ids[1]);r=await claim(r,'Top');r=await claim(r,'Mid',ids[1]);r=await save(r,startDraft(r.state));r=await control(r,'open');let s=structuredClone(r.state);s.picks.ally=[{role:'Top',championId:'58'},{role:'Mid',championId:'103'}];r=await save(r,s);
 r=(await as<{r:Room}>(ids[0],'select public.move_live_role($1,$2,$3) r',[r.id,'Mid',r.version])).r;expect(r.state.players[0].role).toBe('Top');const q=(await db.query<{id:string}>('select id from public.role_swap_requests where room_id=$1',[r.id])).rows[0];
 r=(await as<{r:Room}>(ids[1],'select public.respond_role_swap($1,$2,true) r',[r.id,q.id])).r;expect(r.state.players[0].role).toBe('Mid');expect(r.state.players[0].pool).toEqual(['7']);expect(r.state.players[1].pool).toEqual(['122']);expect(r.state.picks.ally).toContainEqual({role:'Mid',championId:'58'});
});
it('admits ten participants without classes, derives observers from roles and allows a free role to be taken live',async()=>{
 let r=await room();r=await save(r,startDraft(r.state));r=await control(r,'open');for(const uid of ids.slice(1,10))r=await join(r,uid);expect(r.state.players).toHaveLength(10);expect(r.state.players.every(p=>p.role===null)).toBe(true);await fails(()=>join(r,ids[10]),'10 participants');
 await fails(()=>save(r,r.state,ids[2]),'Take a role');r=await claim(r,'Mid',ids[2]);r=(await as<{r:Room}>(ids[2],'select public.set_role_candidates($1,$2,$3,$4,$5) r',[r.id,'enemy','Top',['58'],r.version])).r;
 let s=structuredClone(r.state);s.picks.ally=[{role:'Mid',championId:'103'}];r=await save(r,s);r=await claim(r,null,ids[2]);expect(r.state.picks.ally).toContainEqual({role:'Mid',championId:'103'});r=await claim(r,'Mid',ids[3]);expect(r.state.players.find(p=>p.id===ids[3])?.role).toBe('Mid');await fails(()=>claim(r,'Mid',ids[4]),'Role already taken');
});
it('transfers hosting to any member including an observer without changing draft data',async()=>{
 let r=await room();r=await join(r,ids[2]);r=await claim(r,'Top');r=await save(r,startDraft(r.state));r=await control(r,'open');let s=structuredClone(r.state);s.picks.ally=[{role:'Top',championId:'58'}];r=await save(r,s);const before=structuredClone(r.state);
 await fails(()=>as(ids[2],'select public.transfer_host($1,$2,$3)',[r.id,ids[0],r.version]),'Only the host');await fails(()=>as(ids[0],'select public.transfer_host($1,$2,$3)',[r.id,ids[12],r.version]),'another room participant');
 r=(await as<{r:Room}>(ids[0],'select public.transfer_host($1,$2,$3) r',[r.id,ids[2],r.version])).r;expect(r.host_id).toBe(ids[2]);expect(r.state).toEqual(before);r=await control(r,'clear',ids[2]);await fails(()=>control(r,'clear',ids[0]),'Only the host');
});
it('blocks sign-in within room membership and preserves registered profiles when disposable rooms are deleted',async()=>{
 await profile(ids[0],{...emptyPools(),Top:['58']});expect((await as<{ok:boolean}>(ids[0],'select public.account_login_allowed() ok')).ok).toBe(true);const r=await room();expect((await as<{ok:boolean}>(ids[0],'select public.account_login_allowed() ok')).ok).toBe(false);
 await db.exec('delete from public.rooms');expect((await as<{n:number}>(ids[0],'select count(*)::int n from public.user_profiles')).n).toBe(1);expect((await as<{ok:boolean}>(ids[0],'select public.account_login_allowed() ok')).ok).toBe(true);
 await fails(()=>as(ids[0],'update public.account_features set email_login_ready=true'),'permission denied');expect((await as<{email_login_ready:boolean}>(ids[0],'select email_login_ready from public.account_features')).email_login_ready).toBe(false);expect(r.id).toBeTruthy();
});
