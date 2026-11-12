import { it, expect, vi } from 'vitest';
import { StatisticsCache, persistedState } from '../src/data/shared';
import { initialState } from '../src/data/provider';
import { score } from '../src/domain/scoring';
import type { Pair, Room } from '../src/domain/types';

const sid = 'a'.repeat(64);
function room(snapshotId = sid): Room {
  const state = initialState('p', 'Player');
  state.players[0] = { id: 'p', name: 'Player', role: 'Top', pool: ['58'] };
  state.dataset = { ...state.dataset, snapshotId, pairs: [] };
  return { id: 'room', slug: 'players-room', name: "Player's room", host_id: 'p', version: 0, state };
}
const pair: Pair = { relation: 'vs', candidateChampionId: '58', candidateRole: 'Top', otherChampionId: '122', otherRole: 'Top', delta2: 0, games: 100 };

it('fetches pool shards only, preserves zero, and recalculates picks and bans without fetching them again', async () => {
  const read = vi.fn(async () => [{ candidate_key: '58:Top', pairs: [pair] }]);
  const cache = new StatisticsCache(read);
  let r = await cache.hydrate(room());
  expect(read).toHaveBeenCalledWith(sid, ['58:Top']);
  expect(r.state.dataset.pairs).toEqual([pair]);
  expect(persistedState(r.state).dataset.pairs).toEqual([]);
  expect(r.state.dataset.pairs).toEqual([pair]);
  // A pick from a prepared pool was already fetched. A ban never needs a shard.
  r.state.picks.ally = [{ championId: '58', role: 'Top' }];
  r.state.bans.enemy[0] = '51';
  r = await cache.hydrate(r);
  expect(read).toHaveBeenCalledTimes(1);
  r.state.picks.enemy = [{ championId: '122', role: 'Top' }];
  expect(score('58', 'Top', r.state).value).toBe(0);
});

it('pins each room to its snapshot and never mixes data across refreshes', async () => {
  const next = 'b'.repeat(64);
  const read = vi.fn(async (snapshot: string) => [{ candidate_key: '58:Top', pairs: [{ ...pair, delta2: snapshot === sid ? 1 : -2 }] }]);
  const cache = new StatisticsCache(read);
  expect((await cache.hydrate(room())).state.dataset.pairs[0].delta2).toBe(1);
  expect((await cache.hydrate(room(next))).state.dataset.pairs[0].delta2).toBe(-2);
  expect((await cache.hydrate(room())).state.dataset.pairs[0].delta2).toBe(1);
  expect(read).toHaveBeenCalledTimes(2);
});

it('fetches a changed role separately, caches missing keys, and removes unused pairs from hydrated state', async () => {
  const read = vi.fn(async () => [{ candidate_key: '58:Top', pairs: [pair] }]);
  const cache = new StatisticsCache(read);
  await cache.hydrate(room());
  read.mockImplementation(async () => []);
  const r = room(); r.state.players[0].role = 'Mid';
  expect((await cache.hydrate(r)).state.dataset.pairs).toEqual([]);
  expect((await cache.hydrate(r)).state.dataset.pairs).toEqual([]);
  expect(read).toHaveBeenCalledTimes(2);
  expect(read).toHaveBeenLastCalledWith(sid, ['58:Mid']);
});

it('retries failed loads and rejects another candidate’s data in a shard', async () => {
  const read = vi.fn(async () => [{ candidate_key: '58:Top', pairs: [{ ...pair, candidateChampionId: '122' }] }]);
  const cache = new StatisticsCache(read);
  await expect(cache.hydrate(room())).rejects.toThrow('Mixed');
  read.mockImplementation(async () => [{ candidate_key: '58:Top', pairs: [pair] }]);
  expect((await cache.hydrate(room())).state.dataset.pairs).toEqual([pair]);
  expect(read).toHaveBeenCalledTimes(2);
});

it('evicts the least recently used shard and expires hot entries after thirty minutes', async () => {
  let now = 0;
  const read = vi.fn(async () => []);
  const cache = new StatisticsCache(read, {capacity:2, now:() => now});
  const first = room(), second = room('b'.repeat(64)), third = room('c'.repeat(64));
  await cache.hydrate(first); await cache.hydrate(second); await cache.hydrate(first);
  await cache.hydrate(third); await cache.hydrate(first);
  expect(read).toHaveBeenCalledTimes(3);
  await cache.hydrate(second); expect(read).toHaveBeenCalledTimes(4);
  now = 30 * 60_000 - 1;
  await cache.hydrate(second); expect(read).toHaveBeenCalledTimes(4);
  now++;
  await cache.hydrate(second); expect(read).toHaveBeenCalledTimes(5);
});

it('fully hydrates a request larger than capacity and batches forty keys', async () => {
  const {champions} = await import('../src/data/provider');
  const r = room(); r.state.players[0].pool = champions.slice(0,135).map(c => c.id);
  const read = vi.fn(async (_:string,keys:string[]) => keys.map(key => ({candidate_key:key,pairs:[{...pair,candidateChampionId:key.split(':')[0]}]})));
  const cache = new StatisticsCache(read);
  const loaded = await cache.hydrate(r);
  expect(loaded.state.dataset.pairs).toHaveLength(135);
  expect(read.mock.calls.map(c => c[1].length)).toEqual([40,40,40,15]);
  // Touch an entry that should have survived, then an evicted first entry.
  const only = room(); only.state.players[0].pool = [r.state.players[0].pool.map(id => `${id}:Top`).sort()[134].split(':')[0]];
  await cache.hydrate(only); expect(read).toHaveBeenCalledTimes(4);
  only.state.players[0].pool = [r.state.players[0].pool.map(id => `${id}:Top`).sort()[0].split(':')[0]];
  await cache.hydrate(only); expect(read).toHaveBeenCalledTimes(5);
});

it('deduplicates overlapping concurrent requests, retries failures, and ignores cleared in-flight entries', async () => {
  let reject!: (e:Error) => void;
  const read = vi.fn(() => new Promise<never>((_,fail) => {reject=fail;}));
  const cache = new StatisticsCache(read);
  const one = cache.hydrate(room()), two = cache.hydrate(room());
  const outcomes = Promise.allSettled([one,two]);
  await Promise.resolve(); expect(read).toHaveBeenCalledTimes(1);
  reject(Error('offline'));
  expect((await outcomes).map(r => r.status)).toEqual(['rejected','rejected']);
  read.mockImplementation(async () => [] as never);
  await cache.hydrate(room()); expect(read).toHaveBeenCalledTimes(2);
  cache.clear();
  await cache.hydrate(room()); expect(read).toHaveBeenCalledTimes(3);
  // A cleared pending load must not refill the resolved cache.
  const spy = vi.fn(async () => []);
  const pending = new StatisticsCache(spy);
  const inflight = pending.hydrate(room()); pending.clear(); await inflight;
  await pending.hydrate(room()); expect(spy).toHaveBeenCalledTimes(2);
});
