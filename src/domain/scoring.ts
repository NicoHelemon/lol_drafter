import {type Dataset,type Role,type State,type Pair} from './types';
import {WEIGHTS} from './weights';
import {consolidatedInteraction} from './interactions';
export const INDIVIDUAL_DENOMINATOR=9;
export const pairKey = (p:Pick<Pair,'relation'|'candidateChampionId'|'candidateRole'|'otherChampionId'|'otherRole'>)=>[p.relation,p.candidateChampionId,p.candidateRole,p.otherChampionId,p.otherRole].join('|');
export interface Contribution {relation:'vs'|'with'; championId:string; role:Role; delta2:number|null; weight:number;forward:number|null;reverse:number|null;directions:number}
export function score(candidateChampionId:string,candidateRole:Role,state:State,index=new Map(state.dataset.pairs.map(p=>[pairKey(p),p]))) {
 const contributions:Contribution[]=[];
 for(const [team,relation] of [['enemy','vs'],['ally','with']] as const) for(const pick of state.picks[team]) {
  if(!pick.role || (relation==='with'&&pick.role===candidateRole)) continue;
  const weight=WEIGHTS[candidateRole][relation][pick.role]!;
  const p=index.get(pairKey({relation,candidateChampionId,candidateRole,otherChampionId:pick.championId,otherRole:pick.role}));
  const reverse=index.get(pairKey({relation,candidateChampionId:pick.championId,candidateRole:pick.role,otherChampionId:candidateChampionId,otherRole:candidateRole}));
  const interaction=consolidatedInteraction(p,reverse,state.shrinkage);
  contributions.push({relation,championId:pick.championId,role:pick.role,delta2:interaction.value,weight,
   forward:interaction.forward,reverse:interaction.reverse,directions:interaction.directions});
 }
 const known=contributions.filter(c=>c.delta2!==null);
 return {value:state.shrinkage?known.reduce((n,c)=>n+c.weight*c.delta2!,0)/INDIVIDUAL_DENOMINATOR:null,
  known:known.length,complete:contributions.filter(c=>c.directions===2).length,total:contributions.length,contributions};
}
export function unavailable(state:State){return new Set([...state.picks.ally,...state.picks.enemy].map(p=>p.championId).concat([...state.bans.ally,...state.bans.enemy].filter((x):x is string=>!!x)));}
export function rank(pool:string[],role:Role,state:State,names:Record<string,string>={}){
 const used=unavailable(state), index=new Map(state.dataset.pairs.map(p=>[pairKey(p),p]));
 return pool.filter(c=>!used.has(c)).map(id=>({id,...score(id,role,state,index)})).sort((a,b)=>a.value===null&&b.value!==null?1:b.value===null&&a.value!==null?-1:(b.value??0)-(a.value??0)||(names[a.id]??a.id).localeCompare(names[b.id]??b.id));
}
export function coverage(dataset:Dataset,players:{role:Role|null;pool:string[]}[],champions:string[]){
 const keys=new Set(dataset.pairs.filter(p=>p.delta2!==null).map(pairKey)); let total=0,known=0;
 for(const player of players) if(player.role) for(const c of player.pool) for(const o of champions) if(o!==c) for(const role of ['Top','Jungle','Mid','ADC','Support'] as Role[]) for(const relation of ['vs','with'] as const){
  if(relation==='with'&&role===player.role)continue;
  total++; if(keys.has(pairKey({relation,candidateChampionId:c,candidateRole:player.role,otherChampionId:o,otherRole:role})))known++;
 }
 return {known,total};
}
