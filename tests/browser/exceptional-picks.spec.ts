import {test,expect} from '@playwright/test';
import {champions,initialState} from '../../src/data/provider';
import {ROLES,type Pair} from '../../src/domain/types';
import {mkdirSync} from 'node:fs';
function fixture(m=9){
 const s=initialState('local-player','Fit check');s.phase='live';s.openDraft=true;s.players[0]={id:'local-player',name:'Fit check',role:'Top',pool:champions.slice(0,3).map(c=>c.id)};
 s.picks={ally:ROLES.filter(r=>r!=='Top').map((role,i)=>({role,championId:champions[100+i].id})),enemy:ROLES.map((role,i)=>({role,championId:champions[110+i].id}))};
 const context=[...s.picks.ally,...s.picks.enemy].slice(0,m);s.picks.ally=s.picks.ally.filter(p=>context.includes(p));s.picks.enemy=s.picks.enemy.filter(p=>context.includes(p));s.picks.ally.push({role:'Top',championId:champions[2].id});
 s.roleCatalogue!.entries=champions.slice(0,40).map(c=>({championId:c.id,role:'Top',lanePercent:100,games:10000,pickPercent:1}));
 s.dataset.pairs=champions.slice(0,40).flatMap((c,i)=>context.map(o=>({candidateChampionId:c.id,candidateRole:'Top',otherChampionId:o.championId,otherRole:o.role,relation:s.picks.ally.includes(o)?'with':'vs',delta2:i===0?2:i===1?-2:0,games:625} as Pair)));
 return {id:'fit-browser',slug:'fit-check',name:"Fit check's room",host_id:'local-player',version:0,state:s};
}
async function seed(page:import('@playwright/test').Page,m=9){await page.goto('/');const room=fixture(m);await page.evaluate(room=>{localStorage.setItem('draftroom-demo',JSON.stringify(room));localStorage.setItem('draftroom-current',room.slug);},room);await page.goto('/rooms/fit-check/draft');await expect(page.getByRole('heading',{name:'Draft board',exact:true})).toBeVisible();}
const cell=(p:import('@playwright/test').Page)=>p.getByRole('region',{name:'Top ally picks',exact:true});
test('exceptional positive and negative fits glow with clear hover details, selection remains first and motion can be reduced',async({page})=>{
 await page.setViewportSize({width:1440,height:1600});await seed(page);
 const positive=cell(page).locator(`[data-champion="${champions[0].id}"]`),negative=cell(page).locator(`[data-champion="${champions[1].id}"]`);
 await expect(positive).toHaveAttribute('data-fit','positive');await expect(negative).toHaveAttribute('data-fit','negative');await expect(cell(page).locator('.draft-champion-tile').first()).toHaveAttribute('data-champion',champions[2].id);
 await positive.hover();await expect(page.getByRole('tooltip')).toContainText('Excellent fit');await expect(page.getByRole('tooltip')).toContainText('exceptionally favorable pick for your team');await expect(page.getByRole('tooltip').locator('.fit-explanation')).not.toContainText('Provisional');
 await positive.locator('.champion-choice').click();await expect(cell(page).locator('.draft-champion-tile').first()).toHaveAttribute('data-champion',champions[0].id);await expect(positive).toHaveClass(/tile-selected.*fit-positive/);
 await negative.hover();await expect(page.getByRole('tooltip')).toContainText('Poor fit');await expect(page.getByRole('tooltip')).toContainText('below the typical available Top option');
 await page.emulateMedia({reducedMotion:'reduce'});await expect(positive).toHaveCSS('animation-name','none');
 const dir=process.env.DRAFT_REVIEW_SCREENSHOTS??'test-results';mkdirSync(dir,{recursive:true});await page.screenshot({path:dir+'/exceptional-fit-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await positive.hover();await expect(page.getByRole('tooltip')).toContainText('Excellent fit');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:dir+'/exceptional-fit-mobile.png',fullPage:true});
});
test('partial fits use the stronger threshold and unknown contributions suppress the glow',async({page})=>{
 await seed(page,3);await expect(cell(page).locator('[data-fit]')).toHaveCount(0);await seed(page,6);const positive=cell(page).locator(`[data-champion="${champions[0].id}"]`);await expect(positive).toHaveAttribute('data-fit','positive');await positive.hover();await expect(page.getByRole('tooltip')).toContainText('Excellent fit · Provisional');await expect(page.getByRole('tooltip')).toContainText('6/9 other champions');
 await page.evaluate(id=>{const r=JSON.parse(localStorage.getItem('draftroom-demo')!);const i=r.state.dataset.pairs.findIndex((p:{candidateChampionId:string})=>p.candidateChampionId===id);r.state.dataset.pairs.splice(i,1);localStorage.setItem('draftroom-demo',JSON.stringify(r));},champions[0].id);await page.reload();await expect(positive).not.toHaveAttribute('data-fit','positive');
});
