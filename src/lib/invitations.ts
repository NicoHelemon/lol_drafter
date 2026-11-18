import {supabase} from './client';
import type {Room} from '../domain/types';

const key=(uid:string,slug:string)=>`draftroom-invitation:${uid}:${slug}`;
const valid=(token:string)=>token.length>=64&&token.length<=128;
export function savedInvitation(uid:string,slug:string){try{const token=localStorage.getItem(key(uid,slug))??'';return valid(token)?token:'';}catch{return '';}}
export function rememberInvitation(uid:string,slug:string,token:string){if(!uid||!valid(token))return;try{localStorage.setItem(key(uid,slug),token);}catch{/* The URL and copy fallback still work when storage is unavailable. */}}
export function forgetInvitation(uid:string,slug:string){try{localStorage.removeItem(key(uid,slug));}catch{/* Storage may be unavailable. */}}
export async function recoverInvitation(room:Room){
 if(!supabase)throw Error('Invitations are unavailable in local demo mode');
 const {data,error}=await supabase.rpc('issue_room_invitation',{room_id:room.id});
 if(error)throw error;if(typeof data!=='string'||!valid(data))throw Error('Could not create an invitation link');return data;
}
export const invitationUrl=(slug:string,token:string)=>`${location.origin}/rooms/${encodeURIComponent(slug)}/setup#${token}`;
