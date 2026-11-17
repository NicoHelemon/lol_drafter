import {useEffect,useState} from 'react';
import {ROLES,type Role,type RoleCatalogue} from '../domain/types';
import {roleName} from '../domain/roles';
import {RoleIcon} from './RoleIcon';
import {Search,Portrait,names} from './Champions';
import {type Account,emptyPools,emailLoginReady,signInPassword,registerAccount,sendRecoveryCode,resendConfirmationCode,verifyCode,setAccountPassword,saveProfile,accountRoleCatalogue,readProfile} from '../lib/accounts';
import {errorMessage} from '../lib/errors';
import GuideLink from './GuideLink';
type Mode='signin'|'signup'|'recovery';
export default function AccountPanel({account,onChange,onClose}:{account:Account|null;onChange:(account:Account)=>void;onClose:()=>void}){
 const [mode,setMode]=useState<Mode>('signin'),[email,setEmail]=useState(''),[identifier,setIdentifier]=useState(''),[loginName,setLoginName]=useState(account?.loginName??''),[password,setPassword]=useState(''),[repeat,setRepeat]=useState(''),[code,setCode]=useState(''),[pending,setPending]=useState<{email:string;type:'email'|'recovery'}|null>(null),[reset,setReset]=useState(false),[ready,setReady]=useState(false),[loadingProfile,setLoadingProfile]=useState(!!account),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [name,setName]=useState(account?.profile?.display_name??''),[pools,setPools]=useState({...emptyPools(),...account?.profile?.role_pools}),[role,setRole]=useState<Role>('Top'),[catalogue,setCatalogue]=useState<RoleCatalogue>();
 useEffect(()=>{let active=true;void emailLoginReady().then(value=>{if(active)setReady(value);}).catch(e=>{if(active)setError(errorMessage(e));});void accountRoleCatalogue().then(value=>{if(active)setCatalogue(value);}).catch(()=>{});return()=>{active=false;};},[]);
 useEffect(()=>{if(!account)return;let active=true;setLoadingProfile(true);void readProfile().then(profile=>{if(active)onChange({...account,profile});}).catch(e=>{if(active)setError(errorMessage(e));}).finally(()=>{if(active)setLoadingProfile(false);});return()=>{active=false;};},[account?.id]);
 useEffect(()=>{setName(account?.profile?.display_name??'');setPools({...emptyPools(),...account?.profile?.role_pools});},[account?.id,account?.profile?.version]);
 useEffect(()=>{if(account?.loginName)setLoginName(account.loginName);},[account?.id,account?.loginName]);
 const settingPassword=!!account&&(reset||!account.loginName||!account.hasPassword);
 const onboarding=account?.profile?.onboarding_complete===false;
 function switchMode(next:Mode){setMode(next);setPending(null);setCode('');setPassword('');setRepeat('');setError('');}
 function matchedPassword(){if(password!==repeat)throw Error('The passwords do not match');}
 function accept(next:Account|null,closeWhenReady=false){if(!next)throw Error('Could not read your account. Please sign in again.');onChange(next);if(closeWhenReady&&next.loginName&&next.hasPassword&&next.profile?.onboarding_complete!==false)onClose();}
 async function act(fn:()=>Promise<void>){setBusy(true);setError('');try{await fn();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
 const credentials=<>
  <label>Login name<input required autoComplete="username" minLength={3} maxLength={24} pattern="[A-Za-z0-9_]{3,24}" value={loginName} disabled={busy||!!account?.loginName} onChange={e=>setLoginName(e.target.value)}/></label>
  <p className="muted">Private sign-in name · 3–24 letters, numbers or underscores. It is separate from your name in rooms.</p>
  <label>{account?'New password':'Password'}<input required type="password" autoComplete="new-password" minLength={10} maxLength={128} value={password} disabled={busy} onChange={e=>setPassword(e.target.value)}/></label>
  <label>Confirm password<input required type="password" autoComplete="new-password" minLength={10} maxLength={128} value={repeat} disabled={busy} onChange={e=>setRepeat(e.target.value)}/></label>
  <p className="muted">Use at least 10 characters.</p>
 </>;
 return <div className="modal-backdrop" onClick={()=>{if(!busy&&!loadingProfile)onClose();}}><section className="modal account-panel" role="dialog" aria-modal="true" aria-label={account?'My profile':'Account access'} onClick={e=>e.stopPropagation()}>
  <div className="section-heading"><h2>{account?onboarding?'Set up your champion pools':'My profile':mode==='signup'?'Create account':mode==='recovery'?'Recover your account':'Sign in'}</h2><button aria-label="Close account" disabled={busy||loadingProfile} onClick={onClose}>×</button></div>
  <div className="account-guide"><GuideLink/></div>
  {loadingProfile&&<p role="status" className="muted">Loading your personal pools…</p>}
  {settingPassword?<>
   <h3>{account!.hasPassword&&account!.loginName?'Change password':'Finish setting up your account'}</h3>
   <p className="muted">Email: {account!.email}. Your profile and champion lists will stay.</p>
   <form onSubmit={e=>{e.preventDefault();void act(async()=>{matchedPassword();accept(await setAccountPassword(loginName,password),true);setPassword('');setRepeat('');setReset(false);});}}>
    {credentials}<button className="primary" disabled={busy||loadingProfile}>Save login and password</button>
   </form>
   {account!.hasPassword&&account!.loginName&&<button disabled={busy} onClick={()=>{setReset(false);setPassword('');setRepeat('');setError('');}}>Cancel password change</button>}
  </>:account?<>
   <div className="account-details"><p><span>Login name</span><b>{account.loginName}</b></p><p><span>Email</span><span>{account.email}</span></p><button disabled={busy||loadingProfile} onClick={()=>{setReset(true);setPassword('');setRepeat('');setError('');}}>Change password</button></div>
   {onboarding?<p className="muted">Prepare your candidates for each role once. You can leave roles empty and edit your lists later in My profile.</p>:<h3>My champion pools</h3>}
   <label>Room display name<input maxLength={32} disabled={busy||loadingProfile} value={name} onChange={e=>setName(e.target.value)} autoComplete="nickname"/></label>
   <p className="muted">Your name when creating or joining rooms.</p>
   <div className="personal-role-tabs" role="tablist" aria-label="Personal role pools">{ROLES.map(r=><button role="tab" aria-selected={role===r} disabled={busy||loadingProfile} key={r} onClick={()=>setRole(r)}><RoleIcon role={r}/>{roleName(r)}</button>)}</div>
   <div className="pool-tiles" aria-label={`${roleName(role)} personal candidates`}>{pools[role].map(id=><div className="pool-tile" key={id}><Portrait id={id}/><button className="remove-champion" aria-label={`Remove ${names[id]} from personal pool`} disabled={busy||loadingProfile} onClick={()=>setPools(p=>({...p,[role]:p[role].filter(c=>c!==id)}))}>×</button></div>)}</div>
   <Search key={role} initialRole={role} catalogue={catalogue} selected={pools[role]} blocked={new Set(pools[role])} disabled={busy||loadingProfile} onChoose={id=>setPools(p=>({...p,[role]:[...p[role],id]}))}/>
   <p className="muted">Your lists load when you take or change roles. Changes in a room stay in that room until you choose to save them.</p>
   <button className="primary" disabled={busy||loadingProfile||!name.trim()} onClick={()=>void act(async()=>{const profile=await saveProfile(name,pools,account.profile?.version??0);onChange({...account,profile});onClose();})}>Save profile and pools</button>
  </>:pending?<>
   <p className="muted">{pending.type==='recovery'?'If this email has an account, a recovery code has been sent.':'Enter the code sent to your email to confirm your account.'} Codes expire in 10 minutes.</p>
   <form onSubmit={e=>{e.preventDefault();void act(async()=>{const recovering=pending.type==='recovery';const next=await verifyCode(pending.email,code,pending.type);if(recovering)setReset(true);accept(next,!recovering);setCode('');setPending(null);});}}>
    <label>Confirmation code<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" maxLength={10} value={code} disabled={busy} onChange={e=>setCode(e.target.value)}/></label>
    <button className="primary" disabled={busy}>Verify code</button>
   </form><button disabled={busy} onClick={()=>void act(async()=>{if(pending.type==='recovery')await sendRecoveryCode(pending.email);else await resendConfirmationCode(pending.email);setCode('');})}>Resend code</button><button disabled={busy} onClick={()=>switchMode(mode)}>Back</button>
  </>:<>
   {!ready&&<p role="status" className="account-status">Account email is being configured. You can continue as a guest.</p>}
   {mode==='signin'?<>
    <form onSubmit={e=>{e.preventDefault();void act(async()=>{accept(await signInPassword(identifier,password),true);setPassword('');});}}>
     <label>Login name or email<input required autoComplete="username" maxLength={320} value={identifier} disabled={busy} onChange={e=>setIdentifier(e.target.value)}/></label>
     <label>Password<input required type="password" autoComplete="current-password" maxLength={128} value={password} disabled={busy} onChange={e=>setPassword(e.target.value)}/></label>
     <button className="primary" disabled={busy}>Sign in</button>
    </form>
    <button className="create-account-secondary" disabled={busy} onClick={()=>switchMode('signup')}>Create account</button>
    <button className="account-link" disabled={busy} onClick={()=>switchMode('recovery')}>Forgot password?</button>
    <button className="account-link" disabled={busy} onClick={()=>switchMode('recovery')}>Existing email-code account? Set your first password</button>
    <p className="muted">Stay signed in on this browser. Accounts are optional; guest rooms remain available.</p>
   </>:mode==='signup'?<form onSubmit={e=>{e.preventDefault();void act(async()=>{matchedPassword();const next=await registerAccount(email,loginName,password,name);setPassword('');setRepeat('');if(next)accept(next);else setPending({email:email.trim(),type:'email'});});}}>
    <label>Email address<input required type="email" autoComplete="email" value={email} disabled={busy} onChange={e=>setEmail(e.target.value)}/></label>
    {credentials}
    <label>Room display name<input required maxLength={32} autoComplete="nickname" value={name} disabled={busy} onChange={e=>setName(e.target.value)}/></label>
    <button className="primary" disabled={busy||!ready}>Create account</button>
   </form>:<>
    <h3>Recover your account</h3><p className="muted">Use the email linked to your account to reset your password or set your first one. Your profile and champion lists stay.</p>
    <form onSubmit={e=>{e.preventDefault();void act(async()=>{await sendRecoveryCode(email);setPending({email:email.trim(),type:'recovery'});});}}>
     <label>Email address<input required type="email" autoComplete="email" value={email} disabled={busy} onChange={e=>setEmail(e.target.value)}/></label>
     <button className="primary" disabled={busy||!ready}>Send recovery code</button>
    </form><button disabled={busy} onClick={()=>switchMode('signin')}>Back to sign in</button>
   </>}
   {mode==='signup'&&<button className="account-link" disabled={busy} onClick={()=>switchMode('signin')}>Back to sign in</button>}
  </>}
  {error&&<p role="alert" className="account-error">{error}</p>}
 </section></div>;
}
