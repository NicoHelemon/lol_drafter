import {useEffect,useRef,useState} from 'react';
import type {Room} from '../domain/types';
import {recoverInvitation,savedInvitation,rememberInvitation,invitationUrl} from '../lib/invitations';
import {errorMessage} from '../lib/errors';
import ExternalArrow from './ExternalArrow';

export default function InvitationButton({room,uid,token,onToken}:{room:Room;uid:string;token:string;onToken:(token:string)=>void}){
 const [working,setWorking]=useState(false),[manual,setManual]=useState(''),[error,setError]=useState(''),[copied,setCopied]=useState(false);
 const input=useRef<HTMLInputElement>(null),close=useRef<HTMLButtonElement>(null),button=useRef<HTMLButtonElement>(null),dialog=useRef<HTMLElement>(null);
 useEffect(()=>{if(manual){input.current?.focus();input.current?.select();return()=>button.current?.focus();}},[manual]);
 useEffect(()=>{if(copied){const timer=setTimeout(()=>setCopied(false),2500);return()=>clearTimeout(timer);}},[copied]);
 async function copy(){
  if(working)return;setWorking(true);setError('');setCopied(false);
  try{
   const current=token||savedInvitation(uid,room.slug)||await recoverInvitation(room);
   rememberInvitation(uid,room.slug,current);onToken(current);
   const url=invitationUrl(room.slug,current);
   try{await navigator.clipboard.writeText(url);setCopied(true);}catch{setManual(url);}
  }catch(e){setError(errorMessage(e));}finally{setWorking(false);}
 }
 return <>
  <button ref={button} disabled={working} title="Copy a private link so others can join this room" onClick={()=>void copy()}>{working?'Preparing invitation…':'Copy invitation'} <ExternalArrow/></button>
  {copied&&<span className="invitation-status" role="status">Invitation copied</span>}
  {error&&<span className="invitation-error" role="alert">{error}</span>}
  {manual&&<div className="modal-backdrop" onMouseDown={e=>{if(e.currentTarget===e.target)setManual('');}}>
   <section ref={dialog} className="modal invitation-dialog" role="dialog" aria-modal="true" aria-label="Copy invitation link" onKeyDown={e=>{
    if(e.key==='Escape'){e.stopPropagation();setManual('');}
    if(e.key==='Tab'){const nodes=dialog.current?.querySelectorAll<HTMLElement>('button:enabled,input');if(!nodes?.length)return;const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
   }}>
    <div className="section-heading"><h2>Invitation link</h2><button ref={close} aria-label="Close invitation link" onClick={()=>setManual('')}>×</button></div>
    <p>Your browser blocked automatic copying. Copy the selected link with Ctrl + C, or copy it from this field.</p>
    <label>Invitation link<input ref={input} readOnly value={manual} onFocus={e=>e.target.select()}/></label>
   </section>
  </div>}
 </>;
}
