import {supabase} from './client';
import {ROLES,type AccountProfile,type Role,type RoleCatalogue} from '../domain/types';
import {validatePool} from '../domain/rolePools';
export interface Account {id:string;email:string;profile:AccountProfile|null}
export const emptyPools=():Record<Role,string[]>=>({Top:[],Jungle:[],Mid:[],ADC:[],Support:[]});
export async function readAccount():Promise<Account|null>{
 if(!supabase)return null;const {data:{session}}=await supabase.auth.getSession();if(!session||session.user.is_anonymous||!session.user.email)return null;
 const {data,error}=await supabase.auth.getUser();if(error)throw error;const user=data.user;if(!user?.email||user.is_anonymous||!user.email_confirmed_at)return null;
 const profile=await readProfile();return {id:user.id,email:user.email,profile};
}
export async function readProfile():Promise<AccountProfile|null>{if(!supabase)return null;const {data,error}=await supabase.from('user_profiles').select('*').maybeSingle();if(error)throw error;return data;}
export async function emailLoginReady(){if(!supabase)return false;const {data,error}=await supabase.from('account_features').select('email_login_ready').single();if(error)throw error;return data.email_login_ready===true;}
async function outsideRoom(){if(!supabase)throw Error('Email sign-in is available on the hosted site');const {data,error}=await supabase.rpc('account_login_allowed');if(error)throw error;if(data!==true)throw Error('Quit your current room before signing in or out');}
export async function sendCode(email:string){await outsideRoom();if(!await emailLoginReady())throw Error('Email sign-in is being configured. You can continue as a guest.');const {error}=await supabase!.auth.signInWithOtp({email:email.trim(),options:{shouldCreateUser:true}});if(error)throw error;}
export async function verifyCode(email:string,token:string){await outsideRoom();const {error}=await supabase!.auth.verifyOtp({email:email.trim(),token:token.trim(),type:'email'});if(error)throw error;return readAccount();}
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
