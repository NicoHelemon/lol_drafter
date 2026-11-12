import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from 'vitest';
import { initialState } from '../src/data/provider';
import type { Room } from '../src/domain/types';

let db: PGlite;
const user = '00000000-0000-4000-8000-000000000001';
const guest = '00000000-0000-4000-8000-000000000002';
const a = 'a'.repeat(64), b = 'b'.repeat(64), c = 'c'.repeat(64);
async function snapshot(id: string, ready = true, age = '0 hours') {
  const metadata = { ...initialState(user, 'Host').dataset, id: 'retention-test', fictional: false, snapshotId: id };
  delete (metadata as { pairs?: unknown }).pairs;
  await db.query("insert into public.statistics_snapshots(id,metadata,created_at) values($1,$2::jsonb,now()-$3::interval)", [id, JSON.stringify(metadata), age]);
  await db.query("insert into public.statistics_shards values($1,'58:Top',$2::jsonb)", [id, JSON.stringify([
    {relation:'vs',candidateChampionId:'58',candidateRole:'Top',otherChampionId:'122',otherRole:'Top',delta2:0,games:1},
    {relation:'with',candidateChampionId:'58',candidateRole:'Top',otherChampionId:'64',otherRole:'Jungle',delta2:-.1,games:2},
  ])]);
  if (ready) await db.query('update public.statistics_snapshots set ready=true where id=$1', [id]);
  return metadata;
}
async function pointer(id: string) { await db.query('insert into public.statistics_current values(true,$1) on conflict(singleton) do update set snapshot_id=excluded.snapshot_id', [id]); }
async function room(id: string) {
  const metadata = (await db.query<{metadata:Room['state']['dataset']}>('select metadata from public.statistics_snapshots where id=$1', [id])).rows[0].metadata;
  const state = initialState(user, 'Host'); state.dataset = {...metadata, pairs:[]};
  await db.exec(`set request.jwt.claim.sub='${user}'`);
  return (await db.query<{r:Room}>('select public.create_room($1::jsonb,$2) r', [JSON.stringify(state), 'a'.repeat(72)])).rows[0].r;
}
async function maintain(dryRun = false) { return (await db.query<{r:{rooms:number;snapshots:number;shards:number;retired:number;dryRun:boolean}}>('select public.maintain_statistics($1) r', [dryRun])).rows[0].r; }
async function exists(table: string, id: string) { return (await db.query<{n:number}>(`select count(*)::int n from public.${table} where id=$1`, [id])).rows[0].n; }
async function fails(fn:() => Promise<unknown>, message:string) {
  await db.exec('savepoint expected_failure');
  await expect(fn()).rejects.toThrow(message);
  await db.exec('rollback to expected_failure');
}
async function ageRoom(r: Room, age: string, seen: string) {
  await db.query('update public.rooms set created_at=now()-$2::interval where id=$1', [r.id,age]);
  await db.query('update public.room_members set last_seen=now()-$2::interval where room_id=$1', [r.id,seen]);
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
  for (const id of [user, guest]) await db.query('insert into auth.users values($1)',[id]);
  for (const file of readdirSync('supabase/migrations').sort()) await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));
}, 30000);
afterAll(() => db.close());
beforeEach(() => db.exec('begin'));
afterEach(() => db.exec('rollback'));

it('protects the current snapshot even when old, empty of rooms and marked retired', async () => {
  await snapshot(a,true,'10 days'); await pointer(a);
  await db.query("update public.statistics_snapshots set retired_at=now()-interval '2 days' where id=$1",[a]);
  expect(await maintain()).toMatchObject({snapshots:0,shards:0});
  expect(await exists('statistics_snapshots',a)).toBe(1);
  await fails(() => db.query('delete from public.statistics_shards where snapshot_id=$1',[a]), 'immutable');
});

it('retires only the previous pointer, leaves the grace period, and atomically rolls retirement back on failure', async () => {
  await snapshot(a); await snapshot(b); await pointer(a);
  const r = await room(a);
  await pointer(b);
  expect((await db.query<{retired_at:unknown}>('select retired_at from public.statistics_snapshots where id=$1',[a])).rows[0].retired_at).not.toBeNull();
  expect((await maintain()).rooms).toBe(0);
  await db.query("update public.statistics_snapshots set retired_at=now()-interval '59 minutes' where id=$1",[a]);
  await maintain(); expect(await exists('rooms',r.id)).toBe(1);
  await db.exec('savepoint promotion');
  await pointer(a);
  await db.exec('rollback to promotion');
  expect((await db.query<{snapshot_id:string}>('select snapshot_id from public.statistics_current')).rows[0].snapshot_id).toBe(b);
  await db.query("update public.statistics_snapshots set retired_at=now()-interval '1 hour' where id=$1",[a]);
  expect(await maintain()).toMatchObject({rooms:1,snapshots:1,shards:1});
  expect(await exists('rooms',r.id)).toBe(0);
  expect(await exists('statistics_snapshots',b)).toBe(1);
});

it('expires rooms by last presence or absolute lifetime and cascades members, invites and swaps', async () => {
  await snapshot(a); await pointer(a);
  const stale = await room(a), live = await room(a), absolute = await room(a), boundary = await room(a);
  await ageRoom(stale,'3 hours','2 hours'); await ageRoom(live,'23 hours','1 minute');
  await ageRoom(absolute,'24 hours','0 seconds'); await ageRoom(boundary,'3 hours','119 minutes');
  await db.query('insert into public.room_members(room_id,user_id) values($1,$2)',[stale.id,guest]);
  // A single recently present member keeps the room alive.
  await maintain(); expect(await exists('rooms',stale.id)).toBe(1);
  await db.query("update public.room_members set last_seen=now()-interval '2 hours' where room_id=$1",[stale.id]);
  await db.query("insert into public.role_swap_requests(room_id,requester_id,target_id,from_role,to_role) values($1,$2,$3,'Top','Mid')",[stale.id,user,guest]);
  expect((await maintain()).rooms).toBe(1);
  expect(await exists('rooms',stale.id)).toBe(0);
  expect(await exists('rooms',absolute.id)).toBe(0);
  expect(await exists('rooms',live.id)).toBe(1);
  expect(await exists('rooms',boundary.id)).toBe(1);
  for (const table of ['room_members','room_invites','role_swap_requests']) expect((await db.query<{n:number}>(`select count(*)::int n from public.${table} where room_id=$1`,[stale.id])).rows[0].n).toBe(0);
});

it('previews without deleting or retiring anything, then purges only expired incomplete uploads', async () => {
  await snapshot(a,false,'24 hours'); await snapshot(b,false,'23 hours'); await snapshot(c);
  const before = (await db.query('select * from public.statistics_snapshots order by id')).rows;
  expect((await db.query<{r:unknown}>('select public.maintain_statistics() r')).rows[0].r).toMatchObject({dryRun:true,snapshots:1,shards:1,retired:1});
  expect((await db.query('select * from public.statistics_snapshots order by id')).rows).toEqual(before);
  expect(await maintain()).toMatchObject({snapshots:1,shards:1,retired:1});
  expect(await exists('statistics_snapshots',b)).toBe(1);
  expect(await exists('statistics_snapshots',c)).toBe(1);
  expect((await maintain()).snapshots).toBe(0);
});

it('retires unreferenced ready imports but retains a referenced nonretired snapshot', async () => {
  await snapshot(a); await snapshot(b); await room(a);
  expect((await maintain()).retired).toBe(1);
  expect((await db.query<{retired_at:unknown}>('select retired_at from public.statistics_snapshots where id=$1',[a])).rows[0].retired_at).toBeNull();
  await db.query("update public.statistics_snapshots set retired_at=now()-interval '1 hour' where id=$1",[b]);
  await maintain(); expect(await exists('statistics_snapshots',b)).toBe(0);
});

it('rejects new expired references and allows repromotion without altering pairs or metadata', async () => {
  await snapshot(a); await snapshot(b); await pointer(a); await pointer(b);
  await db.query("update public.statistics_snapshots set retired_at=now()-interval '1 hour' where id=$1",[a]);
  await fails(() => room(a), 'expired');
  await pointer(a); await room(a);
  await fails(() => db.query("update public.statistics_shards set pairs='[]' where snapshot_id=$1",[a]), 'immutable');
  await fails(() => db.query("update public.statistics_snapshots set ready=false where id=$1",[a]), 'immutable');
  await fails(() => db.query("update public.statistics_snapshots set metadata=metadata||'{\"source\":\"forged\"}',retired_at=now() where id=$1",[a]), 'immutable');
});

it('keeps maintenance and health inaccessible to web clients even with a forged maintenance setting', async () => {
  await snapshot(a); await pointer(a);
  for (const role of ['anon','authenticated']) {
    for (const fn of ['maintain_statistics(boolean)','statistics_health()']) expect((await db.query<{allowed:boolean}>('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,`public.${fn}`])).rows[0].allowed).toBe(false);
  }
  await db.exec("set role authenticated; set draftroom.maintenance='on'");
  await fails(() => db.exec('select public.maintain_statistics(false)'), 'permission');
  await fails(() => db.exec('select public.statistics_health()'), 'permission');
  await fails(() => db.query('delete from public.statistics_shards where snapshot_id=$1',[a]), 'permission');
  await db.exec('reset role');
});

it('returns current coverage and freshness without exposing room IDs, users or invitations', async () => {
  await snapshot(a); await pointer(a); await room(a);
  const health = (await db.query<{h:Record<string,unknown>}>('select public.statistics_health() h')).rows[0].h;
  expect(health).toMatchObject({snapshotId:a,shards:1,pairs:2,coverage:{vs:1,with:1},rooms:1,incomplete:0,retired:0});
  expect(JSON.stringify(health)).not.toContain(user);
});

it('rejects an incomplete pointer and preserves the previous pointer and retirement timestamp', async () => {
  await snapshot(a); await snapshot(b,false); await pointer(a);
  await fails(() => pointer(b), 'ready and real');
  expect((await db.query<{snapshot_id:string}>('select snapshot_id from public.statistics_current')).rows[0].snapshot_id).toBe(a);
  expect((await db.query<{retired_at:unknown}>('select retired_at from public.statistics_snapshots where id=$1',[a])).rows[0].retired_at).toBeNull();
});

it('applies 008 to a populated 007 database without deleting rooms or changing statistical contents', async () => {
  const prior = new PGlite();
  try {
    await prior.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select '${user}'::uuid$$;
      insert into auth.users values('${user}'); grant usage on schema auth to authenticated;`);
    for (const file of readdirSync('supabase/migrations').sort().filter(f => !f.includes('0008_'))) await prior.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));
    await prior.query('select public.create_room($1::jsonb,$2)',[JSON.stringify(initialState(user,'Before migration')),'a'.repeat(72)]);
    const rooms = (await prior.query('select * from public.rooms')).rows;
    const shards = (await prior.query('select * from public.statistics_shards order by candidate_key')).rows;
    const snapshots = (await prior.query('select id,metadata,ready,created_at from public.statistics_snapshots')).rows;
    await prior.exec(readFileSync('supabase/migrations/202611120008_statistics_retention.sql','utf8'));
    expect((await prior.query('select * from public.rooms')).rows).toEqual(rooms);
    expect((await prior.query('select * from public.statistics_shards order by candidate_key')).rows).toEqual(shards);
    expect((await prior.query('select id,metadata,ready,created_at from public.statistics_snapshots')).rows).toEqual(snapshots);
  } finally { await prior.close(); }
},30000);
