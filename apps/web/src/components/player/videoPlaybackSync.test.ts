import { describe, expect, it } from 'vitest';
import type { SessionState } from '@lumen/session-core';
import type { PlaybackError } from '@lumen/types';
import {
  shouldClearPendingAutoplayOnPlaybackError,
  sessionWantsPlayback,
  shouldPreservePlaybackIntentDuringBackgroundPause,
  shouldRecoverPlaybackAfterForeground,
  shouldKeepPendingAutoplayOnIdle,
  shouldResolveProviderBlockingErrorAfterPlaybackError,
  shouldRetryPendingAutoplayAfterPausedEvent,
  shouldResumePlaybackAfterPictureInPictureExit,
  shouldScheduleStartupHardRetry,
  shouldContinueCatchUpStartupFallbacks,
  shouldRetryLiveStartupWithoutFrame,
  shouldShowBlockingPlaybackError,
  shouldShowPlaybackErrorAfterPlaybackError,
  shouldHoldPauseSyncOnSourceStartup,
  shouldRetryCatchUpBufferingStall,
  hasRenderableMediaFrame,
  shouldAttemptCatchUpErrorFallback,
  shouldDeferLiveStartupPlaybackError,
  shouldDeferCatchUpStartupPlaybackError,
  shouldResolveCatchUpRuntimeUnavailableAfterPlaybackError,
  shouldResolveCatchUpStartupWatchdog,
  shouldRetryCatchUpStartupWithoutSafeStart,
  shouldRetryCatchUpStartupWithProviderSafeStart,
  shouldStopLongCatchUpStartupLoading,
  shouldShowCatchUpManifestNoFrameUnavailable,
  resolveCatchUpManifestNoFrameWatchdogDelayMs,
  shouldUseCatchUpStartupWatchdog,
  resolveCatchUpMediaOffsetSeconds,
  resolveCatchUpMediaSeekTimeSeconds,
  resolveCatchUpMediaSeekTimeSecondsForSource,
  resolveCatchUpPendingStartupSeek,
  resolveCatchUpSeekRecoveryFallbackPositionMs,
  resolveCatchUpTimelinePositionMs,
  resolveCatchUpTimelinePositionMsForSource,
  resolveCatchUpTimelineSeekTargetMs,
  resolveCatchUpTimelineSeekTargetMsForSource,
  resolveCatchUpLoadingProgressPercent,
  resolvePlaybackFailureTelemetry,
  resolveLiveUnexpectedStopDecision,
  shouldResumeRenderableLiveAfterUnexpectedStop,
  resolveCatchUpSeekNoFrameDecision,
  shouldWatchCatchUpSeekAfterPlaybackError,
  shouldWatchCatchUpSeekAfterPositionChange,
  resolveCatchUpFallbackPlaybackPosition,
  resolveCatchUpFallbackTimelinePositionMs,
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
  it('keeps deferred and still-rendering failures out of terminal playback errors', () => {
    expect(resolvePlaybackFailureTelemetry('deferred', true)).toEqual({
      name: 'playback.retry',
      severity: 'warn',
      terminal: false,
    });
    expect(resolvePlaybackFailureTelemetry('rendering-continues', true)).toEqual({
      name: 'playback.warning',
      severity: 'warn',
      terminal: false,
    });
    expect(resolvePlaybackFailureTelemetry('terminal', false)).toEqual({
      name: 'playback.error',
      severity: 'warn',
      terminal: true,
    });
    expect(resolvePlaybackFailureTelemetry('terminal', true)).toEqual({
      name: 'playback.error',
      severity: 'error',
      terminal: true,
    });
  });

  it('treats playing and buffering as playback-intent states', () => {
    expect(sessionWantsPlayback(buildSession({ playback: 'playing' }))).toBe(true);
    expect(sessionWantsPlayback(buildSession({ playback: 'buffering' }))).toBe(true);
    expect(sessionWantsPlayback(buildSession({ playback: 'paused' }))).toBe(false);
  });

  it('preserves live and catch-up playback intent for browser-generated background pauses', () => {
    const liveSession = buildSession({
      playback: 'playing',
      source: {
        url: 'https://example.com/live.m3u8',
        type: 'hls',
        title: 'Live',
        metadata: { mode: 'live' },
      },
    });
    const catchUpSession = buildSession({
      playback: 'buffering',
      source: {
        url: 'https://example.com/archive.m3u8',
        type: 'hls',
        title: 'Archive',
        metadata: { mode: 'catchup' },
      },
    });

    expect(shouldPreservePlaybackIntentDuringBackgroundPause(liveSession, {
      isDocumentHidden: true,
      isForegroundRecoveryPending: false,
      manualPauseRequested: false,
    })).toBe(true);
    expect(shouldPreservePlaybackIntentDuringBackgroundPause(catchUpSession, {
      isDocumentHidden: true,
      isForegroundRecoveryPending: false,
      manualPauseRequested: false,
    })).toBe(true);
    expect(shouldPreservePlaybackIntentDuringBackgroundPause(liveSession, {
      isDocumentHidden: true,
      isForegroundRecoveryPending: false,
      manualPauseRequested: true,
    })).toBe(false);
    expect(shouldPreservePlaybackIntentDuringBackgroundPause(liveSession, {
      isDocumentHidden: false,
      isForegroundRecoveryPending: false,
      manualPauseRequested: false,
    })).toBe(false);
    expect(shouldPreservePlaybackIntentDuringBackgroundPause(liveSession, {
      isDocumentHidden: false,
      isForegroundRecoveryPending: true,
      manualPauseRequested: false,
    })).toBe(true);
  });

  it('recovers an interrupted live or catch-up source once it returns to the foreground', () => {
    const liveSession = buildSession({
      playback: 'playing',
      source: {
        url: 'https://example.com/live.m3u8',
        type: 'hls',
        title: 'Live',
        metadata: { mode: 'live' },
      },
    });
    const catchUpSession = buildSession({
      playback: 'playing',
      source: {
        url: 'https://example.com/archive.m3u8',
        type: 'hls',
        title: 'Archive',
        metadata: { mode: 'catchup' },
      },
    });

    expect(shouldRecoverPlaybackAfterForeground(liveSession, {
      backgroundSourceUrl: liveSession.source?.url ?? null,
      mediaPaused: true,
      adapterState: 'paused',
    })).toBe(true);
    expect(shouldRecoverPlaybackAfterForeground(catchUpSession, {
      backgroundSourceUrl: catchUpSession.source?.url ?? null,
      mediaPaused: false,
      adapterState: 'buffering',
    })).toBe(true);
    expect(shouldRecoverPlaybackAfterForeground(liveSession, {
      backgroundSourceUrl: liveSession.source?.url ?? null,
      mediaPaused: false,
      adapterState: 'playing',
    })).toBe(false);
    expect(shouldRecoverPlaybackAfterForeground(liveSession, {
      backgroundSourceUrl: 'https://example.com/other.m3u8',
      mediaPaused: true,
      adapterState: 'paused',
    })).toBe(false);
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

  it('shows blocking overlay only for fatal playback errors without a renderable live/catch-up frame', () => {
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
    expect(shouldShowPlaybackErrorAfterPlaybackError(buildSession({
      source: {
        url: 'https://example.com/live.m3u8',
        type: 'hls',
        title: 'Live',
        metadata: {
          mode: 'live',
        },
      },
    }), fatalError, {
      hasRenderableFrame: true,
    })).toBe(false);
    expect(shouldShowPlaybackErrorAfterPlaybackError(buildSession({
      source: {
        url: 'https://example.com/live.m3u8',
        type: 'hls',
        title: 'Live',
        metadata: {
          mode: 'live',
        },
      },
    }), fatalError, {
      hasRenderableFrame: false,
    })).toBe(true);
  });

  it('does not surface live provider overlays while video still renders', () => {
    const liveSession = buildSession({
      playback: 'playing',
      source: {
        url: 'https://example.com/live.m3u8',
        type: 'hls',
        title: 'Live',
        metadata: {
          mode: 'live',
        },
      },
    });
    const catchUpSession = buildSession({
      playback: 'playing',
      source: {
        url: 'https://example.com/archive.m3u8',
        type: 'hls',
        title: 'Archive',
        metadata: {
          mode: 'catchup',
        },
      },
    });

    expect(shouldResolveProviderBlockingErrorAfterPlaybackError(liveSession, {
      fatal: false,
    }, {
      hasRenderableFrame: true,
    })).toBe(false);
    expect(shouldResolveProviderBlockingErrorAfterPlaybackError(liveSession, {
      fatal: false,
    }, {
      hasRenderableFrame: false,
    })).toBe(true);
    expect(shouldResolveProviderBlockingErrorAfterPlaybackError(liveSession, {
      fatal: true,
    }, {
      hasRenderableFrame: true,
    })).toBe(false);
    expect(shouldResolveProviderBlockingErrorAfterPlaybackError(liveSession, {
      fatal: true,
    }, {
      hasRenderableFrame: false,
    })).toBe(true);
    expect(shouldResolveProviderBlockingErrorAfterPlaybackError(catchUpSession, {
      fatal: false,
    }, {
      hasRenderableFrame: true,
    })).toBe(true);
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

  it('uses catch-up startup watchdog for active catch-up sources', () => {
    const catchUpPlaying = buildSession({
      playback: 'playing',
      source: {
        url: 'https://example.com/archive.m3u8',
        type: 'hls',
        title: 'Archive',
        channelId: 'live-1',
        metadata: {
          mode: 'catchup',
        },
      },
    });
    const catchUpPaused = buildSession({
      ...catchUpPlaying,
      playback: 'paused',
    });
    const livePlaying = buildSession({
      playback: 'playing',
      source: {
        url: 'https://example.com/live.m3u8',
        type: 'hls',
        title: 'Live',
        channelId: 'live-1',
        metadata: {
          mode: 'live',
        },
      },
    });

    expect(shouldUseCatchUpStartupWatchdog(catchUpPlaying)).toBe(true);
    expect(shouldUseCatchUpStartupWatchdog(catchUpPaused)).toBe(true);
    expect(shouldUseCatchUpStartupWatchdog(livePlaying)).toBe(false);
  });

  it('requires current media data before treating stale video dimensions as a rendered frame', () => {
    expect(hasRenderableMediaFrame({ readyState: 1, videoWidth: 1920 })).toBe(false);
    expect(hasRenderableMediaFrame({ readyState: 2, videoWidth: 0 })).toBe(false);
    expect(hasRenderableMediaFrame({ readyState: 2, videoWidth: 1920 })).toBe(true);
  });

  it('maps shifted catch-up media time back onto the full programme timeline', () => {
    const session = buildSession({
      source: {
        url: 'http://127.0.0.1:8788/xui-api/https%3A%2F%2Fgw.castcdn.net%2Fstreaming%2Ftimeshift.php',
        type: 'hls',
        title: 'N1 - Pregled dana',
        metadata: {
          mode: 'catchup',
          channelId: 'n1-rs',
          streamId: 109,
          programId: 'program-n1',
          startTimestamp: 1_779_909_600,
          durationSeconds: 3_000,
          fallbackStreamIds: [],
          catchUpMediaOffsetSeconds: '960',
        },
      },
      positionMs: 1_049_180,
    });

    expect(resolveCatchUpMediaOffsetSeconds(session.source)).toBe(960);
    expect(resolveCatchUpTimelinePositionMs(72.06, 960)).toBe(1_032_060);
    expect(resolveCatchUpMediaSeekTimeSeconds(1_049_180, 960, 75)).toBeCloseTo(89.18, 2);
    expect(resolveCatchUpTimelineSeekTargetMs(1_049_180, 960, 75)).toBe(1_049_180);
  });

  it('keeps shifted catch-up seeks inside the loaded media window when the target is before preroll', () => {
    expect(resolveCatchUpMediaSeekTimeSeconds(980_000, 960, 75)).toBe(75);
    expect(resolveCatchUpTimelineSeekTargetMs(980_000, 960, 75)).toBe(1_035_000);
  });

  it('resolves pending shifted catch-up startup seek metadata to media and timeline positions', () => {
    const session = buildSession({
      source: {
        url: 'http://127.0.0.1:8788/xui-api/https%3A%2F%2Fgw.castcdn.net%2Fstreaming%2Ftimeshift.php',
        type: 'hls',
        title: 'N1 - Pregled dana',
        metadata: {
          mode: 'catchup',
          channelId: 'n1-rs',
          streamId: 399,
          programId: 'program-n1',
          startTimestamp: 1_779_909_600,
          durationSeconds: 3_000,
          fallbackStreamIds: [],
          catchUpMediaOffsetSeconds: 1020,
          catchUpPendingTimelineSeekMs: 1_049_180,
        },
      },
      positionMs: 1_035_000,
    });

    const pendingSeek = resolveCatchUpPendingStartupSeek(session.source, {
      fallbackTimelinePositionMs: session.positionMs,
      minimumMediaPositionSeconds: 15,
    });

    expect(pendingSeek?.timelinePositionMs).toBe(1_049_180);
    expect(pendingSeek?.mediaPositionSeconds).toBeCloseTo(29.18, 2);
  });

  it('anchors provider safe-start media time back to zero on the catch-up timeline', () => {
    const session = buildSession({
      source: {
        url: 'http://127.0.0.1:8788/xui-api/https%3A%2F%2Fgw.castcdn.net%2Fstreaming%2Ftimeshift.php',
        type: 'hls',
        title: 'RTS 1 - Dnevnik 1',
        metadata: {
          mode: 'catchup',
          channelId: 'rts-1',
          streamId: 112,
          programId: 'program-rts-dnevnik',
          startTimestamp: 1_780_484_400,
          durationSeconds: 3_420,
          catchUpHlsStartPositionSeconds: 75,
          catchUpPendingTimelineSeekMs: 0,
          catchUpPendingMediaSeekSeconds: 75,
        },
      },
      positionMs: 0,
    });

    const pendingSeek = resolveCatchUpPendingStartupSeek(session.source, {
      fallbackTimelinePositionMs: session.positionMs,
      minimumMediaPositionSeconds: 75,
    });

    expect(pendingSeek).toEqual({
      timelinePositionMs: 0,
      mediaPositionSeconds: 75,
    });
    expect(resolveCatchUpTimelinePositionMsForSource(session.source, 75)).toBe(0);
    expect(resolveCatchUpTimelinePositionMsForSource(session.source, 76.25)).toBe(1_250);
    expect(resolveCatchUpMediaSeekTimeSecondsForSource(session.source, 10_000, 75)).toBe(85);
    expect(resolveCatchUpTimelineSeekTargetMsForSource(session.source, 0, 75)).toBe(0);
  });

  it('anchors implicit startup retry media time back to zero on the catch-up timeline', () => {
    const source = {
      url: 'http://127.0.0.1:8788/xui-api/https%3A%2F%2Fgw.castcdn.net%2Fstreaming%2Ftimeshift.php',
      type: 'hls' as const,
      title: 'RTS 1 - Dnevnik 1',
      metadata: {
        mode: 'catchup',
        channelId: 'rts-1',
        streamId: 112,
        programId: 'program-rts-dnevnik',
        startTimestamp: 1_780_484_400,
        durationSeconds: 3_420,
        catchUpHlsStartPositionSeconds: 15,
        catchUpInitialSegmentRetryUsed: true,
      },
    };

    expect(resolveCatchUpTimelinePositionMsForSource(source, 15)).toBe(0);
    expect(resolveCatchUpTimelinePositionMsForSource(source, 16.5)).toBe(1_500);
    expect(resolveCatchUpMediaSeekTimeSecondsForSource(source, 0, 15)).toBe(15);
    expect(resolveCatchUpTimelineSeekTargetMsForSource(source, 0, 15)).toBe(0);
  });

  it('keeps fallback position clamps in shifted catch-up timeline coordinates', () => {
    expect(resolveCatchUpFallbackTimelinePositionMs({
      requestedPositionMs: 1_386_000,
      mediaOffsetSeconds: 1_210,
      mediaDurationSeconds: 611,
      positionGuardMs: 30_000,
    })).toBe(1_386_000);
  });

  it('keeps the existing startup guard for unshifted catch-up fallback positions', () => {
    expect(resolveCatchUpFallbackTimelinePositionMs({
      requestedPositionMs: 5_000,
      mediaOffsetSeconds: 0,
      mediaDurationSeconds: 1_980,
      positionGuardMs: 30_000,
    })).toBe(30_000);
  });

  it('preserves zero timeline position while applying a media guard for unshifted fallback startup', () => {
    expect(resolveCatchUpFallbackPlaybackPosition({
      requestedPositionMs: 0,
      mediaOffsetSeconds: 0,
      mediaDurationSeconds: 1_980,
      positionGuardMs: 15_000,
      preserveRequestedTimelinePosition: true,
    })).toEqual({
      timelinePositionMs: 0,
      mediaPositionSeconds: 15,
    });
  });

  it('keeps guarded timeline position when fallback startup does not preserve the requested position', () => {
    expect(resolveCatchUpFallbackPlaybackPosition({
      requestedPositionMs: 0,
      mediaOffsetSeconds: 0,
      mediaDurationSeconds: 1_980,
      positionGuardMs: 15_000,
      preserveRequestedTimelinePosition: false,
    })).toEqual({
      timelinePositionMs: 15_000,
      mediaPositionSeconds: 15,
    });
  });

  it('keeps shifted fallback playback positions in provider timeline coordinates', () => {
    expect(resolveCatchUpFallbackPlaybackPosition({
      requestedPositionMs: 1_386_000,
      mediaOffsetSeconds: 1_210,
      mediaDurationSeconds: 611,
      positionGuardMs: 30_000,
      preserveRequestedTimelinePosition: true,
    })).toEqual({
      timelinePositionMs: 1_386_000,
      mediaPositionSeconds: 176,
    });
  });

  it('schedules startup hard retry only for live playback', () => {
    const liveSession = buildSession({
      playback: 'playing',
      source: {
        url: 'https://example.com/live.m3u8',
        type: 'hls',
        title: 'Live',
        metadata: {
          mode: 'live',
        },
      },
    });
    const catchUpSession = buildSession({
      playback: 'playing',
      source: {
        url: 'https://example.com/archive.m3u8',
        type: 'hls',
        title: 'Archive',
        metadata: {
          mode: 'catchup',
        },
      },
    });

    expect(shouldScheduleStartupHardRetry(liveSession)).toBe(true);
    expect(shouldScheduleStartupHardRetry(catchUpSession)).toBe(false);
  });

  it('retries live startup when time moves but no frame is renderable', () => {
    expect(shouldRetryLiveStartupWithoutFrame({
      currentTimeSeconds: 0,
      hasRenderableFrame: false,
    })).toBe(true);
    expect(shouldRetryLiveStartupWithoutFrame({
      currentTimeSeconds: 2.5,
      hasRenderableFrame: false,
    })).toBe(true);
    expect(shouldRetryLiveStartupWithoutFrame({
      currentTimeSeconds: 0,
      hasRenderableFrame: true,
    })).toBe(false);
  });

  it('retries an unexpected live stop before surfacing a reportable failure', () => {
    const liveSession = buildSession({
      playback: 'playing',
      source: {
        url: 'https://example.com/live.m3u8',
        type: 'hls',
        title: 'Live',
        metadata: {
          mode: 'live',
        },
      },
    });

    expect(resolveLiveUnexpectedStopDecision(liveSession, {
      manualPauseRequested: false,
      attemptedRetries: 0,
      maxRetries: 1,
    })).toBe('retry');
    expect(resolveLiveUnexpectedStopDecision(liveSession, {
      manualPauseRequested: false,
      attemptedRetries: 1,
      maxRetries: 1,
    })).toBe('block');
  });

  it('resumes a renderable live stop without source reload', () => {
    const liveSession = buildSession({
      playback: 'playing',
      source: {
        url: 'https://example.com/live.m3u8',
        type: 'hls',
        title: 'Live',
        metadata: {
          mode: 'live',
        },
      },
    });
    const catchUpSession = buildSession({
      playback: 'playing',
      source: {
        url: 'https://example.com/archive.m3u8',
        type: 'hls',
        title: 'Archive',
        metadata: {
          mode: 'catchup',
        },
      },
    });

    expect(shouldResumeRenderableLiveAfterUnexpectedStop(liveSession, {
      manualPauseRequested: false,
      hasRenderableFrame: true,
    })).toBe(true);
    expect(shouldResumeRenderableLiveAfterUnexpectedStop(liveSession, {
      manualPauseRequested: false,
      hasRenderableFrame: false,
    })).toBe(false);
    expect(shouldResumeRenderableLiveAfterUnexpectedStop(liveSession, {
      manualPauseRequested: true,
      hasRenderableFrame: true,
    })).toBe(false);
    expect(shouldResumeRenderableLiveAfterUnexpectedStop(catchUpSession, {
      manualPauseRequested: false,
      hasRenderableFrame: true,
    })).toBe(false);
  });

  it('does not recover manual, non-live, or non-playing stops as live failures', () => {
    const liveSession = buildSession({
      playback: 'playing',
      source: {
        url: 'https://example.com/live.m3u8',
        type: 'hls',
        title: 'Live',
        metadata: {
          mode: 'live',
        },
      },
    });
    const catchUpSession = buildSession({
      playback: 'playing',
      source: {
        url: 'https://example.com/archive.m3u8',
        type: 'hls',
        title: 'Archive',
        metadata: {
          mode: 'catchup',
        },
      },
    });

    expect(resolveLiveUnexpectedStopDecision(liveSession, {
      manualPauseRequested: true,
      attemptedRetries: 0,
      maxRetries: 1,
    })).toBe('sync-stop');
    expect(resolveLiveUnexpectedStopDecision(catchUpSession, {
      manualPauseRequested: false,
      attemptedRetries: 0,
      maxRetries: 1,
    })).toBe('sync-stop');
    expect(resolveLiveUnexpectedStopDecision(buildSession({
      playback: 'paused',
      source: liveSession.source,
    }), {
      manualPauseRequested: false,
      attemptedRetries: 0,
      maxRetries: 1,
    })).toBe('sync-stop');
  });

  it('does not run catch-up buffering retry before the first usable media signal', () => {
    const catchUpSession = buildSession({
      playback: 'buffering',
      positionMs: 75_000,
      source: {
        url: 'https://example.com/archive.m3u8',
        type: 'hls',
        title: 'Archive',
        metadata: {
          mode: 'catchup',
          catchUpHlsStartPositionSeconds: 75,
        },
      },
    });

    expect(shouldRetryCatchUpBufferingStall(catchUpSession, {
      currentTimeSeconds: 75,
      hasRenderableFrame: false,
    })).toBe(false);
    expect(shouldRetryCatchUpBufferingStall(catchUpSession, {
      currentTimeSeconds: 76.8,
      hasRenderableFrame: false,
    })).toBe(false);
    expect(shouldRetryCatchUpBufferingStall(catchUpSession, {
      currentTimeSeconds: 75,
      hasRenderableFrame: true,
    })).toBe(true);
  });

  it('falls back on catch-up decoder errors that otherwise leave playback without a frame', () => {
    const catchUpSession = buildSession({
      playback: 'playing',
      source: {
        url: 'https://example.com/archive.m3u8',
        type: 'hls',
        title: 'Archive',
        metadata: {
          mode: 'catchup',
        },
      },
    });
    const liveSession = buildSession({
      playback: 'playing',
      source: {
        url: 'https://example.com/live.m3u8',
        type: 'hls',
        title: 'Live',
        metadata: {
          mode: 'live',
        },
      },
    });

    expect(shouldAttemptCatchUpErrorFallback(catchUpSession, {
      code: 'MEDIA_ERROR',
      fatal: false,
    }, {
      hasRenderableFrame: false,
    })).toBe(true);
    expect(shouldAttemptCatchUpErrorFallback(catchUpSession, {
      code: 'MEDIA_ELEMENT_3',
      fatal: false,
    }, {
      hasRenderableFrame: true,
    })).toBe(false);
    expect(shouldAttemptCatchUpErrorFallback(catchUpSession, {
      code: 'MEDIA_ERROR',
      fatal: false,
    }, {
      hasRenderableFrame: true,
    })).toBe(false);
    expect(shouldAttemptCatchUpErrorFallback(liveSession, {
      code: 'MEDIA_ERROR',
      fatal: false,
    }, {
      hasRenderableFrame: false,
    })).toBe(false);
  });

  it('keeps catch-up media warnings recoverable while surfacing hard decoder failures only before a frame', () => {
    const catchUpSession = buildSession({
      playback: 'playing',
      source: {
        url: 'https://example.com/archive.m3u8',
        type: 'hls',
        title: 'Archive',
        metadata: {
          mode: 'catchup',
        },
      },
    });

    expect(shouldResolveCatchUpRuntimeUnavailableAfterPlaybackError(catchUpSession, {
      code: 'MEDIA_ERROR',
      fatal: false,
    }, {
      hasRenderableFrame: false,
    })).toBe(false);
    expect(shouldResolveCatchUpRuntimeUnavailableAfterPlaybackError(catchUpSession, {
      code: 'MEDIA_ELEMENT_3',
      fatal: false,
    }, {
      hasRenderableFrame: true,
    })).toBe(false);
    expect(shouldResolveCatchUpRuntimeUnavailableAfterPlaybackError(catchUpSession, {
      code: 'MEDIA_ELEMENT_3',
      fatal: false,
    }, {
      hasRenderableFrame: false,
    })).toBe(true);
    expect(shouldResolveCatchUpRuntimeUnavailableAfterPlaybackError(catchUpSession, {
      code: 'MEDIA_ERROR',
      fatal: true,
    }, {
      hasRenderableFrame: true,
    })).toBe(false);
    expect(shouldResolveCatchUpRuntimeUnavailableAfterPlaybackError(catchUpSession, {
      code: 'MEDIA_ERROR',
      fatal: true,
    }, {
      hasRenderableFrame: false,
    })).toBe(true);
    expect(shouldResolveCatchUpRuntimeUnavailableAfterPlaybackError(catchUpSession, {
      code: 'MEDIA_ERROR',
      fatal: false,
    }, {
      hasRenderableFrame: true,
    })).toBe(false);
    expect(shouldResolveCatchUpRuntimeUnavailableAfterPlaybackError(catchUpSession, {
      code: 'PLAYBACK_START_FAILED',
      fatal: false,
    }, {
      hasRenderableFrame: false,
    })).toBe(false);
  });

  it('defers live startup playback errors before the first renderable frame', () => {
    const liveSession = buildSession({
      playback: 'playing',
      source: {
        url: 'https://example.com/live.m3u8',
        type: 'hls',
        title: 'Live',
        metadata: {
          mode: 'live',
        },
      },
    });
    const catchUpSession = buildSession({
      playback: 'playing',
      source: {
        url: 'https://example.com/archive.m3u8',
        type: 'hls',
        title: 'Archive',
        metadata: {
          mode: 'catchup',
        },
      },
    });

    expect(shouldDeferLiveStartupPlaybackError(liveSession, {
      code: 'MEDIA_ERROR',
      fatal: true,
    }, {
      hasRenderableFrame: false,
    }, {
      sourceHasStarted: false,
    })).toBe(true);
    expect(shouldDeferLiveStartupPlaybackError(liveSession, {
      code: 'LOAD_FAILED',
      fatal: true,
    }, {
      hasRenderableFrame: false,
    }, {
      sourceHasStarted: false,
    })).toBe(true);
    expect(shouldDeferLiveStartupPlaybackError(liveSession, {
      code: 'MEDIA_ERROR',
      fatal: true,
    }, {
      hasRenderableFrame: true,
    }, {
      sourceHasStarted: false,
    })).toBe(false);
    expect(shouldDeferLiveStartupPlaybackError(liveSession, {
      code: 'MEDIA_ERROR',
      fatal: true,
    }, {
      hasRenderableFrame: false,
    }, {
      sourceHasStarted: true,
    })).toBe(false);
    expect(shouldDeferLiveStartupPlaybackError({
      ...liveSession,
      playback: 'paused',
    }, {
      code: 'MEDIA_ERROR',
      fatal: true,
    }, {
      hasRenderableFrame: false,
    }, {
      sourceHasStarted: false,
    })).toBe(false);
    expect(shouldDeferLiveStartupPlaybackError(liveSession, {
      code: 'MEDIA_ERROR',
      fatal: false,
    }, {
      hasRenderableFrame: false,
    }, {
      sourceHasStarted: false,
    })).toBe(false);
    expect(shouldDeferLiveStartupPlaybackError(catchUpSession, {
      code: 'MEDIA_ERROR',
      fatal: true,
    }, {
      hasRenderableFrame: false,
    }, {
      sourceHasStarted: false,
    })).toBe(false);
  });

  it('defers catch-up startup playback errors before the first renderable frame', () => {
    const catchUpSession = buildSession({
      playback: 'playing',
      source: {
        url: 'https://example.com/archive.m3u8',
        type: 'hls',
        title: 'Archive',
        metadata: {
          mode: 'catchup',
        },
      },
    });
    const liveSession = buildSession({
      playback: 'playing',
      source: {
        url: 'https://example.com/live.m3u8',
        type: 'hls',
        title: 'Live',
        metadata: {
          mode: 'live',
        },
      },
    });

    expect(shouldDeferCatchUpStartupPlaybackError(catchUpSession, {
      code: 'MEDIA_ERROR',
      fatal: true,
    }, {
      hasRenderableFrame: false,
    }, {
      sourceHasStarted: false,
    })).toBe(true);
    expect(shouldDeferCatchUpStartupPlaybackError(catchUpSession, {
      code: 'LOAD_FAILED',
      fatal: true,
    }, {
      hasRenderableFrame: false,
    }, {
      sourceHasStarted: false,
    })).toBe(true);
    expect(shouldDeferCatchUpStartupPlaybackError(catchUpSession, {
      code: 'PLAYBACK_START_FAILED',
      fatal: false,
    }, {
      hasRenderableFrame: false,
    }, {
      sourceHasStarted: false,
    })).toBe(true);
    expect(shouldDeferCatchUpStartupPlaybackError(catchUpSession, {
      code: 'MEDIA_ERROR',
      fatal: true,
    }, {
      hasRenderableFrame: true,
    }, {
      sourceHasStarted: false,
    })).toBe(false);
    expect(shouldDeferCatchUpStartupPlaybackError(catchUpSession, {
      code: 'MEDIA_ERROR',
      fatal: true,
    }, {
      hasRenderableFrame: false,
    }, {
      sourceHasStarted: true,
    })).toBe(false);
    expect(shouldDeferCatchUpStartupPlaybackError({
      ...catchUpSession,
      playback: 'paused',
    }, {
      code: 'MEDIA_ERROR',
      fatal: true,
    }, {
      hasRenderableFrame: false,
    }, {
      sourceHasStarted: false,
    })).toBe(false);
    expect(shouldDeferCatchUpStartupPlaybackError(liveSession, {
      code: 'MEDIA_ERROR',
      fatal: true,
    }, {
      hasRenderableFrame: false,
    }, {
      sourceHasStarted: false,
    })).toBe(false);
    expect(shouldDeferCatchUpStartupPlaybackError(catchUpSession, {
      code: 'HLS_NOT_SUPPORTED',
      fatal: true,
    }, {
      hasRenderableFrame: false,
    }, {
      sourceHasStarted: false,
    })).toBe(false);
  });

  it('reports catch-up loading progress from confirmed media milestones', () => {
    expect(resolveCatchUpLoadingProgressPercent({ phase: 'requesting' })).toBe(16);
    expect(resolveCatchUpLoadingProgressPercent({ phase: 'playlist' })).toBe(36);
    expect(resolveCatchUpLoadingProgressPercent({ phase: 'segment' })).toBe(58);
    expect(resolveCatchUpLoadingProgressPercent({
      phase: 'segment',
      bufferedAheadSeconds: 5,
    })).toBe(82);
    expect(resolveCatchUpLoadingProgressPercent({
      phase: 'buffered',
      bufferedAheadSeconds: 20,
    })).toBe(90);
    expect(resolveCatchUpLoadingProgressPercent({
      phase: 'frame',
      hasRenderableFrame: true,
    })).toBe(96);
  });

  it('retries a post-start catch-up seek when the target loses renderable video', () => {
    const catchUpSession = buildSession({
      playback: 'playing',
      positionMs: 4_410_000,
      source: {
        url: 'https://example.com/archive.m3u8',
        type: 'hls',
        title: 'Archive',
        metadata: {
          mode: 'catchup',
          durationSeconds: 6300,
        },
      },
    });

    expect(resolveCatchUpSeekNoFrameDecision(catchUpSession, {
      currentTimeSeconds: 75,
      hasRenderableFrame: false,
    }, {
      targetPositionMs: 4_410_000,
      attemptedRetries: 0,
      maxRetries: 1,
    })).toBe('retry');
  });

  it('blocks a post-start catch-up seek after the no-frame retry budget is exhausted', () => {
    const catchUpSession = buildSession({
      playback: 'playing',
      positionMs: 4_410_000,
      source: {
        url: 'https://example.com/archive.m3u8',
        type: 'hls',
        title: 'Archive',
        metadata: {
          mode: 'catchup',
          durationSeconds: 6300,
        },
      },
    });

    expect(resolveCatchUpSeekNoFrameDecision(catchUpSession, {
      currentTimeSeconds: 75,
      hasRenderableFrame: false,
    }, {
      targetPositionMs: 4_410_000,
      attemptedRetries: 1,
      maxRetries: 1,
    })).toBe('block');
  });

  it('falls back to the last renderable catch-up position after an unrecoverable seek', () => {
    expect(resolveCatchUpSeekRecoveryFallbackPositionMs({
      targetPositionMs: 1_500_000,
      lastRenderablePositionMs: 29_200,
      toleranceMs: 2_000,
    })).toBe(29_200);
  });

  it('does not fall back when there is no distinct renderable catch-up position', () => {
    expect(resolveCatchUpSeekRecoveryFallbackPositionMs({
      targetPositionMs: 1_500_000,
      lastRenderablePositionMs: null,
    })).toBeNull();
    expect(resolveCatchUpSeekRecoveryFallbackPositionMs({
      targetPositionMs: 1_500_000,
      lastRenderablePositionMs: 1_499_250,
      toleranceMs: 2_000,
    })).toBeNull();
  });

  it('does not treat target currentTime as recovered until a frame is renderable', () => {
    const catchUpSession = buildSession({
      playback: 'playing',
      positionMs: 4_410_000,
      source: {
        url: 'https://example.com/archive.m3u8',
        type: 'hls',
        title: 'Archive',
        metadata: {
          mode: 'catchup',
          durationSeconds: 6300,
        },
      },
    });

    expect(resolveCatchUpSeekNoFrameDecision(catchUpSession, {
      currentTimeSeconds: 4_410,
      hasRenderableFrame: false,
    }, {
      targetPositionMs: 4_410_000,
      attemptedRetries: 0,
      maxRetries: 1,
    })).toBe('retry');
    expect(resolveCatchUpSeekNoFrameDecision(catchUpSession, {
      currentTimeSeconds: 4_410,
      hasRenderableFrame: false,
    }, {
      targetPositionMs: 4_410_000,
      attemptedRetries: 1,
      maxRetries: 1,
    })).toBe('block');
  });

  it('retries a post-start catch-up seek when playback keeps rendering the old position', () => {
    const catchUpSession = buildSession({
      playback: 'playing',
      positionMs: 2_205_000,
      source: {
        url: 'https://example.com/archive.m3u8',
        type: 'hls',
        title: 'Archive',
        metadata: {
          mode: 'catchup',
          durationSeconds: 6300,
        },
      },
    });

    expect(resolveCatchUpSeekNoFrameDecision(catchUpSession, {
      currentTimeSeconds: 90,
      hasRenderableFrame: true,
    }, {
      targetPositionMs: 2_205_000,
      attemptedRetries: 0,
      maxRetries: 1,
    })).toBe('retry');
  });

  it('re-arms catch-up seek recovery after non-fatal media errors while no target frame is renderable', () => {
    const catchUpSession = buildSession({
      playback: 'playing',
      positionMs: 2_205_000,
      source: {
        url: 'https://example.com/archive.m3u8',
        type: 'hls',
        title: 'Archive',
        metadata: {
          mode: 'catchup',
        },
      },
    });

    expect(shouldWatchCatchUpSeekAfterPlaybackError(catchUpSession, {
      fatal: false,
      hasRenderableFrame: false,
      targetPositionMs: 2_205_000,
    })).toBe(true);
    expect(shouldWatchCatchUpSeekAfterPlaybackError(catchUpSession, {
      fatal: true,
      hasRenderableFrame: false,
      targetPositionMs: 2_205_000,
    })).toBe(false);
    expect(shouldWatchCatchUpSeekAfterPlaybackError(catchUpSession, {
      fatal: false,
      hasRenderableFrame: true,
      targetPositionMs: 2_205_000,
    })).toBe(false);
  });

  it('keeps watching post-start catch-up seeks even when rapid clicks lose the current frame', () => {
    const catchUpSession = buildSession({
      playback: 'playing',
      positionMs: 2_772_000,
      source: {
        url: 'https://example.com/archive.m3u8',
        type: 'hls',
        title: 'Archive',
        metadata: {
          mode: 'catchup',
        },
      },
    });

    expect(shouldWatchCatchUpSeekAfterPositionChange(catchUpSession, {
      playbackWantsPlaying: true,
      hasRenderableFrame: false,
      retryCount: 0,
      sourceHasStarted: true,
    })).toBe(true);
    expect(shouldWatchCatchUpSeekAfterPositionChange(catchUpSession, {
      playbackWantsPlaying: true,
      hasRenderableFrame: false,
      retryCount: 0,
      sourceHasStarted: false,
    })).toBe(false);
    expect(shouldWatchCatchUpSeekAfterPositionChange(catchUpSession, {
      playbackWantsPlaying: false,
      hasRenderableFrame: true,
      retryCount: 1,
      sourceHasStarted: true,
    })).toBe(false);
  });

  it('keeps waiting on catch-up seek recovery while the media has a usable frame', () => {
    const catchUpSession = buildSession({
      playback: 'playing',
      positionMs: 4_410_000,
      source: {
        url: 'https://example.com/archive.m3u8',
        type: 'hls',
        title: 'Archive',
        metadata: {
          mode: 'catchup',
        },
      },
    });

    expect(resolveCatchUpSeekNoFrameDecision(catchUpSession, {
      currentTimeSeconds: 4_410,
      hasRenderableFrame: true,
    }, {
      targetPositionMs: 4_410_000,
      attemptedRetries: 0,
      maxRetries: 1,
    })).toBe('wait');
    expect(resolveCatchUpSeekNoFrameDecision(buildSession({
      playback: 'playing',
      source: {
        url: 'https://example.com/live.m3u8',
        type: 'hls',
        title: 'Live',
        metadata: {
          mode: 'live',
        },
      },
    }), {
      currentTimeSeconds: 75,
      hasRenderableFrame: false,
    }, {
      targetPositionMs: 4_410_000,
      attemptedRetries: 0,
      maxRetries: 1,
    })).toBe('wait');
  });

  it('limits catch-up startup fallback attempts before the source ever starts', () => {
    const catchUpSession = buildSession({
      playback: 'buffering',
      source: {
        url: 'https://example.com/archive.m3u8',
        type: 'hls',
        title: 'Archive',
        metadata: {
          mode: 'catchup',
        },
      },
    });

    expect(shouldContinueCatchUpStartupFallbacks(catchUpSession, null, 0, 1)).toBe(true);
    expect(shouldContinueCatchUpStartupFallbacks(catchUpSession, null, 1, 1)).toBe(false);
    expect(shouldContinueCatchUpStartupFallbacks(
      catchUpSession,
      'https://example.com/archive.m3u8',
      3,
      1,
    )).toBe(true);
    expect(shouldContinueCatchUpStartupFallbacks(
      buildSession({
        playback: 'buffering',
        source: {
          url: 'https://example.com/live.m3u8',
          type: 'hls',
          title: 'Live',
          metadata: {
            mode: 'live',
          },
        },
      }),
      null,
      3,
      1,
    )).toBe(true);
  });

  it('lets the catch-up startup watchdog finish for the watched catch-up source', () => {
    const catchUpPaused = buildSession({
      playback: 'paused',
      source: {
        url: 'https://example.com/archive.m3u8',
        type: 'hls',
        title: 'Archive',
        metadata: {
          mode: 'catchup',
        },
      },
    });

    expect(shouldResolveCatchUpStartupWatchdog(
      catchUpPaused,
      'https://example.com/archive.m3u8',
    )).toBe(true);
    expect(shouldResolveCatchUpStartupWatchdog(
      catchUpPaused,
      'https://example.com/archive.m3u8',
    )).toBe(true);
    expect(shouldResolveCatchUpStartupWatchdog(
      catchUpPaused,
      'https://example.com/other.m3u8',
    )).toBe(false);
  });

  it('retries a catch-up startup without provider safe-start when the safe-start attempt gets no frame', () => {
    const safeStartSession = buildSession({
      playback: 'playing',
      source: {
        url: 'https://example.com/archive.m3u8',
        type: 'hls',
        title: 'Archive',
        metadata: {
          mode: 'catchup',
          catchUpHlsStartPositionSeconds: 75,
          catchUpHlsStartupMode: 'progressive',
        },
      },
    });

    expect(shouldRetryCatchUpStartupWithoutSafeStart(
      safeStartSession,
      'STARTUP_TIMEOUT',
      { hasRenderableFrame: false },
      15,
    )).toBe(true);
    expect(shouldRetryCatchUpStartupWithoutSafeStart(
      safeStartSession,
      'MEDIA_ERROR',
      { hasRenderableFrame: false },
      15,
    )).toBe(false);
    expect(shouldRetryCatchUpStartupWithoutSafeStart(
      safeStartSession,
      'STARTUP_TIMEOUT',
      { hasRenderableFrame: true },
      15,
    )).toBe(false);
    expect(shouldRetryCatchUpStartupWithoutSafeStart(
      buildSession({
        ...safeStartSession,
        source: {
          ...safeStartSession.source!,
          metadata: {
            ...safeStartSession.source!.metadata,
            catchUpInitialSegmentRetryUsed: true,
          },
        },
      }),
      'STARTUP_TIMEOUT',
      { hasRenderableFrame: false },
      15,
    )).toBe(false);
    expect(shouldRetryCatchUpStartupWithoutSafeStart(
      buildSession({
        ...safeStartSession,
        source: {
          ...safeStartSession.source!,
          metadata: {
            ...safeStartSession.source!.metadata,
            catchUpHlsStartPositionSeconds: 15,
          },
        },
      }),
      'STARTUP_TIMEOUT',
      { hasRenderableFrame: false },
      15,
    )).toBe(false);
  });

  it('retries a catch-up startup with provider safe-start only after the first source gets no frame', () => {
    const firstAttemptSession = buildSession({
      playback: 'playing',
      source: {
        url: 'https://example.com/archive.m3u8',
        type: 'hls',
        title: 'Archive',
        metadata: {
          mode: 'catchup',
          catchUpHlsStartPositionSeconds: 0,
          catchUpProviderSafeStartPositionSeconds: 75,
        },
      },
    });

    expect(shouldRetryCatchUpStartupWithProviderSafeStart(
      firstAttemptSession,
      'STARTUP_TIMEOUT',
      { hasRenderableFrame: false },
      75,
    )).toBe(true);
    expect(shouldRetryCatchUpStartupWithProviderSafeStart(
      firstAttemptSession,
      'MEDIA_ERROR',
      { hasRenderableFrame: false },
      75,
    )).toBe(false);
    expect(shouldRetryCatchUpStartupWithProviderSafeStart(
      firstAttemptSession,
      'STARTUP_TIMEOUT',
      { hasRenderableFrame: true },
      75,
    )).toBe(false);
    expect(shouldRetryCatchUpStartupWithProviderSafeStart(
      buildSession({
        ...firstAttemptSession,
        source: {
          ...firstAttemptSession.source!,
          metadata: {
            ...firstAttemptSession.source!.metadata,
            catchUpProviderSafeStartRetryUsed: true,
          },
        },
      }),
      'STARTUP_TIMEOUT',
      { hasRenderableFrame: false },
      75,
    )).toBe(false);
  });

  it('stops long catch-up startup loading only when no video frame is renderable', () => {
    const catchUpSession = buildSession({
      playback: 'playing',
      source: {
        url: 'https://example.com/archive.m3u8',
        type: 'hls',
        title: 'Archive',
        metadata: {
          mode: 'catchup',
        },
      },
    });
    const liveSession = buildSession({
      playback: 'playing',
      source: {
        url: 'https://example.com/live.m3u8',
        type: 'hls',
        title: 'Live',
        metadata: {
          mode: 'live',
        },
      },
    });

    expect(shouldStopLongCatchUpStartupLoading(
      catchUpSession,
      { hasRenderableFrame: false },
      60_000,
      60_000,
    )).toBe(true);
    expect(shouldStopLongCatchUpStartupLoading(
      catchUpSession,
      { hasRenderableFrame: false },
      59_999,
      60_000,
    )).toBe(false);
    expect(shouldStopLongCatchUpStartupLoading(
      catchUpSession,
      { hasRenderableFrame: true },
      60_000,
      60_000,
    )).toBe(false);
    expect(shouldStopLongCatchUpStartupLoading(
      liveSession,
      { hasRenderableFrame: false },
      60_000,
      60_000,
    )).toBe(false);
  });

  it('shows catch-up unavailable after a manifest no-frame retry already happened', () => {
    const catchUpSession = buildSession({
      playback: 'playing',
      source: {
        url: 'https://example.com/archive.m3u8',
        type: 'hls',
        title: 'Archive',
        metadata: {
          mode: 'catchup',
        },
      },
    });

    expect(shouldShowCatchUpManifestNoFrameUnavailable(catchUpSession, 0, 0)).toBe(false);
    expect(shouldShowCatchUpManifestNoFrameUnavailable(catchUpSession, 1, 0)).toBe(true);
    expect(shouldShowCatchUpManifestNoFrameUnavailable(catchUpSession, 0, 1)).toBe(true);
    expect(shouldShowCatchUpManifestNoFrameUnavailable(
      buildSession({
        playback: 'playing',
        source: {
          url: 'https://example.com/live.m3u8',
          type: 'hls',
          title: 'Live',
          metadata: {
            mode: 'live',
          },
        },
      }),
      1,
      1,
    )).toBe(false);
  });

  it('uses a longer manifest no-frame watchdog after a catch-up startup recovery was already attempted', () => {
    const catchUpSession = buildSession({
      playback: 'playing',
      source: {
        url: 'https://example.com/archive.m3u8',
        type: 'hls',
        title: 'Archive',
        metadata: {
          mode: 'catchup',
        },
      },
    });

    expect(resolveCatchUpManifestNoFrameWatchdogDelayMs(
      catchUpSession,
      0,
      0,
      8_000,
      24_000,
    )).toBe(8_000);
    expect(resolveCatchUpManifestNoFrameWatchdogDelayMs(
      catchUpSession,
      1,
      0,
      8_000,
      24_000,
    )).toBe(24_000);
    expect(resolveCatchUpManifestNoFrameWatchdogDelayMs(
      catchUpSession,
      0,
      1,
      8_000,
      24_000,
    )).toBe(24_000);
  });

});
