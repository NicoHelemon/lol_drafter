import type { Dataset, Pair, Room, ShrinkageModel,RoleCatalogue } from '../domain/types';
import {validateCatalogue} from '../domain/catalogue';
import {validateModel} from '../domain/shrinkage';
import { championIds } from './provider';
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
  private readCatalogue?: (snapshot:string)=>Promise<unknown>;
  constructor(private read: ReadShards, options: { capacity?: number; ttlMs?: number; now?: () => number; readCalibration?:(snapshot:string)=>Promise<unknown>;readCatalogue?:(snapshot:string)=>Promise<unknown> } = {}) {
    this.capacity = options.capacity ?? 128;
    this.ttlMs = options.ttlMs ?? 30 * 60_000;
    this.now = options.now ?? Date.now;
    this.readCalibration=options.readCalibration;
    this.readCatalogue=options.readCatalogue;
    if (!Number.isInteger(this.capacity) || this.capacity < 1 || !Number.isFinite(this.ttlMs) || this.ttlMs <= 0) throw Error('Invalid cache limits');
  }

  clear() {
    this.entries.clear();
    this.pending.clear();
    this.models.clear();
    this.catalogues.clear();
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
    const keys = [...new Set([
      ...room.state.players.flatMap(p => p.role ? p.pool.map(id => `${id}:${p.role}`) : []),
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
    return { ...room, state: { ...room.state, shrinkage:model,roleCatalogue:catalogue, dataset: { ...dataset, pairs } } };
  }
}

export function persistedState(state: Room['state']): Room['state'] {
  const {shrinkage:_,roleCatalogue:__,...stored}=state;
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
