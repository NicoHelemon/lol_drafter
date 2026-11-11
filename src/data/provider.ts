import catalogue from './champions.json';
import {ROLES,type Dataset,type Pair,type Role,type State} from '../domain/types';
export const champions=catalogue;
export const championIds=new Set(champions.map(c=>c.id));
export const byId=Object.fromEntries(champions.map(c=>[c.id,c]));
const demoCoverage:Record<Role,string[]>={Top:['58','122','164'],Jungle:['64','59','104'],Mid:['103','84','61'],ADC:['202','51','222'],Support:['412','89','117']};
export interface PairwiseDataProvider {load():Promise<Dataset>}
export class DemoProvider implements PairwiseDataProvider {async load(){return demoDataset();}}
export class ImportedProvider implements PairwiseDataProvider {constructor(private dataset:Dataset){} async load(){return structuredClone(this.dataset);}}
// Deliberately fabricated, deterministic fixture. No relationship to live winrates.
export function demoDataset():Dataset {
 const pairs:Pair[]=[];
 for(const candidateRole of ROLES) for(const c of demoCoverage[candidateRole]) for(const otherRole of ROLES) for(const o of Object.values(demoCoverage).flat()) for(const relation of ['vs','with'] as const){
  if(c===o||(relation==='with'&&candidateRole===otherRole))continue;
  // Atypical roles intentionally missing: demonstrate honest coverage.
  if(!demoCoverage[otherRole].includes(o))continue;
  const seed=Number(c)*17+Number(o)*13+ROLES.indexOf(candidateRole)*7+ROLES.indexOf(otherRole)*3+(relation==='vs'?11:23);
  if(seed%11===0)continue;
  pairs.push({relation,candidateChampionId:c,candidateRole,otherChampionId:o,otherRole,delta2:((seed%61)-30)/10,games:100+seed%900});
 }
 return {id:'fictional-v1',patch:'Demo',tier:'Synthetic',source:'Synthetic demo data',importedAt:'2026-11-11T00:00:00Z',fictional:true,pairs};
}
export function initialState(id:string,name:string):State{return {phase:'setup',side:'blue',dataset:demoDataset(),players:[{id,name,role:null,pool:[],ready:false}],picks:{ally:[],enemy:[]},bans:{ally:Array(5).fill(null),enemy:Array(5).fill(null)},history:[]};}
