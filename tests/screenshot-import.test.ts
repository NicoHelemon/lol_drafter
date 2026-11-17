import {it,expect,beforeAll,afterAll,beforeEach,afterEach} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {initialState} from '../src/data/provider';
import {startDraft} from '../src/domain/progression';
import {controlLocalDraft} from '../src/domain/draftHistory';
import {importLocalScreenshot,mergeScreenshot,proposeScreenshot,proposalAdditions,type ScreenshotReading,type ScreenshotAdditions} from '../src/domain/screenshot';
import type {Room,State} from '../src/domain/types';

const empty=():ScreenshotAdditions=>({picks:{ally:[],enemy:[]},bans:{ally:[],enemy:[]}});
const additions=():ScreenshotAdditions=>({picks:{ally:[{championId:'103',role:'Top'},{championId:'64',role:'Jungle'}],enemy:[{championId:'84',role:'Mid'}]},bans:{ally:[{slot:0,championId:'157'}],enemy:[{slot:2,championId:'238'}]}});
function state(){const s=startDraft(initialState('host','Host','ranked'));s.picks.ally=[{championId:'58',role:'Mid'}];s.bans.ally[4]='3';return s;}
it('preserves manual Renekton Mid, excludes hover/picking states and jointly assigns only free roles',()=>{
 const s=state();s.roleCatalogue!.entries=[{championId:'103',role:'Mid',games:10000,pickPercent:10,lanePercent:99},{championId:'103',role:'Top',games:100,pickPercent:1,lanePercent:1},{championId:'64',role:'Jungle',games:10000,pickPercent:10,lanePercent:99}];
 const reading:ScreenshotReading={width:960,height:540,box:[0,0,960,540],bans:[],slots:[
  {team:'ally',slot:1,championId:'58',role:'Top',status:'locked',similarity:.9,margin:.2},
  {team:'ally',slot:2,championId:'103',status:'locked',similarity:.9,margin:.2},
  {team:'ally',slot:3,championId:'64',status:'locked',similarity:.9,margin:.2},
  {team:'enemy',slot:1,championId:'157',status:'hover',similarity:.9,margin:.2},
  {team:'enemy',slot:2,championId:'238',status:'picking',similarity:.9,margin:.2}]};
 const before=structuredClone(s),p=proposeScreenshot(s,reading),next=mergeScreenshot(s,proposalAdditions(p));
 expect(next.picks.ally).toContainEqual({championId:'58',role:'Mid'});expect(next.picks.ally).toContainEqual({championId:'103',role:'Top'});expect(next.picks.ally).toContainEqual({championId:'64',role:'Jungle'});expect(next.picks.enemy).toEqual([]);expect(p.pending).toBe(2);expect(s).toEqual(before);
});
it('only fills empty ban positions, keeps existing choices, and allows the same ranked ban on opposite teams',()=>{
 const s=state(),r:ScreenshotReading={slots:[],box:[],width:960,height:540,bans:[{team:'ally',slot:5,championId:'157',similarity:1,margin:1},{team:'enemy',slot:1,championId:'3',similarity:1,margin:1},{team:'enemy',slot:2,championId:'58',similarity:1,margin:1}]};
 const p=proposeScreenshot(s,r);expect(p.bans).toHaveLength(1);expect(p.bans[0].championId).toBe('3');expect(p.notes.length).toBeGreaterThan(0);
 expect(mergeScreenshot(s,proposalAdditions(p)).bans.enemy[0]).toBe('3');
});
it('keeps candidate lists and roles intact, groups import history and keeps Open draft through Undo and Redo',()=>{
 const s=state();s.players[0].role='Mid';s.players[0].pool=['58','112'];const room:Room={id:'room',slug:'room',name:'Room',host_id:'host',version:8,state:s};
 const imported=importLocalScreenshot(room,additions());expect(imported.version).toBe(9);expect(imported.undo_count).toBe(1);expect(imported.state.openDraft).toBe(true);expect(imported.state.players).toEqual(s.players);
 const undone=controlLocalDraft(imported,'undo');expect(undone.state.picks).toEqual(s.picks);expect(undone.state.bans).toEqual(s.bans);expect(undone.state.openDraft).toBe(true);
 expect(controlLocalDraft(undone,'redo').state.picks).toEqual(imported.state.picks);
 expect(()=>mergeScreenshot(s,empty())).toThrow('No new');const bad=additions();bad.picks.ally[0].role='Mid';expect(()=>mergeScreenshot(s,bad)).toThrow('cannot be overwritten');
});

const ids=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003'];let db:PGlite;
async function as<T>(uid:string,sql:string,args:unknown[]=[]){await db.exec('savepoint actor');await db.exec(`set role authenticated;set request.jwt.claim.sub='${uid}'`);try{return (await db.query<T>(sql,args)).rows[0];}catch(e){await db.exec('rollback to actor');throw e;}finally{await db.exec('reset role;release actor');}}
const save=async(r:Room,s:State)=>(await as<{r:Room}>(ids[0],'select public.save_room($1,$2,$3::jsonb) r',[r.id,r.version,JSON.stringify(s)])).r;
async function room(){const s=initialState(ids[0],'Host','ranked');s.dataset.pairs=[];let r=(await as<{r:Room}>(ids[0],'select public.create_room($1::jsonb,$2) r',[JSON.stringify(s),'s'.repeat(72)])).r;r=await save(r,startDraft(r.state));return r;}
const apply=async(r:Room,a=additions(),uid=ids[0])=>(await as<{r:Room}>(uid,'select public.import_draft_screenshot($1,$2,$3::jsonb) r',[r.id,r.version,JSON.stringify(a)])).r;
beforeAll(async()=>{db=new PGlite();await db.exec("create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,is_anonymous boolean default true,email_confirmed_at timestamptz,email text,encrypted_password text,raw_user_meta_data jsonb);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;");for(const id of ids)await db.query('insert into auth.users(id) values($1)',[id]);for(const file of readdirSync('supabase/migrations').sort())await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));},30000);
afterAll(()=>db.close());beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));
it('server imports into guided draft atomically, increments once, and Undo restores the prior picks while staying open',async()=>{
 const before=await room(),r=await apply(before);expect(r.version).toBe(before.version+1);expect(r.undo_count).toBe(1);expect(r.state.openDraft).toBe(true);expect(r.state.picks.ally).toHaveLength(2);expect(r.state.bans.enemy[2]).toBe('238');
 const undone=(await as<{r:Room}>(ids[0],"select public.control_draft($1,$2,'undo') r",[r.id,r.version])).r;expect(undone.state.picks).toEqual(before.state.picks);expect(undone.state.bans).toEqual(before.state.bans);expect(undone.state.openDraft).toBe(true);
 const redone=(await as<{r:Room}>(ids[0],"select public.control_draft($1,$2,'redo') r",[r.id,undone.version])).r;expect(redone.state.picks).toEqual(r.state.picks);expect(redone.state.bans).toEqual(r.state.bans);
});
it('server denies non-hosts, non-members, stale versions, overwrites, duplicate champions and malformed additions',async()=>{
 let r=await room();r=(await as<{r:Room}>(ids[1],'select public.join_room($1,$2,$3) r',[r.slug,'s'.repeat(72),'Guest'])).r;
 await expect(apply(r,additions(),ids[1])).rejects.toThrow('Only the host');await expect(apply(r,additions(),ids[2])).rejects.toThrow('Access denied');
 const first=await apply(r);await expect(apply(r)).rejects.toThrow('Conflict');const bad=additions();bad.picks.ally[0].championId='122';await expect(apply(first,bad)).rejects.toThrow('cannot be overwritten');
 const duplicate=empty();duplicate.picks.enemy=[{role:'Top',championId:'103'}];await expect(apply(first,duplicate)).rejects.toThrow('already used');
 const malformed=empty();malformed.bans.ally=[{slot:1.5,championId:'64'}];await expect(apply(first,malformed)).rejects.toThrow('Invalid screenshot ban');
 await expect(apply(first,empty())).rejects.toThrow('No new');
 const same=(await db.query<{version:number}>('select version from public.rooms where id=$1',[first.id])).rows[0];expect(same.version).toBe(first.version);
});
