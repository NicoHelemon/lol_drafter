import {test,expect} from '@playwright/test';
test('local demo: pick, atypical move, ban, pool and persisted reload',async({page})=>{
 await page.goto('/');await page.getByPlaceholder('Ex. Invocateur').fill('Test host');await page.getByRole('button',{name:'Ouvrir la démo locale'}).click();
 await expect(page.getByRole('heading',{name:'Tableau de draft'})).toBeVisible();await expect(page.getByText('Pas encore de données contextuelles').first()).toBeVisible();
 await page.getByRole('button',{name:'Choisir ADC enemy',exact:true}).click();await page.getByRole('textbox',{name:'Rechercher un champion'}).fill('Jhin');await page.getByRole('button',{name:'Jhin',exact:true}).click();
 await page.getByLabel('Déplacer Jhin enemy').selectOption('Jungle');await page.getByRole('button',{name:'Choisir ADC enemy',exact:true}).click();await page.getByRole('textbox',{name:'Rechercher un champion'}).fill('Caitlyn');await page.getByRole('button',{name:'Caitlyn',exact:true}).click();
 await expect(page.getByLabel('Déplacer Jhin enemy')).toHaveValue('Jungle');await expect(page.getByLabel('Déplacer Caitlyn enemy')).toHaveValue('ADC');
 await page.getByRole('button',{name:'Ban 1 ally',exact:true}).click();await page.getByRole('textbox',{name:'Rechercher un champion'}).fill('Renekton');await page.getByRole('button',{name:'Renekton',exact:true}).click();await expect(page.locator('.recommendation').filter({hasText:'Renekton'})).toHaveCount(0);
 await page.getByLabel('Retirer ban Renekton').click();await expect(page.locator('.recommendation').filter({hasText:'Renekton'})).toHaveCount(1);
 await page.reload();await expect(page.getByLabel('Déplacer Jhin enemy')).toHaveValue('Jungle');await expect(page.getByLabel('Déplacer Caitlyn enemy')).toHaveValue('ADC');
 await page.screenshot({path:'test-results/draft-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await expect(page.getByRole('button',{name:'Recommandations',exact:true})).toBeVisible();await page.getByRole('button',{name:'Recommandations',exact:true}).click();await expect(page.getByRole('heading',{name:'Vos options'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();await page.screenshot({path:'test-results/draft-mobile.png',fullPage:true});
});
