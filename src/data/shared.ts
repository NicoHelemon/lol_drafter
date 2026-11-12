import type { Dataset, Pair, Room } from '../domain/types';
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
  constructor(private read: ReadShards, options: { capacity?: number; ttlMs?: number; now?: () => number } = {}) {
    this.capacity = options.capacity ?? 128;
    this.ttlMs = options.ttlMs ?? 30 * 60_000;
    this.now = options.now ?? Date.now;
    if (!Number.isInteger(this.capacity) || this.capacity < 1 || !Number.isFinite(this.ttlMs) || this.ttlMs <= 0) throw Error('Invalid cache limits');
  }

  clear() {
    this.entries.clear();
    this.pending.clear();
  }

  async hydrate(room: Room): Promise<Room> {
    const dataset = room.state.dataset;
    if (!dataset.snapshotId) return room;
    if (!/^[a-f0-9]{64}$/.test(dataset.snapshotId)) throw Error('Invalid snapshot identity');
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
    return { ...room, state: { ...room.state, dataset: { ...dataset, pairs } } };
  }
}

export function persistedState(state: Room['state']): Room['state'] {
  // Loaded pairs are local working data; never send them back in room edits.
  return state.dataset.snapshotId
    ? { ...state, dataset: { ...state.dataset, pairs: [] } }
    : state;
}

export function snapshotMetadata(raw: unknown): Dataset {
  const ds = raw as Dataset;
  if (!ds || !/^[a-f0-9]{64}$/.test(ds.snapshotId ?? '')) throw Error('Invalid snapshot metadata');
  importDataset(JSON.stringify({ ...ds, pairs: [] }), 'json', championIds);
  return { ...ds, pairs: [] };
}
