import { describe, expect, it } from 'vitest';
import { createWebObservability } from './observability';

type LoggedRecord = {
  level: 'info' | 'warn' | 'error';
  payload: Record<string, unknown>;
};

describe('web observability baseline', () => {
  it('emits structured payloads for regular events', () => {
    const logged: LoggedRecord[] = [];
    const observability = createWebObservability({
      info: (_prefix, payload) => {
        logged.push({ level: 'info', payload });
      },
      warn: (_prefix, payload) => {
        logged.push({ level: 'warn', payload });
      },
      error: (_prefix, payload) => {
        logged.push({ level: 'error', payload });
      },
    });

    observability.emit({
      name: 'playback.started',
      severity: 'info',
      metadata: {
        renderer: 'local-web',
      },
      timestampMs: Date.UTC(2026, 1, 16, 12, 0, 0),
    });

    expect(logged).toHaveLength(1);
    expect(logged[0]?.level).toBe('info');
    expect(logged[0]?.payload.event).toBe('playback.started');
    expect(logged[0]?.payload.renderer).toBe('local-web');
  });

  it('raises threshold alert for bursty playback errors', () => {
    const logged: LoggedRecord[] = [];
    const observability = createWebObservability({
      info: (_prefix, payload) => {
        logged.push({ level: 'info', payload });
      },
      warn: (_prefix, payload) => {
        logged.push({ level: 'warn', payload });
      },
      error: (_prefix, payload) => {
        logged.push({ level: 'error', payload });
      },
    });

    const startedAt = Date.UTC(2026, 1, 16, 12, 0, 0);
    for (let index = 0; index < 5; index += 1) {
      observability.emit({
        name: 'playback.error',
        severity: 'error',
        metadata: {
          code: 'NETWORK_ERROR',
        },
        timestampMs: startedAt + index * 1000,
      });
    }

    const alertEvents = logged
      .filter((entry) => entry.payload.event === 'alert.playback-error-burst');

    expect(alertEvents).toHaveLength(1);
    expect(alertEvents[0]?.payload.eventsInWindow).toBe(5);
  });

  it('does not raise burst alert when errors are sparse across threshold window', () => {
    const logged: LoggedRecord[] = [];
    const observability = createWebObservability({
      info: (_prefix, payload) => {
        logged.push({ level: 'info', payload });
      },
      warn: (_prefix, payload) => {
        logged.push({ level: 'warn', payload });
      },
      error: (_prefix, payload) => {
        logged.push({ level: 'error', payload });
      },
    });

    const startedAt = Date.UTC(2026, 1, 16, 12, 0, 0);
    for (let index = 0; index < 5; index += 1) {
      observability.emit({
        name: 'playback.error',
        severity: 'error',
        metadata: {
          code: 'NETWORK_ERROR',
        },
        timestampMs: startedAt + index * 90 * 1000,
      });
    }

    const alertEvents = logged
      .filter((entry) => entry.payload.event === 'alert.playback-error-burst');

    expect(alertEvents).toHaveLength(0);
  });
});
