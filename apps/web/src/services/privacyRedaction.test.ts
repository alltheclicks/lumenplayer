// Characterization tests (P4 step 1b): pin telemetry redaction before it moves
// into @lumen/observability and is reconciled with apps/proxy/src/privacy-redaction.ts.
import { describe, expect, it } from 'vitest';
import { redactSensitiveText, sanitizeTelemetryRecord } from './privacyRedaction';

const R = '[REDACTED]';

describe('redactSensitiveText', () => {
  it.each([
    ['URL basic-auth credentials', 'http://user:pa55@host.tv/x', `http://${R}@host.tv/x`],
    ['Xtream live path credentials', 'https://p.tv/live/alice/secret/123.ts', `https://p.tv/live/${R}/${R}/123.ts`],
    ['Xtream movie path credentials', 'https://p.tv/movie/alice/secret/9.mp4', `https://p.tv/movie/${R}/${R}/9.mp4`],
    ['timeshift path credentials', '/timeshift/alice/secret/60/2026-01-01:10-00/1.ts', `/timeshift/${R}/${R}/60/2026-01-01:10-00/1.ts`],
    ['query credentials', '/player_api.php?username=alice&password=s3cret&action=x', `/player_api.php?username=${R}&password=${R}&action=x`],
    ['query tokens', '/a?token=abc&api_key=k&session=s', `/a?token=${R}&api_key=${R}&session=${R}`],
    ['SSO fragment tokens', 'https://app/sso#token=abc.def', `https://app/sso#token=${R}`],
    ['bearer tokens', 'Authorization: Bearer eyJhbGci.payload.sig', `Authorization: Bearer ${R}`],
    ['email addresses', 'contact alice@example.com now', `contact ${R} now`],
  ])('redacts %s', (_label, input, expected) => {
    expect(redactSensitiveText(input)).toBe(expected);
  });

  it('leaves ordinary text and non-credential query params alone', () => {
    const input = 'GET /player_api.php?action=get_live_streams&category_id=4 took 120ms';

    expect(redactSensitiveText(input)).toBe(input);
  });

  it('truncates very long strings after redaction', () => {
    const output = redactSensitiveText('a'.repeat(20_010));

    expect(output).toHaveLength(20_000 + '[TRUNCATED]'.length);
    expect(output.endsWith('[TRUNCATED]')).toBe(true);
  });
});

describe('sanitizeTelemetryRecord', () => {
  it('redacts sensitive field names in any casing style', () => {
    const output = sanitizeTelemetryRecord({
      password: 'x',
      streamUrl: 'x',
      'source-url': 'x',
      requestHeaders: { a: 1 },
      userEmail: 'x',
      apiKey: 'x',
      channelId: 'kept',
      positionMs: 1_000,
    });

    expect(output).toEqual({
      password: R,
      streamUrl: R,
      'source-url': R,
      requestHeaders: R,
      userEmail: R,
      apiKey: R,
      channelId: 'kept',
      positionMs: 1_000,
    });
  });

  it('redacts credentials inside nested string values and arrays', () => {
    const output = sanitizeTelemetryRecord({
      nested: { message: 'failed https://p.tv/live/alice/secret/1.ts' },
      list: ['ok', 'mail bob@example.com'],
    });

    expect(output).toEqual({
      nested: { message: `failed https://p.tv/live/${R}/${R}/1.ts` },
      list: ['ok', `mail ${R}`],
    });
  });

  it('normalizes non-JSON values', () => {
    const output = sanitizeTelemetryRecord({
      when: new Date('2026-10-06T10:00:00.000Z'),
      big: BigInt(12),
      gone: undefined,
      fn: () => 1,
      sym: Symbol('x'),
      nil: null,
      flag: false,
    });

    expect(output).toEqual({
      when: '2026-10-06T10:00:00.000Z',
      big: '12',
      nil: null,
      flag: false,
    });
  });

  it('marks circular references instead of recursing', () => {
    const record: Record<string, unknown> = { name: 'root' };
    record.self = record;

    expect(sanitizeTelemetryRecord(record)).toEqual({ name: 'root', self: '[CIRCULAR]' });
  });

  it('allows the same object to appear in sibling branches', () => {
    const shared = { id: 1 };

    expect(sanitizeTelemetryRecord({ a: shared, b: shared })).toEqual({ a: { id: 1 }, b: { id: 1 } });
  });

  it('truncates nesting at depth 10', () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let level = 0; level < 12; level += 1) {
      deep = { child: deep };
    }

    let cursor: unknown = sanitizeTelemetryRecord(deep);
    for (let level = 0; level < 10; level += 1) {
      cursor = (cursor as Record<string, unknown>).child;
    }
    expect(cursor).toBe('[TRUNCATED]');
  });

  it('keeps at most 500 entries per array and object', () => {
    const array = Array.from({ length: 600 }, (_value, index) => index);
    const object = Object.fromEntries(array.map(index => [`k${index}`, index]));

    const output = sanitizeTelemetryRecord({ array, object }) as { array: unknown[]; object: Record<string, unknown> };

    expect(output.array).toHaveLength(500);
    expect(Object.keys(output.object)).toHaveLength(500);
  });
});
