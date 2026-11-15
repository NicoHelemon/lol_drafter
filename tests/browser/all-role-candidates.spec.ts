import {test,expect,type Page} from '@playwright/test';
import {mkdirSync} from 'node:fs';
async function add(page:Page,button:string,names:string[]){
 await page.getByRole('button',{name:button,exact:true}).click();
 for(const name of names){await page.getByRole('textbox',{name:'Search champions'}).fill(name);await page.getByRole('button',{name,exact:true}).click();}
 await page.getByRole('button',{name:'Close',exact:true}).click();
}
test('all ten seats prepare candidates in the lobby, a player overrides their seat, and draft selections stay independent',async({page})=>{
 await page.setViewportSize({width:1440,height:1100});await page.goto('/');await page.getByPlaceholder('Your name').fill('Candidate check');await page.getByRole('button',{name:'Open local demo'}).click();
 await expect(page.getByRole('group',{name:/ role$/})).toHaveCount(10);
 await expect(page.getByRole('button',{name:/^Add champion to .* pool$/})).toHaveCount(10);
 await add(page,'Add champion to Mid pool',['Ahri','Akali']);
 await add(page,'Add champion to Top enemy pool',['Darius','Camille']);
 const mid=page.getByRole('group',{name:'Mid role',exact:true});await expect(mid.locator('.pool-tile')).toHaveCount(2);
 await mid.getByRole('button',{name:'Join',exact:true}).click();await expect(mid.locator('.pool-tile')).toHaveCount(0);
 await expect(page.getByRole('group',{name:'Top enemy role',exact:true}).locator('.pool-tile')).toHaveCount(2);
 await add(page,'Add champion to Mid pool',['Ahri']);
 const screenshots=process.env.DRAFT_REVIEW_SCREENSHOTS??'test-results';mkdirSync(screenshots,{recursive:true});await page.screenshot({path:`${screenshots}/ten-role-lobby.png`,fullPage:true});
 await page.getByRole('button',{name:'Start draft'}).click();
 const enemy=page.getByRole('region',{name:'Top enemy picks',exact:true});await expect(enemy.locator('.draft-champion-tile')).toHaveCount(2);await expect(page.locator('.tile-selected')).toHaveCount(0);
 await enemy.getByRole('button',{name:'Pick Darius Top enemy',exact:true}).click();
 await expect(enemy.locator('.tile-selected')).toHaveAttribute('data-champion','122');
 await add(page,'Add Jungle candidates',['Lee Sin','Graves']);
 const jungle=page.getByRole('region',{name:'Jungle ally picks',exact:true});await expect(jungle.locator('.tile-selected')).toHaveCount(0);
 await jungle.getByRole('button',{name:'Pick Lee Sin Jungle ally',exact:true}).click();
 await page.getByRole('button',{name:'Add Jungle candidates',exact:true}).click();await page.getByRole('button',{name:'Remove Lee Sin from pool',exact:true}).click();await page.getByRole('button',{name:'Close',exact:true}).click();
 await expect(jungle.locator('.tile-selected')).toHaveAttribute('data-champion','64');
 await page.reload();await expect(enemy.locator('.tile-selected')).toHaveAttribute('data-champion','122');await expect(jungle.locator('.tile-selected')).toHaveAttribute('data-champion','64');
 await expect(page.getByRole('button',{name:/^Add .* candidates$/})).toHaveCount(10);
 await page.screenshot({path:`${screenshots}/ten-role-draft.png`,fullPage:true});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
