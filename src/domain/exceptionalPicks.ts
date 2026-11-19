import {ROLE_SHARE_MIN} from './catalogue';
import {scoreForTeam,type CandidateScore} from './candidates';
import {unavailable} from './scoring';
import type {Pair,Role,State,Team} from './types';

// Local working data is valid for this snapshot and the current champion/role slots.
export function referenceContextKey(state:State){
 return `${state.dataset.snapshotId??'inline'}/${[...new Set(Object.values(state.picks).flat().map(p=>`${p.championId}:${p.role}`))].sort().join('|')}`;
}
function quantile(sorted:number[],q:number){const at=(sorted.length-1)*q,lo=Math.floor(at);return sorted[lo]+(sorted[Math.ceil(at)]-sorted[lo])*(at-lo);}
export interface FitReference {median:number;high:number;low:number;minimum:number;total:number;count:number}
export interface ExceptionalFit {kind:'positive'|'negative';provisional:boolean;gap:number;total:number}
export function fitReference(role:Role,team:Team,state:State,index?:Map<string,Pair>):FitReference|undefined {
 if(!state.shrinkage||!state.roleCatalogue||state.dataset.snapshotId&&state.referenceKey!==referenceContextKey(state))return;
 const other=team==='ally'?'enemy':'ally';
 const total=state.picks[team].filter(p=>p.role!==role).length+state.picks[other].length;
 if(total<1||total>9)return;
 const used=unavailable(state),selected=state.picks[team].find(p=>p.role===role)?.championId;
 if(selected)used.delete(selected);
 const values=state.roleCatalogue.entries.filter(e=>e.role===role&&e.lanePercent>=ROLE_SHARE_MIN&&!used.has(e.championId))
  .map(e=>scoreForTeam(e.championId,role,team,state,index)).filter(s=>s.value!==null&&s.known===total&&s.total===total).map(s=>s.value!).sort((a,b)=>a-b);
 if(values.length<20)return;
 // Scores already divide by nine in partial drafts: do not attenuate again.
 return {median:quantile(values,.5),high:quantile(values,.95),low:quantile(values,.05),minimum:.5,total,count:values.length};
}
export function exceptionalFit(result:CandidateScore,reference:FitReference|undefined,blocked=false):ExceptionalFit|undefined {
 if(blocked||!reference||result.value===null||result.known!==reference.total||result.total!==reference.total)return;
 const gap=result.value-reference.median;
 const kind=result.value>0&&result.value>=reference.high&&gap>=reference.minimum?'positive'
  :result.value<0&&result.value<=reference.low&&gap<=-reference.minimum?'negative':undefined;
 return kind?{kind,provisional:reference.total<9||result.complete<result.total,gap,total:reference.total}:undefined;
}
