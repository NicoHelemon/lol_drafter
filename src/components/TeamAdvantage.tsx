import {scoreLabel} from '../domain/candidates';
import type {teamAdvantage} from '../domain/teamScore';

export default function TeamAdvantage({result,side}:{result:ReturnType<typeof teamAdvantage>;side:'blue'|'red'}){
 const value=result.value,even=value!==null&&Math.abs(value)<.005;
 const team=value===null||even?null:value>0?'Ally':'Enemy';
 const color=team===null?'neutral':team==='Ally'?side:side==='blue'?'red':'blue';
 const position=value===null||even?50:50-Math.max(-1,Math.min(1,value))*50;
 const text=value===null?'Awaiting team scores':even?'Even · 0.00':`${team} advantage · ${scoreLabel(Math.abs(value))}`;
 return <div className={`team-advantage ${color}`} role="group" aria-label="Team advantage">
  <div className="advantage-label"><strong>{text}</strong>{result.provisional&&value!==null&&<small>Provisional</small>}</div>
  <div className="advantage-track" role="img" aria-label={`${text}. Ally score ${scoreLabel(result.ally.value)}, enemy score ${scoreLabel(result.enemy.value)}. Fixed scale, capped at one point per side.`}>
   <span className="advantage-fill" style={{left:`${Math.min(50,position)}%`,width:`${Math.abs(position-50)}%`}}/>
   <span className="advantage-zero"/>{value!==null&&<span className="advantage-marker" style={{left:`${position}%`}}/>}
  </div>
  <div className="advantage-scale"><span>Ally +1</span><span>Even · 0</span><span>Enemy +1</span></div>
  <small className="advantage-note">Adjusted score difference · not a win probability</small>
 </div>;
}
