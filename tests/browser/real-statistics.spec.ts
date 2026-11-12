import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

test('imports real source observations and displays Against plus Synergy without contacting the source', async ({page}) => {
  const sourceRequests:string[]=[];
  page.on('request',request=>{if(new URL(request.url()).hostname.endsWith('lolalytics.com'))sourceRequests.push(request.url());});
  await page.goto('/');
  await page.getByPlaceholder('Your name').fill('Nico');
  await page.getByRole('button',{name:'Open local demo'}).click();
  await page.getByRole('group',{name:'Top role'}).getByRole('button',{name:'Join',exact:true}).click();
  await page.getByRole('button',{name:'Add champion to Top pool'}).click();
  await page.getByRole('textbox',{name:'Search champions'}).fill('Renekton');
  await page.getByRole('button',{name:'Renekton',exact:true}).click();
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByText('Dataset settings',{exact:true}).click();
  await page.locator('input[type=file]').setInputFiles(resolve('tests/fixtures/lolalytics-real-pairs.json'));
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('draftroom-demo')??'{}').state?.dataset?.fictional)).toBe(false);
  await page.getByRole('button',{name:'Start draft'}).click();
  const tile=page.getByRole('region',{name:'Top ally picks'}).locator('[data-champion="58"] .tile-score');
  await expect(tile).toContainText('N/A');
  for(const [role,team,champion] of [['Top','enemy','Ambessa'],['Jungle','ally','Lee Sin']]){
    await page.getByRole('button',{name:`Choose ${role} ${team}`,exact:true}).click();
    await page.getByRole('textbox',{name:'Search champions'}).fill(champion);
    await page.getByRole('button',{name:champion,exact:true}).click();
  }
  await expect(tile).toContainText('+1.36');
  await tile.click();
  const details=page.getByRole('dialog',{name:'Score details'});
  await expect(details).toContainText('2/2 pairs');
  await expect(details).toContainText('Against Ambessa');
  await expect(details).toContainText('With Lee Sin');
  await expect(details).toContainText('-0.10');
  expect(sourceRequests).toEqual([]);
});
