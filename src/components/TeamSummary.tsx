import type {State,Team} from '../domain/types';
import {teamScore} from '../domain/teamScore';
import {scoreLabel} from '../domain/candidates';

export default function TeamSummary({team,state,result=teamScore(team,state)}:{team:Team;state:State;result?:ReturnType<typeof teamScore>}) {
 return <div className={`team-summary ${team==='ally'?state.side:state.side==='blue'?'red':'blue'}`} role="group" aria-label={`${team==='ally'?'Ally team':'Enemy team'} score`}>
  <div><b>{team==='ally'?'ALLY TEAM':'ENEMY TEAM'}{state.draftMode?` · ${(team==='ally'?state.side:state.side==='blue'?'red':'blue').toUpperCase()}`:''}</b><strong className={result.value===null?'muted':result.value<0?'negative':result.value>0?'positive':'neutral'}>{scoreLabel(result.value)}</strong></div>
  <small title={`${result.known+result.complete}/${result.total*2} interaction directions available. Missing directions contribute zero.`}>{result.provisional || result.value===null ? 'Provisional · ' : ''}{result.picks}/5 picks · {result.scored} scored · {result.known}/{result.total} pairs</small>
 </div>;
}
