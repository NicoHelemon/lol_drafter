import {championIds} from '../data/provider';
import {ROLES,type State,type Team,type Role,type Pick,type Room} from './types';
import {validateState,record} from './state';
import {draftPosition,trackDraft} from './draftHistory';

export interface ImageSlot {team:Team;slot:number;championId:string|null;status:'locked'|'picking'|'hover'|'unknown';role?:Role|null;similarity:number;margin:number}
export interface ImageBan {team:Team;slot:number;championId:string|null;similarity:number;margin:number}
export interface ScreenshotReading {slots:ImageSlot[];bans:ImageBan[];box:number[];width:number;height:number}
export interface ScreenshotAdditions {picks:Record<Team,Pick[]>;bans:Record<Team,{slot:number;championId:string}[]>}
export interface ProposedPick extends Pick {team:Team;estimated:boolean;included:boolean;key:string}
export interface ProposedBan {team:Team;slot:number;championId:string;included:boolean;key:string}
export interface ImportProposal {picks:ProposedPick[];bans:ProposedBan[];notes:string[];pending:number}
const teams:Team[]=['ally','enemy'];

// Existing picks are fixed constraints. Search at most 5! assignments per team;
// client role labels are preferred only when compatible with those constraints.
export function proposeScreenshot(state:State,reading:ScreenshotReading):ImportProposal{
 const proposal:ImportProposal={picks:[],bans:[],notes:[],pending:reading.slots.filter(s=>s.championId&&['hover','picking'].includes(s.status)).length};
 const used=new Set([...state.picks.ally,...state.picks.enemy].map(p=>p.championId));
 const banned=new Set([...state.bans.ally,...state.bans.enemy].filter((c):c is string=>!!c));
 for(const team of teams){
  const seen=new Set<string>(),detected:ImageSlot[]=[];
  for(const slot of reading.slots.filter(s=>s.team===team&&s.status==='locked'&&s.championId&&championIds.has(s.championId))){
   const id=slot.championId!;
   if(seen.has(id)){proposal.notes.push('A repeated pick was left for manual review.');continue;}seen.add(id);
   const own=state.picks[team].find(p=>p.championId===id);
   if(own)continue;
   if(used.has(id)||banned.has(id)){proposal.notes.push('A detected pick conflicts with an existing pick or ban and was skipped.');continue;}
   detected.push(slot);
  }
  const free=ROLES.filter(r=>!state.picks[team].some(p=>p.role===r));
  if(detected.length>free.length){proposal.notes.push('More picks were detected than there are free roles. Review this team manually.');continue;}
  let best=-Infinity,assignment:Role[]=[];
  function visit(roles:Role[]){
   if(roles.length===detected.length){
    const score=detected.reduce((v,s,i)=>{
     const meta=state.roleCatalogue?.entries.find(e=>e.championId===s.championId&&e.role===roles[i]);
     return v+Math.log(Math.max(.001,(meta?.lanePercent??0)/100))+(s.role===roles[i]?20:0);
    },0);
    if(score>best){best=score;assignment=[...roles];}return;
   }
   for(const role of free)if(!roles.includes(role))visit([...roles,role]);
  }
  visit([]);
  detected.forEach((s,i)=>{if(assignment[i]){used.add(s.championId!);proposal.picks.push({team,championId:s.championId!,role:assignment[i],estimated:s.role!==assignment[i],included:true,key:`pick:${team}:${s.slot}`});}});
 }
 for(const team of teams){
  const seen=new Set(state.bans[team].filter(Boolean));
  for(const ban of reading.bans.filter(b=>b.team===team&&b.championId&&championIds.has(b.championId))){
   const id=ban.championId!,slot=ban.slot-1;
   if(slot<0||slot>4||seen.has(id))continue;
   if(state.bans[team][slot]){if(state.bans[team][slot]!==id)proposal.notes.push('An existing ban was kept instead of a conflicting screenshot ban.');continue;}
   if(used.has(id)||(state.draftMode!=='ranked'&&(state.bans[team==='ally'?'enemy':'ally'].includes(id)||proposal.bans.some(b=>b.team!==team&&b.championId===id)))){proposal.notes.push('A detected ban conflicts with an existing selection and was skipped.');continue;}
   seen.add(id);proposal.bans.push({team,slot,championId:id,included:true,key:`ban:${team}:${slot}`});
  }
 }
 proposal.notes=[...new Set(proposal.notes)];return proposal;
}
export function proposalAdditions(proposal:ImportProposal):ScreenshotAdditions{
 return {picks:Object.fromEntries(teams.map(t=>[t,proposal.picks.filter(p=>p.team===t&&p.included).map(({role,championId})=>({role,championId}))])) as Record<Team,Pick[]>,
  bans:Object.fromEntries(teams.map(t=>[t,proposal.bans.filter(b=>b.team===t&&b.included).map(({slot,championId})=>({slot,championId}))])) as ScreenshotAdditions['bans']};
}
export function mergeScreenshot(state:State,additions:ScreenshotAdditions):State{
 if(state.phase!=='live')throw Error('Start the draft before importing a screenshot');
 const next=structuredClone(state);next.openDraft=true;next.draftStep=0;next.draftHistory=[];
 let added=0;
 for(const team of teams){
  if(!Array.isArray(additions.picks[team])||additions.picks[team].length>5||!Array.isArray(additions.bans[team])||additions.bans[team].length>5)throw Error('Invalid screenshot additions');
  for(const p of additions.picks[team]){
   const old=next.picks[team].find(o=>o.role===p.role);
   if(old){if(old.championId===p.championId)continue;throw Error('An existing role cannot be overwritten');}
   next.picks[team].push({...p});added++;
  }
  for(const b of additions.bans[team]){
   if(!Number.isInteger(b.slot)||b.slot<0||b.slot>4)throw Error('Invalid ban slot');
   const old=next.bans[team][b.slot];if(old){if(old===b.championId)continue;throw Error('An existing ban cannot be overwritten');}
   next.bans[team][b.slot]=b.championId;added++;
  }
 }
 if(!added)throw Error('No new picks or bans to import');
 validateState(next,championIds);return record(next,'Screenshot imported');
}
export function importLocalScreenshot(room:Room,additions:ScreenshotAdditions):Room{
 const state=mergeScreenshot(room.state,additions);
 const baseline={...structuredClone(room.state),openDraft:true,draftStep:0,draftHistory:[]};
 const base={...room,state:baseline,...(!room.state.openDraft?{draft_undo:[],draft_redo:[]}: {})};
 // Mode conversion is deliberately outside choice history. One Undo restores
 // the previous picks/bans while leaving Open draft active.
 const result=trackDraft(base,state);
 if(JSON.stringify(draftPosition(baseline))===JSON.stringify(draftPosition(state)))throw Error('No new picks or bans to import');
 return result;
}
