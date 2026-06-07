import { describe, expect, it } from 'vitest';
import type { SessionSource } from '@lumen/session-core';
import {
  resolveCastSourceUnsupportedReason,
  resolveGoogleCastReceiverAppId,
} from './useGoogleCastSender';

describe('useGoogleCastSender helpers', () => {
  it('uses the default Cast receiver only as a dev fallback', () => {
    expect(resolveGoogleCastReceiverAppId({
      DEV: true,
      VITE_GOOGLE_CAST_APP_ID: '',
    })).toBe('CC1AD845');

    expect(resolveGoogleCastReceiverAppId({
      DEV: false,
      VITE_GOOGLE_CAST_APP_ID: '',
    })).toBeNull();
  });

  it('prefers an explicit Google Cast app id in every environment', () => {
    expect(resolveGoogleCastReceiverAppId({
      DEV: false,
      VITE_GOOGLE_CAST_APP_ID: '  ABC123  ',
    })).toBe('ABC123');
  });

  it('blocks MP2 live sources from Cast without blocking normal live sources', () => {
    const mp2Source: SessionSource = {
      url: 'https://example.com/live.m3u8',
      type: 'hls',
      metadata: {
        mode: 'live',
        unsupportedAudioCodec: 'mp2',
      },
    };
    const aacSource: SessionSource = {
      url: 'https://example.com/live-aac.m3u8',
      type: 'hls',
      metadata: {
        mode: 'live',
      },
    };

    expect(resolveCastSourceUnsupportedReason(mp2Source)).toContain('MP2 audio');
    expect(resolveCastSourceUnsupportedReason(aacSource)).toBeNull();
  });
});

