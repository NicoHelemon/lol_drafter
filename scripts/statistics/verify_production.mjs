/** Production smoke test: private disposable room, real snapshot, real scores.
 * Does not log Auth tokens or invitation links. Always attempts to Quit its room.
 * node scripts/statistics/verify_production.mjs /tmp/draftroom-production-check
 */
import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const output=process.argv[2];
if(!output)throw Error('Pass an output directory');
await mkdir(output,{recursive:true});
const base='https://draftroom-lol.netlify.app';
if(!process.env.SUPABASE_ACCESS_TOKEN || !process.env.SUPABASE_PROJECT_REF)throw Error('Configure backend credentials for canonical production expectations');
  // Backend-only canonical expectation; never sends the management token to Chrome.
const row=JSON.parse(execFileSync('python3',['-c',`
import sys,json
sys.path.insert(0,'scripts/statistics')
from publish import query
print(json.dumps(query("select c.snapshot_id,m.model,(select jsonb_object_agg(s.candidate_key,s.pairs) from public.statistics_shards s where s.snapshot_id=c.snapshot_id and s.candidate_key in ('58:Top','164:Top','64:Jungle')) shards from public.statistics_current c join public.statistics_calibrations m on m.snapshot_id=c.snapshot_id")[0]))
`],{encoding:'utf8'}));
const snapshot=row.snapshot_id,pairs=row.shards['58:Top'],model=row.model;
const adjusted=p=>p?.delta2==null||!p.games ? null : model.k===null?0:p.delta2*p.games/(p.games+model.k);
const mean=values=>{const known=values.filter(v=>v!==null);return known.length?known.reduce((a,b)=>a+b,0)/known.length:null;};
const format=value=>value===null?'N/A':`${value<0?'-':'+'}${(Math.round((Math.abs(value)+Number.EPSILON)*100)/100).toFixed(2)}`;
function candidate(id,role,allyId,allyRole){
 const list=row.shards[`${id}:${role}`]??[];
 return mean([adjusted(list.find(p=>p.relation==='vs'&&p.otherChampionId==='799'&&p.otherRole==='Top')),
  adjusted(list.find(p=>p.relation==='with'&&p.otherChampionId===allyId&&p.otherRole===allyRole))]);
}
const against=pairs.find(p=>p.relation==='vs'&&p.otherChampionId==='799'&&p.otherRole==='Top');
const withAlly=pairs.find(p=>p.relation==='with'&&p.otherChampionId==='64'&&p.otherRole==='Jungle');
if(against?.delta2==null||withAlly?.delta2==null)throw Error('Canonical verification pairs are missing');
const expected=candidate('58','Top','64','Jungle'),label=format(expected);
const expectedTeam=mean([expected,candidate('64','Jungle','58','Top')]);
const expectedCamilleTeam=mean([candidate('164','Top','64','Jungle'),candidate('64','Jungle','164','Top')]);
const browser=await chromium.launch({
  executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',
  // Trust only the known environment proxy CA when Chromium's NSS store lags
  // behind the supplied system trust. Never disable HTTPS checks globally.
  args:process.env.CHROMIUM_TRUSTED_PROXY_SPKI ? [`--ignore-certificate-errors-spki-list=${process.env.CHROMIUM_TRUSTED_PROXY_SPKI}`] : [],
});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const proof={checkedAt:new Date().toISOString(),site:base,sourceRequests:0,shardRequests:0,expectedScore:label,k:model.k,expectedTeam:format(expectedTeam),expectedCamilleTeam:format(expectedCamilleTeam)};
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
  await page.getByRole('textbox',{name:'Search champions'}).fill('Camille');
  await page.getByRole('button',{name:'Camille',exact:true}).click();
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
  await score.locator('..').hover();
  const details=page.getByRole('tooltip');
  await details.getByLabel(`Against Top Ambessa: ${format(adjusted(against))}`,{exact:true}).waitFor();
  await details.getByLabel(`With Jungle Lee Sin: ${format(adjusted(withAlly))}`,{exact:true}).waitFor();
  proof.details=await details.innerText();
  if(!proof.details.includes('2/2 pairs'))throw Error('Incomplete source coverage for verification pair');
  if(!proof.details.includes('Adjusted values')||proof.details.includes('Raw values'))throw Error('Unexpected raw contribution presentation');
  await page.getByRole('region',{name:'Top ally picks'}).getByRole('button',{name:'Pick Renekton Top ally',exact:true}).click();
  const team=page.getByRole('group',{name:'Our team score',exact:true});
  await expect(team).toContainText(format(expectedTeam));await expect(team).toContainText('4/4 pairs');
  proof.displayedTeam=await team.innerText();
  await page.getByRole('region',{name:'Top ally picks'}).locator('[data-champion="164"]').hover();
  const preview=page.getByRole('tooltip').getByLabel('Team score preview');
  await expect(preview).toContainText(format(expectedCamilleTeam));
  await expect(preview).toContainText(format(expectedCamilleTeam-expectedTeam));
  proof.candidatePreview=await preview.innerText();
  const note=page.getByRole('note',{name:'How scores work'});await expect(note).toContainText('Learned k');
  proof.explanation=await note.innerText();
  await page.screenshot({path:resolve(output,'production-real-statistics.png')});
  await page.getByRole('heading',{name:'Draft board',exact:true}).hover();
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('region',{name:'Top ally picks'}).locator('[data-champion="58"] .tile-score').filter({hasText:label}).waitFor({timeout:30000});
  proof.reloadPreservedScore=true;
  await expect(page.getByRole('group',{name:'Our team score',exact:true})).toContainText(format(expectedTeam));
  proof.reloadPreservedTeamScore=true;
  await Promise.all(shardTasks);
  if(proof.sourceRequests!==0||proof.shardRequests===0)throw Error('Unexpected statistics request path');
  proof.success=true;
}finally{
  if(roomCreated){
    try{
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
