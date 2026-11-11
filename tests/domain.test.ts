import {describe,it,expect} from 'vitest';
import {ROLES,type Pair} from '../src/domain/types';
import {initialState,demoDataset,championIds} from '../src/data/provider';
import {WEIGHTS} from '../src/domain/weights';
import {score,rank} from '../src/domain/scoring';
import {place,validateState} from '../src/domain/state';
import {importDataset} from '../src/data/import';
const pair=(otherRole:Pair['otherRole'],delta2:number|null,relation:Pair['relation']='vs',otherChampionId='202'):Pair=>({candidateChampionId:'58',candidateRole:'Top',otherChampionId,otherRole,relation,delta2});
describe('Delta 2 scoring',()=>{
 it('keeps all full-draft weight totals at 2',()=>{for(const r of ROLES)expect([...Object.values(WEIGHTS[r].vs),...Object.values(WEIGHTS[r].with)].reduce((a,b)=>a!+b!,0)).toBeCloseTo(2);expect(WEIGHTS.Top.vs.Top).toBe(.4);for(const r of ['Support','ADC'] as const)expect(WEIGHTS.Support.vs[r]).toBe(.3);expect(WEIGHTS.Support.with.ADC).toBe(.3);});
 it('normalizes only available observed pairs, with no base winrate',()=>{const s=initialState('a','A');s.picks.enemy=[{championId:'202',role:'Top'},{championId:'51',role:'ADC'},{championId:'84',role:'Mid'}];s.picks.ally=[{championId:'64',role:'Jungle'}];s.dataset.pairs=[pair('Top',2),pair('ADC',-1,'vs','51'),pair('Mid',null,'vs','84'),pair('Jungle',3,'with','64')];const result=score('58','Top',s);expect(result.value).toBeCloseTo((.4*2-.2+.2*3)/.8);expect(result.known).toBe(3);expect(result.total).toBe(4);});
 it('returns null with no pairs, but preserves real zero',()=>{const s=initialState('a','A');expect(score('58','Top',s).value).toBeNull();s.picks.enemy=[{championId:'202',role:'Top'}];s.dataset.pairs=[pair('Top',0)];expect(score('58','Top',s).value).toBe(0);});
 it('does not infer reverse directions or score unassigned picks',()=>{const s=initialState('a','A');s.picks.enemy=[{championId:'202',role:null}];expect(score('58','Top',s).total).toBe(0);s.picks.enemy[0].role='Top';s.dataset.pairs=[{...pair('Top',5),candidateChampionId:'202',otherChampionId:'58'}];expect(score('58','Top',s).value).toBeNull();});
 it('ranks ties alphabetically and removes banned/picked champions',()=>{const s=initialState('a','A');s.bans.enemy[0]='122';expect(rank(['58','122','164'],'Top',s,{'58':'Z','164':'A'}).map(r=>r.id)).toEqual(['164','58']);});
 it('supports Jhin ADC → Jungle then Caitlyn ADC without loss',()=>{let s=initialState('a','A');s=place(s,'enemy','ADC','202');s=place(s,'enemy','Jungle','202');s=place(s,'enemy','ADC','51');expect(s.picks.enemy).toEqual([{championId:'202',role:'Jungle'},{championId:'51',role:'ADC'}]);expect(score('58','Top',s).contributions.find(p=>p.championId==='202')?.delta2).toBeNull();s=place(s,'enemy','ADC','202');expect(s.picks.enemy.find(p=>p.championId==='51')?.role).toBe('Jungle');});
 it('keeps displaced picks unassigned and enforces the five-pick cap',()=>{let s=initialState('a','A');s=place(s,'enemy','ADC','202');s=place(s,'enemy','ADC','51','unassign');expect(s.picks.enemy[0].role).toBeNull();s.picks.enemy.push({championId:'64',role:'Jungle'},{championId:'58',role:'Top'},{championId:'84',role:'Mid'});expect(()=>place(s,'enemy','Support','89')).toThrow('five');s.bans.ally[0]='202';expect(()=>validateState(s)).toThrow('already');});
});
describe('authorized imports',()=>{
 it('roundtrips JSON without extra score signals',()=>{const d=demoDataset();expect(importDataset(JSON.stringify(d),'json',championIds)).toEqual(d);});
 it('parses quoted CSV, including zero and missing deltas',()=>{const meta={...demoDataset(),pairs:undefined,source:'Authorized, supplied'};const csv='relation,candidateChampionId,candidateRole,otherChampionId,otherRole,delta2,games\r\nvs,58,Top,202,ADC,0,100\r\nwith,58,Top,64,Jungle,,\r\n';const d=importDataset(csv,'csv',championIds,meta);expect(d.pairs.map(p=>p.delta2)).toEqual([0,null]);});
 it('rejects duplicates, unknown champions and nonfinite deltas',()=>{const d=demoDataset();d.pairs=[d.pairs[0],d.pairs[0]];expect(()=>importDataset(JSON.stringify(d),'json',championIds)).toThrow('Duplicate');d.pairs=[{...d.pairs[0],candidateChampionId:'invalid'}];expect(()=>importDataset(JSON.stringify(d),'json',championIds)).toThrow('Invalid');d.pairs=[{...demoDataset().pairs[0],delta2:101}];expect(()=>importDataset(JSON.stringify(d),'json',championIds)).toThrow('Invalid');});
});

it('starts new players without a role or champion preset',()=>{const s=initialState('player','Player');expect(s.players[0].role).toBeNull();expect(s.players[0].pool).toEqual([]);expect(s.players[0].ready).toBe(false);});
