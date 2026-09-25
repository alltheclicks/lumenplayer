import { sanitizeTelemetryRecord } from './privacyRedaction';
import { emitPlayerAnalyticsEvent } from './playerAnalytics';

export type ObservabilitySeverity = 'info' | 'warn' | 'error';

export interface ObservabilityEvent {
  name: string;
  severity?: ObservabilitySeverity;
  metadata?: Record<string, unknown>;
  timestampMs?: number;
}

interface ThresholdRule {
  id: string;
  eventName: string;
  minimumSeverity: ObservabilitySeverity;
  maxEvents: number;
  windowMs: number;
  cooldownMs: number;
  alertEventName: string;
}

interface ThresholdState {
  timestamps: number[];
  lastAlertAt: number;
}

interface ObservabilitySink {
  info: (prefix: string, payload: Record<string, unknown>) => void;
  warn: (prefix: string, payload: Record<string, unknown>) => void;
  error: (prefix: string, payload: Record<string, unknown>) => void;
}

const DEFAULT_PREFIX = '[lumen-observe]';

const severityRank: Record<ObservabilitySeverity, number> = {
  info: 1,
  warn: 2,
  error: 3,
};

const WEB_ALERT_THRESHOLD_RULES: ThresholdRule[] = [
  {
    id: 'web-playback-error-burst',
    eventName: 'playback.error',
    minimumSeverity: 'error',
    maxEvents: 5,
    windowMs: 5 * 60 * 1000,
    cooldownMs: 2 * 60 * 1000,
    alertEventName: 'alert.playback-error-burst',
  },
  {
    id: 'web-cast-error-burst',
    eventName: 'cast.error',
    minimumSeverity: 'error',
    maxEvents: 3,
    windowMs: 5 * 60 * 1000,
    cooldownMs: 2 * 60 * 1000,
    alertEventName: 'alert.cast-error-burst',
  },
];

const defaultSink: ObservabilitySink = {
  info: (prefix, payload) => {
    console.info(prefix, payload);
  },
  warn: (prefix, payload) => {
    console.warn(prefix, payload);
  },
  error: (prefix, payload) => {
    console.error(prefix, payload);
  },
};

// Best-effort beacon to a server sink (the proxy /observe endpoint). Enabled
// only when VITE_OBSERVABILITY_BEACON_URL is set; otherwise this is a no-op and
// the console-only behavior above is unchanged. Failures are swallowed so
// telemetry never affects playback.
const resolveBeaconUrl = (): string => {
  const raw = (import.meta.env.VITE_OBSERVABILITY_BEACON_URL ?? "").trim();
  return raw.replace(/\/+$/, "");
};

const sendBeacon = (payload: Record<string, unknown>): void => {
  const url = resolveBeaconUrl();
  if (!url || typeof window === "undefined") {
    return;
  }

  try {
    const body = JSON.stringify(payload);
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch(url, {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Telemetry must never throw into the playback path.
  }
};

const beaconSink: ObservabilitySink = {
  info: (prefix, payload) => {
    defaultSink.info(prefix, payload);
    sendBeacon(payload);
  },
  warn: (prefix, payload) => {
    defaultSink.warn(prefix, payload);
    sendBeacon(payload);
  },
  error: (prefix, payload) => {
    defaultSink.error(prefix, payload);
    sendBeacon(payload);
  },
};

const trimWindow = (timestamps: number[], nowMs: number, windowMs: number): number[] => (
  timestamps.filter((timestampMs) => nowMs - timestampMs <= windowMs)
);

const shouldCountForThreshold = (
  eventName: string,
  eventSeverity: ObservabilitySeverity,
  rule: ThresholdRule,
): boolean => (
  eventName === rule.eventName && severityRank[eventSeverity] >= severityRank[rule.minimumSeverity]
);

const createThresholdStateMap = (rules: ThresholdRule[]): Map<string, ThresholdState> => {
  const map = new Map<string, ThresholdState>();
  for (const rule of rules) {
    map.set(rule.id, {
      timestamps: [],
      lastAlertAt: 0,
    });
  }

  return map;
};

export interface WebObservability {
  emit: (event: ObservabilityEvent) => void;
  flush: () => void;
  getThresholdRules: () => ThresholdRule[];
}

export const createWebObservability = (
  sink: ObservabilitySink = defaultSink,
  rules: ThresholdRule[] = WEB_ALERT_THRESHOLD_RULES,
): WebObservability => {
  const thresholdStateByRuleId = createThresholdStateMap(rules);

  const publish = (event: ObservabilityEvent) => {
    const severity = event.severity ?? 'info';
    const nowMs = event.timestampMs ?? Date.now();

    const payload = sanitizeTelemetryRecord({
      event: event.name,
      severity,
      timestamp: new Date(nowMs).toISOString(),
      ...(event.metadata ?? {}),
    });

    emitPlayerAnalyticsEvent(event.name, severity, event.metadata ?? {}, nowMs);

    if (severity === 'error') {
      sink.error(DEFAULT_PREFIX, payload);
    } else if (severity === 'warn') {
      sink.warn(DEFAULT_PREFIX, payload);
    } else {
      sink.info(DEFAULT_PREFIX, payload);
    }

    for (const rule of rules) {
      if (!shouldCountForThreshold(event.name, severity, rule)) {
        continue;
      }

      const state = thresholdStateByRuleId.get(rule.id);
      if (!state) {
        continue;
      }

      state.timestamps = trimWindow(state.timestamps, nowMs, rule.windowMs);
      state.timestamps.push(nowMs);

      const crossedThreshold = state.timestamps.length >= rule.maxEvents;
      const cooldownElapsed = nowMs - state.lastAlertAt >= rule.cooldownMs;
      if (!crossedThreshold || !cooldownElapsed) {
        continue;
      }

      state.lastAlertAt = nowMs;
      sink.error(DEFAULT_PREFIX, {
        event: rule.alertEventName,
        severity: 'error',
        timestamp: new Date(nowMs).toISOString(),
        thresholdId: rule.id,
        sourceEventName: rule.eventName,
        eventsInWindow: state.timestamps.length,
        maxEvents: rule.maxEvents,
        windowMs: rule.windowMs,
      });
    }
  };

  const pendingDiagnostics = new Map<string, { event: ObservabilityEvent; repeats: number }>();
  let diagnosticTimer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    if (diagnosticTimer !== undefined) clearTimeout(diagnosticTimer);
    diagnosticTimer = undefined;
    for (const { event, repeats } of pendingDiagnostics.values()) {
      if (repeats > 0) publish({
        ...event,
        metadata: { ...event.metadata, occurrences: repeats, coalesced: true },
      });
    }
    pendingDiagnostics.clear();
  };
  const emit = (event: ObservabilityEvent) => {
    // Flush before source context changes so delayed diagnostics keep the
    // channel/content attribution they had when they occurred.
    if (event.name === 'playback.source-selected') flush();
    if (event.name !== 'playback.warning' && event.name !== 'playback.retry') {
      publish(event);
      return;
    }
    const metadata = event.metadata ?? {};
    const key = JSON.stringify([
      event.name, event.severity, metadata.errorCode ?? metadata.code,
      metadata.channelId ?? metadata.streamId, metadata.playbackMode, metadata.status,
    ]);
    const pending = pendingDiagnostics.get(key);
    if (pending) {
      pending.event = { ...event, timestampMs: event.timestampMs ?? Date.now() };
      pending.repeats += 1;
      return;
    }
    if (pendingDiagnostics.size >= 100) flush();
    pendingDiagnostics.set(key, { event, repeats: 0 });
    publish({ ...event, metadata: { ...metadata, occurrences: 1 } });
    diagnosticTimer ??= setTimeout(flush, 10_000);
  };

  return {
    emit, flush,
    getThresholdRules: () => rules,
  };
};

const webObservability = createWebObservability(
  resolveBeaconUrl() ? beaconSink : defaultSink,
);

if (typeof window !== 'undefined') {
  // Flush during capture, before the analytics client's bubble listeners send
  // their final batch on background/unload.
  window.addEventListener('pagehide', () => webObservability.flush(), true);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) webObservability.flush();
  }, true);
}

export const emitWebObservabilityEvent = (event: ObservabilityEvent): void => {
  webObservability.emit(event);
};

export const WEB_OBSERVABILITY_ALERT_RULES = WEB_ALERT_THRESHOLD_RULES;
