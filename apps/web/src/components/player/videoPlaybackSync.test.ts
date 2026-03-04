import { describe, expect, it } from 'vitest';
import type { SessionState } from '@lumen/session-core';
import type { PlaybackError } from '@lumen/types';
import {
  evaluateCatchUpDecodeErrorBurst,
  hasRuntimePlaybackStarted,
  resolveCatchUpAttemptDurationSeconds,
  shouldClearPendingAutoplayOnPlaybackError,
  sessionWantsPlayback,
  shouldKeepPendingAutoplayOnIdle,
  shouldSkipCatchUpShortDurationAttempt,
  shouldRetryPendingAutoplayAfterPausedEvent,
  shouldResumePlaybackAfterPictureInPictureExit,
  shouldShowBlockingPlaybackError,
  shouldHoldPauseSyncOnSourceStartup,
  shouldAttemptCatchUpFallbackForPlaybackError,
  shouldSkipCatchUpNonManifestAttempt,
  shouldTriggerCatchUpRuntimeStallFallback,
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

  it('retries pending autoplay only while startup intent exists and attempts remain', () => {
    const playingSession = buildSession({ playback: 'playing' });
    const sourceUrl = playingSession.source?.url ?? null;

    expect(shouldRetryPendingAutoplayAfterPausedEvent(playingSession, sourceUrl, 0, 3)).toBe(true);
    expect(shouldRetryPendingAutoplayAfterPausedEvent(playingSession, sourceUrl, 2, 3)).toBe(true);
    expect(shouldRetryPendingAutoplayAfterPausedEvent(playingSession, sourceUrl, 3, 3)).toBe(false);
    expect(shouldRetryPendingAutoplayAfterPausedEvent(playingSession, 'https://example.com/other.m3u8', 0, 3)).toBe(false);
    expect(
      shouldRetryPendingAutoplayAfterPausedEvent(
        buildSession({ playback: 'paused' }),
        sourceUrl,
        0,
        3
      )
    ).toBe(false);
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

  it('detects runtime playback start from readyState/currentTime without false positives', () => {
    expect(hasRuntimePlaybackStarted(null)).toBe(false);
    expect(hasRuntimePlaybackStarted({
      readyState: 1,
      currentTime: 12,
      paused: false,
      videoWidth: 1920,
      videoHeight: 1080,
    })).toBe(false);
    expect(hasRuntimePlaybackStarted({
      readyState: 2,
      currentTime: 0,
      paused: true,
      videoWidth: 0,
      videoHeight: 0,
    })).toBe(false);
    expect(hasRuntimePlaybackStarted({
      readyState: 2,
      currentTime: 0,
      paused: false,
      videoWidth: 0,
      videoHeight: 0,
    })).toBe(false);
    expect(hasRuntimePlaybackStarted({
      readyState: 2,
      currentTime: 15,
      paused: false,
      videoWidth: 1920,
      videoHeight: 1080,
    })).toBe(true);
    expect(hasRuntimePlaybackStarted({
      readyState: 4,
      currentTime: 30,
      paused: true,
      videoWidth: 1920,
      videoHeight: 1080,
    })).toBe(true);
  });

  it('triggers catch-up stall fallback only for active catch-up runtime stalls', () => {
    expect(shouldTriggerCatchUpRuntimeStallFallback({
      isCatchUpSource: true,
      hasRuntimePlaybackData: true,
      isVideoPaused: false,
      playbackRequested: true,
      stalledDurationMs: 12_000,
      thresholdMs: 10_000,
    })).toBe(true);

    expect(shouldTriggerCatchUpRuntimeStallFallback({
      isCatchUpSource: false,
      hasRuntimePlaybackData: true,
      isVideoPaused: false,
      playbackRequested: true,
      stalledDurationMs: 12_000,
      thresholdMs: 10_000,
    })).toBe(false);

    expect(shouldTriggerCatchUpRuntimeStallFallback({
      isCatchUpSource: true,
      hasRuntimePlaybackData: false,
      isVideoPaused: false,
      playbackRequested: true,
      stalledDurationMs: 12_000,
      thresholdMs: 10_000,
    })).toBe(false);

    expect(shouldTriggerCatchUpRuntimeStallFallback({
      isCatchUpSource: true,
      hasRuntimePlaybackData: true,
      isVideoPaused: true,
      playbackRequested: true,
      stalledDurationMs: 12_000,
      thresholdMs: 10_000,
    })).toBe(false);

    expect(shouldTriggerCatchUpRuntimeStallFallback({
      isCatchUpSource: true,
      hasRuntimePlaybackData: true,
      isVideoPaused: false,
      playbackRequested: false,
      stalledDurationMs: 12_000,
      thresholdMs: 10_000,
    })).toBe(false);

    expect(shouldTriggerCatchUpRuntimeStallFallback({
      isCatchUpSource: true,
      hasRuntimePlaybackData: true,
      isVideoPaused: false,
      playbackRequested: true,
      stalledDurationMs: 8_000,
      thresholdMs: 10_000,
    })).toBe(false);
  });

  it('allows catch-up fallback on post-start network error threshold and blocks live path', () => {
    const networkError: PlaybackError = {
      code: 'NETWORK_ERROR',
      message: 'segment failed',
      fatal: false,
    };

    expect(shouldAttemptCatchUpFallbackForPlaybackError({
      playbackError: networkError,
      isCatchUpSource: true,
      hasRuntimePlaybackData: true,
      allowNetworkFallback: true,
    })).toBe(true);

    expect(shouldAttemptCatchUpFallbackForPlaybackError({
      playbackError: networkError,
      isCatchUpSource: true,
      hasRuntimePlaybackData: true,
      allowNetworkFallback: false,
    })).toBe(false);

    expect(shouldAttemptCatchUpFallbackForPlaybackError({
      playbackError: networkError,
      isCatchUpSource: false,
      hasRuntimePlaybackData: true,
      allowNetworkFallback: true,
    })).toBe(false);
  });

  it('does not consume catch-up fallback attempts on MEDIA_ELEMENT errors', () => {
    const mediaElementError: PlaybackError = {
      code: 'MEDIA_ELEMENT_3',
      message: 'The media playback was aborted due to a corruption problem.',
      fatal: false,
    };

    expect(shouldAttemptCatchUpFallbackForPlaybackError({
      playbackError: mediaElementError,
      isCatchUpSource: true,
      hasRuntimePlaybackData: true,
      allowNetworkFallback: true,
    })).toBe(false);

    expect(shouldAttemptCatchUpFallbackForPlaybackError({
      playbackError: mediaElementError,
      isCatchUpSource: true,
      hasRuntimePlaybackData: false,
      allowNetworkFallback: true,
    })).toBe(false);
  });

  it('triggers decode burst fallback only after runtime-progress MEDIA_ELEMENT_3 bursts', () => {
    const initialState = {
      sourceUrl: 'https://example.com/catchup-1.m3u8',
      count: 0,
      lastAtMs: 0,
    };

    const firstDecision = evaluateCatchUpDecodeErrorBurst({
      tracker: initialState,
      isCatchUpSource: true,
      playbackErrorCode: 'MEDIA_ELEMENT_3',
      hasRuntimeProgressForCurrentSource: true,
      currentSourceUrl: 'https://example.com/catchup-1.m3u8',
      nowMs: 1_000,
      windowMs: 45_000,
      threshold: 2,
    });
    expect(firstDecision.shouldFallback).toBe(false);
    expect(firstDecision.tracker.count).toBe(1);

    const secondDecision = evaluateCatchUpDecodeErrorBurst({
      tracker: firstDecision.tracker,
      isCatchUpSource: true,
      playbackErrorCode: 'MEDIA_ELEMENT_3',
      hasRuntimeProgressForCurrentSource: true,
      currentSourceUrl: 'https://example.com/catchup-1.m3u8',
      nowMs: 20_000,
      windowMs: 45_000,
      threshold: 2,
    });
    expect(secondDecision.shouldFallback).toBe(true);
    expect(secondDecision.tracker.count).toBe(2);
  });

  it('resets decode burst counter when there is no runtime progress or non-media error', () => {
    const seededState = {
      sourceUrl: 'https://example.com/catchup-1.m3u8',
      count: 2,
      lastAtMs: 10_000,
    };

    const noProgressDecision = evaluateCatchUpDecodeErrorBurst({
      tracker: seededState,
      isCatchUpSource: true,
      playbackErrorCode: 'MEDIA_ELEMENT_3',
      hasRuntimeProgressForCurrentSource: false,
      currentSourceUrl: 'https://example.com/catchup-1.m3u8',
      nowMs: 15_000,
      windowMs: 45_000,
      threshold: 2,
    });
    expect(noProgressDecision.shouldFallback).toBe(false);
    expect(noProgressDecision.tracker.count).toBe(0);

    const nonMediaDecision = evaluateCatchUpDecodeErrorBurst({
      tracker: seededState,
      isCatchUpSource: true,
      playbackErrorCode: 'NETWORK_ERROR',
      hasRuntimeProgressForCurrentSource: true,
      currentSourceUrl: 'https://example.com/catchup-1.m3u8',
      nowMs: 16_000,
      windowMs: 45_000,
      threshold: 2,
    });
    expect(nonMediaDecision.shouldFallback).toBe(false);
    expect(nonMediaDecision.tracker.count).toBe(0);
  });

  it('parses catch-up duration from query and path variants', () => {
    expect(resolveCatchUpAttemptDurationSeconds(
      'http://127.0.0.1:8080/xui-api/http%3A%2F%2Fserv2.mediaking.fi%3A8080/streaming/timeshift.php?username=fica&duration=2100&extension=m3u8',
    )).toBe(2100);
    expect(resolveCatchUpAttemptDurationSeconds(
      'http://127.0.0.1:8080/xui-api/http%3A%2F%2Fserv2.mediaking.fi%3A8080/timeshift/fica/pass/35/2026-02-24:02-00/112.m3u8',
    )).toBe(35);
    expect(resolveCatchUpAttemptDurationSeconds('not-a-url')).toBeNull();
  });

  it('skips short fallback attempts only after runtime progress already existed', () => {
    const shortAttemptUrl = 'http://127.0.0.1:8080/xui-api/http%3A%2F%2Fserv2.mediaking.fi%3A8080/streaming/timeshift.php?username=fica&duration=35&extension=m3u8';
    const longAttemptUrl = 'http://127.0.0.1:8080/xui-api/http%3A%2F%2Fserv2.mediaking.fi%3A8080/streaming/timeshift.php?username=fica&duration=2100&extension=m3u8';

    expect(shouldSkipCatchUpShortDurationAttempt({
      attemptUrl: shortAttemptUrl,
      expectedDurationSeconds: 2100,
      hasRuntimePlaybackProgress: true,
    })).toBe(true);

    expect(shouldSkipCatchUpShortDurationAttempt({
      attemptUrl: longAttemptUrl,
      expectedDurationSeconds: 2100,
      hasRuntimePlaybackProgress: true,
    })).toBe(false);

    expect(shouldSkipCatchUpShortDurationAttempt({
      attemptUrl: shortAttemptUrl,
      expectedDurationSeconds: 2100,
      hasRuntimePlaybackProgress: false,
    })).toBe(false);

    expect(shouldSkipCatchUpShortDurationAttempt({
      attemptUrl: shortAttemptUrl,
      expectedDurationSeconds: 300,
      hasRuntimePlaybackProgress: true,
    })).toBe(false);
  });

  it('skips non-manifest ts attempts once runtime playback has already progressed', () => {
    const tsAttemptUrl = 'http://127.0.0.1:8080/xui-api/http%3A%2F%2Fserv2.mediaking.fi%3A8080/timeshift/fica/pass/600/2026-03-03:15-00/112.ts';
    const m3u8AttemptUrl = 'http://127.0.0.1:8080/xui-api/http%3A%2F%2Fserv2.mediaking.fi%3A8080/timeshift/fica/pass/600/2026-03-03:15-00/112.m3u8';

    expect(shouldSkipCatchUpNonManifestAttempt({
      attemptUrl: tsAttemptUrl,
      hasRuntimePlaybackProgress: true,
    })).toBe(true);

    expect(shouldSkipCatchUpNonManifestAttempt({
      attemptUrl: tsAttemptUrl,
      hasRuntimePlaybackProgress: false,
    })).toBe(false);

    expect(shouldSkipCatchUpNonManifestAttempt({
      attemptUrl: m3u8AttemptUrl,
      hasRuntimePlaybackProgress: true,
    })).toBe(false);
  });

  it('uses extended stall threshold after significant playback progress', () => {
    // Post-start: progress > 5s → 30s threshold should apply
    expect(shouldTriggerCatchUpRuntimeStallFallback({
      isCatchUpSource: true,
      hasRuntimePlaybackData: true,
      isVideoPaused: false,
      playbackRequested: true,
      stalledDurationMs: 15_000,
      thresholdMs: 30_000,
    })).toBe(false);

    // Post-start: stalled for 30s → should trigger
    expect(shouldTriggerCatchUpRuntimeStallFallback({
      isCatchUpSource: true,
      hasRuntimePlaybackData: true,
      isVideoPaused: false,
      playbackRequested: true,
      stalledDurationMs: 30_000,
      thresholdMs: 30_000,
    })).toBe(true);

    // Startup: stalled for 12s with 12s threshold → should trigger
    expect(shouldTriggerCatchUpRuntimeStallFallback({
      isCatchUpSource: true,
      hasRuntimePlaybackData: true,
      isVideoPaused: false,
      playbackRequested: true,
      stalledDurationMs: 12_000,
      thresholdMs: 12_000,
    })).toBe(true);
  });
});
