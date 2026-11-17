import type { Dataset, Pair, Room, ShrinkageModel,RoleCatalogue } from '../domain/types';
import {validateCatalogue} from '../domain/catalogue';
import {automaticPool} from '../domain/automaticCandidates';
import {rolePoolEntries} from '../domain/rolePools';
import {validateModel} from '../domain/shrinkage';
import { championIds } from './provider';
import {referenceContextKey} from '../domain/exceptionalPicks';
import {pairKey} from '../domain/scoring';
import type {Pick} from '../domain/types';
import { importDataset } from './import';

export interface Shard { candidate_key: string; pairs: Pair[] }
type ReadShards = (snapshot: string, keys: string[]) => Promise<Shard[]>;

// One cache per browser session, keyed by immutable snapshot AND candidate/role.
// No cache entry is reused across daily snapshots. Failures may be retried.
export class StatisticsCache {
  private entries = new Map<string, { pairs: Pair[]; expires: number }>();
  private pending = new Map<string, Promise<Pair[]>>();
  private capacity: number;
  private ttlMs: number;
  private now: () => number;
  private models=new Map<string,Promise<ShrinkageModel|undefined>>();
  private readCalibration?: (snapshot:string)=>Promise<unknown>;
  private catalogues=new Map<string,Promise<RoleCatalogue|undefined>>();
  private references=new Map<string,Promise<Pair[]>>();
  private readReference?: (snapshot:string,picks:Pick[])=>Promise<unknown>;
  private readCatalogue?: (snapshot:string)=>Promise<unknown>;
  constructor(private read: ReadShards, options: { capacity?: number; ttlMs?: number; now?: () => number; readCalibration?:(snapshot:string)=>Promise<unknown>;readCatalogue?:(snapshot:string)=>Promise<unknown>;readReference?:(snapshot:string,picks:Pick[])=>Promise<unknown> } = {}) {
    this.capacity = options.capacity ?? 128;
    this.ttlMs = options.ttlMs ?? 30 * 60_000;
    this.now = options.now ?? Date.now;
    this.readCalibration=options.readCalibration;
    this.readCatalogue=options.readCatalogue;
    this.readReference=options.readReference;
    if (!Number.isInteger(this.capacity) || this.capacity < 1 || !Number.isFinite(this.ttlMs) || this.ttlMs <= 0) throw Error('Invalid cache limits');
  }

  clear() {
    this.entries.clear();
    this.pending.clear();
    this.models.clear();
    this.catalogues.clear();
    this.references.clear();
  }

  async hydrate(room: Room): Promise<Room> {
    const dataset = room.state.dataset;
    if (!dataset.snapshotId) return room;
    if (!/^[a-f0-9]{64}$/.test(dataset.snapshotId)) throw Error('Invalid snapshot identity');
    let model=room.state.shrinkage;
    let catalogue=room.state.roleCatalogue;
    if(this.readCatalogue){
      const sid=dataset.snapshotId;
      if(!this.catalogues.has(sid)){
        const request=this.readCatalogue(sid).then(raw=>raw==null?undefined:validateCatalogue(raw,championIds)).catch(e=>{this.catalogues.delete(sid);throw e;});
        this.catalogues.set(sid,request);while(this.catalogues.size>this.capacity)this.catalogues.delete(this.catalogues.keys().next().value!);
      }
      catalogue=await this.catalogues.get(sid)!;if(!catalogue)this.catalogues.delete(sid);
    }
    if(this.readCalibration){
      const sid=dataset.snapshotId;
      if(!this.models.has(sid)){
        const request=this.readCalibration(sid).then(raw=>raw==null ? undefined : validateModel(raw)).catch(e=>{this.models.delete(sid);throw e;});
        this.models.set(sid,request);
        while(this.models.size>this.capacity)this.models.delete(this.models.keys().next().value!);
      }
      model=await this.models.get(sid)!;
      // A missing calibration may be installed later; never pin the absence.
      if(!model)this.models.delete(sid);
    }
    const context=Object.values(room.state.picks).flat(),referenceKey=referenceContextKey(room.state);
    let reference:Promise<Pair[]>|undefined;
    if(this.readReference&&model&&catalogue&&room.state.phase==='live'&&context.length){
      if(!this.references.has(referenceKey)){
        const eligible=new Set(catalogue.entries.filter(e=>e.lanePercent>=5).map(e=>`${e.championId}:${e.role}`));
        const others=new Set(context.map(p=>`${p.championId}:${p.role}`));
        const request=this.readReference(dataset.snapshotId,context).then(raw=>{
          if(!Array.isArray(raw)||raw.length>10000)throw Error('Invalid reference pairs');
          const pairs=importDataset(JSON.stringify({...dataset,pairs:raw}),'json',championIds).pairs;
          if(pairs.some(p=>!eligible.has(`${p.candidateChampionId}:${p.candidateRole}`)||!others.has(`${p.otherChampionId}:${p.otherRole}`)))throw Error('Unexpected reference pair');
          return pairs;
        }).catch(e=>{this.references.delete(referenceKey);throw e;});
        this.references.set(referenceKey,request);
        while(this.references.size>8)this.references.delete(this.references.keys().next().value!);
      }
      reference=this.references.get(referenceKey)!;
    }
    // An optional reference outage must not disable the draft or its regular scores.
    const referenceResult=reference?.then(pairs=>({pairs,key:referenceKey})).catch(()=>undefined);
    const keys = [...new Set([
      // Best fits use the compact reference already loaded above, without full shards.
      ...rolePoolEntries(room.state).flatMap(p=>automaticPool({...room.state,roleCatalogue:catalogue},p.team,p.role,false).map(id=>`${id}:${p.role}`)),
      ...Object.values(room.state.picks).flat().map(p => `${p.championId}:${p.role}`),
    ])].sort();
    // Keep this hydration's promises even if a larger request evicts LRU entries.
    const values = new Map<string, Promise<Pair[]>>();
    for (const [key, entry] of this.entries) if (entry.expires <= this.now()) this.entries.delete(key);
    const missing = keys.filter(key => {
      const cacheKey = `${dataset.snapshotId}/${key}`, entry = this.entries.get(cacheKey);
      if (entry) {
        this.entries.delete(cacheKey);
        this.entries.set(cacheKey, entry);
        values.set(key, Promise.resolve(entry.pairs));
      } else if (this.pending.has(cacheKey)) values.set(key, this.pending.get(cacheKey)!);
      return !values.has(key);
    });
    for (let i = 0; i < missing.length; i += 40) {
      const batch = missing.slice(i, i + 40), snapshot = dataset.snapshotId;
      const request = Promise.resolve().then(() => this.read(snapshot, batch)).then(rows => {
        const found = new Map<string, Pair[]>();
        for (const row of rows) {
          if (!batch.includes(row.candidate_key) || found.has(row.candidate_key)) throw Error('Unexpected statistics shard');
          const verified = importDataset(JSON.stringify({ ...dataset, pairs: row.pairs }), 'json', championIds);
          if (verified.pairs.some(p => `${p.candidateChampionId}:${p.candidateRole}` !== row.candidate_key)) throw Error('Mixed statistics shards');
          found.set(row.candidate_key, verified.pairs);
        }
        return found;
      });
      for (const key of batch) {
        const cacheKey = `${snapshot}/${key}`;
        const value = request.then(rows => {
          const pairs = rows.get(key) ?? [];
          if (this.pending.get(cacheKey) === value) {
            this.entries.set(cacheKey, { pairs, expires: this.now() + this.ttlMs });
            while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!);
          }
          return pairs;
        }).finally(() => {
          if (this.pending.get(cacheKey) === value) this.pending.delete(cacheKey);
        });
        this.pending.set(cacheKey, value);
        values.set(key, value);
      }
    }
    const pairs = (await Promise.all(keys.map(key => values.get(key)!))).flat();
    const extra=await referenceResult;
    const merged=extra?[...new Map([...extra.pairs,...pairs].map(p=>[pairKey(p),p])).values()]:pairs;
    return { ...room, state: { ...room.state, referenceKey:extra?.key,shrinkage:model,roleCatalogue:catalogue, dataset: { ...dataset, pairs:merged } } };
  }
}

export function persistedState(state: Room['state']): Room['state'] {
  const {shrinkage:_,roleCatalogue:__,referenceKey:___,...stored}=state;
  // Loaded pairs are local working data; never send them back in room edits.
  return state.dataset.snapshotId
    ? { ...stored, dataset: { ...state.dataset, pairs: [] } }
    : stored;
}

export function snapshotMetadata(raw: unknown): Dataset {
  const ds = raw as Dataset;
  if (!ds || !/^[a-f0-9]{64}$/.test(ds.snapshotId ?? '')) throw Error('Invalid snapshot metadata');
  importDataset(JSON.stringify({ ...ds, pairs: [] }), 'json', championIds);
  return { ...ds, pairs: [] };
}
