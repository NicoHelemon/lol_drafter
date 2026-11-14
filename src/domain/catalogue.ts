import {ROLES,type Champion,type Role,type RoleCatalogue} from './types';
export const ROLE_SHARE_MIN=5;
export function validateCatalogue(raw:unknown,ids:Set<string>):RoleCatalogue {
 const c=raw as RoleCatalogue;
 if(!c||c.schemaVersion!==1||!Number.isFinite(Date.parse(c.capturedAt))||!c.source||!c.context||!Array.isArray(c.entries)||c.entries.length<1||c.entries.length>ids.size*5)throw Error('Invalid role catalogue');
 const seen=new Set<string>();
 for(const e of c.entries){const key=`${e.championId}:${e.role}`;
  if(!ids.has(e.championId)||!ROLES.includes(e.role)||seen.has(key)||!Number.isInteger(e.games)||e.games<0
   ||[e.lanePercent,e.pickPercent].some(n=>!Number.isFinite(n)||n<0||n>100))throw Error('Invalid role catalogue entry');
  seen.add(key);
 }
 return c;
}
export function catalogueChoices(champions:Champion[],catalogue:RoleCatalogue|undefined,options:{role:Role|'all';sort:'alphabetical'|'popularity';query:string;pinned:string[]}) {
 const rows=new Map(catalogue?.entries.map(e=>[`${e.championId}:${e.role}`,e]));
 const totals=new Map<string,number>();for(const e of catalogue?.entries??[])totals.set(e.championId,(totals.get(e.championId)??0)+e.games);
 const query=options.query.trim().toLocaleLowerCase();
 const games=(id:string)=>options.role==='all'?totals.get(id):rows.get(`${id}:${options.role}`)?.games;
 return champions.filter(c=>c.name.toLocaleLowerCase().includes(query))
  .filter(c=>!catalogue||options.role==='all'||options.pinned.includes(c.id)||(rows.get(`${c.id}:${options.role}`)?.lanePercent??-1)>=ROLE_SHARE_MIN)
  .map(c=>({...c,games:games(c.id),popularity:options.role==='all'?undefined:rows.get(`${c.id}:${options.role}`)?.pickPercent}))
  .sort((a,b)=>options.sort==='popularity'&&catalogue
   ? Number(b.games!==undefined)-Number(a.games!==undefined)||(b.games??0)-(a.games??0)||a.name.localeCompare(b.name,'en')
   :a.name.localeCompare(b.name,'en'));
}
