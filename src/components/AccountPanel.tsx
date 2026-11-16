import {useEffect,useState} from 'react';
import {ROLES,type Role,type RoleCatalogue} from '../domain/types';
import {roleName} from '../domain/roles';
import {RoleIcon} from './RoleIcon';
import {Search,Portrait,names} from './Champions';
import {type Account,emptyPools,emailLoginReady,sendCode,verifyCode,saveProfile,accountRoleCatalogue} from '../lib/accounts';
import {errorMessage} from '../lib/errors';
export default function AccountPanel({account,onChange,onClose}:{account:Account|null;onChange:(account:Account)=>void;onClose:()=>void}){
 const [email,setEmail]=useState(''),[code,setCode]=useState(''),[sent,setSent]=useState(false),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [name,setName]=useState(account?.profile?.display_name??''),[pools,setPools]=useState({...emptyPools(),...account?.profile?.role_pools}),[role,setRole]=useState<Role>('Top'),[catalogue,setCatalogue]=useState<RoleCatalogue>();
 useEffect(()=>{let active=true;void emailLoginReady().then(value=>{if(active)setReady(value);}).catch(e=>{if(active)setError(errorMessage(e));});void accountRoleCatalogue().then(value=>{if(active)setCatalogue(value);}).catch(()=>{});return()=>{active=false;};},[]);
 useEffect(()=>{setName(account?.profile?.display_name??'');setPools({...emptyPools(),...account?.profile?.role_pools});},[account?.id,account?.profile?.version]);
 async function act(fn:()=>Promise<void>){setBusy(true);setError('');try{await fn();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
 return <div className="modal-backdrop" onClick={()=>{if(!busy)onClose();}}><section className="modal account-panel" role="dialog" aria-modal="true" aria-label={account?'My champion pools':'Email sign-in'} onClick={e=>e.stopPropagation()}>
  <div className="section-heading"><h2>{account?'My champion pools':'Sign in or create an account'}</h2><button aria-label="Close account" disabled={busy} onClick={onClose}>×</button></div>
  {account?<>
   <label>Display name<input maxLength={32} value={name} onChange={e=>setName(e.target.value)} autoComplete="nickname"/></label>
   <div className="personal-role-tabs" role="tablist" aria-label="Personal role pools">{ROLES.map(r=><button role="tab" aria-selected={role===r} key={r} onClick={()=>setRole(r)}><RoleIcon role={r}/>{roleName(r)}</button>)}</div>
   <div className="pool-tiles" aria-label={`${roleName(role)} personal candidates`}>{pools[role].map(id=><div className="pool-tile" key={id}><Portrait id={id}/><button className="remove-champion" aria-label={`Remove ${names[id]} from personal pool`} disabled={busy} onClick={()=>setPools(p=>({...p,[role]:p[role].filter(c=>c!==id)}))}>×</button></div>)}</div>
   <Search key={role} initialRole={role} catalogue={catalogue} selected={pools[role]} blocked={new Set(pools[role])} disabled={busy} onChoose={id=>setPools(p=>({...p,[role]:[...p[role],id]}))}/>
   <p className="muted">Your lists load when you take or change roles. Changes in a room stay in that room until you choose to save them.</p>
   <button className="primary" disabled={busy||!name.trim()} onClick={()=>void act(async()=>{const profile=await saveProfile(name,pools,account.profile?.version??0);onChange({...account,profile});onClose();})}>Save profile and pools</button>
  </>:<>
   <p className="muted">Get an email code. No password. Accounts are optional; you can continue as a guest.</p>
   {!ready&&<p role="status" className="account-status">Email sign-in is being configured. Guest rooms remain available.</p>}
   <form onSubmit={e=>{e.preventDefault();void act(async()=>{if(sent){const next=await verifyCode(email,code);if(next)onChange(next);}else{await sendCode(email);setSent(true);}});}}>
    <label>Email address<input required type="email" autoComplete="email" value={email} readOnly={sent} onChange={e=>setEmail(e.target.value)}/></label>
    {sent&&<label>Sign-in code<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" maxLength={10} value={code} onChange={e=>setCode(e.target.value)}/></label>}
    <button className="primary" disabled={busy||!ready}>{sent?'Verify code':'Send sign-in code'}</button>
   </form>
   {sent&&<button disabled={busy} onClick={()=>{setSent(false);setCode('');}}>Use another email</button>}
  </>}
  {error&&<p role="alert" className="account-error">{error}</p>}
 </section></div>;
}
