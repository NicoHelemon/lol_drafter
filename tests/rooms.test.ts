import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { initialState } from '../src/data/provider';

const mocks = vi.hoisted(() => {
  const channel = { on: vi.fn(), subscribe: vi.fn() };
  channel.on.mockReturnValue(channel); channel.subscribe.mockReturnValue(channel);
  return {
    channel,
    client: { channel: vi.fn(() => channel), removeChannel: vi.fn(), from: vi.fn(), rpc: vi.fn() },
  };
});
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mocks.client }));
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); vi.clearAllMocks();
  vi.stubEnv('VITE_SUPABASE_URL','https://test.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY','public-test-key');
  vi.stubGlobal('window',{ addEventListener:vi.fn(), removeEventListener:vi.fn() });
  const row = { id:'room',slug:'test-room',host_id:'p',version:0,name:'Test',state:initialState('p','Test') };
  const read = { select:vi.fn(), eq:vi.fn(), maybeSingle:vi.fn(async () => ({data:row,error:null})) };
  read.select.mockReturnValue(read); read.eq.mockReturnValue(read);
  mocks.client.from.mockReturnValue(read);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('executes the lazy heartbeat request every twenty seconds and stops after leaving the room', async () => {
  let requestsSent = 0;
  mocks.client.rpc.mockImplementation(() => ({
    // Like Supabase/PostgREST, constructing a builder does not send a request.
    then(resolve:(r:{error:null}) => unknown) {
      requestsSent++;
      return Promise.resolve({error:null}).then(resolve);
    },
  }));
  const {watchRoom} = await import('../src/lib/rooms');
  const receive=vi.fn(), expired=vi.fn();
  const stop=watchRoom('room',receive,vi.fn(),expired);
  expect(requestsSent).toBe(0);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(mocks.client.rpc).toHaveBeenCalledWith('heartbeat',{room_id:'room'});
  expect(requestsSent).toBe(1);
  expect(receive).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(requestsSent).toBe(2);
  stop();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(requestsSent).toBe(2);
  expect(expired).not.toHaveBeenCalled();
});

it('reports a rejected heartbeat as reconnecting without declaring the room expired', async () => {
  mocks.client.rpc.mockImplementation(() => Promise.resolve({error:{message:'connection failed'}}));
  const {watchRoom} = await import('../src/lib/rooms');
  const status=vi.fn(), expired=vi.fn();
  const stop=watchRoom('room',vi.fn(),status,expired);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(status).toHaveBeenCalledWith('Reconnecting…');
  expect(expired).not.toHaveBeenCalled();
  stop();
});
