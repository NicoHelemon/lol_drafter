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
