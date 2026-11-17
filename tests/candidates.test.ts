import {it,expect} from 'vitest';
import {initialState} from '../src/data/provider';
import {candidates,scoreForTeam} from '../src/domain/candidates';
it('keeps banned and other-picked pool candidates visible but blocked, without blocking the current pick',()=>{
 const s=initialState('p','Player');s.picks.ally=[{championId:'58',role:'Top'}];s.picks.enemy=[{championId:'122',role:'Top'}];s.bans.enemy[0]='164';
 const options=candidates(['58','122','164','266'],'Top','ally',s);
 expect(options.find(p=>p.id==='58')).toMatchObject({selected:true,blocked:false});expect(options.find(p=>p.id==='122')?.blocked).toBe(true);expect(options.find(p=>p.id==='164')?.blocked).toBe(true);expect(options.find(p=>p.id==='266')?.blocked).toBe(false);expect(options[0].selected).toBe(true);expect(options.slice(1).map(p=>p.value)).toEqual(options.slice(1).sort((a,b)=>(b.value??-Infinity)-(a.value??-Infinity)).map(p=>p.value));
});
it('scores enemy picks in the enemy candidate’s direction and excludes self-pairs',()=>{
 const s=initialState('p','Player');s.picks.ally=[{championId:'58',role:'Top'}];s.picks.enemy=[{championId:'202',role:'ADC'}];s.dataset.pairs=[{relation:'vs',candidateChampionId:'202',candidateRole:'ADC',otherChampionId:'58',otherRole:'Top',delta2:2,games:625}];
 expect(scoreForTeam('202','ADC','enemy',s).value).toBe(1);expect(scoreForTeam('202','ADC','enemy',s).total).toBe(1);expect(scoreForTeam('58','Top','ally',s).value).toBeNull();
});
it('shows a manually selected champion outside the prepared pool and recalculates as the context changes',()=>{
 const s=initialState('p','Player');s.picks.ally=[{championId:'266',role:'Top'}];expect(candidates(['58'],'Top','ally',s).map(c=>c.id)).toContain('266');expect(scoreForTeam('58','Top','ally',s).value).toBeNull();
 s.picks.enemy=[{championId:'122',role:'Top'}];s.dataset.pairs=[{relation:'vs',candidateChampionId:'58',candidateRole:'Top',otherChampionId:'122',otherRole:'Top',delta2:1.25,games:625}];expect(scoreForTeam('58','Top','ally',s).value).toBe(.625);
});

it('formats the arithmetic mean symmetrically at a half-cent boundary and keeps zero known',async()=>{
 const {scoreLabel}=await import('../src/domain/candidates');
 expect(scoreLabel((2.09-.1)/2)).toBe('+1.00');
 expect(scoreLabel(-((2.09-.1)/2))).toBe('-1.00');
 expect(scoreLabel(0)).toBe('+0.00');expect(scoreLabel(null)).toBe('N/A');
});
it('pins the selected champion first and sorts the remaining scores with missing data last',()=>{
 const s=initialState('p','P');s.picks.ally=[{role:'Top',championId:'58'}];s.picks.enemy=[{role:'Top',championId:'122'}];s.bans.enemy[0]='164';
 s.dataset.pairs=[['58',-2,625],['164',2,625],['266',0,625],['41',10,10]].map(([id,delta2,games])=>({relation:'vs',candidateChampionId:String(id),candidateRole:'Top',otherChampionId:'122',otherRole:'Top',delta2:Number(delta2),games:Number(games)}));
 const list=candidates(['58','266','164','103','41'],'Top','ally',s);expect(list.map(c=>c.id)).toEqual(['58','164','41','266','103']);expect(list[1].blocked).toBe(true);expect(list[0].selected).toBe(true);expect(list[4].value).toBeNull();
});
