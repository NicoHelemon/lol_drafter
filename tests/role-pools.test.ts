import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest';
import {initialState} from '../src/data/provider';
import {place} from '../src/domain/state';
import {rolePool,setRolePool,reconcileRolePools,toggleRoleCandidate} from '../src/domain/rolePools';
import type {Room,State} from '../src/domain/types';
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
async function fails(fn:()=>Promise<unknown>,message:string){await db.exec('savepoint expected');await expect(fn()).rejects.toThrow(message);await db.exec('rollback to expected');}
beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
 for(const id of ids)await db.query('insert into auth.users values($1)',[id]);
 for(const file of readdirSync('supabase/migrations').filter(f=>f<'202611150014').sort())await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));
},30000);
afterAll(()=>db.close());beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));
const pools=async(r:Room,team='enemy',role='Top',pool:unknown=['122','266'],uid=ids[0],version=r.version)=>(await as<{r:Room}>(uid,'select public.set_role_candidates($1,$2,$3,$4::jsonb,$5) r',[r.id,team,role,JSON.stringify(pool),version])).r;
async function lobby(){let r=(await as<{r:Room}>(ids[0],'select public.create_room($1::jsonb,$2) r',[JSON.stringify(initialState(ids[0],'Host')),token])).r;return(await as<{r:Room}>(ids[1],'select public.join_room($1,$2,$3) r',[r.slug,token,'Guest'])).r;}
it('stores candidates for all ten seats without selecting picks and preserves them at draft start',async()=>{
 let r=await lobby();const dataset=r.state.dataset;
 for(const team of ['ally','enemy'])for(const role of ['Top','Jungle','Mid','ADC','Support'])r=await pools(r,team,role,['58','103']);
 expect(r.state.picks).toEqual({ally:[],enemy:[]});expect(r.state.dataset).toEqual(dataset);
 const before=r.state.rolePools;r=await save(r,{...r.state,phase:'live'});
 expect(r.state.rolePools).toEqual(before);expect(rolePool(r.state,'enemy','Mid')).toEqual(['58','103']);
});
it('an empty arriving personal pool supersedes prefilled candidates permanently, including after departure',async()=>{
 let r=await pools(await lobby(),'ally','Top',['58','164']);let s=structuredClone(r.state);s.players[1].role='Top';r=await save(r,s,ids[1]);
 expect(rolePool(r.state,'ally','Top')).toEqual([]);expect(r.state.rolePools?.ally?.Top).toBeUndefined();
 await as(ids[1],'select public.leave_room($1)',[r.id]);
 r=(await db.query<Room>('select * from public.rooms where id=$1',[r.id])).rows[0];expect(rolePool(r.state,'ally','Top')).toEqual([]);
});
it('a moving owner brings their own candidates while the vacated role remains editable and enemy pools persist',async()=>{
 let r=await lobby();let s=structuredClone(r.state);s.players[0].role='Top';s.players[0].pool=['58','164'];r=await save(r,s);
 r=await pools(r,'ally','Mid',['103']);r=await pools(r);
 s=structuredClone(r.state);s.players[0].role='Mid';r=await save(r,s);
 expect(rolePool(r.state,'ally','Mid')).toEqual(['58','164']);expect(r.state.rolePools?.ally?.Mid).toBeUndefined();expect(rolePool(r.state,'ally','Top')).toEqual(['58','164']);expect(rolePool(r.state,'enemy','Top')).toEqual(['122','266']);
 r=await pools(r,'ally','Top',['31']);expect(r.state.players[0].pool).toEqual(['58','164']);
});
it('keeps setup owner/host permissions and allows collaborative live candidate edits without changing picks',async()=>{
 let r=await setup();const picks=r.state.picks,players=r.state.players.map(p=>({id:p.id,role:p.role}));
 r=await pools(r,'ally','Top',['58','164','266'],ids[1]);expect(r.state.players[0].pool).toEqual(['58','164','266']);expect(r.state.picks).toEqual(picks);expect(r.state.players.map(p=>({id:p.id,role:p.role}))).toEqual(players);
 r=await lobby();let s=structuredClone(r.state);s.players[0].role='Top';r=await save(r,s);
 await fails(()=>pools(r,'ally','Top',['58'],ids[1]),'owner or host');r=await pools(r,'enemy','Mid',['103'],ids[1]);expect(rolePool(r.state,'enemy','Mid')).toEqual(['103']);
});
it('rejects stale candidate writes after a role is claimed, forged hidden pools and invalid payloads',async()=>{
 let r=await pools(await lobby(),'ally','Top',['58']);const stale=r.version;let s=structuredClone(r.state);s.players[1].role='Top';r=await save(r,s,ids[1]);
 await fails(()=>pools(r,'ally','Top',['164'],ids[0],stale),'Conflict');
 s=structuredClone(r.state);s.rolePools!.ally!.Top=['266'];r=await save(r,s);expect(rolePool(r.state,'ally','Top')).toEqual([]);expect(r.state.rolePools?.ally?.Top).toBeUndefined();
 for(const invalid of [null,{},['58','58'],[58],['wrong'],Array.from({length:501},(_,i)=>String(i+1))])await fails(()=>pools(r,'enemy','Top',invalid),'Invalid candidate pool');
 await fails(()=>pools(r,'bad','Top',[]),'Invalid candidate seat');await fails(()=>pools(r,'enemy','Roam',[]),'Invalid candidate seat');await fails(()=>pools(r,'enemy','Top',[],ids[3]),'Access denied');
 s=structuredClone(r.state);s.rolePools={enemy:{Top:['bad']}};await fails(()=>save(r,s),'Invalid candidate pool');
});
it('preserves shared pools when a legacy client omits the optional field and cleans only its own room',async()=>{
 let r=await pools(await lobby());const s=structuredClone(r.state);delete s.rolePools;r=await save(r,s);expect(rolePool(r.state,'enemy','Top')).toEqual(['122','266']);
 const permissions=await db.query<{allowed:boolean}>("select has_function_privilege('anon','public.set_role_candidates(uuid,text,text,jsonb,integer)','execute') allowed");expect(permissions.rows[0].allowed).toBe(false);
});
it('domain candidates can be prepared independently in both teams and selected without changing pools',()=>{
 const original=initialState('p','P');let s=setRolePool(original,'enemy','Mid',['103','84']);s=setRolePool(s,'ally','Mid',['103']);expect(original.rolePools).toBeUndefined();
 s=toggleRoleCandidate(s,'enemy','Mid','103');expect(rolePool(s,'enemy','Mid')).toEqual(['103','84']);expect(()=>toggleRoleCandidate(s,'ally','Mid','103')).toThrow('already');
 s=toggleRoleCandidate(s,'enemy','Mid','84');s=toggleRoleCandidate(s,'enemy','Mid','84');expect(s.picks.enemy).toEqual([]);expect(rolePool(s,'enemy','Mid')).toEqual(['103','84']);
 const next=structuredClone(s);next.players[0].role='Mid';expect(rolePool(reconcileRolePools(s,next),'ally','Mid')).toEqual([]);
});
