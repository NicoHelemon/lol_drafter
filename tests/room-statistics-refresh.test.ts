import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest';
import {initialState} from '../src/data/provider';
import {startDraft} from '../src/domain/progression';
import {DEMO_MODEL} from '../src/domain/shrinkage';
import type {Room,State} from '../src/domain/types';
const ids=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003'];
const a='a'.repeat(64),b='b'.repeat(64);let db:PGlite;
async function as<T>(uid:string,sql:string,args:unknown[]=[]){await db.exec('savepoint actor');await db.exec(`set role authenticated;set request.jwt.claim.sub='${uid}'`);try{return (await db.query<T>(sql,args)).rows[0];}catch(e){await db.exec('rollback to actor');throw e;}finally{await db.exec('reset role;release actor');}}
async function snapshot(id:string){
 const s=initialState(ids[0],'Host','ranked');const {pairs:_,...metadata}={...s.dataset,id:'snapshot-'+id,snapshotId:id,fictional:false};
 await db.query('insert into public.statistics_snapshots(id,metadata) values($1,$2::jsonb)',[id,JSON.stringify(metadata)]);
 await db.query("insert into public.statistics_shards values($1,'58:Top',$2::jsonb)",[id,JSON.stringify([{relation:'vs',candidateChampionId:'58',candidateRole:'Top',otherChampionId:'122',otherRole:'Top',delta2:1,games:1000}])]);
 await db.query('insert into public.statistics_calibrations(snapshot_id,model) values($1,$2::jsonb)',[id,JSON.stringify(DEMO_MODEL)]);
 await db.query('insert into public.statistics_role_catalogues(snapshot_id,catalogue) values($1,$2::jsonb)',[id,JSON.stringify(s.roleCatalogue)]);
 await db.query('update public.statistics_snapshots set ready=true where id=$1',[id]);
}
async function point(id:string){await db.query('insert into public.statistics_current values(true,$1) on conflict(singleton) do update set snapshot_id=excluded.snapshot_id',[id]);}
async function create(){const s=initialState(ids[0],'Host','ranked');return (await as<{r:Room}>(ids[0],'select public.create_room($1::jsonb,$2) r',[JSON.stringify(s),'s'.repeat(72)])).r;}
async function save(r:Room,s:State){return (await as<{r:Room}>(ids[0],'select public.save_room($1,$2,$3::jsonb) r',[r.id,r.version,JSON.stringify(s)])).r;}
async function refresh(r:Room,uid=ids[0],version:number|null=r.version){return (await as<{r:Room}>(uid,'select public.refresh_room_statistics($1,$2) r',[r.id,version])).r;}
async function control(r:Room,action:string){return (await as<{r:Room}>(ids[0],'select public.control_draft($1,$2,$3) r',[r.id,r.version,action])).r;}
async function exists(table:string,id:string){return (await db.query<{n:number}>(`select count(*)::int n from public.${table} where id=$1`,[id])).rows[0].n;}
beforeAll(async()=>{
 db=new PGlite();await db.exec("create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,is_anonymous boolean default true,email_confirmed_at timestamptz,email text,encrypted_password text,raw_user_meta_data jsonb);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;");
 for(const id of ids)await db.query('insert into auth.users(id) values($1)',[id]);
 for(const f of readdirSync('supabase/migrations').sort())await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));
},30000);
afterAll(()=>db.close());beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));
it('new rooms and lobby polling adopt the current shared dataset, including for observers, without changing candidates',async()=>{
 await snapshot(a);await snapshot(b);await point(a);let r=await create();expect(r.state.dataset.snapshotId).toBe(a);
 r=(await as<{r:Room}>(ids[1],'select public.join_room($1,$2,$3) r',[r.slug,'s'.repeat(72),'Observer'])).r;
 const before=structuredClone(r);await point(b);r=await refresh(r,ids[1],null);
 expect(r.version).toBe(before.version+1);expect(r.state.dataset.snapshotId).toBe(b);expect({...r.state,dataset:before.state.dataset}).toEqual(before.state);
 expect((await refresh(r,ids[1],null)).version).toBe(r.version);
 expect((await create()).state.dataset.snapshotId).toBe(b);
});
it('starting a draft and returning to the lobby adopt the latest publication atomically',async()=>{
 await snapshot(a);await snapshot(b);await point(a);let r=await create();await point(b);r=await save(r,startDraft(r.state));expect(r.state.dataset.snapshotId).toBe(b);
 await point(a);r=await control(r,'clear');expect(r.state.dataset.snapshotId).toBe(b);
 r=await control(r,'lobby');expect(r.state.phase).toBe('setup');expect(r.state.dataset.snapshotId).toBe(a);
});
it('live refresh is host-only, version checked, and preserves choices, roles and both history stacks',async()=>{
 await snapshot(a);await snapshot(b);await point(a);let r=await create();r=(await as<{r:Room}>(ids[1],'select public.join_room($1,$2,$3) r',[r.slug,'s'.repeat(72),'Observer'])).r;
 r=await save(r,startDraft(r.state));r=await control(r,'open');const s=structuredClone(r.state);s.picks.ally=[{role:'Top',championId:'58'}];s.picks.enemy=[{role:'Top',championId:'122'}];s.bans.ally[0]='103';r=await save(r,s);r=await control(r,'clear');
 const before=structuredClone(r);const timeline=(await db.query('select * from public.draft_timelines where room_id=$1',[r.id])).rows;await point(b);
 await expect(refresh(r,ids[1])).rejects.toThrow('Only the host');await expect(refresh(r,ids[2])).rejects.toThrow('Access denied');expect((await refresh(r,ids[1],null)).state.dataset.snapshotId).toBe(a);await expect(refresh(r,ids[0],r.version-1)).rejects.toThrow('Conflict');
 r=await refresh(r);expect(r.version).toBe(before.version+1);expect(r.state.dataset.snapshotId).toBe(b);expect({...r.state,dataset:before.state.dataset}).toEqual(before.state);expect((await db.query('select * from public.draft_timelines where room_id=$1',[r.id])).rows).toEqual(timeline);
 const observed=(await as<{state:State}>(ids[1],'select state from public.rooms where id=$1',[r.id])).state;expect(observed.dataset).toEqual(r.state.dataset);
 r=await control(r,'undo');expect(r.state.picks).toEqual(s.picks);expect(r.state.bans).toEqual(s.bans);expect(r.state.dataset.snapshotId).toBe(b);
});
it('publication and maintenance keep active drafts and their old snapshots editable beyond the retirement grace period',async()=>{
 await snapshot(a);await snapshot(b);await point(a);let r=await create();r=await save(r,startDraft(r.state));
 await point(b);await db.query("update public.statistics_snapshots set retired_at=now()-interval '2 hours' where id=$1",[a]);
 await db.query('select public.maintain_statistics(false)');expect(await exists('rooms',r.id)).toBe(1);expect(await exists('statistics_snapshots',a)).toBe(1);
 r=await control(r,'open');expect(r.state.dataset.snapshotId).toBe(a);
 await db.query("update public.rooms set created_at=now()-interval '25 hours' where id=$1",[r.id]);await db.query('select public.maintain_statistics(false)');expect(await exists('rooms',r.id)).toBe(0);expect(await exists('statistics_snapshots',a)).toBe(0);expect(await exists('statistics_snapshots',b)).toBe(1);
});
it('web clients cannot invoke internal dataset selection or the adoption trigger directly',async()=>{
 for(const role of ['anon','authenticated'])for(const fn of ['public.current_statistics_dataset()','public.adopt_lobby_statistics()'])expect((await db.query<{ok:boolean}>('select has_function_privilege($1,$2,\'execute\') ok',[role,fn])).rows[0].ok).toBe(false);
 expect((await db.query<{ok:boolean}>("select has_function_privilege('anon','public.refresh_room_statistics(uuid,integer)','execute') ok")).rows[0].ok).toBe(false);
});
