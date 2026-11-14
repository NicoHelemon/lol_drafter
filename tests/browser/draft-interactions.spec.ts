import {test,expect,type Page} from '@playwright/test';
import {makePickSwap} from '../../src/domain/pickSwaps';
import {ROLES,type Room,type State} from '../../src/domain/types';
import {DEMO_MODEL} from '../../src/domain/shrinkage';
import {mkdirSync} from 'node:fs';
test.use({viewport:{width:1440,height:1360}});
function fixture(options:{emptyReceiver?:boolean;missing?:boolean}={}) {
 const state:State={shrinkage:{...DEMO_MODEL},phase:'live',side:'blue',players:[],picks:{ally:[],enemy:[]},bans:{ally:Array(5).fill(null),enemy:Array(5).fill(null)},history:[],dataset:{id:'synthetic-hover-fixture',patch:'Test',tier:'Emerald+',source:'Synthetic browser fixture',importedAt:new Date().toISOString(),fictional:true,pairs:[]}};
 state.players=[{id:'local-player',name:'Nico',role:'Mid',pool:['103','7','61']},
  {id:'top-player',name:'Chloe',role:'Top',pool:['31']},
  {id:'jungle-player',name:'Alex',role:'Jungle',pool:['64']},
  {id:'bottom-player',name:'Sam',role:'ADC',pool:['202']},
  {id:'support-player',name:'Lou',role:'Support',pool:['89']}];
 state.picks={ally:ROLES.map((role,i)=>({role,championId:['31','64','103','202','89'][i]})).filter(p=>!options.emptyReceiver||p.role!=='Mid'),
  enemy:ROLES.map((role,i)=>({role,championId:['122','56','84','51','267'][i]}))};
 state.dataset={...state.dataset,id:'synthetic-hover-fixture',source:'Synthetic browser fixture',fictional:true,pairs:[]};
 for(const candidate of ['103','7','61']){
  const offset=candidate==='7'?2:candidate==='61'?1:0;
  state.picks.enemy.forEach((p,i)=>state.dataset.pairs.push({relation:'vs',candidateChampionId:candidate,candidateRole:'Mid',otherChampionId:p.championId,otherRole:p.role,delta2:[-2.82,3.41,-.72,0,1.5][i]+offset,games:625}));
  state.picks.ally.filter(p=>p.role!=='Mid').forEach((p,i)=>state.dataset.pairs.push({relation:'with',candidateChampionId:candidate,candidateRole:'Mid',otherChampionId:p.championId,otherRole:p.role,delta2:[1.6,-.1,2.25,1.17][i]+offset,games:625}));
 }
 if(options.missing)state.dataset.pairs=state.dataset.pairs.filter(p=>!(p.candidateChampionId==='103'&&p.relation==='with'&&p.otherRole==='Top'));
 return {id:'browser-draft',slug:'draft-ui-room',name:"Nico's room",host_id:'local-player',version:0,state} satisfies Room;
}
async function seed(page:Page,options:{emptyReceiver?:boolean;missing?:boolean;request?:'incoming'|'outgoing'}={}){
 const room=fixture(options),q=options.request ? makePickSwap(room,options.request==='incoming'?'Top':'Mid',options.request==='incoming'?'Mid':'Top',options.request==='incoming'?'top-player':'local-player') : null;
 await page.goto('/');await page.evaluate(({room,q})=>{
  localStorage.setItem('draftroom-demo',JSON.stringify(room));localStorage.setItem('draftroom-current',room.slug);
  if(q)localStorage.setItem(`draftroom-pick-swaps-${room.id}`,JSON.stringify([{...q,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+5000).toISOString()}]));
 },{room,q});
 await page.goto(`/rooms/${room.slug}/draft`);
 await expect(page.getByRole('heading',{name:'Draft board',exact:true})).toBeVisible();
 return room;
}
const cell=(page:Page,role:string,team='ally')=>page.getByRole('region',{name:`${role} ${team} picks`,exact:true});
const state=(page:Page)=>page.evaluate(()=>JSON.parse(localStorage.getItem('draftroom-demo')!).state);

test('compact candidates keep the selected size and hover shows nine adjusted, role-aligned contributions',async({page})=>{
 await page.setViewportSize({width:1440,height:1360});await seed(page);
 const mid=cell(page,'Mid'),selected=mid.locator('[data-champion="103"]'),candidate=mid.locator('[data-champion="7"]');
 expect((await selected.boundingBox())!.width).toBe(72);
 expect((await candidate.boundingBox())!.width).toBe(52);
 expect((await mid.getByRole('button',{name:'Add Mid candidates'}).boundingBox())!.width).toBe(52);
 expect(await mid.locator('.draft-champion-tile').first().getAttribute('data-champion')).toBe('103');
 await selected.hover();const tooltip=page.getByRole('tooltip');
 await expect(tooltip).toContainText('9/9 pairs');await expect(tooltip).toContainText('+0.35');
 await expect(tooltip.locator('.contribution-row')).toHaveCount(5);
 await expect(tooltip.locator('.portrait')).toHaveCount(9);
 await expect(tooltip.getByLabel(/With Top Cho.Gath/)).toContainText('+0.80');
 await expect(tooltip.getByLabel(/Against Top Darius/)).toContainText('-1.41');
 await expect(tooltip.getByLabel(/Against Top Darius/).locator('b')).toHaveClass('negative');
 await expect(tooltip.getByLabel(/With Top Cho.Gath/).locator('b')).toHaveClass('positive');
 await expect(tooltip.getByLabel(/Against Bottom Caitlyn/).locator('b')).toHaveClass('neutral');
 await expect(tooltip.getByLabel('With Mid: candidate role')).toContainText('—');
 expect(await tooltip.innerText()).not.toContain('×');
 const screenshots=process.env.DRAFT_REVIEW_SCREENSHOTS ?? 'test-results';
 mkdirSync(screenshots,{recursive:true});
 await page.screenshot({path:`${screenshots}/draft-contributions-desktop.png`,fullPage:true});
 await selected.getByRole('button').focus();await candidate.hover();
 await expect(page.getByRole('tooltip')).toHaveCount(1);await expect(page.getByRole('tooltip')).toContainText('LeBlanc');
 await page.getByRole('heading',{name:'Draft board',exact:true}).hover();await expect(page.getByRole('tooltip')).toHaveCount(0);
 await page.keyboard.press('Tab');
 await selected.getByRole('button').focus();await expect(page.getByRole('tooltip')).toBeVisible();
 await page.keyboard.press('Escape');await expect(page.getByRole('tooltip')).toHaveCount(0);
 await page.setViewportSize({width:390,height:844});await selected.hover();
 const box=(await page.getByRole('tooltip').boundingBox())!;
 expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);
 expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(844);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`${screenshots}/draft-contributions-mobile.png`,fullPage:true});
 await page.locator('header a.brand').focus();await selected.hover();
 await expect(page.getByRole('tooltip')).toBeVisible();await page.keyboard.press('Escape');
 await expect(page.getByRole('tooltip')).toHaveCount(0);
});
test('hover preserves missing values and real zeros, and opening it does not change picks',async({page})=>{
 const room=await seed(page,{missing:true});await cell(page,'Mid').locator('[data-champion="103"]').hover();
 const tooltip=page.getByRole('tooltip');await expect(tooltip).toContainText('8/9 pairs');
 await expect(tooltip.getByLabel(/With Top Cho.Gath/)).toContainText('N/A');
 await expect(tooltip.getByLabel(/Against Bottom Caitlyn/)).toContainText('+0.00');
 expect((await state(page)).picks).toEqual(room.state.picks);
});
test('team summary and candidate preview include the changed contributions of other allies',async({page})=>{
 await seed(page);
 await page.evaluate(()=>{
  const r=JSON.parse(localStorage.getItem('draftroom-demo')!);
  r.state.dataset.pairs.push(...[['103',2],['7',8]].map(([id,delta])=>({relation:'with',candidateChampionId:'31',candidateRole:'Top',otherChampionId:id,otherRole:'Mid',delta2:delta,games:625})));
  localStorage.setItem('draftroom-demo',JSON.stringify(r));
 });
 await page.reload();
 const summary=page.getByRole('group',{name:'Our team score',exact:true});
 await expect(summary).toContainText('+0.67');await expect(summary).toContainText('Provisional');
 await expect(summary).toContainText('10/45 pairs');await expect(summary).toContainText('2 scored');
 const before=(await state(page)).picks;
 await cell(page,'Mid').locator('[data-champion="7"]').hover();
 const preview=page.getByRole('tooltip').getByLabel('Team score preview');
 await expect(preview).toContainText('Team with LeBlanc');await expect(preview).toContainText('+2.67');
 await expect(preview).toContainText('+2.00');
 expect((await state(page)).picks).toEqual(before);
 const screenshots=process.env.DRAFT_REVIEW_SCREENSHOTS ?? 'test-results';mkdirSync(screenshots,{recursive:true});
 await page.screenshot({path:`${screenshots}/team-candidate-preview.png`,fullPage:true});
 await cell(page,'Mid').getByRole('button',{name:'Pick LeBlanc Mid ally',exact:true}).click();
 await expect(summary).toContainText('+2.67');
 await expect(page.getByRole('note',{name:'How scores work'})).toContainText('Demo k = 625');
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('an uncalibrated dataset shows no raw score disguised as an adjusted one',async({page})=>{
 await seed(page);await page.evaluate(()=>{
  const r=JSON.parse(localStorage.getItem('draftroom-demo')!);delete r.state.shrinkage;localStorage.setItem('draftroom-demo',JSON.stringify(r));
 });await page.reload();
 await expect(cell(page,'Mid').locator('[data-champion="103"] .tile-score')).toContainText('N/A');
 await expect(page.getByRole('note',{name:'How scores work'})).toContainText('unavailable until this dataset has a calibration');
});
test('native drag exchanges enemy picks, rejects cross-team drops, and supports keyboard role targeting',async({page})=>{
 await page.setViewportSize({width:1440,height:1360});await seed(page);
 await cell(page,'Top','enemy').locator('[data-champion="122"]').dragTo(cell(page,'Jungle','enemy'));
 await expect(cell(page,'Top','enemy').locator('[data-champion="56"]')).toBeVisible();
 await expect(cell(page,'Jungle','enemy').locator('[data-champion="122"]')).toBeVisible();
 const before=(await state(page)).picks;
 await cell(page,'Jungle','enemy').locator('[data-champion="122"]').dragTo(cell(page,'Top','ally'));
 expect((await state(page)).picks).toEqual(before);
 await cell(page,'Jungle','enemy').getByRole('button',{name:'Move Darius enemy',exact:true}).click();
 await cell(page,'Support','enemy').focus();await page.keyboard.press('Enter');
 await expect(cell(page,'Support','enemy').locator('[data-champion="122"]')).toBeVisible();
 await expect(cell(page,'Jungle','enemy').locator('[data-champion="267"]')).toBeVisible();
 await expect(page.getByRole('combobox')).toHaveCount(0);
});
test('dragging between two allied players waits for consent and can be cancelled',async({page})=>{
 const room=await seed(page);
 await cell(page,'Mid').locator('[data-champion="103"]').dragTo(cell(page,'Top'));
 const dialog=page.getByRole('dialog',{name:'Champion swap pending'});await expect(dialog).toBeVisible();
 await expect(dialog).toContainText('Nico');await expect(dialog).toContainText('Chloe');
 expect((await state(page)).picks).toEqual(room.state.picks);
 await expect(dialog.getByRole('progressbar')).toBeVisible();
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 await expect(dialog).toHaveCount(0);expect((await state(page)).picks).toEqual(room.state.picks);
});
test('an allied player without a selection can receive a champion and leave the sender empty',async({page})=>{
 const room=await seed(page,{emptyReceiver:true,request:'incoming'});
 const dialog=page.getByRole('dialog',{name:'Champion swap request'});
 await expect(dialog).toContainText('Receive champion?');
 const screenshots=process.env.DRAFT_REVIEW_SCREENSHOTS ?? 'test-results';mkdirSync(screenshots,{recursive:true});
 await page.screenshot({path:`${screenshots}/champion-receive.png`,fullPage:true});
 await dialog.getByRole('button',{name:'Receive champion',exact:true}).click();
 await expect(dialog).toHaveCount(0);
 await expect(cell(page,'Mid').locator('.tile-selected')).toHaveAttribute('data-champion','31');
 await expect(cell(page,'Top').locator('.tile-selected')).toHaveCount(0);
 expect((await state(page)).players).toEqual(room.state.players);
});
test('incoming exchanges accept or decline, and the same request cannot be accepted after five seconds',async({page})=>{
 const initial=await seed(page,{request:'incoming'});
 let dialog=page.getByRole('dialog',{name:'Champion swap request'});
 await dialog.getByRole('button',{name:'Accept',exact:true}).click();
 await expect(dialog).toHaveCount(0);
 await expect(cell(page,'Mid').locator('.tile-selected')).toHaveAttribute('data-champion','31');
 await expect(cell(page,'Top').locator('.tile-selected')).toHaveAttribute('data-champion','103');
 await seed(page,{request:'incoming'});dialog=page.getByRole('dialog',{name:'Champion swap request'});
 await dialog.getByRole('button',{name:'Decline',exact:true}).click();
 expect((await state(page)).picks).toEqual(initial.state.picks);
 await seed(page,{request:'incoming'});await page.clock.install();
 await expect(page.getByRole('dialog',{name:'Champion swap request'})).toBeVisible();
 await page.clock.fastForward(5001);await expect(page.getByRole('dialog',{name:'Champion swap request'})).toHaveCount(0);
 expect((await state(page)).picks).toEqual(initial.state.picks);
});
