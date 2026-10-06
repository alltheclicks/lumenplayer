// Characterization tests for SessionStore (P4 step 1a). They pin the current
// reducer, hydration, persistence and cross-tab sync behaviour so that the
// storage/broadcast injection in P4 step 3f can be verified as a pure refactor.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionStore, type SessionEvent, type SessionSource, type SessionState } from './index';

const STORAGE_KEY = 'test:session';
const CHANNEL_NAME = 'test:sync';

const SOURCE_A: SessionSource = {
  url: 'https://example.com/live/a.m3u8',
  type: 'hls',
  title: 'Channel A',
  channelId: 'a',
  metadata: { mode: 'live', streamId: 1 },
};

const SOURCE_B: SessionSource = {
  url: 'https://example.com/live/b.m3u8',
  type: 'hls',
  title: 'Channel B',
  channelId: 'b',
};

const createClock = (start = 0) => {
  let tick = start;
  return () => {
    tick += 1;
    return tick;
  };
};

const createLocalStore = (overrides: ConstructorParameters<typeof SessionStore>[0] = {}) => (
  new SessionStore({ persist: false, syncAcrossTabs: false, now: createClock(), ...overrides })
);

const collectEvents = (store: SessionStore) => {
  const events: SessionEvent[] = [];
  store.subscribeToEvents(event => events.push(event));
  return events;
};

class MemoryStorage {
  readonly data = new Map<string, string>();
  readonly setItem = vi.fn((key: string, value: string) => {
    this.data.set(key, value);
  });
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

interface FakeChannel {
  name: string;
  onmessage: ((event: { data: unknown }) => void) | null;
  posted: unknown[];
  closed: boolean;
  postMessage(message: unknown): void;
  close(): void;
}

// In-memory BroadcastChannel: delivers to every other open channel with the same name,
// never back to the sender (matches the browser contract).
const installFakeBroadcastChannel = () => {
  const channels: FakeChannel[] = [];
  class FakeBroadcastChannel implements FakeChannel {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    posted: unknown[] = [];
    closed = false;
    constructor(readonly name: string) {
      channels.push(this);
    }
    postMessage(message: unknown): void {
      this.posted.push(message);
      for (const peer of channels) {
        if (peer !== this && !peer.closed && peer.name === this.name) {
          peer.onmessage?.({ data: structuredClone(message) });
        }
      }
    }
    close(): void {
      this.closed = true;
    }
  }
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
  return channels;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SessionStore reducer', () => {
  it('starts idle on the local renderer with no source or position', () => {
    const store = createLocalStore({ sessionId: 'session:fixed' });

    expect(store.getState()).toEqual({
      sessionId: 'session:fixed',
      source: null,
      playback: 'idle',
      positionMs: null,
      liveOffsetMs: null,
      renderer: 'local-web',
      updatedAt: 1,
      error: null,
    });
  });

  it('setSource pauses at the requested position, clamps negatives and defaults to 0', () => {
    const store = createLocalStore();

    store.dispatch({ type: 'setSource', source: SOURCE_A, positionMs: 42_000 });
    expect(store.getState()).toMatchObject({ source: SOURCE_A, playback: 'paused', positionMs: 42_000 });

    store.dispatch({ type: 'setSource', source: SOURCE_B, positionMs: -5 });
    expect(store.getState()).toMatchObject({ source: SOURCE_B, positionMs: 0 });

    store.dispatch({ type: 'setSource', source: SOURCE_A });
    expect(store.getState().positionMs).toBe(0);
  });

  it('setSource while playing switches back to paused', () => {
    const store = createLocalStore();
    store.dispatch({ type: 'setSource', source: SOURCE_A });
    store.dispatch({ type: 'play' });

    store.dispatch({ type: 'setSource', source: SOURCE_B });

    expect(store.getState().playback).toBe('paused');
  });

  it('setSource with an equal source and position is a no-op even for a new object', () => {
    const store = createLocalStore();
    store.dispatch({ type: 'setSource', source: SOURCE_A, positionMs: 10 });
    const before = store.getState();

    const after = store.dispatch({
      type: 'setSource',
      source: { ...SOURCE_A, metadata: { streamId: 1, mode: 'live' } },
      positionMs: 10,
    });

    expect(after).toBe(before);
  });

  it('ignores play, pause and seek without a source', () => {
    const store = createLocalStore();
    const initial = store.getState();

    store.dispatch({ type: 'play' });
    store.dispatch({ type: 'pause' });
    store.dispatch({ type: 'seek', positionMs: 1_000 });

    expect(store.getState()).toBe(initial);
  });

  it('play and pause toggle playback and clear no position', () => {
    const store = createLocalStore();
    store.dispatch({ type: 'setSource', source: SOURCE_A, positionMs: 5_000 });

    store.dispatch({ type: 'play' });
    expect(store.getState()).toMatchObject({ playback: 'playing', positionMs: 5_000 });

    store.dispatch({ type: 'pause' });
    expect(store.getState()).toMatchObject({ playback: 'paused', positionMs: 5_000 });
  });

  it('seek clamps to 0 and is a no-op for the current position', () => {
    const store = createLocalStore();
    store.dispatch({ type: 'setSource', source: SOURCE_A, positionMs: 1_000 });

    store.dispatch({ type: 'seek', positionMs: -300 });
    expect(store.getState().positionMs).toBe(0);

    const before = store.getState();
    expect(store.dispatch({ type: 'seek', positionMs: 0 })).toBe(before);
  });

  it('seek keeps the playback state', () => {
    const store = createLocalStore();
    store.dispatch({ type: 'setSource', source: SOURCE_A });
    store.dispatch({ type: 'play' });

    store.dispatch({ type: 'seek', positionMs: 9_000 });

    expect(store.getState()).toMatchObject({ playback: 'playing', positionMs: 9_000 });
  });

  it('switchRenderer changes the renderer and ignores the current one', () => {
    const store = createLocalStore();
    const initial = store.getState();

    expect(store.dispatch({ type: 'switchRenderer', renderer: 'local-web' })).toBe(initial);

    store.dispatch({ type: 'switchRenderer', renderer: 'cast' });
    expect(store.getState().renderer).toBe('cast');
  });

  it('switchRenderer works without a source', () => {
    const store = createLocalStore();

    store.dispatch({ type: 'switchRenderer', renderer: 'cast' });

    expect(store.getState()).toMatchObject({ renderer: 'cast', source: null, playback: 'idle' });
  });

  it('stop resets source, playback and position but keeps the renderer', () => {
    const store = createLocalStore();
    store.dispatch({ type: 'switchRenderer', renderer: 'cast' });
    store.dispatch({ type: 'setSource', source: SOURCE_A, positionMs: 3_000 });
    store.dispatch({ type: 'play' });

    store.dispatch({ type: 'stop' });

    expect(store.getState()).toMatchObject({
      source: null,
      playback: 'idle',
      positionMs: null,
      liveOffsetMs: null,
      renderer: 'cast',
    });
  });

  it('stop on an idle session is a no-op', () => {
    const store = createLocalStore();
    const initial = store.getState();

    expect(store.dispatch({ type: 'stop' })).toBe(initial);
  });

  it('stamps every accepted command with the injected clock', () => {
    const store = createLocalStore({ now: createClock(100) });
    expect(store.getState().updatedAt).toBe(101);

    store.dispatch({ type: 'setSource', source: SOURCE_A });
    expect(store.getState().updatedAt).toBe(102);

    store.dispatch({ type: 'play' });
    expect(store.getState().updatedAt).toBe(103);
  });

  it('ignores unknown command types', () => {
    const store = createLocalStore();
    const initial = store.getState();

    expect(store.dispatch({ type: 'rewind' } as never)).toBe(initial);
  });
});

describe('SessionStore listeners and events', () => {
  it('subscribe delivers the current state immediately and stops after unsubscribe', () => {
    const store = createLocalStore();
    const seen: SessionState[] = [];

    const unsubscribe = store.subscribe(state => seen.push(state));
    expect(seen).toEqual([store.getState()]);

    store.dispatch({ type: 'setSource', source: SOURCE_A });
    expect(seen).toHaveLength(2);

    unsubscribe();
    store.dispatch({ type: 'play' });
    expect(seen).toHaveLength(2);
  });

  it('emits specific events before sessionUpdated, with previous values', () => {
    const store = createLocalStore();
    store.dispatch({ type: 'setSource', source: SOURCE_A });
    const events = collectEvents(store);

    store.dispatch({ type: 'play' });

    expect(events.map(event => event.type)).toEqual(['playbackStateChanged', 'sessionUpdated']);
    expect(events[0]).toMatchObject({ previousPlayback: 'paused', playback: 'playing' });
  });

  it('emits rendererChanged on renderer switches', () => {
    const store = createLocalStore();
    const events = collectEvents(store);

    store.dispatch({ type: 'switchRenderer', renderer: 'cast' });

    expect(events.map(event => event.type)).toEqual(['rendererChanged', 'sessionUpdated']);
    expect(events[0]).toMatchObject({ previousRenderer: 'local-web', renderer: 'cast' });
  });

  it('emits only sessionUpdated for a seek', () => {
    const store = createLocalStore();
    store.dispatch({ type: 'setSource', source: SOURCE_A });
    const events = collectEvents(store);

    store.dispatch({ type: 'seek', positionMs: 1_000 });

    expect(events.map(event => event.type)).toEqual(['sessionUpdated']);
  });

  it('keeps notifying other listeners when one throws', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = createLocalStore();
    const healthyStates: SessionState[] = [];
    const healthyEvents: string[] = [];

    store.subscribe(() => {
      if (store.getState().source) throw new Error('state listener boom');
    });
    store.subscribe(state => healthyStates.push(state));
    store.subscribeToEvents(() => {
      throw new Error('event listener boom');
    });
    store.subscribeToEvents(event => healthyEvents.push(event.type));

    store.dispatch({ type: 'setSource', source: SOURCE_A });

    expect(healthyStates[healthyStates.length - 1]?.source).toEqual(SOURCE_A);
    expect(healthyEvents).toContain('sessionUpdated');
    expect(consoleError).toHaveBeenCalledWith('SessionStore: state listener error', expect.any(Error));
    expect(consoleError).toHaveBeenCalledWith('SessionStore: event listener error', expect.any(Error));
  });

  it('ignores commands and drops listeners after destroy', () => {
    const store = createLocalStore();
    const events = collectEvents(store);
    store.destroy();
    const frozen = store.getState();

    expect(store.dispatch({ type: 'setSource', source: SOURCE_A })).toBe(frozen);
    expect(events).toHaveLength(0);
    expect(() => store.destroy()).not.toThrow();
  });
});

describe('SessionStore persistence', () => {
  const persisted = (storage: MemoryStorage) => JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null') as SessionState | null;

  it('writes the initial and every accepted state to storage', () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);

    const store = new SessionStore({ storageKey: STORAGE_KEY, syncAcrossTabs: false, now: createClock() });
    expect(persisted(storage)).toEqual(store.getState());

    store.dispatch({ type: 'setSource', source: SOURCE_A, positionMs: 7 });
    expect(persisted(storage)).toEqual(store.getState());

    const writes = storage.setItem.mock.calls.length;
    store.dispatch({ type: 'pause' });
    expect(storage.setItem.mock.calls.length).toBe(writes);
  });

  it('hydrates a persisted session, including its id', () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    const saved: SessionState = {
      sessionId: 'session:saved',
      source: SOURCE_A,
      playback: 'playing',
      positionMs: 12_000,
      liveOffsetMs: null,
      renderer: 'cast',
      updatedAt: 50,
      error: null,
    };
    storage.data.set(STORAGE_KEY, JSON.stringify(saved));

    const store = new SessionStore({ storageKey: STORAGE_KEY, syncAcrossTabs: false, now: createClock() });

    expect(store.getState()).toEqual(saved);
  });

  // Current quirk, pinned on purpose: options.sessionId only seeds the base state, so a
  // persisted sessionId wins over it; initialState fields do override persisted ones.
  // apps/web constructs SessionStore without options, so nothing depends on this yet.
  it('lets initialState override the persisted session, but not options.sessionId', () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    storage.data.set(STORAGE_KEY, JSON.stringify({
      sessionId: 'session:saved',
      source: SOURCE_A,
      playback: 'paused',
      positionMs: 1_000,
      liveOffsetMs: null,
      renderer: 'local-web',
      updatedAt: 50,
      error: null,
    }));

    const store = new SessionStore({
      storageKey: STORAGE_KEY,
      syncAcrossTabs: false,
      sessionId: 'session:explicit',
      initialState: { renderer: 'cast', positionMs: 2_000 },
      now: createClock(),
    });

    expect(store.getState()).toMatchObject({
      sessionId: 'session:saved',
      source: SOURCE_A,
      renderer: 'cast',
      positionMs: 2_000,
    });
  });

  it('drops position and live offset when the hydrated session has no source', () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    storage.data.set(STORAGE_KEY, JSON.stringify({
      sessionId: 'session:saved',
      source: null,
      playback: 'idle',
      positionMs: 9_000,
      liveOffsetMs: 4_000,
      renderer: 'local-web',
      updatedAt: 50,
      error: null,
    }));

    const store = new SessionStore({ storageKey: STORAGE_KEY, syncAcrossTabs: false, now: createClock() });

    expect(store.getState()).toMatchObject({ sessionId: 'session:saved', positionMs: null, liveOffsetMs: null });
  });

  it.each([
    ['invalid JSON', '{not json'],
    ['wrong shape', JSON.stringify({ sessionId: 7 })],
  ])('ignores a persisted value with %s', (_label, raw) => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    storage.data.set(STORAGE_KEY, raw);

    const store = new SessionStore({ storageKey: STORAGE_KEY, syncAcrossTabs: false, sessionId: 'session:new', now: createClock() });

    expect(store.getState()).toMatchObject({ sessionId: 'session:new', source: null, playback: 'idle' });
  });

  it('does not touch storage when persist is disabled', () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);

    const store = new SessionStore({ storageKey: STORAGE_KEY, persist: false, syncAcrossTabs: false, now: createClock() });
    store.dispatch({ type: 'setSource', source: SOURCE_A });

    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('treats a throwing localStorage getter as no storage', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });

    try {
      const store = new SessionStore({ storageKey: STORAGE_KEY, syncAcrossTabs: false, now: createClock() });
      store.dispatch({ type: 'setSource', source: SOURCE_A });
      expect(store.getState().source).toEqual(SOURCE_A);
    } finally {
      if (descriptor) {
        Object.defineProperty(globalThis, 'localStorage', descriptor);
      } else {
        delete (globalThis as { localStorage?: unknown }).localStorage;
      }
    }
  });
});

describe('SessionStore cross-tab sync', () => {
  const createSyncedStore = (sessionId: string, now: () => number) => (
    new SessionStore({ sessionId, persist: false, channelName: CHANNEL_NAME, now })
  );

  it('broadcasts every accepted state with its source id', () => {
    const channels = installFakeBroadcastChannel();
    const store = createSyncedStore('session:1', createClock());

    store.dispatch({ type: 'setSource', source: SOURCE_A });

    expect(channels).toHaveLength(1);
    expect(channels[0].name).toBe(CHANNEL_NAME);
    expect(channels[0].posted).toEqual([
      { sourceId: expect.stringMatching(/^source:/), state: store.getState() },
    ]);
  });

  it('applies newer remote state with events, without re-broadcasting it', () => {
    const channels = installFakeBroadcastChannel();
    const sharedClock = createClock();
    const sender = createSyncedStore('session:1', sharedClock);
    const receiver = createSyncedStore('session:1', sharedClock);
    const receiverEvents = collectEvents(receiver);

    sender.dispatch({ type: 'setSource', source: SOURCE_A });

    expect(receiver.getState()).toEqual(sender.getState());
    expect(receiverEvents.map(event => event.type)).toEqual(['playbackStateChanged', 'sessionUpdated']);
    expect(channels[1].posted).toHaveLength(0);
  });

  it('persists applied remote state when persistence is enabled', () => {
    installFakeBroadcastChannel();
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    const sharedClock = createClock();
    const sender = createSyncedStore('session:1', sharedClock);
    new SessionStore({ sessionId: 'session:1', storageKey: STORAGE_KEY, channelName: CHANNEL_NAME, now: sharedClock });

    sender.dispatch({ type: 'setSource', source: SOURCE_A });

    expect(JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null')).toMatchObject({ source: SOURCE_A });
  });

  it('ignores remote state that is not newer than the local state (latest wins)', () => {
    installFakeBroadcastChannel();
    const sender = createSyncedStore('session:1', () => 10);
    const receiver = createSyncedStore('session:1', createClock(20));
    receiver.dispatch({ type: 'switchRenderer', renderer: 'cast' });
    const before = receiver.getState();

    sender.dispatch({ type: 'setSource', source: SOURCE_A });

    expect(receiver.getState()).toBe(before);
  });

  it('ignores malformed broadcast messages', () => {
    const channels = installFakeBroadcastChannel();
    const receiver = createSyncedStore('session:1', createClock());
    const before = receiver.getState();
    const deliver = (data: unknown) => channels[0].onmessage?.({ data });

    deliver(null);
    deliver({ sourceId: 1, state: before });
    deliver({ sourceId: 'source:other', state: { ...before, updatedAt: 'later' } });

    expect(receiver.getState()).toBe(before);
  });

  it('does not open a channel when cross-tab sync is disabled', () => {
    const channels = installFakeBroadcastChannel();

    createLocalStore();

    expect(channels).toHaveLength(0);
  });

  it('closes and detaches its channel on destroy', () => {
    const channels = installFakeBroadcastChannel();
    const store = createSyncedStore('session:1', createClock());

    store.destroy();

    expect(channels[0]).toMatchObject({ closed: true, onmessage: null });
  });

  it('works without BroadcastChannel support', () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    // "BroadcastChannel" in globalThis stays true with an undefined value, so remove it.
    delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;

    const store = createSyncedStore('session:1', createClock());
    store.dispatch({ type: 'setSource', source: SOURCE_A });

    expect(store.getState().source).toEqual(SOURCE_A);
  });
});
