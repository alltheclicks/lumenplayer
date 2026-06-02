import { describe, expect, it } from 'vitest';
import {
  resolveCatchUpStartupUnavailableError,
  resolveSessionSourceBlockingError,
} from './sourceBlockingError';

describe('source blocking error', () => {
  it('maps blocked catch-up metadata to a player overlay error', () => {
    const error = resolveSessionSourceBlockingError({
      url: 'lumen://catchup-unavailable/75/program-1',
      type: 'hls',
      title: 'HRT 1 - HAK - Promet info',
      channelId: 'channel-75',
      metadata: {
        mode: 'catchup',
        catchUpUnavailable: {
          code: 'catchup_web_provider_incompatible',
          channelName: 'HRT 1',
          title: 'Snimak za TV unazad nije dostupan u web playeru',
          description: 'Na kanalu HRT 1, TV unazad koristi audio kodek koji web browser ne može pouzdano da pusti. Live kanal može raditi normalno, ali ovaj snimak nije dostupan u web playeru bez promene formata kod provajdera.',
          primaryActionLabel: 'Gledaj HRT 1 uživo',
        },
      },
    });

    expect(error).toEqual({
      type: 'format',
      message: 'Snimak za TV unazad nije dostupan u web playeru',
      details: 'Na kanalu HRT 1, TV unazad koristi audio kodek koji web browser ne može pouzdano da pusti. Live kanal može raditi normalno, ali ovaj snimak nije dostupan u web playeru bez promene formata kod provajdera.',
      primaryAction: 'switch-to-live',
      primaryActionLabel: 'Gledaj HRT 1 uživo',
    });
  });

  it('maps a runtime playback failure with provider evidence to the same user overlay', () => {
    const error = resolveSessionSourceBlockingError({
      url: 'https://edge.example/timeshift_hls/user/pass/30/start/75.m3u8',
      type: 'hls',
      title: 'HRT 1 - HAK - Promet info',
      channelId: 'channel-75',
      metadata: {
        mode: 'catchup',
        catchUpWebProviderIssue: {
          reasonCode: 'unsupported-audio-codec',
          channelName: 'HRT 1',
          summary: 'H.264 video + MP2 audio',
        },
      },
    }, 'MEDIA_ERROR');

    expect(error).toEqual({
      type: 'format',
      message: 'Snimak za TV unazad nije dostupan u web playeru',
      details: 'Na kanalu HRT 1, TV unazad koristi audio kodek koji web browser ne može pouzdano da pusti. Live kanal može raditi normalno, ali ovaj snimak nije dostupan u web playeru bez promene formata kod provajdera.',
      primaryAction: 'switch-to-live',
      primaryActionLabel: 'Gledaj HRT 1 uživo',
    });
  });

  it('maps confirmed unsupported catch-up provider evidence before attempting playback', () => {
    const error = resolveSessionSourceBlockingError({
      url: 'https://edge.example/timeshift_hls/user/pass/30/start/260.m3u8',
      type: 'hls',
      title: 'AMC - Film',
      channelId: 'channel-260',
      metadata: {
        mode: 'catchup',
        catchUpWebProviderIssue: {
          reasonCode: 'unsupported-audio-codec',
          channelName: 'AMC',
          summary: 'H.264 video + MP2 audio',
        },
      },
    });

    expect(error?.message).toBe('Snimak za TV unazad nije dostupan u web playeru');
    expect(error?.details).toContain('audio kodek');
    expect(error?.primaryActionLabel).toBe('Gledaj AMC uživo');
  });

  it('names unsupported video codec evidence clearly', () => {
    const error = resolveSessionSourceBlockingError({
      url: 'https://edge.example/timeshift_hls/user/pass/30/start/2927.m3u8',
      type: 'hls',
      title: 'RTS 1 Ultra HD - Program',
      channelId: 'channel-2927',
      metadata: {
        mode: 'catchup',
        catchUpWebProviderIssue: {
          reasonCode: 'unsupported-video-codec',
          channelName: 'RTS 1 Ultra HD',
          summary: 'HEVC video + AAC audio',
        },
      },
    });

    expect(error?.message).toBe('Snimak za TV unazad nije dostupan u web playeru');
    expect(error?.details).toContain('video kodek');
    expect(error?.primaryActionLabel).toBe('Gledaj RTS 1 Ultra HD uživo');
  });

  it('keeps catch-up risk evidence playable until an actual playback failure occurs', () => {
    const source = {
      url: 'https://edge.example/timeshift_hls/user/pass/30/start/165.m3u8',
      type: 'hls' as const,
      title: 'RTV 1 - Program',
      channelId: 'channel-165',
      metadata: {
        mode: 'catchup',
        catchUpWebProviderIssue: {
          reasonCode: 'ts-sanitizer-risk',
          channelName: 'RTV 1',
          summary: 'H.264 video + AAC audio, ali sa TS prekidima u arhivi',
        },
      },
    };

    expect(resolveSessionSourceBlockingError(source)).toBeNull();
    expect(resolveSessionSourceBlockingError(source, 'MEDIA_ERROR')?.primaryAction).toBe('switch-to-live');
  });

  it('maps a provider startup timeout to the same user overlay', () => {
    const error = resolveSessionSourceBlockingError({
      url: 'https://edge.example/timeshift_hls/user/pass/30/start/75.m3u8',
      type: 'hls',
      title: 'HRT 1 - Dnevnik',
      channelId: 'channel-75',
      metadata: {
        mode: 'catchup',
        catchUpWebProviderIssue: {
          reasonCode: 'unsupported-audio-codec',
          channelName: 'HRT 1',
        },
      },
    }, 'STARTUP_TIMEOUT');

    expect(error?.primaryActionLabel).toBe('Gledaj HRT 1 uživo');
    expect(error?.details).toContain('audio kodek');
    expect(error?.details).toContain('promene formata kod provajdera');
  });

  it('maps a catch-up provider network failure to the provider overlay instead of blaming the user connection', () => {
    const error = resolveSessionSourceBlockingError({
      url: 'https://edge.example/timeshift_hls/user/pass/30/start/75.m3u8',
      type: 'hls',
      title: 'HRT 1 - Dnevnik',
      channelId: 'channel-75',
      metadata: {
        mode: 'catchup',
        catchUpWebProviderIssue: {
          reasonCode: 'unsupported-archive-signal',
          channelName: 'HRT 1',
        },
      },
    }, 'NETWORK_ERROR');

    expect(error?.message).toBe('Snimak za TV unazad nije dostupan u web playeru');
    expect(error?.primaryAction).toBe('switch-to-live');
    expect(error?.details).toContain('format snimka');
  });

  it('maps a generic catch-up startup timeout to a switch-live overlay action', () => {
    const error = resolveCatchUpStartupUnavailableError({
      url: 'https://edge.example/timeshift_hls/user/pass/30/start/75.m3u8',
      type: 'hls',
      title: 'RTS 1 - Ovo je Srbija',
      channelId: 'channel-rts1',
      metadata: {
        mode: 'catchup',
      },
    });

    expect(error).toEqual({
      type: 'network',
      message: 'Snimak za TV unazad trenutno nije dostupan',
      details: 'Provajder trenutno ne vraća ispravan arhivski snimak za ovaj termin. Live kanal može raditi normalno. Nije do vašeg uređaja niti do Lumen playera.',
      primaryAction: 'switch-to-live',
      primaryActionLabel: 'Gledaj kanal uživo',
    });
  });

  it('ignores normal playback sources', () => {
    expect(resolveSessionSourceBlockingError({
      url: 'https://example.test/live.m3u8',
      type: 'hls',
      title: 'RTS 1',
      metadata: {
        mode: 'live',
      },
    })).toBeNull();
  });

  it('maps a live playback failure to a report-problem overlay action', () => {
    const error = resolveSessionSourceBlockingError({
      url: 'https://example.test/live.m3u8',
      type: 'hls',
      title: 'RTS 1',
      channelId: 'channel-rts1',
      metadata: {
        mode: 'live',
      },
    }, 'NETWORK_ERROR');

    expect(error).toEqual({
      type: 'network',
      message: 'Live kanal trenutno nije dostupan',
      details: 'RTS 1 trenutno ne može da se pokrene uživo. Stream ne stiže stabilno od provajdera ili servera. Nije do vašeg uređaja niti do Lumen playera.',
      primaryAction: 'report-problem',
      primaryActionLabel: 'Prijavi problem',
    });
  });
});
