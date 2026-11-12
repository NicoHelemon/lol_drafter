import type { Dataset, Pair, Room } from '../domain/types';
import { championIds } from './provider';
import { importDataset } from './import';

export interface Shard { candidate_key: string; pairs: Pair[] }
type ReadShards = (snapshot: string, keys: string[]) => Promise<Shard[]>;

// One cache per browser session, keyed by immutable snapshot AND candidate/role.
// No cache entry is reused across daily snapshots. Failures may be retried.
export class StatisticsCache {
  private entries = new Map<string, Promise<Pair[]>>();
  constructor(private read: ReadShards) {}

  async hydrate(room: Room): Promise<Room> {
    const dataset = room.state.dataset;
    if (!dataset.snapshotId) return room;
    if (!/^[a-f0-9]{64}$/.test(dataset.snapshotId)) throw Error('Invalid snapshot identity');
    const keys = [...new Set([
      ...room.state.players.flatMap(p => p.role ? p.pool.map(id => `${id}:${p.role}`) : []),
      ...Object.values(room.state.picks).flat().map(p => `${p.championId}:${p.role}`),
    ])].sort();
    const missing = keys.filter(key => !this.entries.has(`${dataset.snapshotId}/${key}`));
    for (let i = 0; i < missing.length; i += 40) {
      const batch = missing.slice(i, i + 40), snapshot = dataset.snapshotId;
      const request = this.read(snapshot, batch).then(rows => {
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
        const value = request.then(rows => rows.get(key) ?? []).catch(error => {
          this.entries.delete(cacheKey);
          throw error;
        });
        this.entries.set(cacheKey, value);
      }
    }
    const pairs = (await Promise.all(keys.map(key => this.entries.get(`${dataset.snapshotId}/${key}`)!))).flat();
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
