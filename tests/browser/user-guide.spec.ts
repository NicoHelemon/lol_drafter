import {test,expect} from '@playwright/test';

test('guide opens beside home, lobby and draft without changing the active room',async({page,context})=>{
 await page.goto('/');
 async function openGuide(){
  const url=page.url(),before=await page.evaluate(()=>({room:localStorage.getItem('draftroom-demo'),current:localStorage.getItem('draftroom-current')}));
  const popup=context.waitForEvent('page');await page.locator('header').getByRole('link',{name:/^User guide/}).click();const guide=await popup;
  await expect(guide).toHaveURL(/\/guide$/);await expect(guide.getByRole('heading',{level:1})).toHaveText('User guide');await expect(page).toHaveURL(url);
  expect(await page.evaluate(()=>({room:localStorage.getItem('draftroom-demo'),current:localStorage.getItem('draftroom-current')}))).toEqual(before);
  await guide.close();
 }
 await openGuide();await page.getByPlaceholder('Your name').fill('Guide check');await page.getByRole('button',{name:'Open local demo'}).click();await expect(page.getByRole('heading',{name:'Ally team',exact:true})).toBeVisible();await openGuide();
 await page.getByRole('button',{name:'Start draft'}).click();await expect(page.getByRole('heading',{name:'Draft board',exact:true})).toBeVisible();await openGuide();
});

test('sign-in keeps guide access and preserves an unfinished sign-in form',async({page,context})=>{
 await page.goto('/');await page.getByRole('button',{name:'Sign in',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Account access'});await dialog.getByLabel('Login name or email').fill('unfinished_login');
 const popup=context.waitForEvent('page');await dialog.getByRole('link',{name:/^User guide/}).click();const guide=await popup;await expect(guide.getByRole('navigation',{name:'Guide chapters'})).toBeVisible();await expect(dialog.getByLabel('Login name or email')).toHaveValue('unfinished_login');await guide.close();
});

test('standalone guide loads all real screenshots on mobile without auth requests or horizontal overflow',async({page})=>{
 const backend:string[]=[];page.on('request',r=>{if(/\/auth\/|\/rest\/|\/realtime\//.test(r.url()))backend.push(r.url());});
 await page.setViewportSize({width:390,height:844});await page.goto('/guide');
 const nav=page.getByRole('navigation',{name:'Guide chapters'});await expect(nav.getByRole('link')).toHaveCount(5);
 await nav.getByRole('link',{name:'Read scores',exact:true}).click();await expect(page).toHaveURL(/#scores$/);await expect(page.getByRole('heading',{name:'Scores and team advantage'})).toBeInViewport();
 await page.getByText('Finding champions & personal pools',{exact:true}).click();
 for(const image of await page.locator('.guide-screen img').all()){await image.scrollIntoViewIfNeeded();await expect(image).toBeVisible();expect(await image.evaluate((el:HTMLImageElement)=>el.complete&&el.naturalWidth>0)).toBe(true);}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(backend).toEqual([]);
 await page.getByRole('link',{name:'Back to top'}).click();await expect(page.getByRole('heading',{level:1})).toBeInViewport();
});
