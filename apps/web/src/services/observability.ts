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
  getThresholdRules: () => ThresholdRule[];
}

export const createWebObservability = (
  sink: ObservabilitySink = defaultSink,
  rules: ThresholdRule[] = WEB_ALERT_THRESHOLD_RULES,
): WebObservability => {
  const thresholdStateByRuleId = createThresholdStateMap(rules);

  const emit = (event: ObservabilityEvent) => {
    const severity = event.severity ?? 'info';
    const nowMs = event.timestampMs ?? Date.now();

    const payload: Record<string, unknown> = {
      event: event.name,
      severity,
      timestamp: new Date(nowMs).toISOString(),
      ...(event.metadata ?? {}),
    };

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

  return {
    emit,
    getThresholdRules: () => rules,
  };
};

const webObservability = createWebObservability();

export const emitWebObservabilityEvent = (event: ObservabilityEvent): void => {
  webObservability.emit(event);
};

export const WEB_OBSERVABILITY_ALERT_RULES = WEB_ALERT_THRESHOLD_RULES;
