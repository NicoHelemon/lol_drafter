import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import {readFileSync} from 'node:fs';
import {DEMO_MODEL} from '../../src/domain/shrinkage';

test('real source observations use an explicitly illustrative calibration without contacting the source', async ({page}) => {
  const sourceRequests:string[]=[];
  page.on('request',request=>{if(new URL(request.url()).hostname.endsWith('lolalytics.com'))sourceRequests.push(request.url());});
  await page.goto('/');
  await page.getByPlaceholder('Your name').fill('Nico');
  await page.getByRole('button',{name:'Open local demo'}).click();await page.evaluate(()=>{const r=JSON.parse(localStorage.getItem('draftroom-demo')!);delete r.state.draftMode;localStorage.setItem('draftroom-demo',JSON.stringify(r));});await page.reload();
  await page.getByRole('group',{name:'Top role'}).getByRole('button',{name:'Join',exact:true}).click();
  await page.getByRole('button',{name:'Add champion to Top pool'}).click();
  await page.getByRole('textbox',{name:'Search champions'}).fill('Renekton');
  await page.getByRole('button',{name:'Renekton',exact:true}).click();
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.evaluate(dataset=>{const r=JSON.parse(localStorage.getItem('draftroom-demo')!);r.state.dataset=dataset;delete r.state.roleCatalogue;localStorage.setItem('draftroom-demo',JSON.stringify(r));},JSON.parse(readFileSync(resolve('tests/fixtures/lolalytics-real-pairs.json'),'utf8')));
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('draftroom-demo')??'{}').state?.dataset?.fictional)).toBe(false);
  // The pair values/counts are real; k=625 is an explicitly synthetic test model.
  await page.evaluate(model=>{const r=JSON.parse(localStorage.getItem('draftroom-demo')!);r.state.shrinkage=model;localStorage.setItem('draftroom-demo',JSON.stringify(r));},DEMO_MODEL);
  await page.reload();
  await page.getByRole('button',{name:'Start draft'}).click();
  const tile=page.getByRole('region',{name:'Top ally picks'}).locator('[data-champion="58"] .tile-score');
  await expect(tile).toContainText('N/A');
  for(const [role,team,champion] of [['Top','enemy','Ambessa'],['Jungle','ally','Lee Sin']]){
    await page.getByRole('button',{name:`Add ${role}${team==='enemy'?' enemy':''} candidates`,exact:true}).click();
    await page.getByRole('textbox',{name:'Search champions'}).fill(champion);
    await page.getByRole('button',{name:champion,exact:true}).click();
    await page.getByRole('button',{name:'Close',exact:true}).click();
    await page.getByRole('region',{name:`${role} ${team} picks`,exact:true}).getByRole('button',{name:`Pick ${champion} ${role} ${team}`,exact:true}).click();
  }
  await expect(tile).toContainText('+0.93');
  await tile.locator('..').hover();
  const details=page.getByRole('tooltip');
  await expect(details).toContainText('2/2 pairs');
  await expect(details.getByLabel(/Against Top Ambessa/)).toBeVisible();
  await expect(details.getByLabel(/With Jungle Lee Sin/)).toBeVisible();
  await expect(details).toContainText('-0.09');
  await expect(details).toContainText('Adjusted values');
  expect(sourceRequests).toEqual([]);
});
