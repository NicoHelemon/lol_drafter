import {test,expect,type Page} from '@playwright/test';
import type {AccountProfile,Room,Role} from '../../src/domain/types';
const guest='11111111-1111-4111-8111-111111111111',member='22222222-2222-4222-8222-222222222222';
function session(registered:boolean){const now=Math.floor(Date.now()/1000),user={id:registered?member:guest,aud:'authenticated',role:'authenticated',email:registered?'player@example.test':undefined,is_anonymous:!registered,email_confirmed_at:registered?new Date().toISOString():undefined,created_at:new Date().toISOString(),app_metadata:{provider:registered?'email':'anonymous',providers:[registered?'email':'anonymous']},user_metadata:{}};const b=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url');return {access_token:`${b({alg:'HS256',typ:'JWT'})}.${b({sub:user.id,role:'authenticated',exp:now+3600,iat:now,email:user.email,is_anonymous:user.is_anonymous})}.dGVzdA`,refresh_token:registered?'test-registered-refresh':'test-guest-refresh',expires_in:3600,token_type:'bearer',user};}
async function mock(page:Page,ready=true){
 const state:{profile:AccountProfile|null;room:Room|null;saves:number;requestedEmail:string;createdUid:string|null}={profile:null,room:null,saves:0,requestedEmail:'',createdUid:null};const anonymous=session(false),account=session(true);
 await page.route('http://127.0.0.1:54321/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname,body=req.method()==='POST'?req.postDataJSON():null;let result:unknown=null,status=200;
  if(req.method()==='OPTIONS'){await route.fulfill({status:200,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'}});return;}
  if(path==='/auth/v1/signup')result=anonymous;
  else if(path==='/auth/v1/otp'){state.requestedEmail=body.email;result={};}
  else if(path==='/auth/v1/verify'){if(body.token==='12345678')result=account;else{status=403;result={code:'otp_expired',msg:'The email code is invalid or expired'};}}
  else if(path==='/auth/v1/user')result=req.headers().authorization===`Bearer ${account.access_token}`?account.user:anonymous.user;
  else if(path==='/auth/v1/logout')result={};
  else if(path.endsWith('/account_features'))result={email_login_ready:ready};
  else if(path.endsWith('/user_profiles'))result=state.profile?[state.profile]:[];
  else if(path.endsWith('/statistics_current'))result=[];
  else if(path.endsWith('/room_members'))result=[{user_id:member,last_seen:new Date().toISOString()}];
  else if(path.endsWith('/rooms'))result=state.room?[state.room]:[];
  else if(path.endsWith('/role_swap_requests')||path.endsWith('/pick_swap_requests'))result=[];
  else if(path.endsWith('/rpc/account_login_allowed'))result=state.room===null;
  else if(path.endsWith('/rpc/save_my_profile')){
   if(body.expected_version!==(state.profile?.version??0)){status=400;result={message:'Conflict: profile updated'};}
   else{state.saves++;state.profile={user_id:member,display_name:body.new_name,role_pools:body.new_pools,version:state.saves};result=state.profile;}
  }else if(path.endsWith('/rpc/create_room')){state.createdUid=body.initial_state.players[0].id;state.room={id:'33333333-3333-4333-8333-333333333333',slug:'account-room',name:"Nico's room",host_id:member,version:0,state:body.initial_state};result=state.room;}
  else if(path.endsWith('/rpc/claim_role')){state.room!.state.players[0].role=body.new_role;state.room!.state.players[0].pool=[...state.profile!.role_pools[body.new_role as Role]];state.room!.version++;result=state.room;}
  else if(path.endsWith('/rpc/set_role_candidates')){state.room!.state.players[0].pool=body.champion_ids;state.room!.version++;result=state.room;}
  else if(path.endsWith('/rpc/leave_room')){state.room=null;result=null;}
  else if(path.endsWith('/rpc/heartbeat'))result=null;
  else throw Error('Unhandled mock route '+path);
  await route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(result)});
 });return state;
}
test('email code, private five-role profile, current identity and explicit room-to-profile save',async({page})=>{
 const server=await mock(page);await page.goto('/');await page.getByRole('button',{name:'Sign in / Create account',exact:true}).click();
 await page.getByLabel('Email address',{exact:true}).fill('player@example.test');await page.getByRole('button',{name:'Send sign-in code',exact:true}).click();await expect.poll(()=>server.requestedEmail).toBe('player@example.test');
 await page.getByLabel('Sign-in code',{exact:true}).fill('11111111');await page.getByRole('button',{name:'Verify code',exact:true}).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('invalid or expired');
 await page.getByLabel('Sign-in code',{exact:true}).fill('12345678');await page.getByRole('button',{name:'Verify code',exact:true}).click();await expect(page.getByRole('dialog',{name:'My champion pools'})).toBeVisible();
 await page.getByRole('dialog').getByLabel('Display name',{exact:true}).fill('Nico');await page.getByRole('tab',{name:'Mid',exact:true}).click();await page.getByRole('textbox',{name:'Search champions'}).fill('Ahri');await page.getByRole('button',{name:'Ahri',exact:true}).click();await page.getByRole('button',{name:'Save profile and pools',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);expect(server.profile?.role_pools.Mid).toEqual(['103']);await expect(page.getByLabel('Display name',{exact:true})).toHaveValue('Nico');await page.reload();await expect(page.getByText('Signed in as',{exact:false})).toContainText('Nico');await expect(page.getByLabel('Display name',{exact:true})).toHaveValue('Nico');
 await page.getByRole('button',{name:/Create private room/}).click();await expect(page.getByRole('region',{name:'Room preparation'})).toBeVisible();expect(server.createdUid).toBe(member);await expect(page.getByRole('button',{name:'Sign in / Create account',exact:true})).toHaveCount(0);
 await page.getByRole('group',{name:'Mid role',exact:true}).getByRole('button',{name:'Join',exact:true}).click();await expect(page.getByRole('group',{name:'Mid role',exact:true}).locator('.pool-tile')).toHaveCount(1);
 await page.getByRole('button',{name:'Add champion to Mid pool',exact:true}).click();await page.getByRole('textbox',{name:'Search champions'}).fill('Akali');await page.getByRole('button',{name:'Akali',exact:true}).click();await page.getByRole('button',{name:'Close',exact:true}).click();expect(server.saves).toBe(1);expect(server.profile!.role_pools.Mid).toEqual(['103']);
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Save my Mid pool',exact:true}).click();await expect.poll(()=>server.saves).toBe(2);expect(server.profile!.role_pools.Mid).toEqual(['103','84']);
});
test('email setup gate keeps guest entry available and never requests a code while unavailable',async({page})=>{
 const server=await mock(page,false);await page.goto('/');await page.getByRole('button',{name:'Sign in / Create account',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('Email sign-in is being configured');await expect(page.getByRole('button',{name:'Send sign-in code',exact:true})).toBeDisabled();expect(server.requestedEmail).toBe('');await page.getByRole('button',{name:'Close account',exact:true}).click();await page.getByLabel('Display name',{exact:true}).fill('Guest');await expect(page.getByRole('button',{name:/Create private room/})).toBeEnabled();
});
