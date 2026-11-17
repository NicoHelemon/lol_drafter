import {expect,it} from 'vitest';
import {draftCandidates,automaticPool} from '../src/domain/automaticCandidates';
import {bestFitCandidates} from '../src/domain/bestFits';
import {setRolePool,toggleRoleCandidate} from '../src/domain/rolePools';
import {referenceContextKey} from '../src/domain/exceptionalPicks';
import {candidates} from '../src/domain/candidates';
import {fitState,popularMids as popular,topFits as fit} from './fixtures/best-fit-state';
import type {Pair} from '../src/domain/types';

it('implements empty/one/three/large explicit pool examples without topping up short pools',()=>{
 let s=fitState(),before=structuredClone(s);
 expect(draftCandidates(s,'ally','Mid',false)).toEqual({pool:popular,bestFits:[]});
 expect(draftCandidates(s,'ally','Mid')).toEqual({pool:[...popular,'112','3'],bestFits:fit});
 expect(s).toEqual(before);
 s=setRolePool(s,'ally','Mid',['103']);
 expect(automaticPool(s,'ally','Mid',false)).toEqual(['103']);
 expect(automaticPool(s,'ally','Mid')).toEqual(['103',...fit]);
 s=setRolePool(s,'ally','Mid',['103','112','61']);
 expect(automaticPool(s,'ally','Mid',false)).toEqual(['103','112','61']);
 expect(automaticPool(s,'ally','Mid')).toEqual(['103','112','61','3','517']);
 s=setRolePool(s,'ally','Mid',['103','112','61','99','45','84']);
 expect(automaticPool(s,'ally','Mid')).toHaveLength(8);
 s=setRolePool(s,'ally','Mid',fit);expect(automaticPool(s,'ally','Mid')).toEqual(fit);
});
it('uses the occupied player pool and never saves suggestions into personal pools',()=>{
 const s=fitState();s.players[0].role='Mid';s.players[0].pool=['103'];s.rolePools={ally:{Mid:['61']}};
 expect(automaticPool(s,'ally','Mid')).toEqual(['103',...fit]);
 const next=toggleRoleCandidate(s,'ally','Mid','112');
 expect(next.players[0].pool).toEqual(['103']);expect(next.rolePools).toEqual(s.rolePools);
 expect(next.picks.ally).toContainEqual({championId:'112',role:'Mid'});
 expect(automaticPool(next,'ally','Mid',false)).toEqual(['112','103']);
 const sorted=candidates(automaticPool(next,'ally','Mid'),'Mid','ally',next);
 expect(sorted[0].id).toBe('112');expect(sorted[1].id).toBe('3');
});
it('reranks after bans/picks, excludes unavailable champions, and retains the current pick',()=>{
 const s=fitState();s.bans.ally[0]='112';s.picks.ally=[{championId:'3',role:'Top'}];
 expect(bestFitCandidates(s,'ally','Mid')).toEqual([]);
 s.dataset.pairs.push(...s.roleCatalogue!.entries.map((e):Pair=>({candidateChampionId:e.championId,candidateRole:'Mid',relation:'with',otherChampionId:'3',otherRole:'Top',delta2:0,games:10000})));
 expect(bestFitCandidates(s,'ally','Mid')).not.toContain('112');expect(bestFitCandidates(s,'ally','Mid')).not.toContain('3');
 s.bans.ally[0]=null;s.picks.ally=[{championId:'112',role:'Mid'}];
 expect(bestFitCandidates(s,'ally','Mid')).toEqual(fit);
 expect(candidates(automaticPool(s,'ally','Mid'),'Mid','ally',s)[0].id).toBe('112');
});
it('requires supported roles, the current reference, calibration and complete interaction coverage',()=>{
 const s=fitState();s.roleCatalogue!.entries.find(e=>e.championId==='112')!.games=4999;
 s.roleCatalogue!.entries.find(e=>e.championId==='3')!.lanePercent=4.99;
 s.dataset.pairs.find(p=>p.candidateChampionId==='517')!.games=0;
 expect(bestFitCandidates(s,'ally','Mid').some(id=>fit.includes(id))).toBe(false);
 s.dataset.snapshotId='a'.repeat(64);expect(bestFitCandidates(s,'ally','Mid')).toEqual([]);
 s.referenceKey=referenceContextKey(s);expect(bestFitCandidates(s,'ally','Mid')).toHaveLength(3);
 s.picks.enemy[0].role='Mid';expect(bestFitCandidates(s,'ally','Mid')).toEqual([]);
 delete s.shrinkage;expect(bestFitCandidates(s,'ally','Mid')).toEqual([]);
});
it('does not invent best fits for an empty draft, all ties or absent catalogue data',()=>{
 const s=fitState();s.picks.enemy=[];expect(bestFitCandidates(s,'ally','Mid')).toEqual([]);
 s.picks.enemy=[{championId:'54',role:'Top'}];s.dataset.pairs.forEach(p=>p.delta2=0);expect(bestFitCandidates(s,'ally','Mid')).toEqual([]);
 s.dataset.pairs.forEach(p=>p.delta2=2);expect(bestFitCandidates(s,'ally','Mid')).toEqual([]);
 delete s.roleCatalogue;expect(bestFitCandidates(s,'ally','Mid')).toEqual([]);
});
it('optimizes the enemy own directional score, including least-bad fits when all scores are negative',()=>{
 const s=fitState();s.picks.ally=s.picks.enemy;s.picks.enemy=[];
 s.dataset.pairs.forEach(p=>p.delta2=-p.delta2!);
 expect(bestFitCandidates(s,'enemy','Mid')).toEqual(['45','99','61']);
});
