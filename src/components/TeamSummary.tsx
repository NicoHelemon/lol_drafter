import type {State,Team} from '../domain/types';
import {teamScore} from '../domain/teamScore';
import {scoreLabel} from '../domain/candidates';

export default function TeamSummary({team,state}:{team:Team;state:State}) {
 const result=teamScore(team,state);
 return <div className={`team-summary ${team==='ally'?'blue':'red'}`} role="group" aria-label={`${team==='ally'?'Our team':'Opponents'} score`}>
  <div><b>{team==='ally'?'OUR TEAM':'OPPONENTS'}</b><strong className={result.value===null?'muted':result.value<0?'negative':result.value>0?'positive':'neutral'}>{scoreLabel(result.value)}</strong></div>
  <small>{result.provisional || result.value===null ? 'Provisional · ' : ''}{result.picks}/5 picks · {result.scored} scored · {result.known}/{result.total} pairs</small>
 </div>;
}
