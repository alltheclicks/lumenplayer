import { describe, expect, it } from 'vitest';
import { buildPlaybackProblemReportMetadata } from './playbackProblemReport';

describe('buildPlaybackProblemReportMetadata', () => {
  it('uses source identity and user-facing error text without exposing stream URLs', () => {
    const metadata = buildPlaybackProblemReportMetadata({
      url: 'https://provider.example/live/user123/pass456/399.m3u8?token=secret',
      type: 'hls',
      title: 'N1 SRB',
      channelId: '399',
      metadata: {
        mode: 'live',
        channelId: '399',
        streamId: 399,
      },
    }, {
      message: 'Live kanal trenutno nije dostupan',
      details: 'Stream trenutno ne stiže ispravno od provajdera.',
    });

    expect(metadata).toEqual({
      channelId: '399',
      streamId: 399,
      mode: 'live',
      title: 'N1 SRB',
      errorMessage: 'Live kanal trenutno nije dostupan',
      errorDetails: 'Stream trenutno ne stiže ispravno od provajdera.',
    });
    expect(JSON.stringify(metadata)).not.toContain('user123');
    expect(JSON.stringify(metadata)).not.toContain('pass456');
    expect(JSON.stringify(metadata)).not.toContain('token=secret');
  });

  it('falls back to a generic title and null ids when metadata is incomplete', () => {
    expect(buildPlaybackProblemReportMetadata({
      url: 'https://provider.example/live/user123/pass456/399.m3u8',
      type: 'hls',
      title: '   ',
      metadata: {
        mode: 'live',
      },
    }, {
      message: 'Live kanal trenutno nije dostupan',
    })).toEqual({
      channelId: null,
      streamId: null,
      mode: null,
      title: 'Live kanal',
      errorMessage: 'Live kanal trenutno nije dostupan',
      errorDetails: null,
    });
  });
});
