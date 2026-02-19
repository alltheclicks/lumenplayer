import { describe, expect, it } from 'vitest';
import type { SessionState } from '@lumen/session-core';
import type { PlaybackError } from '@lumen/types';
import {
  shouldClearPendingAutoplayOnPlaybackError,
  sessionWantsPlayback,
  shouldKeepPendingAutoplayOnIdle,
  shouldResumePlaybackAfterPictureInPictureExit,
  shouldShowBlockingPlaybackError,
  shouldHoldPauseSyncOnSourceStartup,
} from './videoPlaybackSync';

const buildSession = (overrides: Partial<SessionState> = {}): SessionState => ({
  sessionId: 'session-1',
  source: {
    url: 'https://example.com/live.m3u8',
    type: 'hls',
    title: 'Channel 1',
  },
  playback: 'paused',
  positionMs: 0,
  liveOffsetMs: null,
  renderer: 'local-web',
  error: null,
  updatedAt: 0,
  ...overrides,
});

describe('videoPlaybackSync', () => {
  it('treats playing and buffering as playback-intent states', () => {
    expect(sessionWantsPlayback(buildSession({ playback: 'playing' }))).toBe(true);
    expect(sessionWantsPlayback(buildSession({ playback: 'buffering' }))).toBe(true);
    expect(sessionWantsPlayback(buildSession({ playback: 'paused' }))).toBe(false);
  });

  it('holds pause sync while initial autoplay startup is still pending', () => {
    const session = buildSession({ playback: 'playing' });
    expect(shouldHoldPauseSyncOnSourceStartup(session, session.source?.url ?? null)).toBe(true);
  });

  it('does not hold pause sync once source differs or playback intent is gone', () => {
    const session = buildSession({ playback: 'playing' });
    expect(shouldHoldPauseSyncOnSourceStartup(session, 'https://example.com/other.m3u8')).toBe(false);
    expect(
      shouldHoldPauseSyncOnSourceStartup(buildSession({ playback: 'paused' }), session.source?.url ?? null)
    ).toBe(false);
    expect(shouldHoldPauseSyncOnSourceStartup(buildSession({ source: null }), session.source?.url ?? null)).toBe(false);
  });

  it('keeps pending autoplay marker across transient idle state during source startup', () => {
    const session = buildSession({ playback: 'playing' });
    expect(shouldKeepPendingAutoplayOnIdle(session, session.source?.url ?? null)).toBe(true);
  });

  it('clears pending autoplay marker on idle once startup intent is gone', () => {
    const playingSession = buildSession({ playback: 'playing' });
    expect(shouldKeepPendingAutoplayOnIdle(playingSession, 'https://example.com/other.m3u8')).toBe(false);
    expect(shouldKeepPendingAutoplayOnIdle(buildSession({ playback: 'paused' }), playingSession.source?.url ?? null)).toBe(false);
  });

  it('shows blocking overlay only for fatal playback errors', () => {
    const fatalError: PlaybackError = {
      code: 'NETWORK_ERROR',
      message: 'fatal',
      fatal: true,
    };
    const nonFatalError: PlaybackError = {
      code: 'NETWORK_ERROR',
      message: 'recoverable',
      fatal: false,
    };

    expect(shouldShowBlockingPlaybackError(fatalError)).toBe(true);
    expect(shouldShowBlockingPlaybackError(nonFatalError)).toBe(false);
  });

  it('keeps pending autoplay for non-fatal startup errors and clears it for fatal', () => {
    const fatalError: PlaybackError = {
      code: 'NETWORK_ERROR',
      message: 'fatal',
      fatal: true,
    };
    const nonFatalError: PlaybackError = {
      code: 'PLAYBACK_START_FAILED',
      message: 'recoverable',
      fatal: false,
    };

    expect(shouldClearPendingAutoplayOnPlaybackError(fatalError)).toBe(true);
    expect(shouldClearPendingAutoplayOnPlaybackError(nonFatalError)).toBe(false);
  });

  it('resumes playback after PiP exit only for live playback intent while video is paused', () => {
    const liveSession = buildSession({
      playback: 'playing',
      source: {
        url: 'https://example.com/live.m3u8',
        type: 'hls',
        title: 'Live Channel',
        channelId: 'live-1',
        metadata: {
          mode: 'live',
        },
      },
    });
    const vodSession = buildSession({
      playback: 'playing',
      source: {
        url: 'https://example.com/movie.m3u8',
        type: 'hls',
        title: 'Movie',
        metadata: {
          mode: 'vod',
        },
      },
    });

    expect(shouldResumePlaybackAfterPictureInPictureExit(liveSession, true)).toBe(true);
    expect(shouldResumePlaybackAfterPictureInPictureExit(vodSession, true)).toBe(false);
    expect(shouldResumePlaybackAfterPictureInPictureExit(liveSession, false)).toBe(false);
    expect(
      shouldResumePlaybackAfterPictureInPictureExit(
        buildSession({
          playback: 'paused',
          source: liveSession.source,
        }),
        true
      )
    ).toBe(false);
  });
});
