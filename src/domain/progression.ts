import type {State,Team,DraftMode,DraftCheckpoint} from './types';
export interface DraftStage {kind:'pick'|'ban'|'bans';side?:'blue'|'red';count:number;slot?:number;label:string}
const ordinal=(n:number)=>['','1st','2nd','3rd','4th','5th'][n];
export function draftStages(mode:DraftMode):DraftStage[]{
 const result:DraftStage[]=[],counts={blue:0,red:0};
 const pick=(side:'blue'|'red',count:number)=>{const first=counts[side]+1;counts[side]+=count;result.push({kind:'pick',side,count,label:`${side==='blue'?'Blue':'Red'} team · ${ordinal(first)}${count===2?` and ${ordinal(first+1)}`:''} pick${count===2?'s':''}`});};
 const ban=(side:'blue'|'red',slot:number)=>result.push({kind:'ban',side,slot,count:1,label:`${side==='blue'?'Blue':'Red'} team · ${ordinal(slot+1)} ban`});
 if(mode==='ranked'){result.push({kind:'bans',count:10,label:'Both teams · enter all bans'});pick('blue',1);pick('red',2);pick('blue',2);pick('red',2);pick('blue',2);pick('red',1);}
 else{for(let i=0;i<3;i++){ban('blue',i);ban('red',i);}pick('blue',1);pick('red',2);pick('blue',2);pick('red',1);for(let i=3;i<5;i++){ban('red',i);ban('blue',i);}pick('red',1);pick('blue',2);pick('red',1);}
 return result;
}
export function stage(s:State){return s.draftMode&&s.phase==='live'?draftStages(s.draftMode)[s.draftStep??0]:undefined;}
export function teamFor(s:State,side:'blue'|'red'):Team{return s.side===side?'ally':'enemy';}
export function checkpoint(s:State):DraftCheckpoint{return {picks:{ally:s.picks.ally.map(p=>p.championId).sort(),enemy:s.picks.enemy.map(p=>p.championId).sort()},bans:structuredClone(s.bans)};}
export function locked(s:State,team:Team){return s.draftHistory?.at(-1)?.picks[team]??[];}
export function canPick(s:State,team:Team,champion?:string){
 if(!s.draftMode)return true;const current=stage(s);
 if(current?.kind!=='pick'||teamFor(s,current.side!)!==team)return false;
 if(champion&&locked(s,team).includes(champion))return false;
 return !!champion||s.picks[team].length<locked(s,team).length+current.count;
}
export function canBan(s:State,team:Team,slot:number){if(!s.draftMode)return true;const current=stage(s);return current?.kind==='bans'||current?.kind==='ban'&&teamFor(s,current.side!)===team&&current.slot===slot;}
export function canAdvance(s:State){const current=stage(s);if(!current)return false;if(current.kind!=='pick')return true;const team=teamFor(s,current.side!);return s.picks[team].length===locked(s,team).length+current.count;}
export function advanceDraft(s:State):State{if(!canAdvance(s))throw Error('Complete the current draft step first');return {...structuredClone(s),draftStep:(s.draftStep??0)+1,draftHistory:[...s.draftHistory??[],checkpoint(s)]};}
export function backDraft(s:State){if(!s.draftMode||!s.draftStep)throw Error('No previous draft step');const next=structuredClone(s),previous=next.draftHistory!.pop()!;next.draftStep!--;for(const team of ['ally','enemy'] as Team[])next.picks[team]=next.picks[team].filter(p=>previous.picks[team].includes(p.championId));next.bans=previous.bans;return next;}
export function startDraft(s:State):State{return {...structuredClone(s),phase:'live',...(s.draftMode?{draftStep:0,draftHistory:[]}: {})};}
const stable=(v:unknown):unknown=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,stable(x)])):v;
const same=(a:unknown,b:unknown)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
export function validateGuidedState(s:State){
 if(s.draftMode===undefined)return;
 if(!['ranked','tournament'].includes(s.draftMode))throw Error('Invalid draft mode');
 const index=s.draftStep??0,history=s.draftHistory??[];
 if(!Number.isInteger(index)||index<0||index>draftStages(s.draftMode).length||!Array.isArray(history)||history.length!==index)throw Error('Invalid draft progression');
 if(s.phase==='setup'){
  if(index||history.length||s.picks.ally.length||s.picks.enemy.length||[...s.bans.ally,...s.bans.enemy].some(Boolean))throw Error('Picks and bans start in the draft');
  if(s.draftMode==='ranked'&&Object.values(s.rolePools?.enemy??{}).some(p=>p.length))throw Error('Enemy candidates are unavailable in the ranked lobby');
 }
}
function validateCurrent(s:State){
 const base=s.draftHistory?.at(-1)??{picks:{ally:[],enemy:[]},bans:{ally:Array(5).fill(null),enemy:Array(5).fill(null)}},current=stage(s);
 for(const team of ['ally','enemy'] as Team[]){
  const ids=s.picks[team].map(p=>p.championId),old=base.picks[team];
  if(old.some(id=>!ids.includes(id)))throw Error('Confirmed picks are locked');
  const extra=current?.kind==='pick'&&teamFor(s,current.side!)===team?current.count:0;
  if(ids.length>old.length+extra)throw Error('Follow the current pick order');
  for(let i=0;i<5;i++)if(!canBan(s,team,i)&&s.bans[team][i]!==base.bans[team][i])throw Error('Follow the current ban order');
 }
}
export function validateGuidedTransition(before:State,next:State,host:boolean){
 if(before.draftMode!==next.draftMode)throw Error('Draft mode is fixed when creating the room');
 validateGuidedState(next);if(!next.draftMode)return;
 if(before.phase==='setup'){if(next.phase==='live'&&((next.draftStep??0)!==0||(next.draftHistory??[]).length||!same(checkpoint(before),checkpoint(next))))throw Error('Start at the first draft step');return;}
 if(next.side!==before.side)throw Error('Side is locked during the draft');
 const old=before.draftStep??0,n=next.draftStep??0,history=before.draftHistory??[];
 if(n===old){if(!same(next.draftHistory??[],history))throw Error('Confirmed draft history is locked');}
 else if(n===old+1){if(!host||!canAdvance(before)||!same(next.draftHistory,[...history,checkpoint(before)])||!same(checkpoint(next),checkpoint(before)))throw Error('Only the host can confirm a completed draft step');}
 else if(n===old-1&&old>0){if(!host||!same(next.draftHistory,history.slice(0,-1))||!same(checkpoint(next),history.at(-1)))throw Error('Invalid previous draft step');}
 else throw Error('Advance one draft step at a time');
 validateCurrent(next);
}
