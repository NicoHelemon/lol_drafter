import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {initialState} from '../src/data/provider';
import {place} from '../src/domain/state';
import type {Room,State} from '../src/domain/types';
import {DEMO_MODEL} from '../src/domain/shrinkage';
import {StatisticsCache,persistedState,snapshotMetadata} from '../src/data/shared';
const ids=Array.from({length:6},(_,i)=>`00000000-0000-4000-8000-00000000000${i+1}`),token='a'.repeat(72);
let db:PGlite;
async function as<T>(uid:string,sql:string,args:unknown[]=[]):Promise<T>{await db.exec(`set role authenticated; set request.jwt.claim.sub='${uid}';`);try{return (await db.query<T>(sql,args)).rows[0];}finally{await db.exec('reset role');}}
async function create(name='Host'){return (await as<{r:Room}>(ids[0],'select public.create_room($1::jsonb,$2) as r',[JSON.stringify(initialState(ids[0],name)),token])).r;}
async function join(r:Room,i=1){return (await as<{r:Room}>(ids[i],'select public.join_room($1,$2,$3) as r',[r.slug,token,`Player ${i}`])).r;}
async function save(r:Room,s:State,uid=ids[0],version=r.version){return (await as<{r:Room}>(uid,'select public.save_room($1,$2,$3::jsonb) as r',[r.id,version,JSON.stringify(s)])).r;}
async function request(r:Room){return (await as<{r:Room}>(ids[0],'select public.request_role_swap($1,$2,$3) as r',[r.id,ids[1],r.version])).r;}
async function pending(r:Room){return (await as<{id:string;expires_at:string}>(ids[1],'select id,expires_at from public.role_swap_requests where room_id=$1',[r.id]));}
async function respond(r:Room,id:string,accept:boolean,uid=ids[1]){return (await as<{r:Room}>(uid,'select public.respond_role_swap($1,$2,$3) as r',[r.id,id,accept])).r;}
async function swapRoom(){let r=await join(await create());let s=structuredClone(r.state);s.players[0].role='Top';s.players[0].pool=['58'];r=await save(r,s);s=structuredClone(r.state);s.players[1].role='ADC';s.players[1].pool=['202','51'];return save(r,s,ids[1]);}
beforeAll(async()=>{db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);for(const id of ids)await db.query('insert into auth.users values($1)',[id]);for(const file of readdirSync('supabase/migrations').sort())await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));},30000);
afterAll(()=>db.close());
it('gives rooms a readable creator name and unique nonrandom slug',async()=>{const a=await create('Nico'),b=await create('Nico');expect(a.name).toBe("Nico's room");expect(a.slug).toBe('nicos-room');expect(b.slug).toBe('nicos-room-2');expect(a.id).not.toBe(a.slug);});
it('joins five identities through a private invitation and reconnects without duplicating a seat',async()=>{let r=await create();await expect(as(ids[1],'select public.join_room($1,$2,$3)',[r.slug,'bad','B'])).rejects.toThrow('Invalid invitation');for(let i=1;i<5;i++)r=await join(r,i);expect(r.state.players).toHaveLength(5);expect((await join(r,1)).state.players).toHaveLength(5);await expect(join(r,5)).rejects.toThrow('full');});
it('protects rooms, invitations and direct writes through RLS',async()=>{const r=await create();expect((await as<{n:number}>(ids[5],'select count(*)::int n from public.rooms where id=$1',[r.id])).n).toBe(0);await expect(as(ids[0],'update public.rooms set version=99 where id=$1',[r.id])).rejects.toThrow('permission');await expect(as(ids[0],'select * from public.room_invites')).rejects.toThrow('permission');});
it('rejects stale edits and duplicate picks or bans while allowing any member to enter picks',async()=>{let r=await join(await create());const old=r.version;r=await save(r,place(r.state,'enemy','ADC','202'),ids[1]);await expect(save(r,place(r.state,'enemy','ADC','51'),ids[0],old)).rejects.toThrow('Conflict');const s=structuredClone(r.state);s.bans.ally[0]='202';await expect(save(r,s)).rejects.toThrow('already used');r=await save(r,place(r.state,'enemy','Jungle','202'),ids[1]);r=await save(r,place(r.state,'enemy','ADC','51'));expect(r.state.picks.enemy).toHaveLength(2);});
it('lets only the host start immediately with no roles, pools or ready state, then freezes the dataset',async()=>{let r=await join(await create());const live={...r.state,phase:'live' as const};await expect(save(r,live,ids[1])).rejects.toThrow('Host-only');r=await save(r,live);expect(r.state.phase).toBe('live');expect(r.state.players.every(p=>p.pool.length===0&&p.role===null)).toBe(true);const changed=structuredClone(r.state);changed.dataset.id='other';await expect(save(r,changed)).rejects.toThrow('locked');});
it('releases membership on quit and transfers host controls without needing an exact state version',async()=>{let r=await join(await create());await expect(as(ids[5],'select public.leave_room($1)',[r.id])).rejects.toThrow('Access denied');await as(ids[0],'select public.leave_room($1)',[r.id]);r=await as<Room>(ids[1],'select * from public.rooms where id=$1',[r.id]);expect(r.host_id).toBe(ids[1]);expect(r.state.players.map(p=>p.id)).toEqual([ids[1]]);const live={...r.state,phase:'live' as const};r=await save(r,live,ids[1]);expect(r.state.phase).toBe('live');});
it('deletes the last player’s room, members, invitation and swap requests when everyone quits',async()=>{let r=await request(await swapRoom());await as(ids[0],'select public.leave_room($1)',[r.id]);await as(ids[1],'select public.leave_room($1)',[r.id]);for(const table of ['rooms','room_members','room_invites','role_swap_requests']){const key=table==='rooms'?'id':'room_id';expect((await db.query<{n:number}>(`select count(*)::int n from public.${table} where ${key}=$1`,[r.id])).rows[0].n).toBe(0);}});
it('requires the other player’s consent and preserves both pools when swapping roles',async()=>{let r=await swapRoom();const pools=r.state.players.map(p=>p.pool);const forced=structuredClone(r.state);forced.players[0].role='ADC';forced.players[1].role='Top';await expect(save(r,forced)).rejects.toThrow('swap');r=await request(r);const p=await pending(r);expect(Date.parse(p.expires_at)-Date.now()).toBeGreaterThan(0);expect(Date.parse(p.expires_at)-Date.now()).toBeLessThanOrEqual(5000);await expect(respond(r,p.id,true,ids[0])).rejects.toThrow('requested');r=await respond(r,p.id,true);expect(r.state.players.map(p=>p.role)).toEqual(['ADC','Top']);expect(r.state.players.map(p=>p.pool)).toEqual(pools);expect(await pending(r)).toBeUndefined();});
it('declines or cancels without changing roles and prevents competing requests',async()=>{let r=await request(await swapRoom());const p=await pending(r),roles=r.state.players.map(p=>p.role);await expect(as(ids[1],'select public.request_role_swap($1,$2,$3)',[r.id,ids[0],r.version])).rejects.toThrow('pending');r=await respond(r,p.id,false);expect(r.state.players.map(p=>p.role)).toEqual(roles);r=await request(r);r=await respond(r,(await pending(r)).id,false,ids[0]);expect(r.state.players.map(p=>p.role)).toEqual(roles);});
it('rejects an expired acceptance even if the popup did not send a decline',async()=>{let r=await request(await swapRoom());const p=await pending(r),roles=r.state.players.map(p=>p.role);await db.query("update public.role_swap_requests set expires_at=clock_timestamp()-interval '1 second' where id=$1",[p.id]);r=await respond(r,p.id,true);expect(r.state.players.map(p=>p.role)).toEqual(roles);expect(await pending(r)).toBeUndefined();});
it('starting the draft cancels pending swaps and a late response cannot swap roles',async()=>{let r=await request(await swapRoom());const p=await pending(r);r=await save(r,{...r.state,phase:'live'});expect(await pending(r)).toBeUndefined();r=await respond(r,p.id,true);expect(r.state.players.map(p=>p.role)).toEqual(['Top','ADC']);});
it('rejects picks without a role at the server boundary',async()=>{const r=await create();const s=JSON.parse(JSON.stringify(r.state));s.picks.enemy=[{championId:'202',role:null}];await expect(as(ids[0],'select public.save_room($1,$2,$3::jsonb)',[r.id,r.version,JSON.stringify(s)])).rejects.toThrow('Every pick must have a role');});
it('lets another room member add a live candidate without changing the actual pick or widening general pool permissions',async()=>{
 let r=await swapRoom();r=await save(r,{...r.state,phase:'live'});r=await save(r,place(r.state,'ally','Top','58'));const selected=structuredClone(r.state.picks),old=r.version;
 r=(await as<{r:Room}>(ids[1],'select public.add_draft_candidate($1,$2,$3,$4) as r',[r.id,ids[0],'266',r.version])).r;
 expect(r.state.players[0].pool).toContain('266');expect(r.state.picks).toEqual(selected);
 const duplicate=(await as<{r:Room}>(ids[1],'select public.add_draft_candidate($1,$2,$3,$4) as r',[r.id,ids[0],'266',r.version])).r;expect(duplicate.version).toBe(r.version);expect(duplicate.state.players[0].pool.filter(id=>id==='266')).toHaveLength(1);
 await expect(as(ids[1],'select public.add_draft_candidate($1,$2,$3,$4)',[r.id,ids[0],'164',old])).rejects.toThrow('Conflict');
 await expect(as(ids[5],'select public.add_draft_candidate($1,$2,$3,$4)',[r.id,ids[0],'164',r.version])).rejects.toThrow('Access denied');
 const next=structuredClone(r.state);next.players[0].pool=[];await expect(save(r,next,ids[1])).rejects.toThrow('cannot be edited');
});
it('rejects candidate additions in preparation or for an unoccupied role',async()=>{let r=await create();await expect(as(ids[0],'select public.add_draft_candidate($1,$2,$3,$4)',[r.id,ids[0],'266',r.version])).rejects.toThrow('during the draft');r=await save(r,{...r.state,phase:'live'});await expect(as(ids[0],'select public.add_draft_candidate($1,$2,$3,$4)',[r.id,ids[0],'266',r.version])).rejects.toThrow('assigned role');});

it('stores statistical pairs once across rooms and keeps only an immutable reference in each room',async()=>{
 const a=await create(),b=await create();const sid=a.state.dataset.snapshotId!;
 expect(sid).toMatch(/^[a-f0-9]{64}$/);expect(b.state.dataset.snapshotId).toBe(sid);
 expect(a.state.dataset.pairs).toEqual([]);expect(b.state.dataset.pairs).toEqual([]);
 const shard=(await as<{pairs:unknown[]}>(ids[0],'select pairs from public.statistics_shards where snapshot_id=$1 and candidate_key=$2',[sid,'58:Top'])).pairs;
 expect(shard.length).toBeGreaterThan(0);
 await expect(as(ids[0],"update public.statistics_shards set pairs='[]' where snapshot_id=$1",[sid])).rejects.toThrow('permission');
 await expect(db.query("update public.statistics_shards set pairs='[]' where snapshot_id=$1",[sid])).rejects.toThrow('immutable');
 await expect(db.query("update public.statistics_snapshots set metadata='{}' where id=$1",[sid])).rejects.toThrow('immutable');
});

it('rejects unknown or forged snapshot references and imports remain host-only',async()=>{
 let r=await join(await create());const bad=structuredClone(r.state);bad.dataset.snapshotId='f'.repeat(64);
 await expect(save(r,bad)).rejects.toThrow('Invalid shared');
 const fake=structuredClone(r.state);fake.dataset.source='Forged source';await expect(save(r,fake)).rejects.toThrow('Invalid shared');
 const inline={...r.state,dataset:initialState('x','X').dataset};inline.dataset.id='new-import';
 await expect(save(r,inline,ids[1])).rejects.toThrow('host-only');
 r=await save(r,inline);expect(r.state.dataset.id).toBe('new-import');expect(r.state.dataset.pairs).toEqual([]);
 expect(r.state.dataset.snapshotId).not.toBe(bad.dataset.snapshotId);
});

it('hides incomplete snapshots and makes them immutable only on completion',async()=>{
 const sid='c'.repeat(64),meta={...initialState('x','X').dataset,pairs:undefined,snapshotId:sid};
 await db.query('insert into public.statistics_snapshots(id,metadata) values($1,$2)',[sid,JSON.stringify(meta)]);
 await db.query("insert into public.statistics_shards values($1,'58:Top','[]')",[sid]);
 expect((await as<{n:number}>(ids[0],'select count(*)::int n from public.statistics_shards where snapshot_id=$1',[sid])).n).toBe(0);
 await db.query('update public.statistics_snapshots set ready=true where id=$1',[sid]);
 expect((await as<{n:number}>(ids[0],'select count(*)::int n from public.statistics_shards where snapshot_id=$1',[sid])).n).toBe(1);
 await expect(db.query("insert into public.statistics_shards values($1,'103:Mid','[]')",[sid])).rejects.toThrow('immutable');
});

it('hydrates from shared shards and lets a nonhost edit picks without sending the loaded statistical pairs',async()=>{
 let r=await join(await create());r.state.players[0].role='Top';r.state.players[0].pool=['58'];r=await save(r,r.state);
 const cache=new StatisticsCache(async(snapshot,keys)=>(await db.query<{candidate_key:string;pairs:State['dataset']['pairs']}>('select candidate_key,pairs from public.statistics_shards where snapshot_id=$1 and candidate_key=any($2::text[])',[snapshot,keys])).rows);
 const hydrated=await cache.hydrate(r);expect(hydrated.state.dataset.pairs.length).toBeGreaterThan(0);
 const edited=place(hydrated.state,'enemy','ADC','202');
 r=await save(r,persistedState(edited),ids[1]);expect(r.state.dataset.pairs).toEqual([]);expect(r.state.picks.enemy).toEqual([{championId:'202',role:'ADC'}]);
 expect((await cache.hydrate(r)).state.dataset.pairs.some(p=>p.candidateChampionId==='58')).toBe(true);
});

it('executes the Python publisher’s actual SQL and keeps the old pointer on an incomplete promotion',async()=>{
 // The fixture flag is changed ONLY in this isolated database test, never on Supabase.
 const plan=JSON.parse(execFileSync('python3',['-c',`
import sys,tempfile,pathlib,json
sys.path[:0]=['scripts/statistics','tests/statistics']
from pipeline import build
from publish import publish
from test_pipeline import fixture
data=fixture();data['fictional']=False
queries=[]
def execute(sql): queries.append(sql);return []
with tempfile.TemporaryDirectory() as folder:
 m=build(data,folder)
 result=publish(pathlib.Path(folder)/m['metadata']['snapshotId'],execute)
 print(json.dumps(dict(queries=queries,result=result)))
`],{encoding:'utf8'})) as {queries:string[];result:{snapshotId:string}};
 const before=(await db.query('select * from public.statistics_current')).rows;
 await db.exec(plan.queries.find(q=>q.startsWith('insert into public.statistics_snapshots'))!); // Deliberately leave shards missing.
 await expect(db.exec(plan.queries.at(-1)!)).rejects.toThrow('Incomplete snapshot');
 await db.exec('rollback');
 expect((await db.query('select * from public.statistics_current')).rows).toEqual(before);
 for(const sql of plan.queries)await db.exec(sql);
 expect((await db.query<{snapshot_id:string}>('select snapshot_id from public.statistics_current')).rows[0].snapshot_id).toBe(plan.result.snapshotId);
 expect((await db.query<{n:number}>('select count(*)::int n from public.statistics_shards where snapshot_id=$1',[plan.result.snapshotId])).rows[0].n).toBe(3);
});

it('publishes real source pairs locally and new rooms hydrate them while older rooms keep their snapshot',async()=>{
 const oldRoom=await create('Before real source'),oldSnapshot=oldRoom.state.dataset.snapshotId;
 const plan=JSON.parse(execFileSync('python3',['-c',`
import sys,tempfile,pathlib,json
sys.path.insert(0,'scripts/statistics')
from pipeline import build
from publish import publish
data=json.load(open('tests/fixtures/lolalytics-real-pairs.json'))
assert data['fictional'] is False
queries=[]
def execute(sql): queries.append(sql);return []
with tempfile.TemporaryDirectory() as folder:
 m=build(data,folder)
 result=publish(pathlib.Path(folder)/m['metadata']['snapshotId'],execute)
 print(json.dumps(dict(queries=queries,result=result)))
`],{encoding:'utf8'})) as {queries:string[];result:{snapshotId:string}};
 for(const sql of plan.queries)await db.exec(sql);
 // Match createRoom(): resolve current metadata as an authenticated client before the RPC.
 const current=await as<{metadata:unknown}>(ids[0],'select s.metadata from public.statistics_current c join public.statistics_snapshots s on s.id=c.snapshot_id');
 const state=initialState(ids[0],'Real source');state.dataset=snapshotMetadata(current.metadata);
 let r=(await as<{r:Room}>(ids[0],'select public.create_room($1::jsonb,$2) as r',[JSON.stringify(state),token])).r;
 expect(r.state.dataset.snapshotId).toBe(plan.result.snapshotId);
 expect(r.state.dataset.fictional).toBe(false);
 expect(r.state.dataset.pairs).toEqual([]);
 const previous=await as<{dataset:State['dataset']}>(ids[0],"select state->'dataset' dataset from public.rooms where id=$1",[oldRoom.id]);
 expect(previous.dataset.snapshotId).toBe(oldSnapshot);
 r.state.players[0].role='Top';r.state.players[0].pool=['58'];r=await save(r,r.state);
 const cache=new StatisticsCache(async(snapshot,keys)=>(await db.query<{candidate_key:string;pairs:State['dataset']['pairs']}>('select candidate_key,pairs from public.statistics_shards where snapshot_id=$1 and candidate_key=any($2::text[])',[snapshot,keys])).rows);
 const hydrated=await cache.hydrate(r);
 expect(hydrated.state.dataset.pairs.map(p=>p.delta2).sort((a,b)=>a!-b!)).toEqual([-0.1,2.09]);
 expect(persistedState(hydrated.state).dataset.pairs).toEqual([]);
});

it('protects calibrated models, hides incomplete ones, and cascades them with snapshot retention',async()=>{
 const sid='9'.repeat(64),meta={...initialState('x','X').dataset,pairs:undefined,snapshotId:sid};
 await db.query('insert into public.statistics_snapshots(id,metadata) values($1,$2)',[sid,JSON.stringify(meta)]);
 await expect(db.query('insert into public.statistics_calibrations values($1,$2)',[sid,'{}'])).rejects.toThrow('check');
 await db.query('insert into public.statistics_calibrations values($1,$2)',[sid,JSON.stringify(DEMO_MODEL)]);
 expect((await as<{n:number}>(ids[0],'select count(*)::int n from public.statistics_calibrations where snapshot_id=$1',[sid])).n).toBe(0);
 await expect(as(ids[0],'insert into public.statistics_calibrations values($1,$2)',[sid,JSON.stringify(DEMO_MODEL)])).rejects.toThrow('permission');
 await expect(db.query('update public.statistics_calibrations set model=$2 where snapshot_id=$1',[sid,JSON.stringify(DEMO_MODEL)])).rejects.toThrow('immutable');
 await db.query('delete from public.statistics_snapshots where id=$1',[sid]);
 expect((await db.query<{n:number}>('select count(*)::int n from public.statistics_calibrations where snapshot_id=$1',[sid])).rows[0].n).toBe(0);
 const ready=(await db.query<{snapshot_id:string}>('select snapshot_id from public.statistics_current')).rows[0].snapshot_id;
 expect((await as<{n:number}>(ids[0],'select count(*)::int n from public.statistics_calibrations where snapshot_id=$1',[ready])).n).toBe(1);
});
