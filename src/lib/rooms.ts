import {createClient} from '@supabase/supabase-js';
import type {Room,State} from '../domain/types';
import {initialState,DemoProvider} from '../data/provider';
import {validateState} from '../domain/state';
const url=import.meta.env.VITE_SUPABASE_URL,key=import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase=url&&key?createClient(url,key):null;
let identityPromise:Promise<string>|null=null;
export function identity(){return identityPromise??=resolveIdentity().catch(e=>{identityPromise=null;throw e;});}
async function resolveIdentity(){if(!supabase)return 'local-player';const {data}=await supabase.auth.getSession();if(data.session)return data.session.user.id;const result=await supabase.auth.signInAnonymously();if(result.error)throw result.error;return result.data.user!.id;}
export async function createRoom(name:string):Promise<{room:Room;token:string}>{const uid=await identity(),state=initialState(uid,name),token=crypto.randomUUID()+crypto.randomUUID();
 state.dataset=await new DemoProvider().load();
 if(!supabase){const room={id:crypto.randomUUID(),host_id:uid,version:0,state};localStorage.setItem('draftroom-demo',JSON.stringify(room));return {room,token:''};}
 const {data,error}=await supabase.rpc('create_room',{initial_state:state,invite_token:token});if(error)throw error;return {room:data as Room,token};
}
export async function joinRoom(id:string,token:string,name:string):Promise<Room>{await identity();if(!supabase)throw Error('Configurer Supabase pour rejoindre une salle partagée');const {data,error}=await supabase.rpc('join_room',{room_id:id,invite_token:token,nickname:name});if(error)throw error;return data;}
export async function readRoom(id:string):Promise<Room>{if(!supabase){const stored=localStorage.getItem('draftroom-demo');if(!stored)throw Error('Démo introuvable');return JSON.parse(stored);}
 const {data,error}=await supabase.from('rooms').select('*').eq('id',id).single();if(error)throw error;return data;}
export async function saveRoom(room:Room,next:State):Promise<Room>{validateState(next);if(!supabase){const stored=await readRoom(room.id);if(stored.version!==room.version)throw Error('Conflit : état actualisé, recommencez votre action');const updated={...room,state:next,version:room.version+1};localStorage.setItem('draftroom-demo',JSON.stringify(updated));return updated;}
 const {data,error}=await supabase.rpc('save_room',{room_id:room.id,expected_version:room.version,next_state:next});if(error)throw error;return data;}
export function watchRoom(id:string,receive:(r:Room)=>void,status:(s:string)=>void){if(!supabase){status('Démo locale · cet appareil uniquement');return ()=>{};}
 const refresh=()=>readRoom(id).then(receive).catch(()=>status('Reconnexion…'));
 const channel=supabase.channel(`room:${id}`).on('postgres_changes',{event:'UPDATE',schema:'public',table:'rooms',filter:`id=eq.${id}`},refresh).subscribe(s=>{status(s==='SUBSCRIBED'?'Synchronisé':s);if(s==='SUBSCRIBED')void refresh();});
 const timer=setInterval(()=>{void supabase!.rpc('heartbeat',{room_id:id});void refresh();},20000);
 window.addEventListener('online',refresh);return ()=>{clearInterval(timer);window.removeEventListener('online',refresh);void supabase!.removeChannel(channel);};
}
export async function presence(id:string){if(!supabase)return ['local-player'];const {data}=await supabase.from('room_members').select('user_id,last_seen').eq('room_id',id);return (data??[]).filter(p=>Date.now()-Date.parse(p.last_seen)<65000).map(p=>p.user_id as string);}
