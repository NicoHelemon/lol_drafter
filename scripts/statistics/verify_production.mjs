/** Production smoke test: private disposable room, real snapshot, real scores.
 * Does not log Auth tokens or invitation links. Always attempts to Quit its room.
 * node scripts/statistics/verify_production.mjs /tmp/draftroom-production-check
 */
import {chromium} from '@playwright/test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';
const output=process.argv[2];
if(!output)throw Error('Pass an output directory');
await mkdir(output,{recursive:true});
const base='https://draftroom-lol.netlify.app';
const snapshot='0551fd06485293f646720494eef5e1a4158aca434145a860ac66028fb5ebf0fb';
const pairs=JSON.parse(gunzipSync(await readFile(`statistics-cache/full-2026-11-12/snapshots/${snapshot}/58-Top.json.gz`)));
const against=pairs.find(p=>p.relation==='vs'&&p.otherChampionId==='799'&&p.otherRole==='Top');
const withAlly=pairs.find(p=>p.relation==='with'&&p.otherChampionId==='64'&&p.otherRole==='Jungle');
const expected=(.4*against.delta2+.2*withAlly.delta2)/.6;
const label=`${expected>=0?'+':''}${expected.toFixed(2)}`;
const browser=await chromium.launch({
  executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',
  // Trust only the known environment proxy CA when Chromium's NSS store lags
  // behind the supplied system trust. Never disable HTTPS checks globally.
  args:process.env.CHROMIUM_TRUSTED_PROXY_SPKI ? [`--ignore-certificate-errors-spki-list=${process.env.CHROMIUM_TRUSTED_PROXY_SPKI}`] : [],
});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const proof={checkedAt:new Date().toISOString(),site:base,sourceRequests:0,shardRequests:0,expectedScore:label};
const shardTasks=[];
page.on('request',r=>{if(new URL(r.url()).hostname.endsWith('lolalytics.com'))proof.sourceRequests++;});
page.on('response',r=>{
  if(r.url().includes('/rest/v1/statistics_shards')){
    proof.shardRequests++;
    shardTasks.push(r.json().then(rows=>{
      if(!Array.isArray(rows))throw Error('Shard API did not return rows');
      if(rows.some(r=>!Array.isArray(r.pairs)))throw Error('Malformed production shards');
    }));
  }
});
let roomCreated=false;
try{
  const revision=await page.goto(`${base}/deployment.json`,{waitUntil:'domcontentloaded'});
  if(!revision.ok())throw Error('Deployment metadata unavailable');
  proof.deployment=await revision.json();
  if(process.env.EXPECTED_COMMIT&&!proof.deployment.commit.startsWith(process.env.EXPECTED_COMMIT))throw Error('Unexpected deployed commit');
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.getByPlaceholder('Your name').fill('Deployment check');
  const created=page.waitForResponse(r=>r.url().endsWith('/rest/v1/rpc/create_room')&&r.request().method()==='POST');
  await page.getByRole('button',{name:/Create private room/}).click();
  const response=await created;
  if(!response.ok())throw Error(`create_room failed: ${response.status()}`);
  const room=await response.json();roomCreated=true;
  proof.roomSlug=room.slug;proof.snapshotId=room.state.dataset.snapshotId;
  proof.fictional=room.state.dataset.fictional;proof.inlinePairs=room.state.dataset.pairs.length;
  if(proof.snapshotId!==snapshot||proof.fictional!==false||proof.inlinePairs!==0)throw Error('Production room did not pin the published real snapshot');
  await page.getByRole('group',{name:'Top role'}).getByRole('button',{name:'Join',exact:true}).click();
  await page.getByRole('button',{name:'Add champion to Top pool'}).click();
  await page.getByRole('textbox',{name:'Search champions'}).fill('Renekton');
  await page.getByRole('button',{name:'Renekton',exact:true}).click();
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Start draft'}).click();
  for(const [role,team,name] of [['Top','enemy','Ambessa'],['Jungle','ally','Lee Sin']]){
    await page.getByRole('button',{name:`Choose ${role} ${team}`,exact:true}).click();
    await page.getByRole('textbox',{name:'Search champions'}).fill(name);
    await page.getByRole('button',{name,exact:true}).click();
  }
  const score=page.getByRole('region',{name:'Top ally picks'}).locator('[data-champion="58"] .tile-score');
  await score.filter({hasText:label}).waitFor({timeout:30000});
  proof.displayedScore=(await score.innerText()).trim();
  await score.click();
  const details=page.getByRole('dialog',{name:'Score details'});
  await details.getByText('Against Ambessa',{exact:false}).waitFor();
  await details.getByText('With Lee Sin',{exact:false}).waitFor();
  proof.details=await details.innerText();
  if(!proof.details.includes('2/2 pairs'))throw Error('Incomplete source coverage for verification pair');
  await page.screenshot({path:resolve(output,'production-real-statistics.png')});
  await page.getByRole('button',{name:'Close score details'}).click();
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('region',{name:'Top ally picks'}).locator('[data-champion="58"] .tile-score').filter({hasText:label}).waitFor({timeout:30000});
  proof.reloadPreservedScore=true;
  await Promise.all(shardTasks);
  if(proof.sourceRequests!==0||proof.shardRequests===0)throw Error('Unexpected statistics request path');
  proof.success=true;
}finally{
  if(roomCreated){
    try{
      const closeDetails=page.getByRole('button',{name:'Close score details'});
      if(await closeDetails.isVisible())await closeDetails.click();
      const closePicker=page.getByRole('button',{name:'Close',exact:true});
      if(await closePicker.isVisible())await closePicker.click();
      page.once('dialog',d=>d.accept());
      await page.getByRole('button',{name:'Quit',exact:true}).click();
      await page.getByPlaceholder('Your name').waitFor({timeout:15000});
      proof.testRoomRemoved=true;
    }catch(error){proof.cleanupError=error.message;}
  }
  await writeFile(resolve(output,'proof.json'),JSON.stringify(proof,null,2)+'\n');
  await browser.close();
}
console.log(JSON.stringify(proof,null,2));
