import {it,expect} from 'vitest';
import {initialState} from '../src/data/provider';
import {adjustedDelta,DEMO_MODEL,validateModel} from '../src/domain/shrinkage';
import {scoreForTeam} from '../src/domain/candidates';
import {candidateImpact,teamScore} from '../src/domain/teamScore';
import type {Pair,State,Role} from '../src/domain/types';

const p=(candidate:string,role:Role,other:string,otherRole:Role,delta:number,relation:Pair['relation']='vs',games=625):Pair=>({candidateChampionId:candidate,candidateRole:role,otherChampionId:other,otherRole,delta2:delta,relation,games});
function state():State {
 const s=initialState('p','Player');s.phase='live';
 s.picks={ally:[{championId:'58',role:'Top'},{championId:'103',role:'Mid'}],enemy:[{championId:'122',role:'Top'}]};
 s.dataset.pairs=[p('58','Top','122','Top',2),p('58','Top','103','Mid',4,'with'),
  p('103','Mid','122','Top',-2),p('103','Mid','58','Top',0,'with'),
  p('164','Top','122','Top',6),p('164','Top','103','Mid',2,'with'),
  p('103','Mid','164','Top',8,'with'),
  p('122','Top','58','Top',-8),p('122','Top','103','Mid',2)];
 return s;
}
it('shrinks both signs continuously, uses pair-specific n, and never manufactures missing counts',()=>{
 const pair=p('58','Top','122','Mid',1.34,'vs',1355);
 expect(adjustedDelta(pair,DEMO_MODEL)).toBeCloseTo(.917020202);
 expect(adjustedDelta({...pair,delta2:-1.34},DEMO_MODEL)).toBeCloseTo(-.917020202);
 expect(adjustedDelta({...pair,delta2:0},DEMO_MODEL)).toBe(0);
 for(const games of [0,undefined])expect(adjustedDelta({...pair,games},DEMO_MODEL)).toBeNull();
 expect(adjustedDelta(pair,undefined)).toBeNull();
 expect(adjustedDelta(pair,{...DEMO_MODEL,k:null,priorVariance:0})).toBe(0);
 expect(()=>validateModel({...DEMO_MODEL,k:-1})).toThrow('calibration');
 expect(pair.delta2).toBe(1.34);
});
it('averages adjusted values over known relations, without renormalizing shrinkage factors',()=>{
 const s=state();s.picks.ally=[];s.picks.enemy=[{championId:'122',role:'Top'},{championId:'64',role:'Jungle'}];
 s.dataset.pairs=[p('58','Top','122','Top',1.34,'vs',1355),p('58','Top','64','Jungle',-2,'vs',100)];
 expect(scoreForTeam('58','Top','ally',s).value).toBeCloseTo(.3205790665273424,12);
});
it('averages champion scores equally and uses enemy-specific directional observations',()=>{
 const s=state();
 expect(scoreForTeam('58','Top','ally',s).value).toBe(1.5);
 expect(scoreForTeam('103','Mid','ally',s).value).toBe(-.5);
 expect(teamScore('ally',s)).toMatchObject({value:.5,picks:2,scored:2,known:4,total:4,provisional:true});
 expect(teamScore('enemy',s)).toMatchObject({value:-1.5,picks:1,scored:1,known:2,total:2});
 s.dataset.pairs=s.dataset.pairs.filter(x=>x.candidateChampionId!=='103');
 expect(teamScore('ally',s)).toMatchObject({value:1.5,picks:2,scored:1,known:2,total:4,provisional:true});
});
it('candidate preview recomputes all teammates, preserves asymmetry and never mutates the draft',()=>{
 const s=state(),original=structuredClone(s);
 const impact=candidateImpact('164','Top','ally',s)!;
 // Camille score=(3+1)/2=2. Ahri becomes=(-1+4)/2=1.5. Team=1.75.
 expect(impact.before.value).toBe(.5);expect(impact.after.value).toBe(1.75);expect(impact.change).toBe(1.25);
 expect(s).toEqual(original);
 expect(candidateImpact('58','Top','ally',s)?.change).toBe(0);
 expect(candidateImpact('122','Top','ally',s)).toBeNull();
 s.bans.ally[0]='164';expect(candidateImpact('164','Top','ally',s)).toBeNull();
});
it('full teams expose 45 possible directed contributions; missing values stay provisional',()=>{
 const s=state();s.picks.ally=[{championId:'58',role:'Top'},{championId:'64',role:'Jungle'},{championId:'103',role:'Mid'},{championId:'202',role:'ADC'},{championId:'89',role:'Support'}];
 s.picks.enemy=[{championId:'122',role:'Top'},{championId:'56',role:'Jungle'},{championId:'84',role:'Mid'},{championId:'51',role:'ADC'},{championId:'267',role:'Support'}];
 s.dataset.pairs=s.picks.ally.flatMap(c=>[...s.picks.enemy.map(o=>p(c.championId,c.role,o.championId,o.role,2)),...s.picks.ally.filter(o=>o.role!==c.role).map(o=>p(c.championId,c.role,o.championId,o.role,2,'with'))]);
 expect(teamScore('ally',s)).toMatchObject({value:1,picks:5,scored:5,known:45,total:45,provisional:false});
 s.dataset.pairs[0].delta2=null;expect(teamScore('ally',s)).toMatchObject({value:1,known:44,total:45,provisional:true});
 delete s.shrinkage;expect(teamScore('ally',s)).toMatchObject({value:null,known:0,total:45,provisional:true});
});
