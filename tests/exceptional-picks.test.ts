import {it,expect} from 'vitest';
import {initialState,champions} from '../src/data/provider';
import {fitReference,exceptionalFit,referenceContextKey} from '../src/domain/exceptionalPicks';
import {candidates,scoreForTeam} from '../src/domain/candidates';
import {pairKey} from '../src/domain/scoring';
import {ROLES,type State,type Pair} from '../src/domain/types';
function fixture(m=9){
 const s=initialState('p','P');s.phase='live';s.openDraft=true;
 s.picks={ally:ROLES.filter(r=>r!=='Top').map((role,i)=>({role,championId:champions[100+i].id})),enemy:ROLES.map((role,i)=>({role,championId:champions[110+i].id}))};
 const context=[...s.picks.ally,...s.picks.enemy].slice(0,m);s.picks.ally=s.picks.ally.filter(p=>context.includes(p));s.picks.enemy=s.picks.enemy.filter(p=>context.includes(p));
 s.roleCatalogue!.entries=champions.slice(0,40).map(c=>({championId:c.id,role:'Top',lanePercent:100,games:10000,pickPercent:1}));
 s.dataset.pairs=champions.slice(0,40).flatMap((c,i)=>context.map(o=>({candidateChampionId:c.id,candidateRole:'Top',otherChampionId:o.championId,otherRole:o.role,relation:s.picks.ally.includes(o)?'with':'vs',delta2:(i===0?2:i===1?-2:0),games:625} as Pair)));
 return s;
}
it('compares the full role universe rather than forcing a winner in a personal pool, and pins selected picks independently',()=>{
 const s=fixture(),id=champions[0].id,ref=fitReference('Top','ally',s)!;
 expect(ref.count).toBe(40);expect(ref.minimum).toBe(.5);expect(ref.median).toBe(0);
 expect(exceptionalFit(scoreForTeam(id,'Top','ally',s),ref)).toMatchObject({kind:'positive',provisional:false,gap:1,total:9});
 expect(exceptionalFit(scoreForTeam(champions[1].id,'Top','ally',s),ref)?.kind).toBe('negative');
 expect(exceptionalFit(scoreForTeam(champions[2].id,'Top','ally',s),ref)).toBeUndefined();
 const before=structuredClone(s);const options=candidates([champions[2].id], 'Top','ally',s);expect(exceptionalFit(options[0],ref)).toBeUndefined();expect(s).toEqual(before);
 s.picks.ally.push({role:'Top',championId:champions[2].id});expect(candidates([id],'Top','ally',s)[0].id).toBe(champions[2].id);expect(fitReference('Top','ally',s)?.median).toBe(ref.median);
});
it('raises the provisional threshold, respects unrounded boundaries and never highlights blocked or incomplete evidence',()=>{
 const s=fixture(3),id=champions[0].id,ref=fitReference('Top','ally',s)!;expect(ref.minimum).toBe(1.5);
 const score=scoreForTeam(id,'Top','ally',s);expect(score.value).toBe(1);expect(exceptionalFit(score,ref)).toBeUndefined();
 expect(exceptionalFit({...score,value:1.5},ref)).toMatchObject({kind:'positive',provisional:true});expect(exceptionalFit({...score,value:1.4999},ref)).toBeUndefined();
 expect(exceptionalFit({...score,value:1.5},ref,true)).toBeUndefined();expect(exceptionalFit({...score,value:1.5,known:2},ref)).toBeUndefined();
 expect(exceptionalFit({...score,value:null},ref)).toBeUndefined();
});
it('requires enough reference data and a matching immutable context, excluding bans and other selected champions',()=>{
 const s=fixture(),id=champions[0].id;s.bans.enemy[0]=id;expect(fitReference('Top','ally',s)?.count).toBe(39);
 s.roleCatalogue!.entries=s.roleCatalogue!.entries.slice(0,20);expect(fitReference('Top','ally',s)).toBeUndefined();
 const fresh=fixture();fresh.dataset.snapshotId='a'.repeat(64);expect(fitReference('Top','ally',fresh)).toBeUndefined();fresh.referenceKey=referenceContextKey(fresh);expect(fitReference('Top','ally',fresh)).toBeDefined();
 fresh.picks.enemy.pop();expect(fitReference('Top','ally',fresh)).toBeUndefined();
 delete fresh.dataset.snapshotId;delete fresh.shrinkage;expect(fitReference('Top','ally',fresh)).toBeUndefined();
});
it('keeps enemy perspective directional and uses the same complete-reference quantile interpolation as the experiment',()=>{
 const s=fixture();s.picks={ally:s.picks.enemy,enemy:s.picks.ally};

 const index=new Map(s.dataset.pairs.map(p=>[pairKey(p),p]));const r=fitReference('Top','enemy',s,index)!;expect(r.count).toBe(40);expect(exceptionalFit(scoreForTeam(champions[0].id,'Top','enemy',s,index),r)?.kind).toBe('positive');
});
