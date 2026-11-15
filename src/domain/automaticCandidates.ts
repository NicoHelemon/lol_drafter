import type {State,Team,Role} from './types';
import {champions} from '../data/provider';
import {rolePool} from './rolePools';
import {unavailable} from './scoring';
export function automaticPool(s:State,team:Team,role:Role):string[]{
 const explicit=rolePool(s,team,role),selected=s.picks[team].find(p=>p.role===role)?.championId;
 if(!s.draftMode||s.phase!=='live')return explicit;
 const ids=[...new Set([...(selected?[selected]:[]),...explicit])],used=unavailable(s);
 const metadata=new Map(s.roleCatalogue?.entries.filter(p=>p.role===role).map(p=>[p.championId,p]));
 const popular=[...champions].sort((a,b)=>Number((metadata.get(b.id)?.lanePercent??0)>=5)-Number((metadata.get(a.id)?.lanePercent??0)>=5)||(metadata.get(b.id)?.games??-1)-(metadata.get(a.id)?.games??-1)||a.name.localeCompare(b.name,'en'));
 for(const c of popular){if(ids.filter(id=>id===selected||!used.has(id)).length>=5)break;if(!ids.includes(c.id)&&!used.has(c.id))ids.push(c.id);}
 return ids;
}
