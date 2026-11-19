import {useEffect,useRef,useState} from 'react';
import type {Dataset,Room} from '../domain/types';
import {currentStatistics} from '../lib/rooms';

const dateFormat=new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Zurich'});
export default function RoomData({room,host,busy,onUpdate}:{room:Room;host:boolean;busy:boolean;onUpdate:()=>void}){
 const dataset=room.state.dataset;
 const [latest,setLatest]=useState<Dataset|null>(null),[unavailable,setUnavailable]=useState(false),[updated,setUpdated]=useState(false);
 const previous=useRef({room:room.id,snapshot:dataset.snapshotId});
 useEffect(()=>{
  const changed=previous.current.room===room.id&&previous.current.snapshot!==dataset.snapshotId;
  previous.current={room:room.id,snapshot:dataset.snapshotId};
  setUpdated(changed);
  if(!changed)return;
  const timer=setTimeout(()=>setUpdated(false),8000);return()=>clearTimeout(timer);
 },[room.id,dataset.snapshotId]);
 useEffect(()=>{
  setLatest(null);setUnavailable(false);
  if(dataset.fictional||!dataset.snapshotId)return;
  let active=true;
  const check=()=>currentStatistics().then(value=>{if(active){setLatest(value);setUnavailable(false);}}).catch(()=>{if(active)setUnavailable(true);});
  void check();const timer=setInterval(()=>{if(!document.hidden)void check();},30000);
  const visible=()=>{if(!document.hidden)void check();};
  window.addEventListener('online',visible);document.addEventListener('visibilitychange',visible);
  return()=>{active=false;clearInterval(timer);window.removeEventListener('online',visible);document.removeEventListener('visibilitychange',visible);};
 },[room.id,dataset.snapshotId,dataset.fictional]);
 if(dataset.fictional)return null;
 const newer=room.state.phase==='live'&&latest&&latest.snapshotId!==dataset.snapshotId;
 return <section className="room-data" aria-label="Room data" aria-live="polite">
  <span>Data collected: <time dateTime={dataset.importedAt}>{dateFormat.format(new Date(dataset.importedAt))}</time> · Zurich time</span>
  {newer&&<><span className="data-available" title={`Collected ${dateFormat.format(new Date(latest.importedAt))} · Zurich time`}>New data available</span>
   {host?<button disabled={busy} onClick={onUpdate} title="Update data for everyone and recalculate scores. Keep picks, bans and candidates.">Update data</button>:<small>The host can update data.</small>}</>}
  {updated&&<span className="data-updated" role="status">Data updated. Scores recalculated.</span>}
  {unavailable&&<small>Unable to check for newer data.</small>}
 </section>;
}
