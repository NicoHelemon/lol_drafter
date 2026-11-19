import {test,expect,type Page} from '@playwright/test';
import {fitState} from '../fixtures/best-fit-state';
import type {Pair,Room} from '../../src/domain/types';

function fixture(ally=-.02,enemy=.16,side:'blue'|'red'='blue'):Room{
 const state=fitState();state.side=side;
 state.players[0]={id:'local-player',name:'Fit check',role:'Mid',pool:['103','112','61']};
 state.picks.ally=[{championId:'58',role:'Top'}];
 state.dataset.pairs.push(...state.roleCatalogue!.entries.map((e):Pair=>({candidateChampionId:e.championId,candidateRole:'Mid',otherChampionId:'58',otherRole:'Top',relation:'with',delta2:0,games:10000})));
 state.dataset.pairs.push(
  {candidateChampionId:'58',candidateRole:'Top',otherChampionId:'54',otherRole:'Top',relation:'vs',delta2:ally*90,games:625},
  {candidateChampionId:'54',candidateRole:'Top',otherChampionId:'58',otherRole:'Top',relation:'vs',delta2:enemy*90,games:625});
 return {id:'fits-and-advantage',slug:'fits-and-advantage',name:'Fit check room',host_id:'local-player',version:0,state};
}
async function seed(page:Page,room=fixture()){
 await page.goto('/');
 await page.evaluate(room=>{
  localStorage.removeItem('draftroom-show-best-fits');
  localStorage.setItem('draftroom-demo',JSON.stringify(room));localStorage.setItem('draftroom-current',room.slug);
 },room);
 await page.goto('/rooms/fits-and-advantage/draft');
 await expect(page.getByRole('heading',{name:'Draft board',exact:true})).toBeVisible();
}
const mid=(page:Page)=>page.getByRole('region',{name:'Mid ally picks',exact:true});
test('best fits default on, merge without duplicates, preserve explicit pools and selected-first order across toggles/reload',async({page})=>{
 await seed(page);const toggle=page.getByRole('checkbox',{name:'Show best fits',exact:true});
 await expect(toggle).toBeChecked();await expect(mid(page).locator('.draft-champion-tile')).toHaveCount(5);
 await expect(mid(page).locator('[data-best-fit]')).toHaveCount(3);
 await expect(mid(page).locator('.draft-champion-tile').first()).toHaveAttribute('data-champion','112');
 await mid(page).locator('[data-champion="3"]').hover();await expect(page.getByRole('tooltip')).toContainText('one of the three highest adjusted scores');
 const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('draftroom-demo')!));
 await toggle.uncheck();await expect(mid(page).locator('.draft-champion-tile')).toHaveCount(3);
 await expect(mid(page).locator('[data-best-fit]')).toHaveCount(0);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('draftroom-demo')!))).toEqual(before);
 await page.reload();await expect(toggle).not.toBeChecked();await expect(mid(page).locator('.draft-champion-tile')).toHaveCount(3);
 await toggle.check();await mid(page).getByRole('button',{name:'Pick Galio Mid ally',exact:true}).click();
 await expect(mid(page).locator('.draft-champion-tile').first()).toHaveAttribute('data-champion','3');
 await toggle.uncheck();await expect(mid(page).locator('.draft-champion-tile')).toHaveCount(4);
 await expect(mid(page).locator('.tile-selected')).toHaveAttribute('data-champion','3');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('draftroom-demo')!).state.players[0].pool)).toEqual(['103','112','61']);
});
test('empty roles merge five popular champions with the top three rather than three missing alternatives',async({page})=>{
 const room=fixture();room.state.players[0].pool=[];await seed(page,room);
 await expect(mid(page).locator('.draft-champion-tile')).toHaveCount(7);
 await page.getByRole('checkbox',{name:'Show best fits',exact:true}).uncheck();
 await expect(mid(page).locator('.draft-champion-tile')).toHaveCount(5);
 await expect(mid(page).locator('[data-champion="112"]')).toHaveCount(0);
 await expect(mid(page).locator('[data-champion="517"]')).toHaveCount(1);
});
test('ban changes recompute best-fit membership without removing a banned explicit candidate',async({page})=>{
 await seed(page);await expect(mid(page).locator('[data-champion="112"]')).toHaveAttribute('data-best-fit','true');
 await page.getByRole('button',{name:'Ban 1 ally',exact:true}).click();
 await page.getByRole('textbox',{name:'Search champions'}).fill('Viktor');await page.getByRole('button',{name:'Viktor',exact:true}).click();
 await page.getByRole('button',{name:'Close',exact:true}).click();
 await expect(mid(page).locator('[data-champion="112"]')).not.toHaveAttribute('data-best-fit','true');
 await expect(mid(page).getByRole('button',{name:'Pick Viktor Mid ally',exact:true})).toBeDisabled();
 await expect(mid(page).locator('[data-champion="103"]')).toHaveAttribute('data-best-fit','true');
});
for(const c of [
 {a:-.02,b:.16,side:'blue' as const,text:'Enemy advantage · +0.18',color:'red',left:59},
 {a:.3,b:.1,side:'red' as const,text:'Ally advantage · +0.20',color:'red',left:40},
 {a:-.4,b:-.1,side:'blue' as const,text:'Enemy advantage · +0.30',color:'red',left:65},
 {a:.2,b:.2,side:'blue' as const,text:'Even · 0.00',color:'neutral',left:50},
 {a:1,b:-1,side:'blue' as const,text:'Ally advantage · +2.00',color:'blue',left:0}
])test('central advantage: '+c.text,async({page})=>{
 await seed(page,fixture(c.a,c.b,c.side));const chart=page.getByRole('group',{name:'Team advantage',exact:true});
 await expect(chart).toContainText(c.text);await expect(chart).toContainText('Provisional');
 await expect(chart).toHaveClass(new RegExp('team-advantage '+c.color));
 expect(await chart.locator('.advantage-marker').evaluate(el=>parseFloat((el as HTMLElement).style.left))).toBeCloseTo(c.left);
 await page.emulateMedia({reducedMotion:'reduce'});await expect(chart.locator('.advantage-marker')).toHaveCSS('transition-duration','0s');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('missing calibration leaves the advantage unavailable and observers can use the local preference',async({page})=>{
 const room=fixture();delete room.state.shrinkage;
 room.host_id='other-host';room.state.players[0].role=null;
 await seed(page,room);
 await expect(page.getByRole('group',{name:'Team advantage',exact:true})).toContainText('Awaiting team scores');
 await expect(page.locator('.advantage-marker')).toHaveCount(0);
 const toggle=page.getByRole('checkbox',{name:'Show best fits',exact:true});await expect(toggle).toBeEnabled();await toggle.uncheck();
 await expect(page.locator('.champion-choice:enabled')).toHaveCount(0);
});

test('entirely missing interactions contribute zero while scores remain provisional',async({page})=>{
 const room=fixture();room.state.dataset.pairs=[];await seed(page,room);
 await expect(page.getByRole('group',{name:'Team advantage',exact:true})).toContainText('Even · 0.00');
 await expect(page.getByRole('group',{name:'Team advantage',exact:true})).toContainText('Provisional');
 await expect(page.getByRole('group',{name:'Ally team score',exact:true})).toContainText('0/1 pairs');
});
