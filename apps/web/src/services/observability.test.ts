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

  it('redacts live, VOD and catch-up credentials before every sink receives them', () => {
    const logged: LoggedRecord[] = [];
    const observability = createWebObservability({
      info: (_prefix, payload) => logged.push({ level: 'info', payload }),
      warn: (_prefix, payload) => logged.push({ level: 'warn', payload }),
      error: (_prefix, payload) => logged.push({ level: 'error', payload }),
    });

    observability.emit({
      name: 'catchup.redirect',
      metadata: {
        streamId: 112,
        sourceUrl: 'https://provider.example/live/viewer@example.com/live-pass/112.m3u8',
        vodUrl: 'https://provider.example/movie/viewer@example.com/movie-pass/9.mp4',
        requestUrl: 'https://provider.example/streaming/timeshift.php?username=viewer@example.com&password=catchup-pass&stream=112',
        finalUrl: 'https://edge.example/streaming/timeshift.php?token=edge-secret&seg=0_1.ts',
        account: {
          email: 'viewer@example.com',
          credentials: { password: 'nested-pass' },
        },
      },
      timestampMs: Date.UTC(2026, 6, 12, 12, 0, 0),
    });

    const serialized = JSON.stringify(logged);
    expect(serialized).not.toContain('viewer@example.com');
    expect(serialized).not.toContain('live-pass');
    expect(serialized).not.toContain('movie-pass');
    expect(serialized).not.toContain('catchup-pass');
    expect(serialized).not.toContain('edge-secret');
    expect(serialized).not.toContain('nested-pass');
    expect(serialized).toContain('provider.example');
    expect(serialized).toContain('stream=112');
    expect(logged[0]?.payload.streamId).toBe(112);
  });

  it('redacts SSO fragments, bearer tokens and account identifiers in free text', () => {
    const logged: LoggedRecord[] = [];
    const observability = createWebObservability({
      info: (_prefix, payload) => logged.push({ level: 'info', payload }),
      warn: (_prefix, payload) => logged.push({ level: 'warn', payload }),
      error: (_prefix, payload) => logged.push({ level: 'error', payload }),
    });

    observability.emit({
      name: 'playback.error',
      metadata: {
        message: 'viewer@example.com opened https://player.exyu.tv/sso#token=sso-secret with Bearer abc.def',
      },
    });

    const serialized = JSON.stringify(logged);
    expect(serialized).not.toContain('viewer@example.com');
    expect(serialized).not.toContain('sso-secret');
    expect(serialized).not.toContain('abc.def');
  });
});
