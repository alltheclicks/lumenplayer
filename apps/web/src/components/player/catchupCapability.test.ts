import { describe, expect, it } from 'vitest';
import {
  CatchUpWebCapabilityError,
  assertCatchUpWebPlayable,
  getCatchUpWebCapabilityNotice,
  resolveCatchUpWebCapability,
} from './catchupCapability';

const createChannel = (overrides: {
  id?: string;
  name?: string;
  streamId?: number;
  source?: 'xtream' | 'm3u';
  hasCatchUp?: boolean;
  catchUpDays?: number;
} = {}) => ({
  id: overrides.id ?? 'channel-53',
  name: overrides.name ?? 'KANAL 5',
  streamId: overrides.streamId ?? 53,
  source: overrides.source ?? 'xtream',
  hasCatchUp: overrides.hasCatchUp ?? true,
  catchUpDays: overrides.catchUpDays ?? 7,
});

describe('catchup web capability', () => {
  it('keeps a known provider archive issue as runtime evidence instead of blocking before playback', () => {
    const channel = createChannel();
    const capability = resolveCatchUpWebCapability(channel);

    expect(capability).toMatchObject({
      status: 'unknown',
      blockPlayback: false,
      reasonCode: 'unsupported-audio-codec',
      streamId: 53,
    });
    expect(capability.summary).toContain('MP2');

    expect(() => assertCatchUpWebPlayable(channel)).not.toThrow();
  });

  it('builds a user-facing notice for a blocked provider archive', () => {
    const notice = getCatchUpWebCapabilityNotice(resolveCatchUpWebCapability(createChannel()));

    expect(notice).toEqual({
      title: 'Snimak za TV unazad nije dostupan u web playeru',
      description: 'Na kanalu KANAL 5, TV unazad koristi audio kodek koji web browser ne može pouzdano da pusti. Live kanal može raditi normalno, ali ovaj snimak nije dostupan u web playeru bez promene formata kod provajdera.',
      primaryActionLabel: 'Gledaj KANAL 5 uživo',
    });
  });

  it('still blocks when catch-up is not advertised for the channel', () => {
    const channel = createChannel({
      hasCatchUp: false,
      catchUpDays: 0,
    });

    const capability = resolveCatchUpWebCapability(channel);

    expect(capability).toMatchObject({
      status: 'unsupported',
      blockPlayback: true,
      reasonCode: 'catchup-not-advertised',
    });
    expect(() => assertCatchUpWebPlayable(channel)).toThrow(CatchUpWebCapabilityError);
  });

  it('does not block an unknown channel because it is not a confirmed failure', () => {
    const channel = createChannel({
      id: 'channel-99999',
      name: 'New Channel',
      streamId: 99999,
    });

    const capability = resolveCatchUpWebCapability(channel);

    expect(capability).toMatchObject({
      status: 'unknown',
      blockPlayback: false,
      reasonCode: 'not-in-provider-matrix',
    });
    expect(() => assertCatchUpWebPlayable(channel)).not.toThrow();
  });

  it('keeps risky provider archives playable until they are confirmed unsupported', () => {
    const channel = createChannel({
      id: 'channel-165',
      name: 'RTV 1',
      streamId: 165,
    });

    const capability = resolveCatchUpWebCapability(channel);

    expect(capability).toMatchObject({
      status: 'unknown',
      blockPlayback: false,
      reasonCode: 'ts-sanitizer-risk',
      streamId: 165,
    });
    expect(() => assertCatchUpWebPlayable(channel)).not.toThrow();
  });
});
