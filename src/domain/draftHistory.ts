import type {State,Room,DraftPosition} from './types';
import {resetDraft} from './progression';
export type DraftControl='undo'|'redo'|'open'|'clear'|'guided'|'lobby';
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export const draftPosition=(s:State):DraftPosition=>structuredClone({picks:s.picks,bans:s.bans,draftStep:s.draftStep??0,draftHistory:s.draftHistory??[]});
const owners=(s:State)=>s.players.filter(p=>!!p.role).map(p=>[p.id,p.role]).sort(([a],[b])=>a!.localeCompare(b!));
export function changesAssignments(a:State,b:State){return !same(owners(a),owners(b))||(['ally','enemy'] as const).some(team=>a.picks[team].some(p=>b.picks[team].some(q=>p.championId===q.championId&&p.role!==q.role)));}
export function trackDraft(room:Room,next:State):Room{
 let undo=room.draft_undo??[],redo=room.draft_redo??[];
 if(room.state.phase!=='live'||!!room.state.openDraft!==!!next.openDraft||changesAssignments(room.state,next)){undo=[];redo=[];}
 else if(!same(draftPosition(room.state),draftPosition(next))){undo=[...undo,draftPosition(room.state)].slice(-60);redo=[];}
 return {...room,state:next,version:room.version+1,draft_undo:undo,draft_redo:redo,undo_count:undo.length,redo_count:redo.length};
}
export function controlLocalDraft(room:Room,action:DraftControl):Room{
 if(room.state.phase!=='live')throw Error('Start the draft first');
 let next:Room;
 if(action==='guided'||action==='lobby'){
  if(action==='guided'&&!room.state.openDraft)throw Error('Draft is already guided');
  const state={...resetDraft(room.state),openDraft:false,phase:action==='lobby'?'setup' as const:'live' as const};
  if(action==='lobby'&&state.draftMode==='ranked'&&state.rolePools)delete state.rolePools.enemy;
  next={...room,state,version:room.version+1,draft_undo:[],draft_redo:[],undo_count:0,redo_count:0};
 }else if(action==='open'){
  if(room.state.openDraft)throw Error('Draft is already open');
  next=trackDraft(room,{...structuredClone(room.state),openDraft:true,draftStep:0,draftHistory:[]});
 }else if(action==='clear')next=trackDraft(room,resetDraft(room.state));
 else{
  let undo=[...room.draft_undo??[]],redo=[...room.draft_redo??[]];
  const snapshot=(action==='undo'?undo:redo).pop();if(!snapshot)throw Error(`Nothing to ${action}`);
  if(action==='undo')redo=[...redo,draftPosition(room.state)].slice(-60);else undo=[...undo,draftPosition(room.state)].slice(-60);
  next={...room,state:{...structuredClone(room.state),...snapshot},version:room.version+1,draft_undo:undo,draft_redo:redo,undo_count:undo.length,redo_count:redo.length};
 }
 next.state.history=[{undo:'Undo',redo:'Redo',open:'Open draft enabled',clear:'Draft cleared',guided:'Guided draft restarted',lobby:'Returned to lobby'}[action],...next.state.history].slice(0,25);
 return next;
}
