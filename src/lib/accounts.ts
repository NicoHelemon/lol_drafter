import {supabase} from './client';
import {ROLES,type AccountProfile,type Role,type RoleCatalogue} from '../domain/types';
import {validatePool} from '../domain/rolePools';
export interface Account {id:string;email:string;profile:AccountProfile|null;loginName:string|null;hasPassword:boolean}
export const emptyPools=():Record<Role,string[]>=>({Top:[],Jungle:[],Mid:[],ADC:[],Support:[]});
export async function readAccount():Promise<Account|null>{
 if(!supabase)return null;const {data:{session}}=await supabase.auth.getSession();if(!session||session.user.is_anonymous||!session.user.email)return null;
 const {data,error}=await supabase.auth.getUser();if(error)throw error;const user=data.user;if(!user?.email||user.is_anonymous||!user.email_confirmed_at)return null;
 const [profile,login]=await Promise.all([readProfile(),supabase.rpc('my_account_login')]);if(login.error)throw login.error;
 return {id:user.id,email:user.email,profile,loginName:login.data?.login_name??null,hasPassword:login.data?.has_password===true};
}
export async function readProfile():Promise<AccountProfile|null>{if(!supabase)return null;const {data,error}=await supabase.from('user_profiles').select('*').maybeSingle();if(error)throw error;return data;}
export async function emailLoginReady(){if(!supabase)return false;const {data,error}=await supabase.from('account_features').select('email_login_ready').single();if(error)throw error;return data.email_login_ready===true;}
async function outsideRoom(){if(!supabase)throw Error('Accounts are available on the hosted site');const {data,error}=await supabase.rpc('account_login_allowed');if(error)throw error;if(data!==true)throw Error('Quit your current room before signing in or out');}
export function validateLoginName(name:string){if(!/^[a-z0-9_]{3,24}$/i.test(name.trim()))throw Error('Use 3–24 letters, numbers or underscores for your login name');return name.trim().toLowerCase();}
export function validatePassword(password:string){if(password.length<10||password.length>128)throw Error('Use a password between 10 and 128 characters');}
export async function loginNameAvailable(name:string){const normal=validateLoginName(name);if(!supabase)throw Error('Accounts require the hosted site');const {data,error}=await supabase.rpc('login_name_available',{proposed_name:normal});if(error)throw error;return data===true;}
export async function signInPassword(identifier:string,password:string){
 await outsideRoom();
 // The server resolves a private login name; no email directory is exposed to browsers.
 const {data,error}=await supabase!.functions.invoke('account-password-login',{body:{identifier:identifier.trim(),password}});
 if(error){let message='Sign-in failed. Please try again.';try{const result=await error.context?.json();if(typeof result?.message==='string')message=result.message;}catch{}throw Error(message);}
 const {error:sessionError}=await supabase!.auth.setSession({access_token:data.access_token,refresh_token:data.refresh_token});if(sessionError)throw sessionError;return readAccount();
}
export async function registerAccount(email:string,loginName:string,password:string,displayName:string){
 await outsideRoom();validatePassword(password);const normal=validateLoginName(loginName);
 if(!displayName.trim()||displayName.trim().length>32)throw Error('Choose a room display name between 1 and 32 characters');
 if(!await emailLoginReady())throw Error('Account email is being configured. You can continue as a guest.');
 if(!await loginNameAvailable(normal))throw Error('This login name is already taken');
 const {data,error}=await supabase!.auth.signUp({email:email.trim(),password,options:{data:{login_name:normal,display_name:displayName.trim()}}});
 if(error)throw Error(error.status===500?'Could not create the account. Try another login name or sign in to your existing account.':error.message);
 return data.session?readAccount():null;
}
export async function sendRecoveryCode(email:string){await outsideRoom();if(!await emailLoginReady())throw Error('Account email is being configured. You can continue as a guest.');const {error}=await supabase!.auth.resetPasswordForEmail(email.trim());if(error)throw error;}
export async function resendConfirmationCode(email:string){await outsideRoom();if(!await emailLoginReady())throw Error('Account email is being configured. You can continue as a guest.');const {error}=await supabase!.auth.resend({type:'signup',email:email.trim()});if(error)throw error;}
export async function verifyCode(email:string,token:string,type:'email'|'recovery'='email'){await outsideRoom();const {error}=await supabase!.auth.verifyOtp({email:email.trim(),token:token.trim(),type});if(error)throw error;return readAccount();}
export async function setAccountPassword(loginName:string,password:string){
 await outsideRoom();validatePassword(password);const normal=validateLoginName(loginName);const account=await readAccount();if(!account)throw Error('Verify your email before setting a password');
 if(account.loginName!==normal&&!await loginNameAvailable(normal))throw Error('This login name is already taken');
 const {error}=await supabase!.auth.updateUser({password});if(error)throw error;
 const {error:nameError}=await supabase!.rpc('set_my_login_name',{proposed_name:normal});if(nameError)throw nameError;
 return readAccount();
}
export async function signOutAccount(){if(!supabase)throw Error('Email accounts require the hosted site');const {error}=await supabase.auth.signOut({scope:'local'});if(error)throw error;}
export async function saveProfile(name:string,pools:Record<Role,string[]>,version:number){
 if(!supabase)throw Error('Profiles require an email account on the hosted site');for(const role of ROLES)validatePool(pools[role]);
 const {data,error}=await supabase.rpc('save_my_profile',{new_name:name.trim(),new_pools:pools,expected_version:version});if(error)throw error;return data as AccountProfile;
}
export async function saveRoomPool(role:Role,pool:string[],fallbackName:string){const current=await readProfile();const pools={...emptyPools(),...current?.role_pools,[role]:[...pool]};return saveProfile(current?.display_name??fallbackName,pools,current?.version??0);}
export async function accountRoleCatalogue():Promise<RoleCatalogue|undefined>{
 if(!supabase)return;const current=await supabase.from('statistics_current').select('snapshot_id').maybeSingle();if(current.error)throw current.error;if(!current.data)return;
 const {data,error}=await supabase.from('statistics_role_catalogues').select('catalogue').eq('snapshot_id',current.data.snapshot_id).maybeSingle();if(error)throw error;return data?.catalogue;
}
