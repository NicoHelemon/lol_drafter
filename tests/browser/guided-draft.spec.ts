import {test,expect,type Page} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {draftStages,teamFor} from '../../src/domain/progression';
import type {State,DraftMode} from '../../src/domain/types';
const folder=process.env.DRAFT_REVIEW_SCREENSHOTS??'test-results';
async function create(page:Page,mode:DraftMode,side:'blue'|'red'='blue'){
 await page.goto('/');await page.getByPlaceholder('Your name').fill('Guided check');
 await page.getByRole('button',{name:mode==='ranked'?'Ranked draft':'Tournament draft',exact:true}).click();
 await page.getByRole('button',{name:'Open local demo'}).click();
 await page.getByRole('button',{name:side==='blue'?'Blue side, first pick':'Red side, second pick',exact:true}).click();
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
test('ranked creation, triangular side selector, five automatic candidates and manual ordered progression',async({page})=>{
 await create(page,'ranked','red');
 await expect(page.getByRole('group',{name:/ role$/})).toHaveCount(5);await expect(page.getByText('Dataset settings',{exact:true})).toHaveCount(0);await expect(page.getByText('Import JSON / CSV',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Red side, second pick'})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Add champion to Top pool',exact:true}).click();await page.getByRole('button',{name:'Filter Top',exact:true}).click();await page.getByRole('textbox',{name:'Search champions'}).fill('Ahri');await page.getByRole('button',{name:'Ahri',exact:true}).click();await page.getByRole('button',{name:'Close',exact:true}).click();
 mkdirSync(folder,{recursive:true});await page.screenshot({path:folder+'/ranked-lobby-side.png',fullPage:true,animations:'disabled'});
 await page.getByRole('button',{name:'Start draft'}).click();await expect(page.getByRole('region',{name:'Draft progression'})).toContainText('Both teams');
 for(const region of await page.locator('.draft-cell').all())await expect(region.locator('.draft-champion-tile')).toHaveCount(5);
 await expect(page.getByRole('region',{name:'Top ally picks',exact:true}).locator('.draft-champion-tile').first()).toHaveAttribute('data-champion','103');
 await expect(page.locator('.champion-choice:enabled')).toHaveCount(0);
 await page.getByRole('button',{name:'Ban 1 ally',exact:true}).click();await page.getByRole('textbox',{name:'Search champions'}).fill('Camille');await page.getByRole('button',{name:'Camille',exact:true}).click();
 await page.getByRole('button',{name:'Ban 1 enemy',exact:true}).click();await page.getByRole('textbox',{name:'Search champions'}).fill('Camille');await page.getByRole('button',{name:'Camille',exact:true}).click();
 await page.getByRole('button',{name:'Confirm bans',exact:true}).click();await expect(page.getByRole('region',{name:'Draft progression'})).toContainText('Blue team · 1st pick');
 await expect(page.locator('.draft-cell.ally .champion-choice:enabled')).toHaveCount(0);await pick(page,'enemy');await page.getByRole('button',{name:'Confirm pick',exact:true}).click();
 await expect(page.getByRole('region',{name:'Draft progression'})).toContainText('Red team · 1st and 2nd picks');await expect(page.getByRole('button',{name:'Confirm 2 picks'})).toBeDisabled();
 await pick(page,'ally');await expect(page.getByRole('button',{name:'Confirm 2 picks'})).toBeDisabled();await pick(page,'ally');
 await page.screenshot({path:folder+'/ranked-two-picks.png',fullPage:true,animations:'disabled'});
 await page.getByRole('button',{name:'Confirm 2 picks'}).click();await page.reload();await expect(page.getByRole('region',{name:'Draft progression'})).toContainText('Blue team · 2nd and 3rd picks');
 await page.getByRole('button',{name:'Previous step'}).click();await expect(page.getByRole('region',{name:'Draft progression'})).toContainText('Red team · 1st and 2nd picks');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('tournament follows both alternating ban phases and all pick groups through completion',async({page})=>{
 await create(page,'tournament');await expect(page.getByRole('group',{name:/ role$/})).toHaveCount(10);
 await page.getByRole('button',{name:'Start draft'}).click();
 for(const current of draftStages('tournament')){
  await expect(page.getByRole('region',{name:'Draft progression'})).toContainText(current.label);
  if(current.kind==='pick'){
   const s=await state(page);for(let i=0;i<current.count;i++)await pick(page,teamFor(s,current.side!));
   await page.getByRole('button',{name:current.count===2?'Confirm 2 picks':'Confirm pick',exact:true}).click();
  }else{
   const s=await state(page),team=teamFor(s,current.side!);
   await expect(page.getByRole('button',{name:`Ban ${current.slot!+1} ${team}`,exact:true})).toBeEnabled();
   if(current.slot===3){mkdirSync(folder,{recursive:true});await page.screenshot({path:folder+`/tournament-ban-${current.side}.png`,fullPage:true,animations:'disabled'});}
   await page.getByRole('button',{name:'Confirm no ban',exact:true}).click();
  }
 }
 await expect(page.getByRole('region',{name:'Draft progression'})).toContainText('Draft complete');await expect(page.locator('.tile-selected')).toHaveCount(10);await expect(page.locator('.champion-choice:enabled')).toHaveCount(0);
 await page.screenshot({path:folder+'/tournament-complete.png',fullPage:true,animations:'disabled'});
});
