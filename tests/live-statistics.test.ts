import { it, expect, vi } from 'vitest';
import captured from './fixtures/lolalytics-real-pairs.json';
import { importDataset } from '../src/data/import';
import { championIds, initialState } from '../src/data/provider';
import { StatisticsCache, persistedState } from '../src/data/shared';
import { score } from '../src/domain/scoring';
import type { Room } from '../src/domain/types';

it('real Against and Synergy survive import, shared hydration and weighted scoring in percentage points', async () => {
  const dataset = importDataset(JSON.stringify(captured), 'json', championIds);
  expect(dataset.fictional).toBe(false);
  expect(dataset.pairs.map(p => p.games).sort((a,b)=>a!-b!)).toEqual([8509, 10562]);
  const state = initialState('player', 'Player');
  state.players[0] = {id:'player', name:'Player', role:'Top', pool:['58']};
  state.dataset = {...dataset, snapshotId:'e'.repeat(64), pairs:[]};
  state.picks.enemy = [{championId:'799', role:'Top'}];
  state.picks.ally = [{championId:'64', role:'Jungle'}];
  const read = vi.fn(async () => [{candidate_key:'58:Top', pairs:dataset.pairs}]);
  const cache = new StatisticsCache(read);
  const room:Room = {id:'real-source-test',slug:'test-room',name:'Test room',host_id:'player',version:0,state};
  const hydrated = await cache.hydrate(room);
  // (0.4 × 2.09 + 0.2 × -0.10) / 0.6 = 1.36 points, not 0.0136.
  const result = score('58', 'Top', hydrated.state);
  expect(result.value).toBeCloseTo(1.36, 12);
  expect(result.known).toBe(2);
  expect(result.contributions.map(p => p.relation)).toEqual(['vs','with']);
  expect(persistedState(hydrated.state).dataset.pairs).toEqual([]);
  await cache.hydrate(hydrated);
  expect(read).toHaveBeenCalledTimes(1);
});
