import {it,expect} from 'vitest';
import {initialState} from '../src/data/provider';
import {candidates,scoreForTeam} from '../src/domain/candidates';
it('keeps banned and other-picked pool candidates visible but blocked, without blocking the current pick',()=>{
 const s=initialState('p','Player');s.picks.ally=[{championId:'58',role:'Top'}];s.picks.enemy=[{championId:'122',role:'Top'}];s.bans.enemy[0]='164';
 const options=candidates(['58','122','164','266'],'Top','ally',s);
 expect(options.find(p=>p.id==='58')).toMatchObject({selected:true,blocked:false});expect(options.find(p=>p.id==='122')?.blocked).toBe(true);expect(options.find(p=>p.id==='164')?.blocked).toBe(true);expect(options.find(p=>p.id==='266')?.blocked).toBe(false);expect(options[0].id).toBe('58');
});
it('scores enemy picks in the enemy candidate’s direction and excludes self-pairs',()=>{
 const s=initialState('p','Player');s.picks.ally=[{championId:'58',role:'Top'}];s.picks.enemy=[{championId:'202',role:'ADC'}];s.dataset.pairs=[{relation:'vs',candidateChampionId:'202',candidateRole:'ADC',otherChampionId:'58',otherRole:'Top',delta2:2}];
 expect(scoreForTeam('202','ADC','enemy',s).value).toBe(2);expect(scoreForTeam('202','ADC','enemy',s).total).toBe(1);expect(scoreForTeam('58','Top','ally',s).value).toBeNull();
});
it('shows a manually selected champion outside the prepared pool and recalculates as the context changes',()=>{
 const s=initialState('p','Player');s.picks.ally=[{championId:'266',role:'Top'}];expect(candidates(['58'],'Top','ally',s).map(c=>c.id)).toContain('266');expect(scoreForTeam('58','Top','ally',s).value).toBeNull();
 s.picks.enemy=[{championId:'122',role:'Top'}];s.dataset.pairs=[{relation:'vs',candidateChampionId:'58',candidateRole:'Top',otherChampionId:'122',otherRole:'Top',delta2:1.25}];expect(scoreForTeam('58','Top','ally',s).value).toBe(1.25);
});
