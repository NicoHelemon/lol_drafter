import {test,expect,type Page} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {draftStages,teamFor} from '../../src/domain/progression';
import type {State,DraftMode} from '../../src/domain/types';
const folder=process.env.DRAFT_REVIEW_SCREENSHOTS??'test-results';
async function create(page:Page,mode:DraftMode,side:'blue'|'red'='blue'){
 await page.goto('/');await page.getByPlaceholder('Your name').fill('Guided check');
 await page.getByRole('button',{name:mode==='ranked'?'Ranked draft':'Tournament draft',exact:true}).click();
 await page.getByRole('button',{name:'Open local demo'}).click();
 await page.getByRole('region',{name:'Ally team side',exact:true}).getByRole('button',{name:side==='blue'?'Blue side, first pick':'Red side, second pick',exact:true}).click();
}
const state=(page:Page)=>page.evaluate(()=>JSON.parse(localStorage.getItem('draftroom-demo')!).state as State);
async function pick(page:Page,team:string){
 const regions=page.locator(`.draft-cell.${team}.current-pick`);
 for(let i=0;i<await regions.count();i++){
  const region=regions.nth(i);if(await region.locator('.tile-selected').count())continue;
  const choices=region.locator('.champion-choice:enabled');if(await choices.count()){await choices.first().click();return;}
 }
 throw Error('No available current pick');
}
test('ranked has a compact square map, batch bans, automatic grouped picks and Clear retaining preparation',async({page})=>{
 await create(page,'ranked','red');
 await expect(page.getByRole('group',{name:/ role$/})).toHaveCount(5);
 await expect(page.getByText('Choose your side',{exact:true})).toHaveCount(0);await expect(page.locator('.dataset-note')).toHaveCount(0);
 const layout=await page.locator('.side-roster-row').evaluate(row=>{const map=row.querySelector('.side-map')!.getBoundingClientRect(),roles=row.querySelector('.roster')!.getBoundingClientRect();return {square:Math.abs(map.width-map.height),ratio:map.width/(map.width+roles.width),aligned:Math.abs(map.top-roles.top)};});
 expect(layout.square).toBeLessThan(1);expect(layout.ratio).toBeCloseTo(.2,1);expect(layout.aligned).toBeLessThan(1);
 await expect(page.getByRole('button',{name:'Red side, second pick'})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('group',{name:'Mid role',exact:true}).getByRole('button',{name:'Join',exact:true}).click();
 await page.getByRole('button',{name:'Add champion to Top pool',exact:true}).click();await page.getByRole('button',{name:'Filter Top',exact:true}).click();await page.getByRole('textbox',{name:'Search champions'}).fill('Ahri');await page.getByRole('button',{name:'Ahri',exact:true}).click();await page.getByRole('button',{name:'Close',exact:true}).click();
 const prepared=await state(page);
 mkdirSync(folder,{recursive:true});await page.screenshot({path:folder+'/ranked-lobby-side.png',fullPage:true,animations:'disabled'});
 await page.getByRole('button',{name:'Start draft'}).click();await expect(page.getByRole('region',{name:'Draft progression'})).toContainText('Both teams');
 for(const region of await page.locator('.draft-cell').all())await expect(region.locator('.draft-champion-tile')).toHaveCount(5);
 await expect(page.locator('.champion-choice:enabled')).toHaveCount(0);
 for(const team of ['ally','enemy']){
  await page.getByRole('button',{name:`Ban 1 ${team}`,exact:true}).click();
  for(const name of ['Aatrox','Ahri','Akali','Akshan','Alistar']){
   await page.getByRole('textbox',{name:'Search champions'}).fill(name);await page.getByRole('button',{name,exact:true}).click();
   if(name!=='Alistar'||team==='ally')await expect(page.getByRole('dialog')).toBeVisible();
  }
  if(team==='ally')await page.getByRole('button',{name:'Close',exact:true}).click();
 }
 await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('region',{name:'Draft progression'})).toContainText('Blue team · 1st pick');
 const square=await page.getByRole('button',{name:'Ban 1 ally',exact:true}).boundingBox();expect(Math.abs(square!.width-square!.height)).toBeLessThan(1);
 await expect(page.locator('.draft-cell.ally .champion-choice:enabled')).toHaveCount(0);await pick(page,'enemy');
 await expect(page.getByRole('region',{name:'Draft progression'})).toContainText('Red team · 1st and 2nd picks');
 await pick(page,'ally');await expect(page.getByRole('region',{name:'Draft progression'})).toContainText('Red team · 1st and 2nd picks');await pick(page,'ally');
 await expect(page.getByRole('region',{name:'Draft progression'})).toContainText('Blue team · 2nd and 3rd picks');
 await expect(page.getByRole('button',{name:/^Confirm/})).toHaveCount(0);
 await page.screenshot({path:folder+'/ranked-two-picks.png',fullPage:true,animations:'disabled'});
 await page.reload();await page.getByRole('button',{name:'Undo'}).click();await expect(page.getByRole('region',{name:'Draft progression'})).toContainText('Red team · 1st and 2nd picks');
 await page.getByRole('button',{name:'Clear',exact:true}).click();const cleared=await state(page);
 expect(cleared.draftStep).toBe(0);expect(cleared.draftHistory).toEqual([]);expect(cleared.picks).toEqual({ally:[],enemy:[]});expect([...cleared.bans.ally,...cleared.bans.enemy].filter(Boolean)).toEqual([]);
 expect(cleared.players).toEqual(prepared.players);expect(cleared.rolePools).toEqual(prepared.rolePools);expect(cleared.side).toBe('red');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('tournament complementary side maps control each other and selected/unselected regions are colored/gray',async({page})=>{
 await create(page,'tournament');
 const ally=page.getByRole('region',{name:'Ally team side',exact:true}),enemy=page.getByRole('region',{name:'Enemy team side',exact:true});
 await expect(ally.getByRole('button',{name:'Blue side, first pick'})).toHaveAttribute('aria-pressed','true');await expect(enemy.getByRole('button',{name:'Red side, second pick'})).toHaveAttribute('aria-pressed','true');
 await enemy.getByRole('button',{name:'Blue side, first pick'}).click();await expect(ally.getByRole('button',{name:'Red side, second pick'})).toHaveAttribute('aria-pressed','true');
 await ally.getByRole('button',{name:'Blue side, first pick'}).click();await expect(enemy.getByRole('button',{name:'Red side, second pick'})).toHaveAttribute('aria-pressed','true');
 expect(await ally.locator('.map-red').evaluate(node=>getComputedStyle(node).fill)).toBe(await enemy.locator('.map-blue').evaluate(node=>getComputedStyle(node).fill));
 await expect(page.getByRole('heading',{name:'Ally team',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Enemy team',exact:true})).toBeVisible();
 mkdirSync(folder,{recursive:true});await page.screenshot({path:folder+'/tournament-lobby-sides.png',fullPage:true,animations:'disabled'});
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('tournament auto-advances actual bans and grouped picks, with spaced side-colored highlights',async({page})=>{
 await create(page,'tournament');await expect(page.getByRole('group',{name:/ role$/})).toHaveCount(10);await page.getByRole('button',{name:'Start draft'}).click();
 const stages=draftStages('tournament');
 for(let index=0;index<stages.length;index++){
  const current=stages[index];await expect(page.getByRole('region',{name:'Draft progression'})).toContainText(current.label);
  if(current.kind==='pick'){
   const s=await state(page);for(let i=0;i<current.count;i++)await pick(page,teamFor(s,current.side!));
  }else{
   const s=await state(page),team=teamFor(s,current.side!);
   if(current.slot===3){mkdirSync(folder,{recursive:true});await page.screenshot({path:folder+`/tournament-ban-${current.side}.png`,fullPage:true,animations:'disabled'});}
   const highlighted=page.locator(`.team-bans.${team}.current-bans`),banner=page.locator('.draft-progress');
   const box=await highlighted.boundingBox(),bar=await banner.boundingBox();expect(box!.y).toBeGreaterThan(bar!.y+bar!.height+10);
   const visual=await highlighted.evaluate(el=>({border:getComputedStyle(el).borderTopColor,transform:getComputedStyle(el).transform,shadow:getComputedStyle(el).boxShadow}));
   expect(visual.border).toBe(current.side==='blue'?'rgb(87, 181, 255)':'rgb(255, 113, 133)');await expect.poll(()=>highlighted.evaluate(el=>getComputedStyle(el).transform)).toContain('1.05');expect(visual.shadow).not.toBe('none');
   if(index===0)await page.getByRole('button',{name:'No ban',exact:true}).click();
   else {await page.getByRole('button',{name:`Ban ${current.slot!+1} ${team}`,exact:true}).click();await page.locator('.champion-grid .champion:enabled').first().click();await expect(page.getByRole('dialog')).toHaveCount(0);}
  }
 }
 await expect(page.getByRole('region',{name:'Draft progression'})).toContainText('Draft complete');await expect(page.locator('.tile-selected')).toHaveCount(10);await expect(page.locator('.champion-choice:enabled')).toHaveCount(0);
 await page.screenshot({path:folder+'/tournament-complete.png',fullPage:true,animations:'disabled'});
});
test('Undo/Redo follows individual choices and shortcuts, while Open draft stays open through history and Clear',async({page})=>{
 await create(page,'ranked','red');await page.getByRole('button',{name:'Start draft'}).click();await page.getByRole('button',{name:'Skip remaining bans',exact:true}).click();
 const progress=page.getByRole('region',{name:'Draft progression'}),undo=page.getByRole('button',{name:'Undo',exact:true}),redo=page.getByRole('button',{name:'Redo',exact:true});
 await pick(page,'enemy');await expect(progress).toContainText('Red team · 1st and 2nd picks');
 await page.keyboard.press('Control+z');await expect(progress).toContainText('Blue team · 1st pick');await expect(page.locator('.tile-selected')).toHaveCount(0);
 await page.keyboard.press('Control+y');await expect(progress).toContainText('Red team · 1st and 2nd picks');await expect(page.locator('.tile-selected')).toHaveCount(1);
 await pick(page,'ally');await expect(page.locator('.tile-selected')).toHaveCount(2);await undo.click();await expect(page.locator('.tile-selected')).toHaveCount(1);await redo.click();await expect(page.locator('.tile-selected')).toHaveCount(2);
 await pick(page,'ally');await expect(progress).toContainText('Blue team · 2nd and 3rd picks');await undo.click();await expect(progress).toContainText('Red team · 1st and 2nd picks');await expect(page.locator('.tile-selected')).toHaveCount(2);
 await page.reload();await expect(redo).toBeEnabled();await redo.click();await expect(progress).toContainText('Blue team · 2nd and 3rd picks');
 await expect(page.locator('.pick-actions button')).toHaveCount(0);await expect(page.locator('.remove-ban')).toHaveCount(0);await expect(page.getByRole('button',{name:'Previous step',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Add Mid candidates',exact:true}).click();const saved=await state(page);await page.getByRole('textbox',{name:'Search champions'}).pressSequentially('ahri');await page.keyboard.press('Control+z');expect((await state(page)).picks).toEqual(saved.picks);await page.getByRole('button',{name:'Close',exact:true}).click();
 await page.getByRole('button',{name:'Open draft',exact:true}).click();await expect(progress).toContainText('Open draft');await expect(undo).toBeDisabled();await expect(redo).toBeDisabled();await expect(page.getByRole('button',{name:'Open draft',exact:true})).toHaveCount(0);await expect(page.locator('.pick-actions button')).toHaveCount(3);
 const support=page.getByRole('region',{name:'Support enemy picks',exact:true});await support.locator('.champion-choice:enabled').first().click();await expect(page.locator('.tile-selected')).toHaveCount(4);
 await undo.click();await expect(page.locator('.tile-selected')).toHaveCount(3);await redo.click();await expect(page.locator('.tile-selected')).toHaveCount(4);
 await page.getByRole('button',{name:'Clear',exact:true}).click();await expect(page.locator('.tile-selected')).toHaveCount(0);await undo.click();await expect(page.locator('.tile-selected')).toHaveCount(4);expect((await state(page)).openDraft).toBe(true);
 await page.reload();await expect(progress).toContainText('Open draft');await expect(redo).toBeEnabled();await support.locator('.pick-actions button').click();await expect(page.locator('.tile-selected')).toHaveCount(3);await expect(redo).toBeDisabled();
 mkdirSync(folder,{recursive:true});await page.screenshot({path:folder+'/open-draft-history.png',fullPage:true,animations:'disabled'});
});
test('guided restart and Return to lobby require confirmation, keep roles and candidates, and reset choices/history',async({page})=>{
 await page.goto('/');await expect(page.getByText('No account required · up to five players',{exact:true})).toHaveCount(0);await expect(page.getByText('Demo statistics are fictional.',{exact:true})).toHaveCount(0);
 await create(page,'tournament');await page.getByRole('group',{name:'Top role',exact:true}).getByRole('button',{name:'Join',exact:true}).click();await page.getByRole('button',{name:'Add champion to Top pool',exact:true}).click();await page.getByRole('textbox',{name:'Search champions'}).fill('Renekton');await page.getByRole('button',{name:'Renekton',exact:true}).click();await page.getByRole('button',{name:'Close',exact:true}).click();const prepared=await state(page);
 await page.getByRole('button',{name:'Start draft'}).click();await page.getByRole('button',{name:'Open draft',exact:true}).click();await page.getByRole('region',{name:'Top ally picks',exact:true}).getByRole('button',{name:'Pick Renekton Top ally',exact:true}).click();
 page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Guided draft',exact:true}).click();await expect(page.locator('.tile-selected')).toHaveCount(1);expect((await state(page)).openDraft).toBe(true);
 page.once('dialog',async d=>{expect(d.message()).toContain('Picks, bans and undo history will be cleared');await d.accept();});await page.getByRole('button',{name:'Guided draft',exact:true}).click();await expect(page.getByRole('region',{name:'Draft progression'})).toContainText('Blue team · 1st ban');await expect(page.locator('.tile-selected')).toHaveCount(0);await expect(page.getByRole('button',{name:'Undo',exact:true})).toBeDisabled();expect((await state(page)).players).toEqual(prepared.players);
 await page.getByRole('button',{name:'Open draft',exact:true}).click();page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Return to lobby',exact:true}).click();await expect(page.getByRole('heading',{name:'Draft board',exact:true})).toBeVisible();
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Return to lobby',exact:true}).click();await expect(page.getByRole('region',{name:'Room preparation'})).toBeVisible();await expect(page.getByRole('button',{name:'Quit room',exact:true})).toBeVisible();expect((await state(page)).players).toEqual(prepared.players);await page.reload();await expect(page.getByRole('button',{name:'Start draft'})).toBeVisible();await page.getByRole('button',{name:'Start draft'}).click();await expect(page.getByRole('region',{name:'Draft progression'})).toContainText('Blue team · 1st ban');
});
test('observers see participant counts and scores without role, candidate, pick or ban controls',async({page})=>{
 await create(page,'tournament');await page.evaluate(()=>{const r=JSON.parse(localStorage.getItem('draftroom-demo')!);r.host_id='other-host';r.state.players=[{id:'other-host',name:'Host',role:'Top',pool:[]},{id:'local-player',name:'Viewer',role:null,pool:[]}];localStorage.setItem('draftroom-demo',JSON.stringify(r));});await page.reload();
 await expect(page.getByRole('region',{name:'Room participants'})).toContainText('2/10 participants');await expect(page.getByRole('region',{name:'Observers',exact:true})).toContainText('Viewer');await expect(page.getByRole('button',{name:'Join',exact:true})).toHaveCount(4);await expect(page.getByRole('button',{name:/^Add champion to/})).toHaveCount(0);await expect(page.getByRole('button',{name:'Quit room',exact:true})).toBeEnabled();
 await page.evaluate(()=>{const r=JSON.parse(localStorage.getItem('draftroom-demo')!);r.state.phase='live';r.state.draftStep=0;r.state.draftHistory=[];localStorage.setItem('draftroom-demo',JSON.stringify(r));});await page.reload();await expect(page.getByRole('heading',{name:'Draft board',exact:true})).toBeVisible();await expect(page.locator('.champion-choice:enabled,.bans button:enabled,.board-add:enabled')).toHaveCount(0);await expect(page.getByRole('button',{name:'Open draft',exact:true})).toHaveCount(0);
});

test('host can observe, transfer hosting with confirmation, and header actions explain their purpose',async({page})=>{
 await create(page,'tournament');await page.getByRole('group',{name:'Top role',exact:true}).getByRole('button',{name:'Join',exact:true}).click();
 await page.evaluate(()=>{const r=JSON.parse(localStorage.getItem('draftroom-demo')!);r.state.players.push({id:'new-host',name:'New host',role:null,pool:[]});localStorage.setItem('draftroom-demo',JSON.stringify(r));});await page.reload();
 await expect(page.getByRole('region',{name:'Room participants'})).toContainText('2/10 participants');await expect(page.getByRole('button',{name:'Start draft'})).toHaveAttribute('title',/order/);await expect(page.getByRole('button',{name:'Quit room',exact:true})).toHaveAttribute('title',/personally/);
 await page.getByRole('button',{name:'Start draft'}).click();await page.getByRole('button',{name:'Open draft',exact:true}).click();await page.getByRole('region',{name:'Top ally picks',exact:true}).locator('.champion-choice:enabled').first().click();
 for(const label of ['Guided draft','Clear','Return to lobby','Join observers'])await expect(page.getByRole('button',{name:label,exact:true})).toHaveAttribute('title',/.{15,}/);
 await page.getByRole('button',{name:'Join observers',exact:true}).click();await expect(page.locator('.tile-selected')).toHaveCount(1);expect((await state(page)).players[0].role).toBeNull();await expect(page.getByRole('button',{name:'Clear',exact:true})).toBeEnabled();
 page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Make New host host',exact:true}).click();await expect(page.getByRole('button',{name:'Clear',exact:true})).toBeVisible();
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Make New host host',exact:true}).click();await expect(page.getByRole('button',{name:'Clear',exact:true})).toHaveCount(0);await expect(page.getByRole('region',{name:'Room participants'})).toContainText('New host');await expect(page.getByText('You are observing. Take an available role to participate.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Move to Mid role',exact:true}).click();expect((await state(page)).players[0].role).toBe('Mid');await expect(page.getByText('You are observing. Take an available role to participate.',{exact:true})).toHaveCount(0);
});

test('dropping your role into the observers area clears its candidates while keeping the selected champion',async({page})=>{
 await create(page,'tournament');await page.getByRole('group',{name:'Top role',exact:true}).getByRole('button',{name:'Join',exact:true}).click();await page.getByRole('button',{name:'Add champion to Top pool',exact:true}).click();await page.getByRole('textbox',{name:'Search champions'}).fill('Renekton');await page.getByRole('button',{name:'Renekton',exact:true}).click();await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'Start draft'}).click();await page.getByRole('button',{name:'Open draft',exact:true}).click();await page.getByRole('region',{name:'Top ally picks',exact:true}).getByRole('button',{name:'Pick Renekton Top ally',exact:true}).click();await page.getByRole('button',{name:'Move your Top role',exact:true}).dragTo(page.getByRole('region',{name:'Observers',exact:true}));await expect(page.getByRole('button',{name:'Join observers',exact:true})).toBeDisabled();await expect(page.locator('.tile-selected')).toHaveCount(1);const result=await state(page);expect(result.players[0].role).toBeNull();expect(result.rolePools?.ally?.Top).toEqual([]);expect(result.picks.ally).toContainEqual({role:'Top',championId:'58'});
});
