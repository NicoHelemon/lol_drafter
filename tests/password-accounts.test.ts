import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest';
import {initialState} from '../src/data/provider';
const ids=Array.from({length:6},(_,i)=>`00000000-0000-4000-9000-${String(i+1).padStart(12,'0')}`);let db:PGlite;
async function actor<T>(role:string,uid:string,sql:string,args:unknown[]=[]){await db.exec('savepoint actor');await db.exec(`set role ${role};set request.jwt.claim.sub='${uid}'`);try{return(await db.query<T>(sql,args)).rows;}catch(e){await db.exec('rollback to actor');throw e;}finally{await db.exec('reset role;release actor');}}
const own=<T>(id:string,sql:string,args:unknown[]=[])=>actor<T>('authenticated',id,sql,args);
const target=(identifier:string,key='a'.repeat(64))=>actor<{result:{limited:boolean;email?:string|null}}>('service_role','', 'select public.password_login_target($1,$2) result',[identifier,key]);
beforeAll(async()=>{db=new PGlite();await db.exec("create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,is_anonymous boolean default false,email_confirmed_at timestamptz,email text,encrypted_password text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;");
 for(let i=0;i<4;i++)await db.query('insert into auth.users(id,is_anonymous,email_confirmed_at,email,encrypted_password) values($1,$2,$3,$4,$5)',[ids[i],i===3,i<2?'2026-11-17T00:00:00Z':null,i===3?null:`person${i}@example.test`,i===1?'auth-managed-hash':null]);
 for(const f of readdirSync('supabase/migrations').filter(f=>f<'202611170019').sort())await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));
 await db.query('insert into public.user_profiles(user_id,display_name,role_pools) values($1,$2,$3)',[ids[0],'Room nickname',{Top:['58'],Mid:['103'],Jungle:[],ADC:[],Support:[]}]);
 await db.exec(readFileSync('supabase/migrations/202611170019_password_accounts.sql','utf8'));
 const before=(await db.query('select * from public.user_profiles order by user_id')).rows;await db.exec(readFileSync('supabase/migrations/202611170020_profile_onboarding_vacated_pools.sql','utf8'));const after=(await db.query<{onboarding_complete:boolean}>('select * from public.user_profiles order by user_id')).rows;expect(after.map(({onboarding_complete,...row})=>{expect(onboarding_complete).toBe(true);return row;})).toEqual(before);
},30000);
afterAll(()=>db.close());beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));
it('preserves existing identity, display name and all pools while adding a separate private login',async()=>{
 const before=(await db.query('select * from public.user_profiles where user_id=$1',[ids[0]])).rows[0];
 expect((await own<{login:{login_name:null;has_password:boolean}}>(ids[0],'select public.my_account_login() login'))[0].login).toEqual({login_name:null,has_password:false});
 await expect(own(ids[0],'select public.set_my_login_name($1)',['Private_Nico'])).rejects.toThrow('Set your password');
 await db.query("update auth.users set encrypted_password='auth-managed-hash' where id=$1",[ids[0]]);
 await own(ids[0],'select public.set_my_login_name($1)',['Private_Nico']);
 expect((await own<{login:unknown}>(ids[0],'select public.my_account_login() login'))[0].login).toEqual({login_name:'private_nico',has_password:true});
 expect((await db.query('select * from public.user_profiles where user_id=$1',[ids[0]])).rows[0]).toEqual(before);
 expect((await db.query<{email:string}>('select email from auth.users where id=$1',[ids[0]])).rows[0].email).toBe('person0@example.test');
});
it('enforces unique case-insensitive login names and rejects invalid, anonymous and unverified changes',async()=>{
 await own(ids[1],'select public.set_my_login_name($1)',['my_login']);
 expect((await own<{ok:boolean}>(ids[0],'select public.login_name_available($1) ok',['MY_LOGIN']))[0].ok).toBe(false);
 await db.query("update auth.users set encrypted_password='auth-managed-hash' where id=$1",[ids[0]]);
 await expect(own(ids[0],'select public.set_my_login_name($1)',['My_Login'])).rejects.toThrow('already taken');
 for(const value of ['ab','name@host','room name','ééé', 'x'.repeat(25)])await expect(own(ids[0],'select public.set_my_login_name($1)',[value])).rejects.toThrow('3–24');
 for(const id of ids.slice(2,4))await expect(own(id,'select public.set_my_login_name($1)',['valid_name'])).rejects.toThrow('Verify your email');
});
it('reserves a new signup name atomically and keeps its initial room display name separate',async()=>{
 await db.query('insert into auth.users(id,email,encrypted_password,raw_user_meta_data) values($1,$2,$3,$4)',[ids[4],'new@example.test','auth-managed-hash',{login_name:'New_Login',display_name:'New room name'}]);
 expect((await db.query<{login_name:string}>('select login_name from public.account_logins where user_id=$1',[ids[4]])).rows[0].login_name).toBe('new_login');
 expect((await own(ids[4],'select * from public.user_profiles'))).toEqual([]);
 await db.query('update auth.users set email_confirmed_at=now() where id=$1',[ids[4]]);
 const p=(await own<{display_name:string;role_pools:unknown}>(ids[4],'select display_name,role_pools from public.user_profiles'))[0];expect(p.display_name).toBe('New room name');expect(p.role_pools).toEqual({Top:[],Jungle:[],Mid:[],ADC:[],Support:[]});
 await db.exec('savepoint duplicate');await expect(db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[ids[5],'another@example.test',{login_name:'NEW_LOGIN',display_name:'Other'}])).rejects.toThrow('account_logins_login_name_key');await db.exec('rollback to duplicate');
 expect((await db.query('select * from auth.users where id=$1',[ids[5]])).rows).toHaveLength(0);
});
it('never exposes a login-to-email directory or the server-only resolver to visitors',async()=>{
 await own(ids[1],'select public.set_my_login_name($1)',['my_login']);
 for(const table of ['account_logins','account_login_limits'])await expect(own(ids[0],'select * from public.'+table)).rejects.toThrow('permission denied');
 await expect(own(ids[0],'select public.password_login_target($1,$2)',['my_login','a'.repeat(64)])).rejects.toThrow('permission denied');
 expect((await target('MY_LOGIN'))[0].result.email).toBe('person1@example.test');expect((await target('missing_login'))[0].result.email).toBe(null);expect((await target(' Email@Example.test '))[0].result.email).toBe('email@example.test');
});
it('limits requests on the server and expires old limit rows without touching profiles',async()=>{
 for(let i=0;i<30;i++)expect((await target('missing'))[0].result.limited).toBe(false);
 expect((await target('missing'))[0].result.limited).toBe(true);
 await db.exec("update public.account_login_limits set started_at=now()-interval '11 minutes'");
 expect((await target('missing'))[0].result.limited).toBe(false);
 expect((await db.query<{n:number}>('select count(*)::int n from public.account_login_limits')).rows[0].n).toBe(1);
 expect((await db.query<{n:number}>('select count(*)::int n from public.user_profiles')).rows[0].n).toBe(1);
});
it('keeps account credential changes outside rooms',async()=>{
 const state=initialState(ids[1],'Room display name','ranked');await own(ids[1],'select public.create_room($1,$2)',[state,'a'.repeat(72)]);
 await expect(own(ids[1],'select public.set_my_login_name($1)',['my_login'])).rejects.toThrow('Quit your room');
});

it('requires initial pool setup only for new accounts and marks it complete on the first explicit profile save',async()=>{
 await db.query('insert into auth.users(id,email,encrypted_password,raw_user_meta_data) values($1,$2,$3,$4)',[ids[4],'new@example.test','auth-managed-hash',{login_name:'new_login',display_name:'New room name'}]);await db.query('update auth.users set email_confirmed_at=now() where id=$1',[ids[4]]);
 const initial=(await own<{onboarding_complete:boolean;version:number}>(ids[4],'select * from public.user_profiles'))[0];expect(initial.onboarding_complete).toBe(false);expect(initial.version).toBe(1);
 const saved=(await own<{profile:{onboarding_complete:boolean;version:number;role_pools:unknown}}>(ids[4],'select public.save_my_profile($1,$2,$3) profile',['New room name',{Top:[],Jungle:[],Mid:['103'],ADC:[],Support:[]},1]))[0].profile;expect(saved.onboarding_complete).toBe(true);expect(saved.version).toBe(2);expect(saved.role_pools).toMatchObject({Mid:['103'],Top:[]});
});
