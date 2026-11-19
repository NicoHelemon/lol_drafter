import {it,expect} from 'vitest';
import {initialState} from '../src/data/provider';
import {consolidatedInteraction} from '../src/domain/interactions';
import {score,pairKey} from '../src/domain/scoring';
import {scoreForTeam} from '../src/domain/candidates';
import {teamScore,teamAdvantage,candidateImpact} from '../src/domain/teamScore';
import {adjustedDelta,DEMO_MODEL} from '../src/domain/shrinkage';
import {ROLES,type Pair,type Pick,type State,type Team} from '../src/domain/types';
const pair=(relation:Pair['relation']='vs',delta2:number|null=2,games=625):Pair=>({relation,candidateChampionId:'58',candidateRole:'Top',otherChampionId:'122',otherRole:'Mid',delta2,games});
const reverse=(p:Pair):Pair=>({...p,candidateChampionId:p.otherChampionId,candidateRole:p.otherRole,otherChampionId:p.candidateChampionId,otherRole:p.candidateRole});
it('shrinks each original direction before consolidating, preserving raw deltas and counts',()=>{
 const f=pair('with'),r={...reverse(f),delta2:4,games:1875},before=structuredClone([f,r]);
 expect(consolidatedInteraction(f,r,DEMO_MODEL)).toMatchObject({value:2,forward:1,reverse:3,directions:2});
 expect(consolidatedInteraction(r,f,DEMO_MODEL).value).toBe(2);
 const a={...f,relation:'vs' as const},b={...r,relation:'vs' as const};
 expect(consolidatedInteraction(a,b,DEMO_MODEL).value).toBe(-1);expect(consolidatedInteraction(b,a,DEMO_MODEL).value).toBe(1);
 expect([f,r]).toEqual(before);
});
it('counts missing directions as zero before dividing by two, without marking them observed',()=>{
 const f=pair();expect(consolidatedInteraction(f,undefined,DEMO_MODEL)).toMatchObject({value:.5,directions:1,forward:1,reverse:null});
 expect(consolidatedInteraction(undefined,reverse(f),DEMO_MODEL)).toMatchObject({value:-.5,directions:1,forward:null,reverse:1});
 expect(consolidatedInteraction(undefined,undefined,DEMO_MODEL)).toMatchObject({value:null,directions:0});
 expect(consolidatedInteraction({...f,delta2:0},undefined,DEMO_MODEL)).toMatchObject({value:0,directions:1});
 expect(consolidatedInteraction({...f,games:0},undefined,DEMO_MODEL)).toMatchObject({value:null,directions:0});
});
it('uses zero contributions with a fixed nine-slot denominator, distinguishing absent data from observed neutrality',()=>{
 const s=initialState('p','P');s.picks.enemy=[{championId:'122',role:'Mid'}];s.dataset.pairs=[];
 expect(score('58','Top',s)).toMatchObject({value:0,known:0,complete:0,total:1});expect(score('58','Top',s).contributions[0].delta2).toBeNull();
 s.dataset.pairs=[pair('vs',0)];expect(score('58','Top',s)).toMatchObject({value:0,known:1,complete:0,total:1});expect(score('58','Top',s).contributions[0].delta2).toBe(0);
 s.dataset.pairs.push(reverse(pair('vs',0)));expect(score('58','Top',s)).toMatchObject({value:0,known:1,complete:1,total:1});
 s.dataset.pairs=[pair()];const before=score('58','Top',s).value;expect(before).toBeCloseTo(.5/9);
 s.picks.enemy.push({championId:'64',role:'Jungle'});s.dataset.pairs.push({...pair('vs',0),otherChampionId:'64',otherRole:'Jungle'});expect(score('58','Top',s).value).toBe(before);
 delete s.shrinkage;expect(score('58','Top',s).value).toBeNull();expect(teamAdvantage(s).value).toBeNull();
});
it('empty and unrevealed team slots contribute zero on fixed five-slot team denominators',()=>{
 const s=initialState('p','P');s.dataset.pairs=[];expect(teamAdvantage(s)).toMatchObject({value:0,ally:{value:0,picks:0},enemy:{value:0,picks:0},provisional:true});
 s.picks.ally=[{championId:'58',role:'Top'}];expect(teamScore('ally',s)).toMatchObject({value:0,picks:1,scored:0});
});

// Independent directional sum: each unordered ally pair adds its two original
// directions, each enemy pair subtracts them, and cross-team directions subtract.
function directionalAdvantage(s:State){
 const index=new Map(s.dataset.pairs.map(p=>[pairKey(p),p]));
 const d=(a:Pick,b:Pick,relation:Pair['relation'])=>adjustedDelta(index.get(pairKey({relation,candidateChampionId:a.championId,candidateRole:a.role,otherChampionId:b.championId,otherRole:b.role})),s.shrinkage)??0;
 let sum=0;
 for(const team of ['ally','enemy'] as Team[]){const ps=s.picks[team];for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++)sum+=(team==='ally'?1:-1)*(d(ps[i],ps[j],'with')+d(ps[j],ps[i],'with'));}
 for(const a of s.picks.ally)for(const b of s.picks.enemy)sum+=d(a,b,'vs')-d(b,a,'vs');
 return sum/45;
}
it('preserves directional advantage and exact fit-to-advantage equivalence in partial/full drafts, missing data and both team perspectives',()=>{
 let seed=571;const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
 const ids={ally:['58','64','103','202','89'],enemy:['122','56','84','51','267']},choices=['164','266','3'];
 for(let trial=0;trial<120;trial++){
  const s=initialState('p','P');s.dataset.pairs=[];
  for(const team of ['ally','enemy'] as Team[])s.picks[team]=ROLES.flatMap((role,i)=>random()<trial%11/10?[{role,championId:ids[team][i]}]:[]);
  const role=ROLES[trial%5],all=[...ROLES.flatMap((r,i)=>[{role:r,championId:ids.ally[i]},{role:r,championId:ids.enemy[i]}]),...choices.map(championId=>({role,championId}))];
  for(const a of all)for(const b of all)if(a.championId!==b.championId)for(const relation of ['with','vs'] as const){
   if(relation==='with'&&a.role===b.role||random()<.3)continue;
   s.dataset.pairs.push({relation,candidateChampionId:a.championId,candidateRole:a.role,otherChampionId:b.championId,otherRole:b.role,delta2:random()<.05?null:random()*8-4,games:1+Math.floor(random()*10000)});
  }
  const original=structuredClone(s),before=teamAdvantage(s).value!;expect(before).toBeCloseTo(directionalAdvantage(s),12);
  for(const team of ['ally','enemy'] as Team[]){
   const old=s.picks[team].find(p=>p.role===role);const oldFit=old?scoreForTeam(old.championId,role,team,s).value!:0;
   const fits:number[]=[],gains:number[]=[];
   for(const c of choices){
    const f=scoreForTeam(c,role,team,s).value!,impact=candidateImpact(c,role,team,s)!;fits.push(f);gains.push(impact.advantageChange!);
    expect(impact.advantageChange).toBeCloseTo(2/5*(f-oldFit),12);
    const next={...s,picks:{...s.picks,[team]:[...s.picks[team].filter(p=>p.role!==role),{role,championId:c}]}};
    expect(teamAdvantage(next).value).toBeCloseTo(directionalAdvantage(next),12);
   }
   for(let i=0;i<fits.length;i++)for(let j=i+1;j<fits.length;j++)expect(gains[i]-gains[j]).toBeCloseTo(2/5*(fits[i]-fits[j]),12);
  }
  expect(s).toEqual(original);
 }
});
