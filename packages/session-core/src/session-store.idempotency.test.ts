import { describe, expect, it } from 'vitest';
import { SessionStore, type SessionSource } from './index';

const TEST_SOURCE: SessionSource = {
  url: 'https://example.com/live/stream.m3u8',
  type: 'hls',
  title: 'Test Channel',
  channelId: 'channel-1',
  metadata: {
    channelId: 'channel-1',
    streamId: 1,
    mode: 'live',
  },
};

const createStore = () => {
  let currentTick = 0;

  return new SessionStore({
    persist: false,
    syncAcrossTabs: false,
    now: () => {
      currentTick += 1;
      return currentTick;
    },
  });
};

describe('SessionStore command idempotency', () => {
  it('play is idempotent when playback is already playing', () => {
    const store = createStore();
    const events: string[] = [];
    store.subscribeToEvents(event => events.push(event.type));

    store.dispatch({ type: 'setSource', source: TEST_SOURCE, positionMs: 0 });
    store.dispatch({ type: 'play' });

    const stateBeforeDuplicatePlay = store.getState();
    const updatedAtBeforeDuplicatePlay = stateBeforeDuplicatePlay.updatedAt;
    events.length = 0;

    const resultState = store.dispatch({ type: 'play' });

    expect(resultState).toBe(stateBeforeDuplicatePlay);
    expect(store.getState()).toBe(stateBeforeDuplicatePlay);
    expect(store.getState().updatedAt).toBe(updatedAtBeforeDuplicatePlay);
    expect(events).toHaveLength(0);
  });

  it('pause is idempotent when playback is already paused', () => {
    const store = createStore();
    const events: string[] = [];
    store.subscribeToEvents(event => events.push(event.type));

    store.dispatch({ type: 'setSource', source: TEST_SOURCE, positionMs: 0 });
    const stateBeforeDuplicatePause = store.getState();
    const updatedAtBeforeDuplicatePause = stateBeforeDuplicatePause.updatedAt;
    events.length = 0;

    const resultState = store.dispatch({ type: 'pause' });

    expect(resultState).toBe(stateBeforeDuplicatePause);
    expect(store.getState()).toBe(stateBeforeDuplicatePause);
    expect(store.getState().updatedAt).toBe(updatedAtBeforeDuplicatePause);
    expect(events).toHaveLength(0);
  });

  it('seek is idempotent when seeking to the same position', () => {
    const store = createStore();
    const events: string[] = [];
    store.subscribeToEvents(event => events.push(event.type));

    store.dispatch({ type: 'setSource', source: TEST_SOURCE, positionMs: 15000 });
    const stateBeforeDuplicateSeek = store.getState();
    const updatedAtBeforeDuplicateSeek = stateBeforeDuplicateSeek.updatedAt;
    events.length = 0;

    const resultState = store.dispatch({ type: 'seek', positionMs: 15000 });

    expect(resultState).toBe(stateBeforeDuplicateSeek);
    expect(store.getState()).toBe(stateBeforeDuplicateSeek);
    expect(store.getState().updatedAt).toBe(updatedAtBeforeDuplicateSeek);
    expect(events).toHaveLength(0);
  });

  it('switchRenderer is idempotent when renderer is unchanged', () => {
    const store = createStore();
    const events: string[] = [];
    store.subscribeToEvents(event => events.push(event.type));

    const stateBeforeDuplicateSwitch = store.getState();
    const updatedAtBeforeDuplicateSwitch = stateBeforeDuplicateSwitch.updatedAt;

    const resultState = store.dispatch({ type: 'switchRenderer', renderer: 'local-web' });

    expect(resultState).toBe(stateBeforeDuplicateSwitch);
    expect(store.getState()).toBe(stateBeforeDuplicateSwitch);
    expect(store.getState().updatedAt).toBe(updatedAtBeforeDuplicateSwitch);
    expect(events).toHaveLength(0);
  });

  it('stop is idempotent when the session is already idle', () => {
    const store = createStore();
    const events: string[] = [];
    store.subscribeToEvents(event => events.push(event.type));

    const stateBeforeDuplicateStop = store.getState();
    const updatedAtBeforeDuplicateStop = stateBeforeDuplicateStop.updatedAt;

    const resultState = store.dispatch({ type: 'stop' });

    expect(resultState).toBe(stateBeforeDuplicateStop);
    expect(store.getState()).toBe(stateBeforeDuplicateStop);
    expect(store.getState().updatedAt).toBe(updatedAtBeforeDuplicateStop);
    expect(events).toHaveLength(0);
  });

  it('setSource is idempotent for equivalent payloads', () => {
    const store = createStore();
    const events: string[] = [];
    store.subscribeToEvents(event => events.push(event.type));

    store.dispatch({ type: 'setSource', source: TEST_SOURCE, positionMs: 0 });
    const stateBeforeDuplicateSetSource = store.getState();
    const updatedAtBeforeDuplicateSetSource = stateBeforeDuplicateSetSource.updatedAt;
    events.length = 0;

    const resultState = store.dispatch({
      type: 'setSource',
      source: {
        ...TEST_SOURCE,
        metadata: {
          ...TEST_SOURCE.metadata,
        },
      },
      positionMs: 0,
    });

    expect(resultState).toBe(stateBeforeDuplicateSetSource);
    expect(store.getState()).toBe(stateBeforeDuplicateSetSource);
    expect(store.getState().updatedAt).toBe(updatedAtBeforeDuplicateSetSource);
    expect(events).toHaveLength(0);
  });
});
