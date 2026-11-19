import {test,expect,type Page} from '@playwright/test';
import {initialState} from '../../src/data/provider';
import {DEMO_MODEL} from '../../src/domain/shrinkage';
import type {Dataset,Room} from '../../src/domain/types';
const host='11111111-1111-4111-8111-111111111111',guest='22222222-2222-4222-8222-222222222222';
const a='a'.repeat(64),b='b'.repeat(64);
function fixture(phase:'setup'|'live'='live'){
 const make=(sid:string,date:string):Dataset=>({...initialState(host,'Host').dataset,id:sid,snapshotId:sid,fictional:false,source:'Lolalytics',importedAt:date,pairs:[]});
 const datasets={[a]:make(a,'2026-11-18T14:18:00Z'),[b]:make(b,'2026-11-19T14:48:00Z')};
 const s=initialState(host,'Host','ranked');s.phase=phase;s.openDraft=phase==='live';s.dataset=datasets[a];s.players=[{id:host,name:'Host',role:'Top',pool:['58']},{id:guest,name:'Guest',role:null,pool:[]}];
 if(phase==='live'){s.picks={ally:[{role:'Top',championId:'58'}],enemy:[{role:'Top',championId:'122'}]};s.bans.ally[0]='103';}
 return {datasets,current:a,updates:0,room:{id:'33333333-3333-4333-8333-333333333333',slug:'data-room',name:'Data room',host_id:host,version:0,state:s} as Room};
}
async function connect(page:Page,server:ReturnType<typeof fixture>,uid=host){
 await page.addInitScript(()=>localStorage.setItem('draftroom-current','data-room'));
 const user={id:uid,aud:'authenticated',role:'authenticated',is_anonymous:true,created_at:new Date().toISOString(),app_metadata:{provider:'anonymous',providers:['anonymous']},user_metadata:{}};
 const enc=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url'),now=Math.floor(Date.now()/1000);
 const session={access_token:`${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:uid,role:'authenticated',exp:now+3600,iat:now,is_anonymous:true})}.dGVzdA`,refresh_token:uid,expires_in:3600,expires_at:now+3600,token_type:'bearer',user};
 await page.route('http://127.0.0.1:54321/**',async route=>{
  const req=route.request(),url=new URL(req.url()),p=url.pathname,body=req.postDataJSON()??{};let result:unknown=null;
  if(p==='/auth/v1/signup'||p==='/auth/v1/token')result=session;
  else if(p==='/auth/v1/user')result=user;
  else if(p.endsWith('/rooms'))result=[server.room];
  else if(p.endsWith('/room_members'))result=server.room.state.players.map(v=>({user_id:v.id,last_seen:new Date().toISOString()}));
  else if(p.endsWith('/statistics_current'))result=[{snapshot_id:server.current}];
  else if(p.endsWith('/statistics_snapshots')){const sid=url.searchParams.get('id')?.replace('eq.','')??server.current;const {pairs:_,...metadata}=server.datasets[sid];result={metadata};}
  else if(p.endsWith('/statistics_calibrations'))result=[{model:DEMO_MODEL}];
  else if(p.endsWith('/statistics_role_catalogues')){const sid=url.searchParams.get('snapshot_id')?.replace('eq.','')??server.current;result=[{catalogue:{...initialState(host,'Host').roleCatalogue!,fictional:false,capturedAt:server.datasets[sid].importedAt}}];}
  else if(p.endsWith('/statistics_shards')){
   const sid=url.searchParams.get('snapshot_id')?.replace('eq.','')??server.current;
   const keys=(url.searchParams.get('candidate_key')??'').replace(/^in\.\(|\)$/g,'').split(',').map(k=>k.replaceAll('"',''));
   result=keys.map(key=>{const [id,role]=key.split(':');return {candidate_key:key,pairs:role==='Top'&&['58','122'].includes(id)?[{relation:'vs',candidateChampionId:id,candidateRole:role,otherChampionId:id==='58'?'122':'58',otherRole:'Top',delta2:(sid===a?1:2)*(id==='58'?1:-1),games:10000}]:[]};});
  }else if(p.endsWith('/rpc/refresh_room_statistics')){
   if(server.room.state.phase==='setup'||uid===host){if(server.room.state.dataset.snapshotId!==server.current){server.room.state.dataset=structuredClone(server.datasets[server.current]);server.room.version++;server.updates++;}}result=server.room;
  }else if(p.endsWith('/rpc/control_draft')){
   if(body.action==='lobby'){server.room.state={...server.room.state,phase:'setup',openDraft:false,draftStep:0,draftHistory:[],picks:{ally:[],enemy:[]},bans:{ally:Array(5).fill(null),enemy:Array(5).fill(null)},dataset:structuredClone(server.datasets[server.current])};server.room.version++;}result=server.room;
  }else if(p.endsWith('/role_swap_requests')||p.endsWith('/pick_swap_requests')||p.endsWith('/rpc/draft_reference_pairs'))result=[];
  else if(p.endsWith('/rpc/account_features'))result={email_login_ready:false};
  else if(p.endsWith('/rpc/my_account_login'))result=null;
  else if(p.endsWith('/rpc/heartbeat'))result=null;
  else if(p.endsWith('/user_profiles'))result=[];
  else throw Error('Unexpected backend request '+p);
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
 });
 await page.goto('/');
 await expect(page.getByRole('region',{name:'Room data'})).toContainText('18 Nov 2026');
}
async function detectPublication(page:Page){await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));}
test('a live draft stays stable until its host updates, then both clients show the same new data and keep choices',async({browser})=>{
 const server=fixture(),before=structuredClone(server.room.state);const hc=await browser.newContext(),gc=await browser.newContext();const h=await hc.newPage(),g=await gc.newPage();
 try{
  await connect(h,server);await g.clock.install();await connect(g,server,guest);
  server.current=b;await detectPublication(h);await detectPublication(g);
  await expect(h.getByRole('region',{name:'Room data'})).toContainText('New data available');await expect(g.getByRole('region',{name:'Room data'})).toContainText('New data available');
  await expect(g.getByRole('button',{name:'Update data',exact:true})).toHaveCount(0);expect(server.updates).toBe(0);
  await expect(h.getByRole('region',{name:'Room data'}).locator('time')).toHaveAttribute('datetime',before.dataset.importedAt);
  await h.getByRole('button',{name:'Update data',exact:true}).click();await expect(h.getByRole('region',{name:'Room data'})).toContainText('19 Nov 2026');
  await g.clock.fastForward(21000);await expect(g.getByRole('region',{name:'Room data'})).toContainText('19 Nov 2026');
  expect(server.updates).toBe(1);expect(server.room.state.picks).toEqual(before.picks);expect(server.room.state.bans).toEqual(before.bans);expect(server.room.state.players).toEqual(before.players);
  await expect(h.getByRole('button',{name:'Update data',exact:true})).toHaveCount(0);await expect(h.getByRole('region',{name:'Room data'})).toContainText('Scores recalculated');
 }finally{await hc.close();await gc.close();}
});
test('the lobby adopts new data automatically and returning from a draft adopts the latest publication',async({page})=>{
 const server=fixture('setup');await connect(page,server);server.current=b;await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect(page.getByRole('region',{name:'Room data'})).toContainText('19 Nov 2026');expect(server.updates).toBe(1);
 server.room.state.phase='live';server.room.state.openDraft=true;await page.reload();await expect(page.getByRole('heading',{name:'Draft board'})).toBeVisible();
 server.current=a;page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Return to lobby',exact:true}).click();
 await expect(page.getByRole('region',{name:'Room preparation'})).toBeVisible();await expect(page.getByRole('region',{name:'Room data'})).toContainText('18 Nov 2026');
});
