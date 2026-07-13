import { sanitizeTelemetryRecord, redactSensitiveText } from './privacyRedaction';

export type PlayerAnalyticsSeverity = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type ReplayTrigger = 'crash' | 'feedback' | 'diagnostic' | 'sample';

export interface PlayerAnalyticsConfiguration {
  subject: string;
  sessionId: string;
  ingestUrl: string;
  replayUrl: string;
}

export interface PlayerFeedbackInput {
  category: string;
  message?: string;
  experienceScore?: number;
}

interface PlayerAnalyticsEvent {
  id: string;
  occurredAt: string;
  name: string;
  severity: PlayerAnalyticsSeverity;
  route: string;
  screen: string;
  renderer: string;
  interactionTarget?: string;
  channelId?: string;
  channelName?: string;
  channelCategory?: string;
  contentKind?: string;
  playbackMode?: string;
  errorCode?: string;
  durationMs?: number;
  positionMs?: number;
  properties: Record<string, unknown>;
}

interface PlayerCrash {
  id: string;
  occurredAt: string;
  fingerprint: string;
  errorName: string;
  message: string;
  stack?: string;
  route: string;
  playerRelease: string;
  lastEvents: PlayerAnalyticsEvent[];
  context: Record<string, unknown>;
  replayId?: string;
}

interface PlayerFeedback {
  id: string;
  submittedAt: string;
  category: string;
  message?: string;
  experienceScore?: number;
  channelId?: string;
  channelName?: string;
  diagnostics: Record<string, unknown>;
  lastEvents: PlayerAnalyticsEvent[];
  replayId?: string;
}

interface QueuedBatch {
  schemaVersion: 1;
  sentAt: string;
  identity: { analyticsSubject: string };
  session: Record<string, unknown>;
  events: PlayerAnalyticsEvent[];
  crashes: PlayerCrash[];
  feedback: PlayerFeedback[];
}

interface ConnectionLike {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
}

interface RrwebEvent {
  timestamp: number;
  [key: string]: unknown;
}

const STORAGE_KEY = 'lumen:player-analytics:v1';
const METRICS_STORAGE_KEY = 'lumen:player-analytics-metrics:v1';
const OFFLINE_KEY = 'lumen:player-analytics-offline:v1';
const FLUSH_INTERVAL_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const REPLAY_WINDOW_MS = 3 * 60_000;
const MAX_EVENTS_PER_BATCH = 25;
const MAX_OFFLINE_BATCHES = 10;
const MAX_REPLAY_EVENTS = 10_000;
const PLAYER_RELEASE = (
  import.meta.env.VITE_PLAYER_RELEASE ??
  import.meta.env.VITE_APP_VERSION ??
  'unknown'
).trim();

export const shouldFlushAnalyticsQueue = (eventCount: number): boolean => (
  eventCount >= MAX_EVENTS_PER_BATCH
);

export const resolveAnalyticsFlushTransport = (
  unload: boolean,
  sendBeaconAvailable: boolean,
): 'beacon' | 'fetch' => (unload && sendBeaconAvailable ? 'beacon' : 'fetch');

export const boundOfflineAnalyticsBatches = <T>(existing: T[], next: T): T[] => (
  [...existing.slice(-MAX_OFFLINE_BATCHES + 1), next]
);

export const RRWEB_BLOCK_SELECTOR = 'video, audio, canvas, .rr-block, [data-rr-block]';

export const maskReplayInput = (text: string, element: HTMLElement): string => {
  const type = element.getAttribute('type')?.toLowerCase();
  const autocomplete = element.getAttribute('autocomplete')?.toLowerCase() ?? '';
  const name = `${element.getAttribute('name') ?? ''} ${element.id}`.toLowerCase();
  const credentialInput = (
    type === 'password' ||
    autocomplete.includes('username') ||
    autocomplete.includes('password') ||
    /(^|\s)(user(name)?|email|password|passwd|pwd)(\s|$)/.test(name)
  );
  return credentialInput ? '*'.repeat(text.length) : text;
};

const isUuid = (value: unknown): value is string => (
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
);

const isConfiguration = (value: unknown): value is PlayerAnalyticsConfiguration => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.subject === 'string' && /^[a-f0-9]{64}$/.test(record.subject) &&
    isUuid(record.sessionId) &&
    record.ingestUrl === '/player-analytics/ingest' &&
    record.replayUrl === '/player-analytics/replay'
  );
};

const randomId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (character) => (
    (Number(character) ^ (Math.random() * 16 >> Number(character) / 4)).toString(16)
  ));
};

const finiteNumber = (value: unknown): number | undefined => (
  typeof value === 'number' && Number.isFinite(value) ? value : undefined
);

export const analyticsInteger = (value: unknown): number | undefined => {
  const number = finiteNumber(value);
  return number === undefined ? undefined : Math.round(number);
};

export interface NormalizedClickCoordinates {
  xPercent: number;
  yPercent: number;
  viewportWidth: number;
  viewportHeight: number;
  viewportClass: 'mobile' | 'tablet' | 'desktop';
}

export const normalizeClickCoordinates = (
  clientX: number,
  clientY: number,
  viewportWidth: number,
  viewportHeight: number,
): NormalizedClickCoordinates | null => {
  if (
    ![clientX, clientY, viewportWidth, viewportHeight].every(Number.isFinite) ||
    viewportWidth <= 0 ||
    viewportHeight <= 0 ||
    clientX < 0 ||
    clientY < 0 ||
    clientX > viewportWidth ||
    clientY > viewportHeight
  ) {
    return null;
  }
  return {
    xPercent: Math.round((clientX / viewportWidth) * 10_000) / 100,
    yPercent: Math.round((clientY / viewportHeight) * 10_000) / 100,
    viewportWidth: Math.round(viewportWidth),
    viewportHeight: Math.round(viewportHeight),
    viewportClass: viewportWidth < 768 ? 'mobile' : viewportWidth < 1200 ? 'tablet' : 'desktop',
  };
};

const stringValue = (value: unknown): string | undefined => (
  typeof value === 'string' && value.trim() ? value.trim() : undefined
);

export const buildCrashFingerprint = (
  errorName: string,
  message: string,
  stack?: string,
): string => {
  const normalized = [errorName, message, ...(stack?.split('\n').slice(0, 4) ?? [])]
    .join('|')
    .toLowerCase()
    .replace(/https?:\/\/[^\s)]+/g, '[url]')
    .replace(/\b\d+\b/g, '#')
    .replace(/\s+/g, ' ')
    .slice(0, 4_000);
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `v1-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

interface TelemetryOccurrence {
  fingerprint: string;
  occurredAtMs: number;
}

export const isDuplicateTelemetryOccurrence = (
  previous: TelemetryOccurrence | null,
  fingerprint: string,
  occurredAtMs: number,
  windowMs: number,
): boolean => Boolean(
  previous?.fingerprint === fingerprint &&
  occurredAtMs >= previous.occurredAtMs &&
  occurredAtMs - previous.occurredAtMs < windowMs
);

export const mediaElementErrorDetails = (
  error: Pick<MediaError, 'code' | 'message'> | null,
): { errorCode: string; message: string } => {
  const code = error?.code ?? 0;
  const defaultMessages: Record<number, string> = {
    1: 'Media playback was aborted',
    2: 'A network error interrupted media playback',
    3: 'The media stream could not be decoded',
    4: 'The media source or format is unsupported',
  };
  return {
    errorCode: code > 0 ? `MEDIA_ELEMENT_${code}` : 'MEDIA_ELEMENT_UNKNOWN',
    message: error?.message?.trim() || defaultMessages[code] || 'Unknown media element error',
  };
};

interface AnalyticsChannelContext {
  id?: string;
  name?: string;
  category?: string;
}

export const resolveAnalyticsEventChannel = (
  explicit: AnalyticsChannelContext,
  current: AnalyticsChannelContext,
): AnalyticsChannelContext => ({
  id: explicit.id ?? current.id,
  name: explicit.name ?? current.name,
  category: explicit.category ?? current.category,
});

export const shouldStartRebufferMeasurement = (
  mediaEventName: string,
  wasPlaybackActive: boolean,
  hasRenderedFirstFrame: boolean,
  channelSwitchPending: boolean,
): boolean => (
  (mediaEventName === 'waiting' || mediaEventName === 'stalled') &&
  wasPlaybackActive &&
  hasRenderedFirstFrame &&
  !channelSwitchPending
);

const parseUserAgent = (userAgent: string): Record<string, string> => {
  const browserMatch = userAgent.match(/(Edg|OPR|Chrome|CriOS|Firefox|FxiOS|Version)\/([\d.]+)/);
  const browserToken = browserMatch?.[1] ?? 'Unknown';
  const browser = browserToken === 'Version'
    ? 'Safari'
    : browserToken === 'Edg'
      ? 'Edge'
      : browserToken === 'OPR'
        ? 'Opera'
        : browserToken === 'CriOS'
          ? 'Chrome iOS'
          : browserToken === 'FxiOS'
            ? 'Firefox iOS'
            : browserToken;
  const osMatch = userAgent.match(/(Windows NT|Android|iPhone OS|CPU OS|Mac OS X)\s?([\d_.]*)/);
  const osToken = osMatch?.[1] ?? 'Unknown';
  const os = osToken === 'Windows NT'
    ? 'Windows'
    : osToken === 'iPhone OS' || osToken === 'CPU OS'
      ? 'iOS'
      : osToken === 'Mac OS X'
        ? 'macOS'
        : osToken;
  return {
    browser,
    browserVersion: browserMatch?.[2] ?? '',
    os,
    osVersion: (osMatch?.[2] ?? '').replace(/_/g, '.'),
  };
};

export const collectSafeDeviceSummary = (): Record<string, unknown> => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return {};
  const connection = (navigator as Navigator & { connection?: ConnectionLike }).connection;
  const coarseDeviceClass = /TV|SMART-TV|HbbTV|Tizen|Web0S/i.test(navigator.userAgent)
    ? 'tv'
    : /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
      ? 'mobile'
      : 'desktop';
  return sanitizeTelemetryRecord({
    deviceClass: coarseDeviceClass,
    ...parseUserAgent(navigator.userAgent),
    locale: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screenWidth: window.screen?.width,
    screenHeight: window.screen?.height,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    touchCapable: navigator.maxTouchPoints > 0,
    standalone: window.matchMedia?.('(display-mode: standalone)').matches ?? false,
    connectionType: connection?.effectiveType,
    connectionDownlinkMbps: connection?.downlink,
    connectionRttMs: connection?.rtt,
    connectionSaveData: connection?.saveData,
  });
};

class PlayerAnalyticsClient {
  private configuration: PlayerAnalyticsConfiguration | null = null;
  private initialized = false;
  private startedAtMs = Date.now();
  private lastTickMs = Date.now();
  private foregroundMs = 0;
  private activeMs = 0;
  private playbackMs = 0;
  private rebufferMs = 0;
  private rebufferStartedAtMs: number | null = null;
  private rebufferCount = 0;
  private eventCount = 0;
  private errorCount = 0;
  private crashCount = 0;
  private feedbackCount = 0;
  private channelChanges = 0;
  private firstFrameMs: number | null = null;
  private lastActivityAtMs = Date.now();
  private playbackActive = false;
  private currentRenderer = 'local-web';
  private currentChannel: { id?: string; name?: string; category?: string } = {};
  private pendingChannelSwitchAtMs: number | null = null;
  private events: PlayerAnalyticsEvent[] = [];
  private crashes: PlayerCrash[] = [];
  private feedback: PlayerFeedback[] = [];
  private recentEvents: PlayerAnalyticsEvent[] = [];
  private replayEvents: RrwebEvent[] = [];
  private stopReplay: (() => void) | null = null;
  private flushTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private searchTimer: number | null = null;
  private activeFlushPromise: Promise<boolean> | null = null;
  private lastStructuredCrash: { fingerprint: string; occurredAtMs: number } | null = null;
  private lastUnhandledCrash: TelemetryOccurrence | null = null;
  private lastMediaError: TelemetryOccurrence | null = null;

  initialize(): void {
    if (this.initialized || typeof window === 'undefined') return;
    this.initialized = true;
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as unknown;
        if (isConfiguration(parsed)) this.configuration = parsed;
      }
    } catch {
      // Storage is optional; analytics remains disabled until the next SSO.
    }

    window.addEventListener('error', (event) => {
      this.captureCrash(event.error ?? new Error(event.message || 'window_error'), {
        source: 'window.error',
        filename: event.filename,
        line: event.lineno,
        column: event.colno,
      });
    });
    window.addEventListener('unhandledrejection', (event) => {
      this.captureCrash(event.reason ?? new Error('unhandled_rejection'), {
        source: 'window.unhandledrejection',
      });
    });
    window.addEventListener('online', () => void this.retryOfflineBatches());
    window.addEventListener('pagehide', () => this.flush('ended', true));
    document.addEventListener('visibilitychange', () => {
      this.tickMetrics();
      this.track(document.hidden ? 'session.backgrounded' : 'session.foregrounded');
      this.flush('active', document.hidden);
    });
    for (const eventName of ['pointerdown', 'keydown', 'touchstart']) {
      document.addEventListener(eventName, () => { this.lastActivityAtMs = Date.now(); }, { passive: true });
    }
    document.addEventListener('click', (event) => this.captureSemanticClick(event), true);
    document.addEventListener('input', (event) => this.captureSearchInput(event), true);
    document.addEventListener('focusin', (event) => {
      if (this.isSearchInput(event.target)) {
        this.track('search.started', 'info', {
          interactionTarget: this.resolveControlId(event.target),
        });
      }
    }, true);
    document.addEventListener('submit', (event) => {
      const search = event.target instanceof HTMLFormElement
        ? event.target.querySelector<HTMLInputElement>('input[type="search"], input[placeholder*="Pretra" i], input[placeholder*="Search" i]')
        : null;
      if (search) {
        this.track('search.submitted', 'info', {
          interactionTarget: this.resolveControlId(search),
          searchText: search.value,
        });
      }
    }, true);
    document.addEventListener('fullscreenchange', () => {
      this.track(document.fullscreenElement ? 'playback.fullscreen_entered' : 'playback.fullscreen_exited');
    });
    for (const eventName of [
      'play', 'playing', 'pause', 'waiting', 'stalled', 'ended', 'error',
      'loadedmetadata', 'canplay', 'volumechange', 'ratechange', 'seeking', 'seeked', 'resize',
      'enterpictureinpicture', 'leavepictureinpicture',
    ]) {
      document.addEventListener(eventName, (event) => this.captureMediaEvent(eventName, event), true);
    }

    this.flushTimer = window.setInterval(() => this.flush('active'), FLUSH_INTERVAL_MS);
    this.heartbeatTimer = window.setInterval(() => {
      this.tickMetrics();
      this.track('session.heartbeat', 'info', this.collectPlaybackSnapshot());
      this.flush('active');
    }, HEARTBEAT_INTERVAL_MS);

    if (this.configuration) {
      this.startConfiguredSession(false);
    } else {
      void this.restoreConfigurationFromBinding();
    }
  }

  private async restoreConfigurationFromBinding(): Promise<void> {
    try {
      const response = await fetch('/player-analytics/config', {
        method: 'GET',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      });
      if (!response.ok || this.configuration) return;
      const configuration = await response.json() as unknown;
      if (!isConfiguration(configuration)) return;
      this.configuration = configuration;
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(configuration));
      } catch {
        // The signed HttpOnly binding remains authoritative.
      }
      this.startConfiguredSession(false);
    } catch {
      // Analytics restoration is best-effort and must never affect playback.
    }
  }

  configure(configuration: PlayerAnalyticsConfiguration): void {
    if (!isConfiguration(configuration)) return;
    this.configuration = configuration;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(configuration));
    } catch {
      // The signed HttpOnly proxy binding remains the authority.
    }
    this.startConfiguredSession(true);
  }

  endSession(): void {
    if (!this.configuration) return;
    this.flush('ended', true);
    this.configuration = null;
    this.stopReplay?.();
    this.stopReplay = null;
    this.replayEvents = [];
    try {
      sessionStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(METRICS_STORAGE_KEY);
    } catch {
      // Session state is already disabled in memory.
    }
  }

  private startConfiguredSession(isFreshSso: boolean): void {
    if (isFreshSso || !this.restoreMetricState()) this.resetMetricState();
    this.lastTickMs = Date.now();
    void this.startReplayRecorder();
    this.track('session.started', 'info', {
      entrySource: isFreshSso ? 'exyu_player_sso' : 'session_restore',
      playerRelease: PLAYER_RELEASE,
      device: collectSafeDeviceSummary(),
    });
    void this.retryOfflineBatches();
  }

  private resetMetricState(): void {
    const now = Date.now();
    this.startedAtMs = now;
    this.lastTickMs = now;
    this.foregroundMs = 0;
    this.activeMs = 0;
    this.playbackMs = 0;
    this.rebufferMs = 0;
    this.rebufferStartedAtMs = null;
    this.rebufferCount = 0;
    this.eventCount = 0;
    this.errorCount = 0;
    this.crashCount = 0;
    this.feedbackCount = 0;
    this.channelChanges = 0;
    this.firstFrameMs = null;
    this.lastActivityAtMs = now;
    this.playbackActive = false;
    this.currentRenderer = 'local-web';
    this.currentChannel = {};
    this.pendingChannelSwitchAtMs = null;
    this.events = [];
    this.crashes = [];
    this.feedback = [];
    this.recentEvents = [];
    this.lastStructuredCrash = null;
    this.lastUnhandledCrash = null;
    this.lastMediaError = null;
    try {
      sessionStorage.removeItem(METRICS_STORAGE_KEY);
    } catch {
      // Metrics remain available in memory.
    }
  }

  private restoreMetricState(): boolean {
    if (!this.configuration) return false;
    try {
      const parsed = JSON.parse(sessionStorage.getItem(METRICS_STORAGE_KEY) ?? 'null') as Record<string, unknown> | null;
      if (!parsed || parsed.sessionId !== this.configuration.sessionId) return false;
      const startedAtMs = finiteNumber(parsed.startedAtMs);
      if (startedAtMs === undefined || startedAtMs <= 0) return false;
      this.startedAtMs = startedAtMs;
      this.foregroundMs = finiteNumber(parsed.foregroundMs) ?? 0;
      this.activeMs = finiteNumber(parsed.activeMs) ?? 0;
      this.playbackMs = finiteNumber(parsed.playbackMs) ?? 0;
      this.rebufferMs = finiteNumber(parsed.rebufferMs) ?? 0;
      this.rebufferCount = analyticsInteger(parsed.rebufferCount) ?? 0;
      this.eventCount = analyticsInteger(parsed.eventCount) ?? 0;
      this.errorCount = analyticsInteger(parsed.errorCount) ?? 0;
      this.crashCount = analyticsInteger(parsed.crashCount) ?? 0;
      this.feedbackCount = analyticsInteger(parsed.feedbackCount) ?? 0;
      this.channelChanges = analyticsInteger(parsed.channelChanges) ?? 0;
      this.firstFrameMs = finiteNumber(parsed.firstFrameMs) ?? null;
      this.currentRenderer = stringValue(parsed.currentRenderer) ?? 'local-web';
      if (typeof parsed.currentChannel === 'object' && parsed.currentChannel !== null && !Array.isArray(parsed.currentChannel)) {
        const channel = parsed.currentChannel as Record<string, unknown>;
        this.currentChannel = {
          ...(stringValue(channel.id) ? { id: stringValue(channel.id) } : {}),
          ...(stringValue(channel.name) ? { name: stringValue(channel.name) } : {}),
          ...(stringValue(channel.category) ? { category: stringValue(channel.category) } : {}),
        };
      }
      return true;
    } catch {
      return false;
    }
  }

  private persistMetricState(): void {
    if (!this.configuration) return;
    try {
      sessionStorage.setItem(METRICS_STORAGE_KEY, JSON.stringify({
        sessionId: this.configuration.sessionId,
        startedAtMs: this.startedAtMs,
        foregroundMs: this.foregroundMs,
        activeMs: this.activeMs,
        playbackMs: this.playbackMs,
        rebufferMs: this.rebufferMs,
        rebufferCount: this.rebufferCount,
        eventCount: this.eventCount,
        errorCount: this.errorCount,
        crashCount: this.crashCount,
        feedbackCount: this.feedbackCount,
        channelChanges: this.channelChanges,
        firstFrameMs: this.firstFrameMs,
        currentRenderer: this.currentRenderer,
        currentChannel: this.currentChannel,
      }));
    } catch {
      // Metrics persistence is best-effort.
    }
  }

  track(
    name: string,
    severity: PlayerAnalyticsSeverity = 'info',
    metadata: Record<string, unknown> = {},
    timestampMs = Date.now(),
  ): void {
    if (!this.configuration || !name) return;
    this.tickMetrics(timestampMs);
    const safe = sanitizeTelemetryRecord(metadata);
    const contentKind = stringValue(safe.contentKind);
    const channelId = stringValue(safe.channelId) ?? (
      !contentKind || contentKind === 'live' || contentKind === 'catchup'
        ? stringValue(safe.streamId)
        : undefined
    );
    const channelName = stringValue(safe.channelName) ?? stringValue(safe.title);
    const channelCategory = stringValue(safe.channelCategory) ?? stringValue(safe.category);
    if (channelId || channelName || channelCategory) {
      this.currentChannel = {
        id: channelId ?? this.currentChannel.id,
        name: channelName ?? this.currentChannel.name,
        category: channelCategory ?? this.currentChannel.category,
      };
    }
    const eventChannel = resolveAnalyticsEventChannel({
      id: channelId,
      name: channelName,
      category: channelCategory,
    }, this.currentChannel);
    if (name === 'renderer.changed') {
      this.currentRenderer = stringValue(safe.to) ?? this.currentRenderer;
    }
    if (name === 'playback.source-selected') {
      // A channel switch has its own latency metric. Do not carry an open
      // rebuffer span into the next channel or keep counting the old source as
      // active playback while the new source starts.
      if (this.rebufferStartedAtMs !== null) {
        this.rebufferMs += Math.max(0, timestampMs - this.rebufferStartedAtMs);
        this.rebufferStartedAtMs = null;
      }
      this.playbackActive = false;
      this.channelChanges += 1;
      this.pendingChannelSwitchAtMs = timestampMs;
    }
    if (severity === 'error' || severity === 'fatal' || name.endsWith('.error')) this.errorCount += 1;

    const event: PlayerAnalyticsEvent = {
      id: randomId(),
      occurredAt: new Date(timestampMs).toISOString(),
      name: name.slice(0, 128),
      severity,
      route: window.location.pathname,
      screen: window.location.pathname,
      renderer: stringValue(safe.renderer) ?? this.currentRenderer,
      ...(stringValue(safe.interactionTarget) ? { interactionTarget: stringValue(safe.interactionTarget) } : {}),
      ...(eventChannel.id ? { channelId: eventChannel.id } : {}),
      ...(eventChannel.name ? { channelName: eventChannel.name } : {}),
      ...(eventChannel.category ? { channelCategory: eventChannel.category } : {}),
      ...(contentKind ? { contentKind } : {}),
      ...(stringValue(safe.playbackMode) ? { playbackMode: stringValue(safe.playbackMode) } : {}),
      ...(stringValue(safe.errorCode) ?? stringValue(safe.code)
        ? { errorCode: stringValue(safe.errorCode) ?? stringValue(safe.code) }
        : {}),
      ...(analyticsInteger(safe.durationMs) !== undefined ? { durationMs: analyticsInteger(safe.durationMs) } : {}),
      ...(analyticsInteger(safe.positionMs) !== undefined ? { positionMs: analyticsInteger(safe.positionMs) } : {}),
      properties: safe,
    };
    this.events.push(event);
    this.recentEvents.push(event);
    this.recentEvents = this.recentEvents.slice(-30);
    this.eventCount += 1;
    const structuredFailure = (
      (name === 'playback.error' && safe.fatal === true) ||
      (name === 'catalog.error' && severity === 'error') ||
      name === 'sso.landing_failed'
    );
    if (structuredFailure) {
      this.captureStructuredFailure(name, safe, timestampMs);
    }
    if (shouldFlushAnalyticsQueue(this.events.length)) this.flush('active');
  }

  trackRoute(pathname: string): void {
    this.track('navigation.route_changed', 'info', { route: pathname, interactionTarget: 'app.route' });
  }

  async submitFeedback(input: PlayerFeedbackInput): Promise<boolean> {
    if (!this.configuration) return false;
    const replayId = randomId();
    const replayUploaded = await this.uploadReplay('feedback', replayId);
    const feedback: PlayerFeedback = {
      id: randomId(),
      submittedAt: new Date().toISOString(),
      category: input.category.slice(0, 80),
      ...(input.message?.trim() ? { message: redactSensitiveText(input.message.trim()).slice(0, 10_000) } : {}),
      ...(input.experienceScore ? { experienceScore: Math.max(1, Math.min(5, Math.round(input.experienceScore))) } : {}),
      ...(this.currentChannel.id ? { channelId: this.currentChannel.id } : {}),
      ...(this.currentChannel.name ? { channelName: this.currentChannel.name } : {}),
      diagnostics: {
        ...this.collectPlaybackSnapshot(),
        device: collectSafeDeviceSummary(),
        route: window.location.pathname,
        playerRelease: PLAYER_RELEASE,
      },
      lastEvents: [...this.recentEvents],
      ...(replayUploaded ? { replayId } : {}),
    };
    this.feedback.push(feedback);
    this.feedbackCount += 1;
    this.track('feedback.submitted', 'info', {
      category: feedback.category,
      experienceScore: feedback.experienceScore,
      interactionTarget: 'feedback.submit',
    });
    return this.flush('active');
  }

  captureReactError(error: unknown, componentStack?: string): void {
    this.captureCrash(error, { source: 'react.error_boundary', componentStack });
  }

  private captureStructuredFailure(
    errorName: string,
    metadata: Record<string, unknown>,
    occurredAtMs: number,
  ): void {
    const message = redactSensitiveText(
      stringValue(metadata.message)
      ?? stringValue(metadata.errorCode)
      ?? stringValue(metadata.code)
      ?? errorName,
    );
    const fingerprint = buildCrashFingerprint(errorName, message);
    if (isDuplicateTelemetryOccurrence(this.lastStructuredCrash, fingerprint, occurredAtMs, 10_000)) {
      return;
    }
    this.lastStructuredCrash = { fingerprint, occurredAtMs };
    const replayId = randomId();
    void this.uploadReplay('crash', replayId);
    this.crashes.push({
      id: randomId(),
      occurredAt: new Date(occurredAtMs).toISOString(),
      fingerprint,
      errorName,
      message,
      route: window.location.pathname,
      playerRelease: PLAYER_RELEASE,
      lastEvents: [...this.recentEvents],
      context: sanitizeTelemetryRecord({
        ...metadata,
        device: collectSafeDeviceSummary(),
        playback: this.collectPlaybackSnapshot(),
      }),
      replayId,
    });
    this.crashCount += 1;
  }

  private captureCrash(error: unknown, context: Record<string, unknown>): void {
    if (!this.configuration) return;
    const normalized = error instanceof Error ? error : new Error(String(error));
    const message = redactSensitiveText(normalized.message || 'Unknown error');
    const stack = normalized.stack ? redactSensitiveText(normalized.stack) : undefined;
    const occurredAtMs = Date.now();
    const fingerprint = buildCrashFingerprint(normalized.name, message, stack);
    if (isDuplicateTelemetryOccurrence(this.lastUnhandledCrash, fingerprint, occurredAtMs, 30_000)) {
      return;
    }
    this.lastUnhandledCrash = { fingerprint, occurredAtMs };
    const replayId = randomId();
    void this.uploadReplay('crash', replayId);
    this.crashes.push({
      id: randomId(),
      occurredAt: new Date(occurredAtMs).toISOString(),
      fingerprint,
      errorName: normalized.name || 'Error',
      message,
      ...(stack ? { stack } : {}),
      route: window.location.pathname,
      playerRelease: PLAYER_RELEASE,
      lastEvents: [...this.recentEvents],
      context: sanitizeTelemetryRecord({
        ...context,
        device: collectSafeDeviceSummary(),
        playback: this.collectPlaybackSnapshot(),
      }),
      replayId,
    });
    this.crashCount += 1;
    this.track('session.crashed', 'fatal', { fingerprint }, occurredAtMs);
    this.flush('crashed', true);
  }

  private tickMetrics(nowMs = Date.now()): void {
    const elapsed = Math.max(0, Math.min(60_000, nowMs - this.lastTickMs));
    if (typeof document !== 'undefined' && !document.hidden) this.foregroundMs += elapsed;
    if (nowMs - this.lastActivityAtMs <= 60_000) this.activeMs += elapsed;
    if (this.playbackActive) this.playbackMs += elapsed;
    this.lastTickMs = nowMs;
  }

  private sessionRecord(status: 'active' | 'ended' | 'crashed'): Record<string, unknown> {
    this.tickMetrics();
    this.persistMetricState();
    return {
      id: this.configuration?.sessionId,
      startedAt: new Date(this.startedAtMs).toISOString(),
      ...(status !== 'active' ? { endedAt: new Date().toISOString() } : {}),
      lastSeenAt: new Date().toISOString(),
      status,
      playerRelease: PLAYER_RELEASE,
      entrySource: 'exyu_player_sso',
      device: collectSafeDeviceSummary(),
      metrics: {
        totalSeconds: (Date.now() - this.startedAtMs) / 1_000,
        foregroundSeconds: this.foregroundMs / 1_000,
        activeSeconds: this.activeMs / 1_000,
        playbackSeconds: this.playbackMs / 1_000,
        rebufferSeconds: this.rebufferMs / 1_000,
        rebufferCount: this.rebufferCount,
        channelChanges: this.channelChanges,
        errorCount: this.errorCount,
        crashCount: this.crashCount,
        feedbackCount: this.feedbackCount,
        eventCount: this.eventCount,
        ...(this.firstFrameMs !== null ? { firstFrameMs: this.firstFrameMs } : {}),
      },
      metadata: { currentRoute: window.location.pathname, renderer: this.currentRenderer },
    };
  }

  private createBatch(status: 'active' | 'ended' | 'crashed'): QueuedBatch | null {
    if (!this.configuration) return null;
    const batch: QueuedBatch = {
      schemaVersion: 1,
      sentAt: new Date().toISOString(),
      identity: { analyticsSubject: this.configuration.subject },
      session: this.sessionRecord(status),
      events: this.events.splice(0, 100),
      crashes: this.crashes.splice(0, 10),
      feedback: this.feedback.splice(0, 10),
    };
    return batch;
  }

  flush(status: 'active' | 'ended' | 'crashed', useBeacon = false): Promise<boolean> | boolean {
    if (!this.configuration) return false;
    if (this.activeFlushPromise && !useBeacon) {
      return this.activeFlushPromise.then(() => {
        if (!this.configuration) return false;
        if (this.events.length === 0 && this.crashes.length === 0 && this.feedback.length === 0) {
          return true;
        }
        return this.flush(status);
      });
    }
    if (this.events.length === 0 && this.crashes.length === 0 && this.feedback.length === 0 && status === 'active') {
      return true;
    }
    const batch = this.createBatch(status);
    if (!batch) return false;
    const body = JSON.stringify(batch);
    if (resolveAnalyticsFlushTransport(useBeacon, typeof navigator.sendBeacon === 'function') === 'beacon') {
      const accepted = navigator.sendBeacon(
        this.configuration.ingestUrl,
        new Blob([body], { type: 'application/json' }),
      );
      if (!accepted) this.storeOfflineBatch(batch);
      return accepted;
    }
    const requestPromise = fetch(this.configuration.ingestUrl, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    })
      .then((response) => {
        if (!response.ok) this.storeOfflineBatch(batch);
        return response.ok;
      })
      .catch(() => {
        this.storeOfflineBatch(batch);
        return false;
      })
      .finally(() => {
        if (this.activeFlushPromise === requestPromise) {
          this.activeFlushPromise = null;
        }
      });
    this.activeFlushPromise = requestPromise;
    return requestPromise;
  }

  private storeOfflineBatch(batch: QueuedBatch): void {
    try {
      const existing = JSON.parse(localStorage.getItem(OFFLINE_KEY) ?? '[]') as unknown;
      const batches = boundOfflineAnalyticsBatches(
        Array.isArray(existing) ? existing : [],
        batch,
      );
      localStorage.setItem(OFFLINE_KEY, JSON.stringify(batches));
    } catch {
      // Bounded in-memory queues remain available if storage is unavailable.
    }
  }

  private async retryOfflineBatches(): Promise<void> {
    if (!this.configuration || !navigator.onLine) return;
    let batches: unknown[] = [];
    try {
      const parsed = JSON.parse(localStorage.getItem(OFFLINE_KEY) ?? '[]') as unknown;
      if (Array.isArray(parsed)) batches = parsed.slice(-MAX_OFFLINE_BATCHES);
      localStorage.removeItem(OFFLINE_KEY);
    } catch {
      return;
    }
    for (const batch of batches) {
      const storedSession = typeof batch === 'object' && batch !== null
        ? (batch as { session?: { id?: unknown } }).session?.id
        : null;
      if (storedSession !== this.configuration.sessionId) {
        continue;
      }
      try {
        const response = await fetch(this.configuration.ingestUrl, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(batch),
        });
        if (!response.ok) this.storeOfflineBatch(batch as QueuedBatch);
      } catch {
        this.storeOfflineBatch(batch as QueuedBatch);
      }
    }
  }

  private async startReplayRecorder(): Promise<void> {
    if (this.stopReplay || typeof document === 'undefined') return;
    try {
      const { record } = await import('@rrweb/record');
      if (!this.configuration || this.stopReplay) return;
      const stop = record({
        emit: (event) => {
          const safe = sanitizeTelemetryRecord(event as unknown as Record<string, unknown>) as RrwebEvent;
          this.replayEvents.push(safe);
          const cutoff = Date.now() - REPLAY_WINDOW_MS;
          this.replayEvents = this.replayEvents
            .filter((entry) => entry.timestamp >= cutoff)
            .slice(-MAX_REPLAY_EVENTS);
        },
        blockSelector: RRWEB_BLOCK_SELECTOR,
        maskInputOptions: {
          password: true,
          email: true,
          text: true,
        },
        maskInputFn: maskReplayInput,
        slimDOMOptions: 'all',
        recordCanvas: false,
        collectFonts: false,
      });
      this.stopReplay = typeof stop === 'function' ? stop : null;
    } catch {
      // Replay is diagnostic-only and must never affect the player.
    }
  }

  private async uploadReplay(trigger: ReplayTrigger, replayId: string): Promise<boolean> {
    if (!this.configuration || this.replayEvents.length === 0) return false;
    const events = this.replayEvents.map((event) => sanitizeTelemetryRecord(event));
    const json = JSON.stringify(events);
    let body: Blob;
    let encoding: string | undefined;
    let timeout: number | null = null;
    try {
      if (typeof CompressionStream !== 'undefined') {
        const compressed = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
        body = new Blob([await new Response(compressed).arrayBuffer()], { type: 'application/gzip' });
        encoding = 'gzip';
      } else {
        body = new Blob([json], { type: 'application/octet-stream' });
      }
      const controller = new AbortController();
      timeout = window.setTimeout(() => controller.abort(), 5_000);
      const response = await fetch(this.configuration.replayUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': body.type,
          ...(encoding ? { 'content-encoding': encoding } : {}),
          'x-player-replay-id': replayId,
          'x-player-replay-trigger': trigger,
          'x-player-replay-started-at': new Date(finiteNumber(events[0]?.timestamp) ?? Date.now()).toISOString(),
          'x-player-replay-ended-at': new Date(finiteNumber(events.at(-1)?.timestamp) ?? Date.now()).toISOString(),
        },
        body,
        signal: controller.signal,
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      if (timeout !== null) window.clearTimeout(timeout);
    }
  }

  private captureSemanticClick(event: Event): void {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-analytics-id],button,a,input,select,textarea,[role="button"]')
      : null;
    if (!target) return;
    const semanticId = target.dataset.analyticsId
      ?? target.getAttribute('aria-label')
      ?? target.getAttribute('name')
      ?? target.textContent?.trim().replace(/\s+/g, ' ').slice(0, 100)
      ?? target.tagName.toLowerCase();
    const clickCoordinates = event instanceof MouseEvent && event.detail > 0
      ? normalizeClickCoordinates(event.clientX, event.clientY, window.innerWidth, window.innerHeight)
      : null;
    this.track('ui.control_activated', 'info', {
      interactionTarget: semanticId,
      controlType: target.tagName.toLowerCase(),
      ...(clickCoordinates ? {
        clickXPercent: clickCoordinates.xPercent,
        clickYPercent: clickCoordinates.yPercent,
        viewportWidth: clickCoordinates.viewportWidth,
        viewportHeight: clickCoordinates.viewportHeight,
        viewportClass: clickCoordinates.viewportClass,
        inputMethod: typeof PointerEvent !== 'undefined' && event instanceof PointerEvent
          ? event.pointerType || 'pointer'
          : 'mouse',
      } : { inputMethod: 'keyboard_or_programmatic' }),
    });
  }

  private isSearchInput(target: EventTarget | null): target is HTMLInputElement {
    if (!(target instanceof HTMLInputElement)) return false;
    return (
      target.type === 'search' ||
      /pretra|search/i.test(target.placeholder) ||
      /search|pretrag/i.test(`${target.name} ${target.id}`)
    );
  }

  private resolveControlId(target: HTMLElement): string {
    return target.dataset.analyticsId
      ?? target.getAttribute('aria-label')
      ?? target.getAttribute('name')
      ?? target.id
      ?? target.tagName.toLowerCase();
  }

  private captureSearchInput(event: Event): void {
    if (!this.isSearchInput(event.target)) return;
    const input = event.target;
    if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
    this.searchTimer = window.setTimeout(() => {
      this.track(input.value ? 'search.changed' : 'search.cleared', 'info', {
        interactionTarget: this.resolveControlId(input),
        searchText: input.value,
      });
    }, 500);
  }

  private captureMediaEvent(eventName: string, event: Event): void {
    if (!(event.target instanceof HTMLMediaElement)) return;
    const media = event.target;
    const now = Date.now();
    // Attribute elapsed time to the state that was active before this media
    // transition. Calling track() only after mutating playbackActive used to
    // count startup waiting as playback and omit time immediately before a
    // pause.
    this.tickMetrics(now);
    const wasPlaybackActive = this.playbackActive;
    const mediaError = eventName === 'error' ? mediaElementErrorDetails(media.error) : null;
    if (mediaError) {
      const fingerprint = [
        mediaError.errorCode,
        this.currentChannel.id ?? 'unknown-channel',
        media.networkState,
        media.readyState,
      ].join(':');
      if (isDuplicateTelemetryOccurrence(this.lastMediaError, fingerprint, now, 1_000)) return;
      this.lastMediaError = { fingerprint, occurredAtMs: now };
    }
    if (eventName === 'playing') {
      if (this.firstFrameMs === null) this.firstFrameMs = now - this.startedAtMs;
      if (this.rebufferStartedAtMs !== null) {
        const durationMs = now - this.rebufferStartedAtMs;
        this.rebufferMs += durationMs;
        this.track('playback.buffering_ended', 'info', { durationMs, positionMs: media.currentTime * 1_000 });
        this.rebufferStartedAtMs = null;
      }
      if (this.pendingChannelSwitchAtMs !== null) {
        this.track('playback.channel_switch_completed', 'info', {
          durationMs: now - this.pendingChannelSwitchAtMs,
        });
        this.pendingChannelSwitchAtMs = null;
      }
      this.playbackActive = true;
    }
    if (eventName === 'waiting' || eventName === 'stalled') {
      this.playbackActive = false;
      if (
        this.rebufferStartedAtMs === null &&
        shouldStartRebufferMeasurement(
          eventName,
          wasPlaybackActive,
          this.firstFrameMs !== null,
          this.pendingChannelSwitchAtMs !== null,
        )
      ) {
        this.rebufferStartedAtMs = now;
        this.rebufferCount += 1;
        this.track('playback.buffering_started', 'warn', { positionMs: media.currentTime * 1_000 });
      }
    }
    if (eventName === 'pause' || eventName === 'ended' || eventName === 'error') {
      this.playbackActive = false;
      if (this.rebufferStartedAtMs !== null) {
        const durationMs = Math.max(0, now - this.rebufferStartedAtMs);
        this.rebufferMs += durationMs;
        this.rebufferStartedAtMs = null;
        this.track('playback.buffering_interrupted', eventName === 'error' ? 'warn' : 'info', {
          durationMs,
          positionMs: media.currentTime * 1_000,
          reason: eventName,
        });
      }
    }
    const quality = media instanceof HTMLVideoElement && typeof media.getVideoPlaybackQuality === 'function'
      ? media.getVideoPlaybackQuality()
      : null;
    this.track(`playback.${eventName}`, eventName === 'error' ? 'error' : 'info', {
      positionMs: media.currentTime * 1_000,
      durationMs: Number.isFinite(media.duration) ? media.duration * 1_000 : undefined,
      readyState: media.readyState,
      networkState: media.networkState,
      paused: media.paused,
      muted: media.muted,
      volume: media.volume,
      ...(mediaError ?? {}),
      ...(media instanceof HTMLVideoElement ? {
        resolutionWidth: media.videoWidth,
        resolutionHeight: media.videoHeight,
        droppedVideoFrames: quality?.droppedVideoFrames,
        totalVideoFrames: quality?.totalVideoFrames,
      } : {}),
    });
  }

  private collectPlaybackSnapshot(): Record<string, unknown> {
    const media = typeof document !== 'undefined' ? document.querySelector('video') : null;
    if (!media) return { renderer: this.currentRenderer, channel: this.currentChannel };
    const quality = typeof media.getVideoPlaybackQuality === 'function'
      ? media.getVideoPlaybackQuality()
      : null;
    return sanitizeTelemetryRecord({
      renderer: this.currentRenderer,
      channel: this.currentChannel,
      positionMs: media.currentTime * 1_000,
      durationMs: Number.isFinite(media.duration) ? media.duration * 1_000 : undefined,
      paused: media.paused,
      muted: media.muted,
      volume: media.volume,
      readyState: media.readyState,
      networkState: media.networkState,
      resolutionWidth: media.videoWidth,
      resolutionHeight: media.videoHeight,
      droppedVideoFrames: quality?.droppedVideoFrames,
      totalVideoFrames: quality?.totalVideoFrames,
      rebufferCount: this.rebufferCount,
      rebufferSeconds: this.rebufferMs / 1_000,
      bufferRatio: this.playbackMs > 0 ? this.rebufferMs / this.playbackMs : 0,
    });
  }
}

const playerAnalytics = new PlayerAnalyticsClient();

export const initializePlayerAnalytics = (): void => playerAnalytics.initialize();
export const configurePlayerAnalytics = (configuration: PlayerAnalyticsConfiguration): void => {
  playerAnalytics.configure(configuration);
};
export const endPlayerAnalyticsSession = (): void => playerAnalytics.endSession();
export const emitPlayerAnalyticsEvent = (
  name: string,
  severity: PlayerAnalyticsSeverity = 'info',
  metadata: Record<string, unknown> = {},
  timestampMs?: number,
): void => playerAnalytics.track(name, severity, metadata, timestampMs);
export const trackPlayerRoute = (pathname: string): void => playerAnalytics.trackRoute(pathname);
export const submitPlayerFeedback = (input: PlayerFeedbackInput): Promise<boolean> => (
  playerAnalytics.submitFeedback(input)
);
export const captureReactAnalyticsError = (error: unknown, componentStack?: string): void => {
  playerAnalytics.captureReactError(error, componentStack);
};
