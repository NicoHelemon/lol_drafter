import {ROLES,type Dataset,type Pair} from '../domain/types';
import {pairKey} from '../domain/scoring';
function csv(text:string):Record<string,string>[] {
 const rows:string[][]=[];let row:string[]=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(!quoted&&(c===','||c==='\n')){row.push(field.replace(/\r$/,''));field='';if(c==='\n'){rows.push(row);row=[];}}else field+=c;}
 if(quoted)throw Error('CSV: unclosed quote');if(field||row.length){row.push(field.replace(/\r$/,''));rows.push(row);}
 const header=rows.shift()??[];return rows.filter(r=>r.some(Boolean)).map(r=>{if(r.length!==header.length)throw Error('CSV: incorrect column count');return Object.fromEntries(header.map((h,i)=>[h.trim(),r[i]]));});
}
export function importDataset(text:string,format:'json'|'csv',ids:Set<string>,metadata?:Omit<Dataset,'pairs'>):Dataset{
 const raw=format==='json'?JSON.parse(text):{...metadata,pairs:csv(text)};
 if(!raw||typeof raw!=='object'||!Array.isArray(raw.pairs))throw Error('Expected a dataset object with pairs');
 for(const k of ['id','patch','tier','source','importedAt'])if(typeof raw[k]!=='string'||!raw[k].trim())throw Error(`Required metadata : ${k}`);
 if(!Number.isFinite(Date.parse(raw.importedAt))||typeof raw.fictional!=='boolean')throw Error('Invalid date or fictional flag');
 if(raw.pairs.length>100000)throw Error('Maximum 100,000 pairs per import');
 const keys=new Set<string>();const pairs:Pair[]=raw.pairs.map((p:Pair)=>{
  if(!['vs','with'].includes(p.relation)||!ROLES.includes(p.candidateRole)||!ROLES.includes(p.otherRole)||!ids.has(String(p.candidateChampionId))||!ids.has(String(p.otherChampionId)))throw Error('Invalid champion, role or relation');
  if(p.relation==='with'&&p.candidateRole===p.otherRole)throw Error('Invalid same-role synergy');
  if(format==='json'&&p.delta2!==null&&typeof p.delta2!=='number')throw Error('JSON score must be a number or null');
  const delta2=p.delta2===null||(p.delta2 as unknown)===''?null:Number(p.delta2);
  if(delta2!==null&&(!Number.isFinite(delta2)||Math.abs(delta2)>100))throw Error('Invalid score');
  if(format==='json'&&p.games!==undefined&&typeof p.games!=='number')throw Error('JSON games must be a number');
  const games=p.games===undefined||(p.games as unknown)===''?undefined:Number(p.games);if(games!==undefined&&(!Number.isInteger(games)||games<0))throw Error('Invalid games count');
  const result={relation:p.relation,candidateChampionId:String(p.candidateChampionId),candidateRole:p.candidateRole,otherChampionId:String(p.otherChampionId),otherRole:p.otherRole,delta2,...(games===undefined?{}:{games})};
  const key=pairKey(result);if(keys.has(key))throw Error('Duplicate directional pair');keys.add(key);return result;
 });return {id:raw.id,patch:raw.patch,tier:raw.tier,source:raw.source,importedAt:raw.importedAt,fictional:raw.fictional,pairs};
}
