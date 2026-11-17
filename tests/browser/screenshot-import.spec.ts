import {test,expect,type Page} from '@playwright/test';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {initialState,champions} from '../../src/data/provider';
import type {ScreenshotReading} from '../../src/domain/screenshot';

const reading:ScreenshotReading={width:960,height:540,box:[0,0,960,540],slots:[
 {team:'ally',slot:1,championId:'58',role:'Top',status:'locked',similarity:.99,margin:.2},
 {team:'ally',slot:2,championId:'103',role:'Mid',status:'locked',similarity:.99,margin:.2},
 {team:'enemy',slot:1,championId:'54',role:'Top',status:'locked',similarity:.99,margin:.2},
 {team:'ally',slot:3,championId:'157',status:'picking',similarity:.99,margin:.2}],bans:[
 {team:'ally',slot:1,championId:'157',similarity:1,margin:1},{team:'ally',slot:2,championId:'238',similarity:1,margin:1},{team:'enemy',slot:1,championId:'3',similarity:1,margin:1}]};
async function fakeRecognizer(page:Page,delay=20,empty=false){await page.addInitScript(({reading,delay})=>{
 const Native=window.Worker;
 window.Worker=class {
  onmessage:((e:MessageEvent)=>void)|null=null;onerror:unknown=null;cancelled=false;
  constructor(url:string|URL,opts?:WorkerOptions){if(!String(url).includes('recognizer.worker'))return new Native(url,opts) as never;}
  postMessage(data:{bitmap:ImageBitmap}){data.bitmap.close();const deliver=()=>{if(!this.cancelled)this.onmessage?.({data:{kind:'result',reading}} as MessageEvent);};if(delay<0)(window as unknown as {finishScreenshot:()=>void}).finishScreenshot=deliver;else setTimeout(deliver,delay);}
  terminate(){this.cancelled=true;}
 } as unknown as typeof Worker;
 },{reading:empty?{...reading,slots:[],bans:[]}:reading,delay});}
async function seed(page:Page,host=true,conflictingBan=false){
 await page.goto('/');const state=initialState('local-player','Image check','ranked');state.phase='live';state.players[0].role='Mid';state.players[0].pool=['58','112'];state.picks.ally=[{championId:'58',role:'Mid'}];state.bans.ally[0]=conflictingBan?'3':'157';
 const room={id:'image-check',slug:'image-check',name:'Image check room',host_id:host?'local-player':'other-host',version:0,state};
 await page.evaluate(room=>{localStorage.setItem('draftroom-demo',JSON.stringify(room));localStorage.setItem('draftroom-current',room.slug);},room);await page.goto('/rooms/image-check/draft');
 await expect(page.getByRole('heading',{name:'Draft board',exact:true})).toBeVisible();
}
async function paste(page:Page,target='window'){
 await page.evaluate(async target=>{const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;const blob=await new Promise<Blob>(r=>canvas.toBlob(b=>r(b!)));const transfer=new DataTransfer();transfer.items.add(new File([blob],'clipboard.png',{type:'image/png'}));const event=new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true});(target==='window'?window:document.querySelector(target)!).dispatchEvent(event);},target);
}
const stored=(page:Page)=>page.evaluate(()=>JSON.parse(localStorage.getItem('draftroom-demo')!));
test('Ctrl+V imports directly, preserves a compatible Renekton Mid and matching bans, and groups Undo/Redo',async({page})=>{
 await fakeRecognizer(page);await seed(page);const before=await stored(page);await paste(page);
 await expect(page.getByRole('region',{name:'Screenshot import'})).toContainText('Imported 4 selections');
 await expect(page.getByRole('dialog',{name:'Review screenshot import'})).toHaveCount(0);
 const after=await stored(page);expect(after.state.openDraft).toBe(true);expect(after.state.picks.ally).toContainEqual({championId:'58',role:'Mid'});expect(after.state.picks.ally).toContainEqual({championId:'103',role:'Top'});expect(after.state.bans.ally[0]).toBe('157');expect(after.state.players).toEqual(before.state.players);expect(after.undo_count).toBe(1);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await stored(page)).state.picks).toEqual(before.state.picks);expect((await stored(page)).state.bans).toEqual(before.state.bans);expect((await stored(page)).state.openDraft).toBe(true);
 await page.keyboard.press('Control+y');expect((await stored(page)).state.picks).toEqual(after.state.picks);
 const unchanged=await stored(page);await paste(page);await expect(page.getByRole('region',{name:'Screenshot import'})).toContainText('No new selections detected');expect(await stored(page)).toEqual(unchanged);
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('file drop recognition can be cancelled, while text-field paste and non-host imports stay protected',async({page})=>{
 await fakeRecognizer(page,3000);await seed(page);const before=await stored(page);
 await page.getByRole('button',{name:'Add Mid candidates',exact:true}).click();await paste(page,'input[aria-label="Search champions"]');await expect(page.getByRole('progressbar',{name:'Screenshot recognition'})).toHaveCount(0);await page.getByRole('button',{name:'Close',exact:true}).click();
 const transfer=await page.evaluateHandle(async()=>{const c=document.createElement('canvas');c.width=960;c.height=540;const blob=await new Promise<Blob>(r=>c.toBlob(b=>r(b!)));const dt=new DataTransfer();dt.items.add(new File([blob],'drop.png',{type:'image/png'}));return dt;});
 await page.getByRole('region',{name:'Screenshot import'}).dispatchEvent('drop',{dataTransfer:transfer});await expect(page.getByRole('progressbar',{name:'Screenshot recognition'})).toBeVisible();await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByRole('region',{name:'Screenshot import'})).toContainText('Recognition cancelled');expect((await stored(page)).state).toEqual(before.state);
 await seed(page,false);await expect(page.getByRole('region',{name:'Screenshot import'})).toHaveCount(0);await paste(page);expect((await stored(page)).state).toEqual(before.state);
});
test('contradictory screenshots report an error without partially importing or opening guided draft',async({page})=>{
 await fakeRecognizer(page);await seed(page,true,true);const before=await stored(page);await paste(page);await expect(page.getByRole('alert')).toContainText('different ban');expect((await stored(page))).toEqual(before);await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('images with no confirmed detections report an error without changing the draft',async({page})=>{
 await fakeRecognizer(page,20,true);await seed(page);const before=await stored(page);await paste(page);await expect(page.getByRole('alert')).toContainText('No confirmed picks or bans');expect((await stored(page))).toEqual(before);
});
test('a pick made during recognition is checked against the result before any changes are imported',async({page})=>{
 await fakeRecognizer(page,-1);await seed(page);await page.getByRole('button',{name:'Open draft',exact:true}).click();await paste(page);
 await page.waitForFunction(()=>typeof (window as unknown as {finishScreenshot:unknown}).finishScreenshot==='function');
 await page.getByRole('region',{name:'Top enemy picks',exact:true}).getByRole('button',{name:'Pick Ahri Top enemy',exact:true}).click();
 await page.evaluate(()=>(window as unknown as {finishScreenshot:()=>void}).finishScreenshot());
 await expect(page.getByRole('alert')).toContainText('conflicts');expect((await stored(page)).state.picks.enemy).toContainEqual({championId:'103',role:'Top'});expect((await stored(page)).state.picks.ally).toEqual([{championId:'58',role:'Mid'}]);
});

// Exercise actual production bundles, local WASM/OCR assets and the intended
// restrictive page CSP. No screenshot dataset or backend is needed in CI.
test('real screenshot pixels are recognized under production CSP without external requests',async({page})=>{
 test.setTimeout(180000);const external:string[]=[],violations:string[]=[];
 page.on('request',r=>{if(!['127.0.0.1','localhost'].includes(new URL(r.url()).hostname))external.push(r.url());});
 await page.addInitScript(()=>document.addEventListener('securitypolicyviolation',e=>console.error('CSP-VIOLATION '+e.violatedDirective+' '+e.blockedURI)));
 page.on('console',m=>{if(m.text().includes('CSP-VIOLATION'))violations.push(m.text());});
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url()),file=resolve('dist','.'+url.pathname);if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();
  const navigation=route.request().isNavigationRequest(),path=navigation?resolve('dist/index.html'):file;if(!existsSync(path))return route.continue();
  const worker=url.pathname.includes('recognizer.worker')||url.pathname.startsWith('/image-tools/');
  const csp=worker?"default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self';":"default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self';";
  const contentType=navigation?'text/html':path.endsWith('.js')?'text/javascript':path.endsWith('.json')?'application/json':path.endsWith('.css')?'text/css':path.endsWith('.wasm')?'application/wasm':path.endsWith('.png')?'image/png':'application/octet-stream';
  await route.fulfill({body:readFileSync(path),headers:{'content-type':contentType,'content-security-policy':csp}});
 });
 await page.goto('/production-check');await page.getByPlaceholder('Your name').fill('Pixels');await page.getByRole('button',{name:'Open local demo'}).click();await page.getByRole('button',{name:'Start draft'}).click();
 const data=await page.evaluate(async portraits=>{
  const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#09131f';ctx.fillRect(0,0,960,540);
  const ids=['58','64','103','54','234','1','2','3','4','5','6','7','8','9','10'];const images=new Map<string,HTMLImageElement>();
  for(const id of ids){const im=new Image();im.src=portraits[id];await im.decode();images.set(id,im);}
  const picks=[['58','Renekton','Top',0,0],['64','Lee Sin','Jungle',0,1],['103','Ahri','Mid',0,2],['54','Malphite','Top',1,0],['234','Viego','Jungle',1,1]];
  for(const [id,name,role,side,row] of picks){const x=960*(side===0?.0667:.95625),y=540*(.186+Number(row)/9),r=960*.023;ctx.save();ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.clip();ctx.drawImage(images.get(String(id))!,x-r,y-r,r*2,r*2);ctx.restore();ctx.fillStyle='#e5d8b4';ctx.font='15px sans-serif';ctx.textAlign=side===0?'left':'right';ctx.fillText(String(name),960*(side===0?.1:.92),y-4);ctx.font='12px sans-serif';ctx.fillText(String(role),960*(side===0?.1:.92),y+13);}
  for(let side=0;side<2;side++)for(let i=0;i<5;i++){const x=960*((side===0?.023:.85)+.03125*i),y=540*.059,r=960*.012;ctx.drawImage(images.get(String(1+side*5+i))!,x-r,y-r,r*2,r*2);}
  return [...new Uint8Array(await(await new Promise<Blob>(r=>canvas.toBlob(b=>r(b!)))).arrayBuffer())];
 },Object.fromEntries(champions.map(c=>[c.id,c.portrait])));
 await page.getByLabel('Choose draft screenshot',{exact:true}).setInputFiles({name:'synthetic-client.png',mimeType:'image/png',buffer:Buffer.from(data)});
 await expect(page.getByRole('region',{name:'Screenshot import'})).toContainText('Imported',{timeout:150000});
 const after=await stored(page);expect(after.state.picks.ally).toContainEqual({championId:'58',role:'Top'});expect(after.state.picks.ally).toContainEqual({championId:'103',role:'Mid'});expect(after.state.picks.enemy).toContainEqual({championId:'54',role:'Top'});expect(after.state.bans.ally[0]).toBe('1');
 expect(violations).toEqual([]);expect(external).toEqual([]);expect(after.state.openDraft).toBe(true);await expect(page.getByRole('dialog')).toHaveCount(0);
});
