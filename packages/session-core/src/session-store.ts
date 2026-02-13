import type {
  ErrorEvent,
  PlaybackStateChangedEvent,
  RendererChangedEvent,
  SessionCommand,
  SessionError,
  SessionEvent,
  SessionState,
  SessionUpdatedEvent,
} from "./contracts";

const DEFAULT_STORAGE_KEY = "lumen:session-core:state";
const DEFAULT_CHANNEL_NAME = "lumen:session-core:sync";

export interface SessionStoreOptions {
  sessionId?: string;
  initialState?: Partial<SessionState>;
  storageKey?: string;
  channelName?: string;
  persist?: boolean;
  syncAcrossTabs?: boolean;
  now?: () => number;
}

export type SessionStateListener = (state: SessionState) => void;
export type SessionEventListener = (event: SessionEvent) => void;

interface BroadcastChannelLike {
  postMessage(message: unknown): void;
  close(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

interface BroadcastEnvelope {
  sourceId: string;
  state: SessionState;
}

interface ApplyStateOptions {
  emitEvents: boolean;
  persist: boolean;
  broadcast: boolean;
}

export class SessionStore {
  private state: SessionState;
  private readonly stateListeners = new Set<SessionStateListener>();
  private readonly eventListeners = new Set<SessionEventListener>();
  private readonly storageKey: string;
  private readonly channelName: string;
  private readonly persistEnabled: boolean;
  private readonly syncAcrossTabs: boolean;
  private readonly now: () => number;
  private readonly sourceId: string;
  private channel: BroadcastChannelLike | null = null;
  private destroyed = false;

  constructor(options: SessionStoreOptions = {}) {
    this.storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
    this.channelName = options.channelName ?? DEFAULT_CHANNEL_NAME;
    this.persistEnabled = options.persist ?? true;
    this.syncAcrossTabs = options.syncAcrossTabs ?? true;
    this.now = options.now ?? Date.now;
    this.sourceId = createUniqueId("source");

    const persistedState = this.persistEnabled
      ? readPersistedState(this.storageKey)
      : null;
    const sessionId =
      options.sessionId ??
      options.initialState?.sessionId ??
      persistedState?.sessionId ??
      createUniqueId("session");

    const baseState = createInitialState(sessionId, this.now());
    const hydratedState = mergeState(baseState, persistedState, options.initialState);
    this.state = hydratedState;

    if (this.persistEnabled) {
      persistState(this.storageKey, this.state);
    }

    this.initializeSyncChannel();
  }

  getState(): SessionState {
    return this.state;
  }

  subscribe(listener: SessionStateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  subscribeToEvents(listener: SessionEventListener): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  dispatch(command: SessionCommand): SessionState {
    if (this.destroyed) {
      return this.state;
    }

    const nextState = reduceCommand(this.state, command, this.now());
    if (nextState === this.state) {
      return this.state;
    }

    this.applyState(nextState, {
      emitEvents: true,
      persist: this.persistEnabled,
      broadcast: this.syncAcrossTabs,
    });

    return this.state;
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.stateListeners.clear();
    this.eventListeners.clear();

    if (this.channel) {
      this.channel.onmessage = null;
      this.channel.close();
      this.channel = null;
    }
  }

  private initializeSyncChannel(): void {
    if (!this.syncAcrossTabs) {
      return;
    }

    const BroadcastChannelCtor = getBroadcastChannelCtor();
    if (!BroadcastChannelCtor) {
      return;
    }

    this.channel = new BroadcastChannelCtor(this.channelName);
    this.channel.onmessage = (event: { data: unknown }) => {
      this.handleBroadcast(event.data);
    };
  }

  private handleBroadcast(data: unknown): void {
    if (this.destroyed) {
      return;
    }

    const message = parseBroadcastEnvelope(data);
    if (!message || message.sourceId === this.sourceId) {
      return;
    }

    // Latest command wins for MVP conflict resolution.
    if (message.state.updatedAt <= this.state.updatedAt) {
      return;
    }

    this.applyState(message.state, {
      emitEvents: true,
      persist: this.persistEnabled,
      broadcast: false,
    });
  }

  private applyState(nextState: SessionState, options: ApplyStateOptions): void {
    const previousState = this.state;
    this.state = nextState;

    if (options.persist) {
      persistState(this.storageKey, this.state);
    }

    if (options.broadcast) {
      this.broadcastState();
    }

    for (const listener of this.stateListeners) {
      listener(this.state);
    }

    if (options.emitEvents) {
      this.emitEvents(previousState, this.state);
    }
  }

  private broadcastState(): void {
    if (!this.channel) {
      return;
    }

    const envelope: BroadcastEnvelope = {
      sourceId: this.sourceId,
      state: this.state,
    };
    this.channel.postMessage(envelope);
  }

  private emitEvents(previousState: SessionState, nextState: SessionState): void {
    if (previousState.renderer !== nextState.renderer) {
      const event: RendererChangedEvent = {
        type: "rendererChanged",
        previousRenderer: previousState.renderer,
        renderer: nextState.renderer,
        state: nextState,
      };
      this.emitEvent(event);
    }

    if (previousState.playback !== nextState.playback) {
      const event: PlaybackStateChangedEvent = {
        type: "playbackStateChanged",
        previousPlayback: previousState.playback,
        playback: nextState.playback,
        state: nextState,
      };
      this.emitEvent(event);
    }

    if (!isSameError(previousState.error, nextState.error) && nextState.error) {
      const event: ErrorEvent = {
        type: "error",
        error: nextState.error,
        state: nextState,
      };
      this.emitEvent(event);
    }

    const sessionUpdatedEvent: SessionUpdatedEvent = {
      type: "sessionUpdated",
      state: nextState,
    };
    this.emitEvent(sessionUpdatedEvent);
  }

  private emitEvent(event: SessionEvent): void {
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }
}

function createInitialState(sessionId: string, now: number): SessionState {
  return {
    sessionId,
    source: null,
    playback: "idle",
    positionMs: null,
    liveOffsetMs: null,
    renderer: "local-web",
    updatedAt: now,
    error: null,
  };
}

function mergeState(
  baseState: SessionState,
  persistedState: SessionState | null,
  initialState?: Partial<SessionState>
): SessionState {
  const merged = {
    ...baseState,
    ...(persistedState ?? {}),
    ...(initialState ?? {}),
  };

  if (!merged.source) {
    merged.positionMs = null;
    merged.liveOffsetMs = null;
  }

  return merged;
}

function reduceCommand(
  state: SessionState,
  command: SessionCommand,
  now: number
): SessionState {
  switch (command.type) {
    case "setSource": {
      const positionMs = Math.max(0, command.positionMs ?? 0);
      const nextState: SessionState = {
        ...state,
        source: command.source,
        playback: "paused",
        positionMs,
        liveOffsetMs: null,
        error: null,
        updatedAt: now,
      };
      return isSameState(state, nextState) ? state : nextState;
    }

    case "play": {
      if (!state.source || state.playback === "playing") {
        return state;
      }

      return {
        ...state,
        playback: "playing",
        updatedAt: now,
      };
    }

    case "pause": {
      if (!state.source || state.playback === "paused") {
        return state;
      }

      return {
        ...state,
        playback: "paused",
        updatedAt: now,
      };
    }

    case "seek": {
      if (!state.source) {
        return state;
      }

      const positionMs = Math.max(0, command.positionMs);
      if (state.positionMs === positionMs) {
        return state;
      }

      return {
        ...state,
        positionMs,
        updatedAt: now,
      };
    }

    case "switchRenderer": {
      if (state.renderer === command.renderer) {
        return state;
      }

      return {
        ...state,
        renderer: command.renderer,
        updatedAt: now,
      };
    }

    case "stop": {
      const nextState: SessionState = {
        ...state,
        source: null,
        playback: "idle",
        positionMs: null,
        liveOffsetMs: null,
        error: null,
        updatedAt: now,
      };
      return isSameState(state, nextState) ? state : nextState;
    }

    default: {
      return state;
    }
  }
}

function isSameState(left: SessionState, right: SessionState): boolean {
  return (
    left.sessionId === right.sessionId &&
    isSameSource(left.source, right.source) &&
    left.playback === right.playback &&
    left.positionMs === right.positionMs &&
    left.liveOffsetMs === right.liveOffsetMs &&
    left.renderer === right.renderer &&
    isSameError(left.error, right.error)
  );
}

function isSameSource(
  left: SessionState["source"],
  right: SessionState["source"]
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.url === right.url &&
    left.type === right.type &&
    left.title === right.title &&
    left.channelId === right.channelId &&
    JSON.stringify(left.metadata ?? null) === JSON.stringify(right.metadata ?? null)
  );
}

function isSameError(left: SessionError | null, right: SessionError | null): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.code === right.code &&
    left.message === right.message &&
    left.fatal === right.fatal &&
    JSON.stringify(left.details ?? null) === JSON.stringify(right.details ?? null)
  );
}

function persistState(storageKey: string, state: SessionState): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  storage.setItem(storageKey, JSON.stringify(state));
}

function readPersistedState(storageKey: string): SessionState | null {
  const storage = getStorage();
  if (!storage) {
    return null;
  }

  const raw = storage.getItem(storageKey);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return isSessionState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseBroadcastEnvelope(data: unknown): BroadcastEnvelope | null {
  if (!isObject(data)) {
    return null;
  }

  const sourceId = data["sourceId"];
  const state = data["state"];

  if (typeof sourceId !== "string" || !isSessionState(state)) {
    return null;
  }

  return { sourceId, state };
}

function isSessionState(value: unknown): value is SessionState {
  if (!isObject(value)) {
    return false;
  }

  return (
    typeof value["sessionId"] === "string" &&
    (value["source"] === null || isObject(value["source"])) &&
    typeof value["playback"] === "string" &&
    (typeof value["positionMs"] === "number" || value["positionMs"] === null) &&
    (typeof value["liveOffsetMs"] === "number" || value["liveOffsetMs"] === null) &&
    typeof value["renderer"] === "string" &&
    typeof value["updatedAt"] === "number" &&
    (value["error"] === null || isObject(value["error"]))
  );
}

function getStorage(): Storage | null {
  if (typeof globalThis === "undefined" || !("localStorage" in globalThis)) {
    return null;
  }

  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function getBroadcastChannelCtor():
  | (new (name: string) => BroadcastChannelLike)
  | null {
  if (typeof globalThis === "undefined" || !("BroadcastChannel" in globalThis)) {
    return null;
  }

  return globalThis.BroadcastChannel as unknown as new (
    name: string
  ) => BroadcastChannelLike;
}

function createUniqueId(prefix: string): string {
  if (
    typeof globalThis !== "undefined" &&
    "crypto" in globalThis &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return `${prefix}:${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}:${Math.random().toString(36).slice(2, 11)}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
