import { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { BRAND_SHORT } from '@/config/brand';
import { AlertCircle, Loader2, Radio, WifiOff, ShieldAlert } from 'lucide-react';
import { CodecNotice } from './CodecNotice';
import type { SessionSource } from '@lumen/session-core';
import { Button } from '@/components/ui/button';
import { useSessionContext } from '@/context/session-context';
import {
  BackgroundPlaybackResumeError,
  HlsPlayerAdapter,
} from '@/adapters/HlsPlayerAdapter';
import type { PlaybackError } from '@lumen/types';
import type { AudioTrackOption } from '@lumen/types';
import type { SubtitleTrackOption } from '@lumen/types';
import { emitWebObservabilityEvent } from '@/services/observability';
import {
  isCatchUpFallbackStrategy,
  isCatchUpTransportAttempt,
  rememberCatchUpHostAffinity,
  resolveCatchUpFallbackAttemptUrl,
  resolveCatchUpFinalHost,
  resolveCatchUpHostAffinity,
  resolveCatchUpTargetOrigin,
  type CatchUpTransportAttempt,
} from './catchupTransport';
import { catchUpFirstSegmentLikelyInFlight } from './catchUpSegmentInFlight';
import {
  shouldKeepPendingAutoplayOnIdle,
  shouldClearPendingAutoplayOnPlaybackError,
  isAutoplayBlockedError,
  shouldSkipPlayForBlockedAutoplay,
  sessionWantsPlayback,
  shouldPreservePlaybackIntentDuringBackgroundPause,
  shouldRecoverPlaybackAfterForeground,
  shouldDeferPlaybackFailureWhileBackgrounded,
  shouldResumeForegroundRecoveryOnIdle,
  shouldResolveProviderBlockingErrorAfterPlaybackError,
  shouldHoldPauseSyncOnSourceStartup,
  shouldRetryPendingAutoplayAfterPausedEvent,
  shouldShowPlaybackErrorAfterPlaybackError,
  shouldResumePlaybackAfterPictureInPictureExit,
  shouldContinueCatchUpStartupFallbacks,
  hasRenderableMediaFrame,
  resolveCatchUpLoadingProgressPercent,
  shouldResolveCatchUpStartupWatchdog,
  shouldRetryCatchUpStartupWithoutSafeStart,
  shouldRetryCatchUpStartupWithProviderSafeStart,
  shouldStopLongCatchUpStartupLoading,
  resolveCatchUpManifestNoFrameWatchdogDelayMs,
  shouldScheduleStartupHardRetry,
  shouldShowCatchUpManifestNoFrameUnavailable,
  shouldUseCatchUpStartupWatchdog,
  resolveCatchUpMediaOffsetSeconds,
  resolveCatchUpMediaSeekTimeSeconds,
  resolveCatchUpMediaSeekTimeSecondsForSource,
  resolveCatchUpPendingStartupSeek,
  resolveCatchUpSeekWatchdogDelayMs,
  resolveCatchUpSeekNoFrameDecision,
  resolveCatchUpSeekRecoveryFallbackPositionMs,
  resolveCatchUpFallbackPlaybackPosition,
  resolveCatchUpTimelinePositionMsForSource,
  resolveCatchUpTimelineSeekTargetMsForSource,
  resolvePlaybackFailureTelemetry,
  resolveLiveUnexpectedStopDecision,
  shouldAttemptCatchUpErrorFallback,
  shouldResumeRenderableLiveAfterUnexpectedStop,
  shouldDeferLiveStartupPlaybackError,
  shouldDeferCatchUpStartupPlaybackError,
  shouldResolveCatchUpRuntimeUnavailableAfterPlaybackError,
  shouldWatchCatchUpSeekAfterPlaybackError,
  shouldWatchCatchUpSeekAfterPositionChange,
  type CatchUpLoadingPhase,
} from './videoPlaybackSync';
import {
  resolveCatchUpStartupUnavailableError,
  resolveSessionSourceBlockingError,
  type SourceBlockingError,
} from './sourceBlockingError';
import {
  getCachedCatchUpRuntimeCompatibility,
  recordCatchUpRuntimeCompatibilityResult,
  resolveCatchUpRuntimeCompatibilityBlockingError,
  resolveCatchUpRuntimeCompatibilityFingerprint,
  type CatchUpRuntimeCompatibilityReasonCode,
  type CatchUpRuntimeCompatibilityStatus,
} from './catchupRuntimeCompatibility';
import { recordCatchUpClientRebaseFailure } from './catchupClientRebaseCompat';
import {
  buildPlayerErrorState,
  resolvePlayerErrorActionSource,
  type PlayerErrorState,
} from './playerErrorState';

export interface VideoPlayerProps {
  poster?: string;
  autoPlay?: boolean;
  preferNativeHls?: boolean;
  loadingOverlayMaxMs?: number;
  onError?: (error: string) => void;
  onEnded?: () => void;
  onCanPlay?: () => void;
  onSourceBlockingPrimaryAction?: (source: SessionSource) => void;
  onReportPlaybackProblem?: (source: SessionSource, error: PlayerError) => void;
  onBackgroundRecoverySourceReloadFailed?: (source: SessionSource) => void;
  className?: string;
}

export interface VideoPlayerHandle {
  play: () => void;
  pause: () => void;
  stop: () => void;
  seek: (time: number) => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  toggleMute: () => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  hasRenderableFrame: () => boolean;
  isPlaying: () => boolean;
  getAudioTracks: () => AudioTrackOption[];
  getSelectedAudioTrackId: () => string | null;
  setAudioTrack: (trackId: string) => boolean;
  onAudioTracksChange: (
    callback: (tracks: AudioTrackOption[], selectedTrackId: string | null) => void
  ) => () => void;
  getSubtitleTracks: () => SubtitleTrackOption[];
  getSelectedSubtitleTrackId: () => string | null;
  setSubtitleTrack: (trackId: string | null) => boolean;
  onSubtitleTracksChange: (
    callback: (tracks: SubtitleTrackOption[], selectedTrackId: string | null) => void
  ) => () => void;
  isPictureInPictureSupported: () => boolean;
  isPictureInPicture: () => boolean;
  enterPictureInPicture: () => Promise<boolean>;
  exitPictureInPicture: () => Promise<boolean>;
  togglePictureInPicture: () => Promise<boolean>;
  onPictureInPictureChange: (callback: (isInPictureInPicture: boolean) => void) => () => void;
  isAirPlaySupported: () => boolean;
  isAirPlayAvailable: () => boolean;
  isAirPlayConnected: () => boolean;
  showAirPlayPicker: () => boolean;
  onAirPlayAvailabilityChange: (callback: (isAvailable: boolean) => void) => () => void;
  onAirPlayConnectionChange: (callback: (isConnected: boolean) => void) => () => void;
}

type PlayerError = SourceBlockingError;
type UnsupportedAudioCodec = 'mp2';
type UnsupportedVideoCodec = 'hevc';

let cachedHevcPlaybackSupport: boolean | null = null;

// Browsers that can decode HEVC (e.g. Safari/iOS) should not warn about it.
const isHevcPlaybackLikelySupported = (): boolean => {
  if (cachedHevcPlaybackSupport !== null) {
    return cachedHevcPlaybackSupport;
  }
  if (typeof document === 'undefined') {
    return false;
  }
  const probe = document.createElement('video');
  cachedHevcPlaybackSupport = [
    'video/mp4; codecs="hvc1.1.6.L123.B0"',
    'video/mp4; codecs="hev1.1.6.L123.B0"',
  ].some((type) => probe.canPlayType(type) !== '');
  return cachedHevcPlaybackSupport;
};

type WebKitPictureInPictureVideoElement = HTMLVideoElement & {
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  webkitSetPresentationMode?: (mode: string) => void;
  webkitPresentationMode?: string;
};

type AirPlayAvailability = 'available' | 'not-available' | string;

type WebKitAirPlayVideoElement = HTMLVideoElement & {
  webkitShowPlaybackTargetPicker?: () => void;
  webkitPlaybackTargetAvailability?: AirPlayAvailability;
  webkitCurrentPlaybackTargetIsWireless?: boolean;
};

interface LoadingProgressState {
  phase: CatchUpLoadingPhase;
  startedAtMs: number;
  updatedAtMs: number;
}

const STARTUP_AUTOPLAY_RECOVERY_MAX_RETRIES = 3;
const STARTUP_AUTOPLAY_RECOVERY_BASE_DELAY_MS = 220;
const CATCH_UP_STARTUP_AUTOPLAY_RECOVERY_MAX_RETRIES = 90;
const CATCH_UP_STARTUP_AUTOPLAY_RECOVERY_MAX_DELAY_MS = 2_000;
const LIVE_STARTUP_DETACHED_RETRY_DELAY_MS = 450;
const LIVE_UNEXPECTED_PAUSE_MAX_RETRIES = 1;
const STARTUP_HARD_RETRY_DELAY_MS = 3_000;
const CATCH_UP_STARTUP_WATCHDOG_DELAY_MS = 35_000;
// Raised from 8s: the CDN edge cache-miss on the first catch-up segment is
// measured at 3-6s, occasionally up to ~6.2s. At 8s the watchdog fired while
// that first segment was still legitimately downloading, reseeking on top of an
// in-flight load and re-fetching seg=0 in a loop. 12s + segment-in-flight
// awareness (see catchUpFirstSegmentLikelyInFlight) covers the slow first fetch.
const CATCH_UP_MANIFEST_NO_FRAME_FALLBACK_DELAY_MS = 12_000;
const CATCH_UP_MANIFEST_NO_FRAME_UNAVAILABLE_DELAY_MS = 24_000;
// How long after a fragment started loading we still consider it "in flight"
// and worth waiting for, rather than reseeking. Covers the slow first-segment
// fetch plus MP2->AAC remux before the first renderable frame appears.
const CATCH_UP_SEGMENT_IN_FLIGHT_GRACE_MS = 9_000;
const CATCH_UP_VISIBLE_LOADING_UNAVAILABLE_MS = 60_000;
const CATCH_UP_SEEK_WATCHDOG_DELAY_MS = 10_000;
// Rebase downloads and rewrites the complete minute file before hls.js can
// append it (`progressive:false`). Give a 45MB archive fragment time to finish
// instead of firing the legacy retry while the first request is still useful.
const CATCH_UP_REBASE_SEEK_WATCHDOG_DELAY_MS = 30_000;
const CATCH_UP_SEEK_SETTLE_TOLERANCE_MS = 20_000;
const CATCH_UP_SEEK_NO_FRAME_MAX_RETRIES = 1;
const CATCH_UP_FALLBACK_POSITION_GUARD_MS = 15_000;
const CATCH_UP_RUNTIME_DECODE_SKIP_MS = 15_000;
const CATCH_UP_RUNTIME_DECODE_SKIP_MAX_ATTEMPTS = 8;
const CATCH_UP_STARTUP_FALLBACK_MAX_ATTEMPTS = 3;
const CATCH_UP_RUNTIME_FALLBACK_MAX_ATTEMPTS = 15;
const CATCH_UP_INITIAL_SEGMENT_RETRY_POSITION_SECONDS = 15;

const createLoadingProgressState = (
  phase: CatchUpLoadingPhase,
  nowMs = Date.now(),
  currentState?: LoadingProgressState | null,
): LoadingProgressState => {
  const phaseRank: Record<CatchUpLoadingPhase, number> = {
    requesting: 0,
    playlist: 1,
    segment: 2,
    buffered: 3,
    frame: 4,
  };
  const nextPhase = currentState && phaseRank[currentState.phase] > phaseRank[phase]
    ? currentState.phase
    : phase;

  return {
    phase: nextPhase,
    startedAtMs: currentState?.startedAtMs ?? nowMs,
    updatedAtMs: nowMs,
  };
};

interface ParsedCatchUpAttemptState {
  attempts: CatchUpTransportAttempt[];
  currentAttemptIndex: number;
}

interface CatchUpRuntimeTimelineAnchor {
  sourceKey: string;
  timelinePositionMs: number;
  mediaPositionSeconds: number;
}

const parseNumericMetadataValue = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) {
      return numericValue;
    }
  }

  return null;
};

const resolveCatchUpRuntimeAnchorSourceKey = (
  source: SessionSource | null | undefined,
): string | null => {
  if (!source) {
    return null;
  }

  const metadata = (
    typeof source.metadata === 'object' &&
    source.metadata !== null
  )
    ? source.metadata as Record<string, unknown>
    : null;
  const loadKey = typeof metadata?.loadKey === 'number'
    ? metadata.loadKey
    : 'initial';

  return `${source.url}:${loadKey}`;
};

const extractSourceTargetHost = (url: string): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(url, typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  } catch {
    return null;
  }

  const proxyMatch = parsed.pathname.match(/^\/xui-api\/([^/?#]+)/);
  if (!proxyMatch?.[1]) {
    return parsed.hostname.toLowerCase();
  }

  try {
    const decodedTarget = decodeURIComponent(proxyMatch[1]);
    return new URL(decodedTarget.includes('://') ? decodedTarget : `http://${decodedTarget}`).hostname.toLowerCase();
  } catch {
    return null;
  }
};

const isMediaKingCatchUpHost = (host: string | null): boolean => (
  Boolean(host) && (
    host === '79.137.99.121' ||
    host === 'mediaking.fi' ||
    host?.endsWith('.mediaking.fi') ||
    host === 'castcdn.net' ||
    host?.endsWith('.castcdn.net')
  )
);

const resolveCatchUpMinimumHlsStartPositionSeconds = (
  source: SessionSource | null | undefined,
): number => {
  if (!source || typeof source.metadata !== 'object' || source.metadata === null) {
    return 0;
  }

  const metadata = source.metadata as Record<string, unknown>;
  if (metadata.mode !== 'catchup') {
    return 0;
  }

  const mediaOffsetSeconds = resolveCatchUpMediaOffsetSeconds(source);
  const rawMetadataStartPosition = parseNumericMetadataValue(metadata.catchUpHlsStartPositionSeconds) ?? 0;
  const metadataStartPosition = mediaOffsetSeconds > 0 && rawMetadataStartPosition > mediaOffsetSeconds
    ? Math.max(0, rawMetadataStartPosition - mediaOffsetSeconds)
    : Math.max(0, rawMetadataStartPosition);
  return metadataStartPosition;
};

const resolveCatchUpProviderSafeStartPositionSeconds = (
  source: SessionSource | null | undefined,
): number => {
  if (!source || typeof source.metadata !== 'object' || source.metadata === null) {
    return 0;
  }

  const metadata = source.metadata as Record<string, unknown>;
  if (metadata.mode !== 'catchup') {
    return 0;
  }

  return Math.max(
    0,
    Math.floor(parseNumericMetadataValue(metadata.catchUpProviderSafeStartPositionSeconds) ?? 0),
  );
};

const resolveBufferedAheadSeconds = (
  video: HTMLVideoElement | null,
  targetTimeSeconds: number,
): number => {
  if (!video || !video.buffered || video.buffered.length === 0) {
    return 0;
  }

  const safeTargetTimeSeconds = Number.isFinite(targetTimeSeconds)
    ? Math.max(0, targetTimeSeconds)
    : Math.max(0, video.currentTime || 0);

  for (let index = 0; index < video.buffered.length; index += 1) {
    const start = video.buffered.start(index);
    const end = video.buffered.end(index);
    if (
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      safeTargetTimeSeconds >= start &&
      safeTargetTimeSeconds <= end
    ) {
      return Math.max(0, end - safeTargetTimeSeconds);
    }
  }

  return 0;
};

const resolveCatchUpLoadingCopy = ({
  phase,
  elapsedSeconds,
  bufferedAheadSeconds,
}: {
  phase: CatchUpLoadingPhase;
  elapsedSeconds: number;
  bufferedAheadSeconds: number;
}): {
  title: string;
  detail: string;
  status: string;
} => {
  if (phase === 'frame') {
    return {
      title: 'Pokrećem snimak',
      detail: 'Video je spreman, pokretanje je u toku.',
      status: 'spreman prvi kadar',
    };
  }

  if (phase === 'buffered' || bufferedAheadSeconds > 0) {
    return {
      title: 'Pokrećem snimak',
      detail: `Video segment je stigao u bafer (${Math.floor(bufferedAheadSeconds)}s unapred).`,
      status: 'video je u baferu',
    };
  }

  if (phase === 'segment') {
    return {
      title: 'Učitavam TV unazad',
      detail: elapsedSeconds >= 12
        ? 'Provajder šalje veliki video segment. Snimak nije pao, još uvek stižu podaci.'
        : 'Lista snimka je učitana, čekam prvi video segment.',
      status: 'segment stiže',
    };
  }

  if (phase === 'playlist') {
    return {
      title: 'Učitavam TV unazad',
      detail: 'Lista snimka je stigla, pripremam video segment.',
      status: 'lista učitana',
    };
  }

  // Default (request sent, no manifest yet). For catch-up this is where the
  // provider's shadow remux runs — a COLD build of a long programme (a 4h show
  // is hundreds of archive minutes) can take a minute or two before the
  // manifest is ready. Escalate the copy over time so the wait reads as
  // "preparing a clean HD recording", not a freeze.
  if (elapsedSeconds >= 8) {
    return {
      title: 'Pripremam snimak',
      detail: 'Pripremam snimak visokog kvaliteta. Duže emisije mogu da potraju do minut-dva — snimak nije pao.',
      status: 'priprema u toku',
    };
  }

  return {
    title: 'Učitavam TV unazad',
    detail: 'Tražim snimak kod provajdera.',
    status: 'zahtev poslat',
  };
};

const usesMediaKingCatchUpManifestGuard = (
  source: SessionSource | null | undefined,
): boolean => {
  if (!source || typeof source.metadata !== 'object' || source.metadata === null) {
    return false;
  }

  const metadata = source.metadata as Record<string, unknown>;
  if (metadata.mode !== 'catchup') {
    return false;
  }

  const gatewayPlaybackUrl = (
    typeof metadata.gateway === 'object' &&
    metadata.gateway !== null &&
    typeof (metadata.gateway as Record<string, unknown>).playbackUrl === 'string'
  )
    ? (metadata.gateway as Record<string, string>).playbackUrl
    : null;

  return (
    isMediaKingCatchUpHost(extractSourceTargetHost(source.url)) ||
    (gatewayPlaybackUrl ? isMediaKingCatchUpHost(extractSourceTargetHost(gatewayPlaybackUrl)) : false)
  );
};

const resolveCatchUpAttemptState = (
  metadata: Record<string, unknown>,
  currentSourceUrl: string,
): ParsedCatchUpAttemptState => {
  const parsedAttempts = Array.isArray(metadata.catchUpAttemptPlan)
    ? metadata.catchUpAttemptPlan.filter(isCatchUpTransportAttempt)
    : [];

  let attempts = parsedAttempts;
  if (attempts.length === 0) {
    const fallbackUrls = Array.isArray(metadata.catchUpFallbackUrls)
      ? metadata.catchUpFallbackUrls
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
      : [];
    const fallbackUrl = typeof metadata.catchUpFallbackUrl === 'string'
      ? metadata.catchUpFallbackUrl.trim()
      : '';

    const streamId = Math.floor(parseNumericMetadataValue(metadata.streamId) ?? 0);
    const startTimestamp = Math.floor(parseNumericMetadataValue(metadata.catchUpStartTimestamp) ?? 0);
    const durationSeconds = Math.floor(parseNumericMetadataValue(metadata.catchUpDurationSeconds) ?? 0);
    const fallbackAttempts = [
      currentSourceUrl,
      ...fallbackUrls,
      ...(fallbackUrl ? [fallbackUrl] : []),
    ].filter((url, index, urls) => (
      url.length > 0 && urls.indexOf(url) === index
    ));
    attempts = fallbackAttempts.map((url): CatchUpTransportAttempt => ({
      url,
      streamId,
      startTimestamp,
      durationSeconds,
      offsetMinutes: 0,
      strategy: 'legacy',
    }));
  }

  let currentAttemptIndex = Math.floor(parseNumericMetadataValue(metadata.catchUpAttemptIndex) ?? -1);
  if (
    currentAttemptIndex < 0 ||
    currentAttemptIndex >= attempts.length ||
    attempts[currentAttemptIndex]?.url !== currentSourceUrl
  ) {
    currentAttemptIndex = attempts.findIndex((attempt) => attempt.url === currentSourceUrl);
  }
  if (currentAttemptIndex < 0) {
    currentAttemptIndex = 0;
  }

  return {
    attempts,
    currentAttemptIndex,
  };
};

const buildCatchUpEventMetadata = (
  source: {
    url: string;
    metadata?: unknown;
  } | null | undefined,
  options: {
    attemptIndex?: number;
    status: string;
    errorCode: string | null;
    finalHost?: string | null;
    strategy?: string | null;
  },
): Record<string, unknown> => {
  if (!source || typeof source.metadata !== 'object' || source.metadata === null) {
    return {
      status: options.status,
      errorCode: options.errorCode,
      finalHost: options.finalHost ?? null,
    };
  }

  const metadata = source.metadata as Record<string, unknown>;
  if (metadata.mode !== 'catchup') {
    return {
      status: options.status,
      errorCode: options.errorCode,
      finalHost: options.finalHost ?? null,
    };
  }

  const { attempts, currentAttemptIndex } = resolveCatchUpAttemptState(metadata, source.url);
  const safeAttemptIndex = typeof options.attemptIndex === 'number'
    ? options.attemptIndex
    : currentAttemptIndex;
  const attempt = attempts[safeAttemptIndex] ?? attempts[currentAttemptIndex] ?? null;
  const streamId = attempt?.streamId ?? parseNumericMetadataValue(metadata.streamId);
  const start = attempt?.startTimestamp ?? parseNumericMetadataValue(metadata.catchUpStartTimestamp);
  const duration = attempt?.durationSeconds ?? parseNumericMetadataValue(metadata.catchUpDurationSeconds);
  const finalHost = options.finalHost ?? resolveCatchUpFinalHost(source.url);

  return {
    streamId: streamId ?? null,
    start: start ?? null,
    duration: duration ?? null,
    attempt: safeAttemptIndex + 1,
    status: options.status,
    finalHost: finalHost ?? null,
    errorCode: options.errorCode,
    strategy: options.strategy ?? attempt?.strategy ?? null,
  };
};

const canUseStandardPictureInPicture = (video: HTMLVideoElement): boolean => (
  typeof document !== 'undefined' &&
  document.pictureInPictureEnabled &&
  typeof video.requestPictureInPicture === 'function' &&
  !video.disablePictureInPicture
);

const canUseWebKitPictureInPicture = (
  video: WebKitPictureInPictureVideoElement
): boolean => (
  typeof video.webkitSetPresentationMode === 'function' &&
  typeof video.webkitSupportsPresentationMode === 'function' &&
  video.webkitSupportsPresentationMode('picture-in-picture')
);

const isVideoInPictureInPicture = (
  video: WebKitPictureInPictureVideoElement
): boolean => {
  const isStandardPictureInPicture =
    typeof document !== 'undefined' &&
    document.pictureInPictureElement === video;
  const isWebKitPictureInPicture = video.webkitPresentationMode === 'picture-in-picture';
  return isStandardPictureInPicture || isWebKitPictureInPicture;
};

const canUseAirPlayPicker = (video: WebKitAirPlayVideoElement): boolean => (
  typeof video.webkitShowPlaybackTargetPicker === 'function'
);

const isAirPlayDeviceAvailable = (video: WebKitAirPlayVideoElement): boolean => (
  video.webkitPlaybackTargetAvailability === 'available'
);

const isAirPlayDeviceConnected = (video: WebKitAirPlayVideoElement): boolean => (
  Boolean(video.webkitCurrentPlaybackTargetIsWireless)
);

const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(({
  poster,
  autoPlay = true,
  preferNativeHls = false,
  loadingOverlayMaxMs,
  onError,
  onEnded,
  onCanPlay,
  onSourceBlockingPrimaryAction,
  onReportPlaybackProblem,
  onBackgroundRecoverySourceReloadFailed,
  className = '',
}, ref) => {
  const { session, commands } = useSessionContext();
  // Callback changes (e.g. next-episode metadata arriving) must not destroy the media adapter.
  const onEndedRef = useRef(onEnded);
  useEffect(() => { onEndedRef.current = onEnded; }, [onEnded]);
  const src = session.source?.url ?? '';
  const sourceLoadKey = typeof session.source?.metadata?.loadKey === 'number'
    ? `${src}:${session.source.metadata.loadKey}`
    : src;
  const sourceType = session.source?.type ?? (src.includes('.m3u8') ? 'hls' : 'mp4');
  const videoRef = useRef<HTMLVideoElement>(null);
  const adapterRef = useRef<HlsPlayerAdapter | null>(null);
  const sessionRef = useRef(session);
  const isApplyingSessionSeekRef = useRef(false);
  const applyingSessionSeekTargetMsRef = useRef<number | null>(null);
  const lastReportedPositionMsRef = useRef<number | null>(null);
  const lastRenderableCatchUpPositionMsRef = useRef<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingOverlayVisible, setIsLoadingOverlayVisible] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState<LoadingProgressState | null>(
    () => createLoadingProgressState('requesting'),
  );
  const [loadingTickMs, setLoadingTickMs] = useState(Date.now());
  const [errorState, setErrorState] = useState<PlayerErrorState | null>(null);
  const error = errorState?.error ?? null;
  const [unsupportedAudioCodec, setUnsupportedAudioCodec] = useState<UnsupportedAudioCodec | null>(null);
  const [unsupportedVideoCodec, setUnsupportedVideoCodec] = useState<UnsupportedVideoCodec | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPictureInPicture, setIsPictureInPicture] = useState(false);
  const [isAirPlayAvailable, setIsAirPlayAvailable] = useState(false);
  const [isAirPlayConnected, setIsAirPlayConnected] = useState(false);
  const pictureInPictureListenersRef = useRef(new Set<(isInPictureInPicture: boolean) => void>());
  const airPlayAvailabilityListenersRef = useRef(new Set<(isAvailable: boolean) => void>());
  const airPlayConnectionListenersRef = useRef(new Set<(isConnected: boolean) => void>());
  const lastStartedSourceRef = useRef<string | null>(null);
  const manualPauseRequestedRef = useRef(false);
  const backgroundPlaybackIntentSourceRef = useRef<string | null>(null);
  const backgroundPlaybackFailureReportedRef = useRef(false);
  const foregroundPlaybackRecoverySourceRef = useRef<string | null>(null);
  const liveUnexpectedPauseRecoverySourceRef = useRef<string | null>(null);
  const liveUnexpectedPauseRecoveryAttemptsRef = useRef(0);
  const pendingAutoplaySourceUrlRef = useRef<string | null>(null);
  // Source URL whose autoplay the browser refused. play() stays gated for that
  // source until a user gesture arrives, otherwise the playback effect and the
  // media element's pause event retry each other indefinitely.
  const autoplayBlockedSourceUrlRef = useRef<string | null>(null);
  const startupAutoplayRecoveryAttemptsRef = useRef(0);
  const startupAutoplayRecoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startupHardRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveNoFrameWatchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const catchUpStartupWatchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const catchUpManifestNoFrameWatchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const catchUpSeekWatchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const catchUpSeekWatchdogTargetMsRef = useRef<number | null>(null);
  const catchUpPendingStartupSeekAppliedKeyRef = useRef<string | null>(null);
  const catchUpSeekAutoplayRetryKeyRef = useRef<string | null>(null);
  const catchUpSeekFallbackAutoplayRetryKeyRef = useRef<string | null>(null);
  const catchUpRuntimeCompatibilityObservedUrlRef = useRef<string | null>(null);
  const lastRecordedCatchUpRuntimeCompatibilityRef = useRef<string | null>(null);
  const catchUpRuntimeTimelineAnchorRef = useRef<CatchUpRuntimeTimelineAnchor | null>(null);
  const startupHardRetrySourceUrlRef = useRef<string | null>(null);
  // Time-to-first-renderable-frame (TTFRF) telemetry. Captures the wall-clock
  // ms from the moment the current catch-up load started (loadingProgress
  // startedAtMs) to the first renderable frame, emitted once per load via
  // `catchup.first_frame`. Gate-2 metric for the server-side SPS/PPS fix.
  const catchUpLoadStartedAtMsRef = useRef<number | null>(null);
  const catchUpFirstFrameEmittedRef = useRef(false);
  const playbackWantsPlaying = sessionWantsPlayback(session);
  const isLocalRenderer = session.renderer === 'local-web' || session.renderer === 'airplay';

  const setError = useCallback((nextError: PlayerError | null) => {
    setErrorState(nextError
      ? buildPlayerErrorState(nextError, sessionRef.current.source)
      : null);
  }, []);

  const setErrorIfMissing = useCallback((nextError: PlayerError) => {
    setErrorState((currentErrorState) => (
      currentErrorState ?? buildPlayerErrorState(nextError, sessionRef.current.source)
    ));
  }, []);

  const deferPlaybackFailureWhileBackgrounded = useCallback((
    errorCode: string,
    message?: string,
  ): boolean => {
    const currentSession = sessionRef.current;
    if (!shouldDeferPlaybackFailureWhileBackgrounded(currentSession, {
      isDocumentHidden: (
        document.visibilityState === 'hidden' ||
        backgroundPlaybackIntentSourceRef.current === currentSession.source?.url
      ),
      backgroundSourceUrl: backgroundPlaybackIntentSourceRef.current,
      manualPauseRequested: manualPauseRequestedRef.current,
    })) {
      return false;
    }

    if (!backgroundPlaybackFailureReportedRef.current) {
      backgroundPlaybackFailureReportedRef.current = true;
      emitWebObservabilityEvent({
        name: 'playback.retry',
        severity: 'warn',
        metadata: {
          renderer: currentSession.renderer,
          channelId: currentSession.source?.channelId ?? null,
          playbackMode: currentSession.source?.metadata?.mode ?? null,
          status: 'background_failure_deferred',
          errorCode,
          message: message ?? null,
        },
      });
    }
    return true;
  }, []);

  const recordCatchUpRuntimeCompatibility = useCallback((
    source: SessionSource | null | undefined,
    status: CatchUpRuntimeCompatibilityStatus,
    reasonCode: CatchUpRuntimeCompatibilityReasonCode,
  ) => {
    const fingerprint = resolveCatchUpRuntimeCompatibilityFingerprint(source);
    if (!fingerprint) {
      return;
    }

    const dedupeKey = `${fingerprint}:${status}:${reasonCode}`;
    if (lastRecordedCatchUpRuntimeCompatibilityRef.current === dedupeKey) {
      return;
    }

    const record = recordCatchUpRuntimeCompatibilityResult(source, {
      status,
      reasonCode,
      observedUrl: catchUpRuntimeCompatibilityObservedUrlRef.current,
    });
    if (!record) {
      return;
    }

    lastRecordedCatchUpRuntimeCompatibilityRef.current = dedupeKey;
    emitWebObservabilityEvent({
      name: 'catchup.runtime_compatibility',
      severity: status === 'playable' ? 'info' : 'warn',
      metadata: {
        fingerprint: record.fingerprint,
        status: record.status,
        reasonCode: record.reasonCode,
        streamId: record.streamId,
        channelId: record.channelId,
        expiresAtMs: record.expiresAtMs,
      },
    });
  }, []);

  const getCatchUpRuntimeTimelineAnchor = useCallback((
    source: SessionSource | null | undefined,
  ): CatchUpRuntimeTimelineAnchor | null => {
    const sourceKey = resolveCatchUpRuntimeAnchorSourceKey(source);
    const anchor = catchUpRuntimeTimelineAnchorRef.current;
    if (!sourceKey || !anchor || anchor.sourceKey !== sourceKey) {
      return null;
    }

    return anchor;
  }, []);

  const rememberCatchUpRuntimeTimelineAnchor = useCallback((
    source: SessionSource | null | undefined,
    timelinePositionMs: number | null | undefined,
    mediaPositionSeconds: number | null | undefined,
  ) => {
    const sourceKey = resolveCatchUpRuntimeAnchorSourceKey(source);
    if (
      !sourceKey ||
      typeof timelinePositionMs !== 'number' ||
      !Number.isFinite(timelinePositionMs) ||
      typeof mediaPositionSeconds !== 'number' ||
      !Number.isFinite(mediaPositionSeconds) ||
      mediaPositionSeconds <= 0
    ) {
      return;
    }

    catchUpRuntimeTimelineAnchorRef.current = {
      sourceKey,
      timelinePositionMs: Math.max(0, Math.floor(timelinePositionMs)),
      mediaPositionSeconds: Math.max(0, mediaPositionSeconds),
    };
  }, []);

  const resolveRuntimeCatchUpTimelinePositionMs = useCallback((
    source: SessionSource | null | undefined,
    mediaTimeSeconds: number,
  ): number => {
    const anchor = getCatchUpRuntimeTimelineAnchor(source);
    if (anchor) {
      return Math.max(0, Math.floor(
        anchor.timelinePositionMs +
        ((Math.max(0, mediaTimeSeconds) - anchor.mediaPositionSeconds) * 1000),
      ));
    }

    return resolveCatchUpTimelinePositionMsForSource(source, mediaTimeSeconds);
  }, [getCatchUpRuntimeTimelineAnchor]);

  const resolveRuntimeCatchUpMediaSeekTimeSeconds = useCallback((
    source: SessionSource | null | undefined,
    targetPositionMs: number | null | undefined,
    minimumMediaPositionSeconds = 0,
  ): number => {
    const anchor = getCatchUpRuntimeTimelineAnchor(source);
    if (anchor) {
      const safeTargetSeconds = Math.max(0, (targetPositionMs ?? 0) / 1000);
      const anchorTimelineSeconds = anchor.timelinePositionMs / 1000;
      return Math.max(
        0,
        minimumMediaPositionSeconds,
        anchor.mediaPositionSeconds + (safeTargetSeconds - anchorTimelineSeconds),
      );
    }

    return resolveCatchUpMediaSeekTimeSecondsForSource(
      source,
      targetPositionMs,
      minimumMediaPositionSeconds,
    );
  }, [getCatchUpRuntimeTimelineAnchor]);

  const resolveRuntimeCatchUpTimelineSeekTargetMs = useCallback((
    source: SessionSource | null | undefined,
    targetPositionMs: number | null | undefined,
    minimumMediaPositionSeconds = 0,
  ): number => {
    const anchor = getCatchUpRuntimeTimelineAnchor(source);
    if (anchor) {
      const mediaPositionSeconds = resolveRuntimeCatchUpMediaSeekTimeSeconds(
        source,
        targetPositionMs,
        minimumMediaPositionSeconds,
      );
      return Math.max(0, Math.floor(
        anchor.timelinePositionMs +
        ((mediaPositionSeconds - anchor.mediaPositionSeconds) * 1000),
      ));
    }

    return resolveCatchUpTimelineSeekTargetMsForSource(
      source,
      targetPositionMs,
      minimumMediaPositionSeconds,
    );
  }, [
    getCatchUpRuntimeTimelineAnchor,
    resolveRuntimeCatchUpMediaSeekTimeSeconds,
  ]);

  const resetLoadingProgress = useCallback((phase: CatchUpLoadingPhase = 'requesting') => {
    const nowMs = Date.now();
    setLoadingProgress(createLoadingProgressState(phase, nowMs));
    setLoadingTickMs(nowMs);
    // New load cycle: re-anchor the TTFRF clock and re-arm the one-shot emit.
    catchUpLoadStartedAtMsRef.current = nowMs;
    catchUpFirstFrameEmittedRef.current = false;
  }, []);

  const updateLoadingProgressPhase = useCallback((phase: CatchUpLoadingPhase) => {
    const nowMs = Date.now();
    setLoadingProgress((currentProgress) => (
      createLoadingProgressState(phase, nowMs, currentProgress)
    ));
    setLoadingTickMs(nowMs);
  }, []);

  const clearLoadingProgress = useCallback(() => {
    setLoadingProgress(null);
  }, []);

  useEffect(() => {
    pictureInPictureListenersRef.current.forEach((listener) => {
      listener(isPictureInPicture);
    });
  }, [isPictureInPicture]);

  useEffect(() => {
    airPlayAvailabilityListenersRef.current.forEach((listener) => {
      listener(isAirPlayAvailable);
    });
  }, [isAirPlayAvailable]);

  useEffect(() => {
    airPlayConnectionListenersRef.current.forEach((listener) => {
      listener(isAirPlayConnected);
    });
  }, [isAirPlayConnected]);

  useEffect(() => {
    if (!isLoading || error) {
      setIsLoadingOverlayVisible(false);
      return;
    }

    setIsLoadingOverlayVisible(true);
    if (
      typeof loadingOverlayMaxMs !== 'number' ||
      !Number.isFinite(loadingOverlayMaxMs) ||
      loadingOverlayMaxMs <= 0
    ) {
      return;
    }

    const timeoutId = setTimeout(() => {
      setIsLoadingOverlayVisible(false);
    }, loadingOverlayMaxMs);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [error, isLoading, loadingOverlayMaxMs, src]);

  useEffect(() => {
    if (!isLoading || !isLoadingOverlayVisible || error) {
      return;
    }

    const intervalId = setInterval(() => {
      setLoadingTickMs(Date.now());
    }, 1_000);

    return () => {
      clearInterval(intervalId);
    };
  }, [error, isLoading, isLoadingOverlayVisible, src]);

  const isPictureInPictureSupported = useCallback((): boolean => {
    const video = videoRef.current as WebKitPictureInPictureVideoElement | null;
    if (!video) {
      return false;
    }

    return canUseStandardPictureInPicture(video) || canUseWebKitPictureInPicture(video);
  }, []);

  const enterPictureInPicture = useCallback(async (): Promise<boolean> => {
    const video = videoRef.current as WebKitPictureInPictureVideoElement | null;
    if (!video) {
      return false;
    }

    try {
      if (canUseStandardPictureInPicture(video)) {
        await video.requestPictureInPicture();
        return true;
      }

      if (canUseWebKitPictureInPicture(video)) {
        video.webkitSetPresentationMode?.('picture-in-picture');
        return true;
      }
    } catch {
      return false;
    }

    return false;
  }, []);

  const exitPictureInPicture = useCallback(async (): Promise<boolean> => {
    const video = videoRef.current as WebKitPictureInPictureVideoElement | null;
    if (!video) {
      return false;
    }

    try {
      if (typeof document !== 'undefined' && document.pictureInPictureElement === video) {
        await document.exitPictureInPicture();
        return true;
      }

      if (video.webkitPresentationMode === 'picture-in-picture' && video.webkitSetPresentationMode) {
        video.webkitSetPresentationMode('inline');
        return true;
      }
    } catch {
      return false;
    }

    return false;
  }, []);

  const togglePictureInPicture = useCallback(async (): Promise<boolean> => {
    const video = videoRef.current as WebKitPictureInPictureVideoElement | null;
    if (!video || !isPictureInPictureSupported()) {
      return false;
    }

    if (isVideoInPictureInPicture(video)) {
      return exitPictureInPicture();
    }

    return enterPictureInPicture();
  }, [enterPictureInPicture, exitPictureInPicture, isPictureInPictureSupported]);

  const isAirPlaySupported = useCallback((): boolean => {
    const video = videoRef.current as WebKitAirPlayVideoElement | null;
    if (!video) {
      return false;
    }

    return canUseAirPlayPicker(video);
  }, []);

  const showAirPlayPicker = useCallback((): boolean => {
    const video = videoRef.current as WebKitAirPlayVideoElement | null;
    if (!video || !canUseAirPlayPicker(video)) {
      return false;
    }

    try {
      video.webkitShowPlaybackTargetPicker?.();
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    const markPlaybackBackgrounded = () => {
      const currentSession = sessionRef.current;
      const currentSource = currentSession.source;
      if (
        currentSource &&
        sessionWantsPlayback(currentSession) &&
        (currentSource.metadata?.mode === 'live' || currentSource.metadata?.mode === 'catchup')
      ) {
        backgroundPlaybackIntentSourceRef.current = currentSource.url;
        backgroundPlaybackFailureReportedRef.current = false;
        adapterRef.current?.setDocumentHidden(true);
      }
    };

    const resumePlaybackInForeground = () => {
      if (document.visibilityState === 'hidden') {
        return;
      }

      const currentSession = sessionRef.current;
      const backgroundSourceUrl = backgroundPlaybackIntentSourceRef.current;
      const adapter = adapterRef.current;
      if (
        !adapter ||
        !shouldRecoverPlaybackAfterForeground(currentSession, {
          backgroundSourceUrl,
        })
      ) {
        adapter?.setDocumentHidden(false);
        return;
      }

      const source = currentSession.source;
      if (!source) {
        return;
      }
      backgroundPlaybackIntentSourceRef.current = null;
      backgroundPlaybackFailureReportedRef.current = false;
      const sourceMetadata = (
        typeof source.metadata === 'object' && source.metadata !== null
      )
        ? source.metadata as Record<string, unknown>
        : {};
      const isCatchUpSource = sourceMetadata.mode === 'catchup';
      const catchUpStartPositionSeconds = isCatchUpSource
        ? resolveRuntimeCatchUpMediaSeekTimeSeconds(
          source,
          currentSession.positionMs,
          resolveCatchUpMinimumHlsStartPositionSeconds(source),
        )
        : 0;
      const sourceForAdapter = {
        url: source.url,
        type: source.type,
        metadata: {
          ...sourceMetadata,
          ...(isCatchUpSource && catchUpStartPositionSeconds > 0
            ? { catchUpHlsStartPositionSeconds: catchUpStartPositionSeconds }
            : {}),
          ...(isCatchUpSource && usesMediaKingCatchUpManifestGuard(source)
            ? { catchUpHlsStartupMode: 'progressive' }
            : {}),
        },
      };
      foregroundPlaybackRecoverySourceRef.current = source.url;
      pendingAutoplaySourceUrlRef.current = source.url;
      setError(null);
      commands.play();
      void adapter.resumeAfterBackground(sourceForAdapter).then((result) => {
        if (sessionRef.current.source?.url !== source.url) {
          return;
        }
        emitWebObservabilityEvent({
          name: 'playback.retry',
          severity: 'warn',
          metadata: {
            renderer: sessionRef.current.renderer,
            channelId: source.channelId ?? null,
            streamId: sourceMetadata.streamId ?? null,
            playbackMode: sourceMetadata.mode ?? null,
            status: result.replace(/-/g, '_'),
            errorCode: 'BACKGROUND_PLAYBACK_RESUME',
          },
        });
      }).catch((recoveryError: unknown) => {
        if (sessionRef.current.source?.url !== source.url) {
          return;
        }
        foregroundPlaybackRecoverySourceRef.current = null;
        const recoveryFailure = recoveryError instanceof BackgroundPlaybackResumeError
          ? recoveryError.code
          : null;
        if (recoveryFailure === 'playback-start-failed' && autoplayBlockedSourceUrlRef.current === source.url) {
          return;
        }
        const recoveryTelemetry = recoveryFailure === 'source-reload-failed'
          ? {
              status: 'foreground_source_reload_failed',
              errorCode: 'BACKGROUND_PLAYBACK_SOURCE_RELOAD_FAILED',
            }
          : recoveryFailure === 'playback-start-failed'
            ? {
                status: 'foreground_playback_start_failed',
                errorCode: 'BACKGROUND_PLAYBACK_START_FAILED',
              }
            : recoveryFailure === 'rebuild-no-frame'
              ? {
                  status: 'foreground_rebuild_no_frame',
                  errorCode: 'BACKGROUND_PLAYBACK_REBUILD_NO_FRAME',
                }
              : {
                  status: 'foreground_pipeline_rebuild_failed',
                  errorCode: 'BACKGROUND_PLAYBACK_RESUME_FAILED',
                };
        emitWebObservabilityEvent({
          name: 'playback.error',
          severity: 'error',
          metadata: {
            renderer: sessionRef.current.renderer,
            channelId: source.channelId ?? null,
            streamId: sourceMetadata.streamId ?? null,
            playbackMode: sourceMetadata.mode ?? null,
            ...recoveryTelemetry,
            message: recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
          },
        });
        if (recoveryFailure === 'source-reload-failed') {
          onBackgroundRecoverySourceReloadFailed?.(source);
        }
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        markPlaybackBackgrounded();
        return;
      }
      resumePlaybackInForeground();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('freeze', markPlaybackBackgrounded);
    document.addEventListener('resume', resumePlaybackInForeground);
    window.addEventListener('blur', markPlaybackBackgrounded);
    window.addEventListener('focus', resumePlaybackInForeground);
    window.addEventListener('pagehide', markPlaybackBackgrounded);
    window.addEventListener('pageshow', resumePlaybackInForeground);
    handleVisibilityChange();
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('freeze', markPlaybackBackgrounded);
      document.removeEventListener('resume', resumePlaybackInForeground);
      window.removeEventListener('blur', markPlaybackBackgrounded);
      window.removeEventListener('focus', resumePlaybackInForeground);
      window.removeEventListener('pagehide', markPlaybackBackgrounded);
      window.removeEventListener('pageshow', resumePlaybackInForeground);
    };
  }, [
    commands,
    onBackgroundRecoverySourceReloadFailed,
    resolveRuntimeCatchUpMediaSeekTimeSeconds,
    setError,
  ]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const isCatchUpLoadingSession = () => (
      sessionRef.current.source?.metadata?.mode === 'catchup'
    );

    const resolveTargetMediaTimeSeconds = () => {
      const currentSource = sessionRef.current.source;
      return resolveRuntimeCatchUpMediaSeekTimeSeconds(
        currentSource,
        sessionRef.current.positionMs,
        resolveCatchUpMinimumHlsStartPositionSeconds(currentSource),
      );
    };

    const updateBufferedPhase = () => {
      if (!isCatchUpLoadingSession()) {
        return;
      }

      const bufferedAheadSeconds = resolveBufferedAheadSeconds(
        video,
        resolveTargetMediaTimeSeconds(),
      );
      updateLoadingProgressPhase(bufferedAheadSeconds > 0 ? 'buffered' : 'segment');
    };

    const updateFramePhase = () => {
      if (!isCatchUpLoadingSession()) {
        return;
      }

      if (hasRenderableMediaFrame(video)) {
        updateLoadingProgressPhase('frame');
        // TTFRF: emit once per load, the wall-clock ms from load start to the
        // first renderable frame. Gate-2 metric for the server SPS/PPS fix.
        if (!catchUpFirstFrameEmittedRef.current) {
          catchUpFirstFrameEmittedRef.current = true;
          const startedAtMs = catchUpLoadStartedAtMsRef.current;
          const ttfrfMs = startedAtMs !== null
            ? Math.max(0, Math.round(Date.now() - startedAtMs))
            : null;
          const currentSession = sessionRef.current;
          emitWebObservabilityEvent({
            name: 'catchup.first_frame',
            severity: 'info',
            metadata: {
              renderer: currentSession.renderer,
              ttfrfMs,
              ...buildCatchUpEventMetadata(currentSession.source, {
                status: 'first_frame',
                errorCode: null,
              }),
            },
          });
        }
        return;
      }

      updateBufferedPhase();
    };

    const updatePlaylistPhase = () => {
      if (isCatchUpLoadingSession()) {
        updateLoadingProgressPhase('playlist');
      }
    };

    const updateRequestPhase = () => {
      if (isCatchUpLoadingSession()) {
        updateLoadingProgressPhase('requesting');
      }
    };

    video.addEventListener('loadstart', updateRequestPhase);
    video.addEventListener('loadedmetadata', updatePlaylistPhase);
    video.addEventListener('progress', updateBufferedPhase);
    video.addEventListener('loadeddata', updateFramePhase);
    video.addEventListener('canplay', updateFramePhase);
    video.addEventListener('waiting', updateBufferedPhase);
    video.addEventListener('stalled', updateBufferedPhase);

    return () => {
      video.removeEventListener('loadstart', updateRequestPhase);
      video.removeEventListener('loadedmetadata', updatePlaylistPhase);
      video.removeEventListener('progress', updateBufferedPhase);
      video.removeEventListener('loadeddata', updateFramePhase);
      video.removeEventListener('canplay', updateFramePhase);
      video.removeEventListener('waiting', updateBufferedPhase);
      video.removeEventListener('stalled', updateBufferedPhase);
    };
  }, [
    resetLoadingProgress,
    resolveRuntimeCatchUpMediaSeekTimeSeconds,
    updateLoadingProgressPhase,
  ]);

  const clearStartupAutoplayRecovery = useCallback(() => {
    if (startupAutoplayRecoveryTimerRef.current !== null) {
      clearTimeout(startupAutoplayRecoveryTimerRef.current);
      startupAutoplayRecoveryTimerRef.current = null;
    }
    if (startupHardRetryTimerRef.current !== null) {
      clearTimeout(startupHardRetryTimerRef.current);
      startupHardRetryTimerRef.current = null;
    }
    startupAutoplayRecoveryAttemptsRef.current = 0;
  }, []);

  const clearLiveNoFrameWatchdog = useCallback(() => {
    if (liveNoFrameWatchdogTimerRef.current !== null) {
      clearTimeout(liveNoFrameWatchdogTimerRef.current);
      liveNoFrameWatchdogTimerRef.current = null;
    }
  }, []);

  const clearCatchUpStartupWatchdog = useCallback(() => {
    if (catchUpStartupWatchdogTimerRef.current !== null) {
      clearTimeout(catchUpStartupWatchdogTimerRef.current);
      catchUpStartupWatchdogTimerRef.current = null;
    }
  }, []);

  const clearCatchUpManifestNoFrameWatchdog = useCallback(() => {
    if (catchUpManifestNoFrameWatchdogTimerRef.current !== null) {
      clearTimeout(catchUpManifestNoFrameWatchdogTimerRef.current);
      catchUpManifestNoFrameWatchdogTimerRef.current = null;
    }
  }, []);

  const clearCatchUpSeekWatchdog = useCallback(() => {
    if (catchUpSeekWatchdogTimerRef.current !== null) {
      clearTimeout(catchUpSeekWatchdogTimerRef.current);
      catchUpSeekWatchdogTimerRef.current = null;
    }
    catchUpSeekWatchdogTargetMsRef.current = null;
  }, []);

  const switchToCatchUpFallbackIfAvailable = useCallback((reason: string): boolean => {
    const currentSession = sessionRef.current;
    const source = currentSession.source;
    if (!source || typeof source.metadata !== 'object' || source.metadata === null) {
      return false;
    }

    const metadata = source.metadata as Record<string, unknown>;
    if (metadata.mode !== 'catchup') {
      return false;
    }
    const startupTimeoutCount = Math.floor(
      parseNumericMetadataValue(metadata.catchUpStartupTimeoutCount) ?? 0,
    );
    if (
      reason === 'STARTUP_TIMEOUT' &&
      startupTimeoutCount >= CATCH_UP_STARTUP_FALLBACK_MAX_ATTEMPTS
    ) {
      return false;
    }
    const startupFallbackCount = Math.floor(
      parseNumericMetadataValue(metadata.catchUpStartupFallbackCount) ?? 0,
    );
    const hasStartedCurrentSource = lastStartedSourceRef.current === source.url;
    const fallbackMaxAttempts = reason === 'STARTUP_TIMEOUT' || !hasStartedCurrentSource
      ? CATCH_UP_STARTUP_FALLBACK_MAX_ATTEMPTS
      : CATCH_UP_RUNTIME_FALLBACK_MAX_ATTEMPTS;
    const mediaOffsetSeconds = metadata.mode === 'catchup'
      ? resolveCatchUpMediaOffsetSeconds(source)
      : 0;
    const shouldPreferOffsetFallback = (
      mediaOffsetSeconds > 0 &&
      (
        reason === 'MEDIA_ERROR' ||
        reason === 'SEEK_NO_FRAME' ||
        reason === 'STARTUP_TIMEOUT'
      )
    );
    if (!shouldContinueCatchUpStartupFallbacks(
      currentSession,
      lastStartedSourceRef.current,
      startupFallbackCount,
      fallbackMaxAttempts,
    )) {
      return false;
    }

    const catchUpDurationSeconds = Math.max(
      0,
      parseNumericMetadataValue(metadata.catchUpDurationSeconds) ?? 0,
    );
    const initialSegmentRetryMediaPositionSeconds = Math.min(
      catchUpDurationSeconds > 1
        ? catchUpDurationSeconds - 1
        : CATCH_UP_INITIAL_SEGMENT_RETRY_POSITION_SECONDS,
      CATCH_UP_INITIAL_SEGMENT_RETRY_POSITION_SECONDS,
    );
    const requestedTimelinePositionMs = Math.max(
      0,
      parseNumericMetadataValue(metadata.catchUpPendingTimelineSeekMs) ??
        currentSession.positionMs ??
        0,
    );
    const providerSafeStartPositionSeconds = resolveCatchUpProviderSafeStartPositionSeconds(source);
    if (shouldRetryCatchUpStartupWithProviderSafeStart(
      currentSession,
      reason,
      { hasRenderableFrame: hasRenderableMediaFrame(videoRef.current) },
      providerSafeStartPositionSeconds,
    )) {
      clearStartupAutoplayRecovery();
      clearCatchUpStartupWatchdog();
      clearCatchUpManifestNoFrameWatchdog();
      pendingAutoplaySourceUrlRef.current = source.url;
      isApplyingSessionSeekRef.current = true;
      applyingSessionSeekTargetMsRef.current = requestedTimelinePositionMs;
      commands.setSource(
        {
          ...source,
          metadata: {
            ...metadata,
            catchUpHlsStartupMode: 'complete',
            catchUpHlsStartPositionSeconds: providerSafeStartPositionSeconds,
            catchUpPendingTimelineSeekMs: requestedTimelinePositionMs,
            catchUpPendingMediaSeekSeconds: providerSafeStartPositionSeconds,
            catchUpProviderSafeStartRetryUsed: true,
            catchUpSeekNoFrameRetryCount: 0,
            loadKey: Date.now(),
          },
        },
        requestedTimelinePositionMs,
      );
      commands.play();
      setError(null);
      setIsLoading(true);
      resetLoadingProgress('requesting');
      emitWebObservabilityEvent({
        name: 'catchup.retry',
        severity: 'warn',
        metadata: {
          ...buildCatchUpEventMetadata(source, {
            attemptIndex: Math.floor(parseNumericMetadataValue(metadata.catchUpAttemptIndex) ?? 0),
            status: 'provider_safe_start_retry',
            errorCode: reason,
          }),
          renderer: currentSession.renderer,
          mediaPositionSeconds: providerSafeStartPositionSeconds,
          positionMs: requestedTimelinePositionMs,
        },
      });
      return true;
    }

    if (shouldRetryCatchUpStartupWithoutSafeStart(
      currentSession,
      reason,
      { hasRenderableFrame: hasRenderableMediaFrame(videoRef.current) },
      initialSegmentRetryMediaPositionSeconds,
    )) {
      clearStartupAutoplayRecovery();
      clearCatchUpStartupWatchdog();
      clearCatchUpManifestNoFrameWatchdog();
      pendingAutoplaySourceUrlRef.current = source.url;
      isApplyingSessionSeekRef.current = true;
      applyingSessionSeekTargetMsRef.current = requestedTimelinePositionMs;
      commands.setSource(
        {
          ...source,
          metadata: {
            ...metadata,
            catchUpHlsStartupMode: 'complete',
            catchUpHlsStartPositionSeconds: initialSegmentRetryMediaPositionSeconds,
            catchUpPendingTimelineSeekMs: requestedTimelinePositionMs,
            catchUpPendingMediaSeekSeconds: initialSegmentRetryMediaPositionSeconds,
            catchUpInitialSegmentRetryUsed: true,
            catchUpSeekNoFrameRetryCount: 0,
            loadKey: Date.now(),
          },
        },
        requestedTimelinePositionMs,
      );
      commands.play();
      setError(null);
      setIsLoading(true);
      resetLoadingProgress('requesting');
      emitWebObservabilityEvent({
        name: 'catchup.retry',
        severity: 'warn',
        metadata: {
          ...buildCatchUpEventMetadata(source, {
            attemptIndex: Math.floor(parseNumericMetadataValue(metadata.catchUpAttemptIndex) ?? 0),
            status: 'initial_segment_retry',
            errorCode: reason,
          }),
          renderer: currentSession.renderer,
          mediaPositionSeconds: initialSegmentRetryMediaPositionSeconds,
          positionMs: requestedTimelinePositionMs,
        },
      });
      return true;
    }

    const { attempts, currentAttemptIndex } = resolveCatchUpAttemptState(metadata, source.url);
    if (attempts.length <= 1) {
      return false;
    }

    let nextAttemptIndex = currentAttemptIndex + 1;
    while (
      nextAttemptIndex < attempts.length &&
      (
        attempts[nextAttemptIndex]?.url === source.url ||
        (
          shouldPreferOffsetFallback &&
          attempts[nextAttemptIndex]?.startTimestamp === attempts[currentAttemptIndex]?.startTimestamp
        )
      )
    ) {
      nextAttemptIndex += 1;
    }
    if (nextAttemptIndex >= attempts.length) {
      emitWebObservabilityEvent({
        name: 'catchup.fallback',
        severity: 'error',
        metadata: {
          ...buildCatchUpEventMetadata(source, {
            attemptIndex: currentAttemptIndex,
            status: 'exhausted',
            errorCode: reason,
          }),
          renderer: currentSession.renderer,
          fallbackCount: Math.max(0, attempts.length - 1),
        },
      });
      return false;
    }

    const nextAttempt = attempts[nextAttemptIndex];
    const currentAttempt = attempts[currentAttemptIndex] ?? null;
    const preferredFinalHost = typeof metadata.catchUpPreferredFinalHost === 'string'
      ? metadata.catchUpPreferredFinalHost
      : resolveCatchUpHostAffinity(source.url);
    const resolvedFallbackUrl = resolveCatchUpFallbackAttemptUrl(nextAttempt.url, preferredFinalHost ?? null);
    const fallbackUrl = resolvedFallbackUrl;
    const nextAttempts = attempts.map((attempt, index) => (
      index === nextAttemptIndex ? { ...attempt, url: fallbackUrl } : attempt
    ));
    const nextFallbackUrls = nextAttempts
      .slice(1)
      .map((attempt) => attempt.url);

    clearStartupAutoplayRecovery();
    clearCatchUpStartupWatchdog();
    clearCatchUpManifestNoFrameWatchdog();
    pendingAutoplaySourceUrlRef.current = fallbackUrl;
    const shouldSkipPastRuntimeDecodeError = (
      reason === 'MEDIA_ELEMENT_3' ||
      reason === 'MEDIA_ERROR'
    );
    const currentPositionMs = currentSession.positionMs ?? 0;
    const pendingTimelineSeekMs = parseNumericMetadataValue(metadata.catchUpPendingTimelineSeekMs);
    const requestedNextPositionMs = typeof pendingTimelineSeekMs === 'number'
      ? pendingTimelineSeekMs
      : shouldSkipPastRuntimeDecodeError
      ? currentPositionMs + CATCH_UP_RUNTIME_DECODE_SKIP_MS
      : currentPositionMs;
    const currentAttemptStartTimestamp = currentAttempt?.startTimestamp
      ?? Math.floor(parseNumericMetadataValue(metadata.catchUpStartTimestamp) ?? 0);
    const originalTimelineStartTimestamp = mediaOffsetSeconds > 0
      ? currentAttemptStartTimestamp - mediaOffsetSeconds
      : currentAttemptStartTimestamp;
    const nextMediaOffsetSeconds = metadata.mode === 'catchup' && mediaOffsetSeconds > 0
      ? Math.max(0, nextAttempt.startTimestamp - originalTimelineStartTimestamp)
      : mediaOffsetSeconds;
    const shouldPreserveRequestedTimelinePosition = (
      metadata.mode === 'catchup' &&
      nextMediaOffsetSeconds <= 0 &&
      !shouldSkipPastRuntimeDecodeError
    );
    const fallbackPlaybackPosition = metadata.mode === 'catchup'
      ? resolveCatchUpFallbackPlaybackPosition({
        requestedPositionMs: requestedNextPositionMs,
        mediaOffsetSeconds: nextMediaOffsetSeconds,
        mediaDurationSeconds: catchUpDurationSeconds,
        positionGuardMs: CATCH_UP_FALLBACK_POSITION_GUARD_MS,
        preserveRequestedTimelinePosition: shouldPreserveRequestedTimelinePosition,
      })
      : null;
    const nextPositionMs = fallbackPlaybackPosition?.timelinePositionMs ?? currentPositionMs;
    const nextMediaPositionSeconds = fallbackPlaybackPosition?.mediaPositionSeconds;
    const currentHlsStartPositionSeconds = parseNumericMetadataValue(metadata.catchUpHlsStartPositionSeconds) ?? 0;
    const nextCatchUpHlsStartPositionSeconds = metadata.mode === 'catchup'
      ? Math.max(
        nextMediaPositionSeconds ?? 0,
        mediaOffsetSeconds > 0 ? 0 : currentHlsStartPositionSeconds,
      )
      : undefined;
    const clientRebaseWasRequested = (
      metadata.catchUpClientRebaseRequested === true ||
      metadata.catchUpClientRebase === true
    );
    const clientRebasePermanentlyUnavailable = reason === 'CATCHUP_REBASE_NOT_SUPPORTED';
    const useClientRebaseForNextAttempt = (
      clientRebaseWasRequested &&
      !clientRebasePermanentlyUnavailable &&
      nextAttempt.strategy !== 'shadow-validation'
    );
    isApplyingSessionSeekRef.current = true;
    applyingSessionSeekTargetMsRef.current = nextPositionMs;
    commands.setSource(
      {
        ...source,
        url: fallbackUrl,
        metadata: {
          ...metadata,
          catchUpAttemptPlan: nextAttempts,
          catchUpAttemptIndex: nextAttemptIndex,
          catchUpAttemptStrategy: nextAttempt.strategy,
          catchUpPreferredFinalHost: preferredFinalHost ?? null,
          catchUpStartTimestamp: nextAttempt.startTimestamp,
          catchUpDurationSeconds: nextAttempt.durationSeconds,
          catchUpFallbackUrl: fallbackUrl,
          catchUpFallbackUrls: nextFallbackUrls,
          catchUpFallbackIndex: Math.max(0, nextAttemptIndex - 1),
          catchUpFallbackUsed: true,
          catchUpClientRebase: useClientRebaseForNextAttempt,
          catchUpClientRebaseRequested: clientRebasePermanentlyUnavailable
            ? false
            : clientRebaseWasRequested,
          ...(metadata.mode === 'catchup'
            ? { catchUpMediaOffsetSeconds: nextMediaOffsetSeconds }
            : {}),
          ...(typeof nextCatchUpHlsStartPositionSeconds === 'number'
            ? {
              catchUpHlsStartPositionSeconds: nextCatchUpHlsStartPositionSeconds,
              catchUpPendingTimelineSeekMs: nextPositionMs,
              catchUpPendingMediaSeekSeconds: nextCatchUpHlsStartPositionSeconds,
            }
            : {}),
          catchUpSeekNoFrameRetryCount: 0,
          ...(reason === 'STARTUP_TIMEOUT'
            ? { catchUpStartupTimeoutCount: startupTimeoutCount + 1 }
            : {}),
          ...(lastStartedSourceRef.current !== source.url
            ? { catchUpStartupFallbackCount: startupFallbackCount + 1 }
            : {}),
        },
      },
      nextPositionMs
    );
    commands.play();
    setError(null);
    setIsLoading(true);
    resetLoadingProgress('requesting');

    const isFallbackStrategy = isCatchUpFallbackStrategy(nextAttempt.strategy);
    emitWebObservabilityEvent({
      name: isFallbackStrategy ? 'catchup.fallback' : 'catchup.retry',
      severity: 'warn',
      metadata: {
        ...buildCatchUpEventMetadata(source, {
          attemptIndex: nextAttemptIndex,
          status: isFallbackStrategy ? 'fallback' : 'retry',
          errorCode: reason,
          finalHost: preferredFinalHost,
          strategy: nextAttempt.strategy,
        }),
        renderer: currentSession.renderer,
        fallbackIndex: Math.max(0, nextAttemptIndex - 1),
        fallbackCount: Math.max(0, nextAttempts.length - 1),
        offsetMinutes: nextAttempt.offsetMinutes,
        fallbackUrl,
      },
    });
    return true;
  }, [
    clearCatchUpManifestNoFrameWatchdog,
    clearCatchUpStartupWatchdog,
    clearStartupAutoplayRecovery,
    commands,
    resetLoadingProgress,
    setError,
  ]);

  useImperativeHandle(ref, () => ({
    play: () => {
      // Reaching this handle means playback was requested from the UI, i.e.
      // inside a user gesture — exactly what a blocked autoplay was waiting
      // for. Lift the gate so the play() below can go through.
      autoplayBlockedSourceUrlRef.current = null;
      adapterRef.current?.play();
    },
    pause: () => {
      manualPauseRequestedRef.current = true;
      backgroundPlaybackIntentSourceRef.current = null;
      foregroundPlaybackRecoverySourceRef.current = null;
      adapterRef.current?.pause();
    },
    stop: () => {
      backgroundPlaybackIntentSourceRef.current = null;
      foregroundPlaybackRecoverySourceRef.current = null;
      adapterRef.current?.stop();
    },
    seek: (time: number) => {
      const targetPositionMs = Math.floor(Math.max(0, time) * 1000);
      const source = sessionRef.current.source;
      const minimumStartPositionSeconds = resolveCatchUpMinimumHlsStartPositionSeconds(source);
      isApplyingSessionSeekRef.current = true;
      applyingSessionSeekTargetMsRef.current = targetPositionMs;
      adapterRef.current?.seek(
        resolveRuntimeCatchUpMediaSeekTimeSeconds(
          source,
          targetPositionMs,
          minimumStartPositionSeconds,
        ),
      );
    },
    setVolume: (volume: number) => {
      adapterRef.current?.setVolume(volume);
    },
    setMuted: (muted: boolean) => {
      if (videoRef.current) {
        videoRef.current.muted = muted;
      }
    },
    toggleMute: () => {
      if (videoRef.current) {
        videoRef.current.muted = !videoRef.current.muted;
      }
    },
    getCurrentTime: () => {
      const mediaTimeSeconds = adapterRef.current?.getCurrentTime() || 0;
      return resolveRuntimeCatchUpTimelinePositionMs(
        sessionRef.current.source,
        mediaTimeSeconds,
      ) / 1000;
    },
    getDuration: () => adapterRef.current?.getDuration() || 0,
    hasRenderableFrame: () => {
      const video = videoRef.current;
      return hasRenderableMediaFrame(video);
    },
    isPlaying: () => isPlaying,
    getAudioTracks: () => adapterRef.current?.getAudioTracks?.() || [],
    getSelectedAudioTrackId: () => adapterRef.current?.getSelectedAudioTrackId?.() || null,
    setAudioTrack: (trackId: string) => adapterRef.current?.setAudioTrack?.(trackId) ?? false,
    onAudioTracksChange: (callback) => (
      adapterRef.current?.onAudioTracksChange?.(callback) ?? (() => {})
    ),
    getSubtitleTracks: () => adapterRef.current?.getSubtitleTracks?.() || [],
    getSelectedSubtitleTrackId: () => (
      adapterRef.current?.getSelectedSubtitleTrackId?.() || null
    ),
    setSubtitleTrack: (trackId: string | null) => (
      adapterRef.current?.setSubtitleTrack?.(trackId) ?? false
    ),
    onSubtitleTracksChange: (callback) => (
      adapterRef.current?.onSubtitleTracksChange?.(callback) ?? (() => {})
    ),
    isPictureInPictureSupported: () => isPictureInPictureSupported(),
    isPictureInPicture: () => isPictureInPicture,
    enterPictureInPicture: () => enterPictureInPicture(),
    exitPictureInPicture: () => exitPictureInPicture(),
    togglePictureInPicture: () => togglePictureInPicture(),
    onPictureInPictureChange: (callback) => {
      pictureInPictureListenersRef.current.add(callback);
      callback(isPictureInPicture);
      return () => {
        pictureInPictureListenersRef.current.delete(callback);
      };
    },
    isAirPlaySupported: () => isAirPlaySupported(),
    isAirPlayAvailable: () => isAirPlayAvailable,
    isAirPlayConnected: () => isAirPlayConnected,
    showAirPlayPicker: () => showAirPlayPicker(),
    onAirPlayAvailabilityChange: (callback) => {
      airPlayAvailabilityListenersRef.current.add(callback);
      callback(isAirPlayAvailable);
      return () => {
        airPlayAvailabilityListenersRef.current.delete(callback);
      };
    },
    onAirPlayConnectionChange: (callback) => {
      airPlayConnectionListenersRef.current.add(callback);
      callback(isAirPlayConnected);
      return () => {
        airPlayConnectionListenersRef.current.delete(callback);
      };
    },
  }));

  const mapPlaybackError = useCallback((playbackError: PlaybackError): PlayerError => {
    if (playbackError.code === 'MIXED_CONTENT') {
      return {
        type: 'mixed-content',
        message: 'Nije moguće učitati stream',
        details: 'HTTPS stranica ne može pristupiti HTTP streamu. Koristite HTTPS verziju IPTV servera ili pristupite aplikaciji preko HTTP-a.',
      };
    }

    if (playbackError.code === 'NETWORK_ERROR') {
      return {
        type: 'network',
        message: 'Greška u mreži',
        details: 'Proverite internet konekciju i dostupnost servera.',
      };
    }

    if (playbackError.code === 'MEDIA_ERROR' || playbackError.code === 'HLS_NOT_SUPPORTED') {
      return {
        type: 'format',
        message: 'Format streama nije podržan',
        details: playbackError.message,
      };
    }

    return {
      type: 'unknown',
      message: 'Greška pri reprodukciji',
      details: playbackError.message,
    };
  }, []);

  const scheduleCatchUpSeekWatchdog = useCallback((
    adapter: HlsPlayerAdapter,
    targetPositionMs: number,
  ) => {
    if (
      catchUpSeekWatchdogTimerRef.current !== null &&
      catchUpSeekWatchdogTargetMsRef.current === targetPositionMs
    ) {
      return;
    }

    clearCatchUpSeekWatchdog();
    catchUpSeekWatchdogTargetMsRef.current = targetPositionMs;

    const watchedSourceUrl = sessionRef.current.source?.url ?? null;
    if (!watchedSourceUrl) {
      catchUpSeekWatchdogTargetMsRef.current = null;
      return;
    }
    const watchdogDelayMs = resolveCatchUpSeekWatchdogDelayMs(
      sessionRef.current.source,
      CATCH_UP_SEEK_WATCHDOG_DELAY_MS,
      CATCH_UP_REBASE_SEEK_WATCHDOG_DELAY_MS,
    );

    catchUpSeekWatchdogTimerRef.current = setTimeout(() => {
      catchUpSeekWatchdogTimerRef.current = null;
      catchUpSeekWatchdogTargetMsRef.current = null;
      if (adapterRef.current !== adapter) {
        return;
      }

      const currentSession = sessionRef.current;
      const currentSource = currentSession.source;
      const mediaElement = videoRef.current;
      if (!currentSource || currentSource.url !== watchedSourceUrl || !mediaElement) {
        return;
      }

      const metadata = (
        typeof currentSource.metadata === 'object' &&
        currentSource.metadata !== null
      )
        ? currentSource.metadata as Record<string, unknown>
        : {};
      const attemptedRetries = Math.floor(
        parseNumericMetadataValue(metadata.catchUpSeekNoFrameRetryCount) ?? 0,
      );
      const currentTimelineTimeSeconds = resolveRuntimeCatchUpTimelinePositionMs(
        currentSource,
        adapter.getCurrentTime(),
      ) / 1000;
      const decision = resolveCatchUpSeekNoFrameDecision(currentSession, {
        currentTimeSeconds: currentTimelineTimeSeconds,
        hasRenderableFrame: hasRenderableMediaFrame(mediaElement),
      }, {
        targetPositionMs,
        attemptedRetries,
        maxRetries: CATCH_UP_SEEK_NO_FRAME_MAX_RETRIES,
      });

      if (decision === 'wait') {
        return;
      }

      const targetMediaPositionSeconds = resolveRuntimeCatchUpMediaSeekTimeSeconds(
        currentSource,
        targetPositionMs,
        resolveCatchUpMinimumHlsStartPositionSeconds(currentSource),
      );
      if (decision === 'retry') {
        const retryStartPositionSeconds = resolveCatchUpMinimumHlsStartPositionSeconds(currentSource);
        isApplyingSessionSeekRef.current = true;
        applyingSessionSeekTargetMsRef.current = targetPositionMs;
        pendingAutoplaySourceUrlRef.current = currentSource.url;
        setError(null);
        setIsLoading(true);
        resetLoadingProgress('segment');
        commands.setSource({
          ...currentSource,
          metadata: {
            ...metadata,
            catchUpHlsStartPositionSeconds: retryStartPositionSeconds,
            catchUpPendingTimelineSeekMs: targetPositionMs,
            catchUpPendingMediaSeekSeconds: targetMediaPositionSeconds,
            catchUpSeekNoFrameRetryCount: attemptedRetries + 1,
            loadKey: Date.now(),
          },
        }, targetPositionMs);
        commands.play();
        emitWebObservabilityEvent({
          name: 'catchup.retry',
          severity: 'warn',
          metadata: {
            renderer: currentSession.renderer,
            positionMs: targetPositionMs,
            currentTimeSeconds: currentTimelineTimeSeconds,
            ...buildCatchUpEventMetadata(currentSource, {
              status: 'seek_no_frame_retry',
              errorCode: 'SEEK_NO_FRAME',
            }),
          },
        });
        return;
      }

      clearStartupAutoplayRecovery();
      clearCatchUpStartupWatchdog();
      isApplyingSessionSeekRef.current = false;
      applyingSessionSeekTargetMsRef.current = null;
      pendingAutoplaySourceUrlRef.current = null;
      const fallbackPositionMs = resolveCatchUpSeekRecoveryFallbackPositionMs({
        targetPositionMs,
        lastRenderablePositionMs: lastRenderableCatchUpPositionMsRef.current,
      });
      if (fallbackPositionMs !== null) {
        const fallbackMediaPositionSeconds = resolveRuntimeCatchUpMediaSeekTimeSeconds(
          currentSource,
          fallbackPositionMs,
          resolveCatchUpMinimumHlsStartPositionSeconds(currentSource),
        );
        isApplyingSessionSeekRef.current = true;
        applyingSessionSeekTargetMsRef.current = fallbackPositionMs;
        pendingAutoplaySourceUrlRef.current = currentSource.url;
        setError(null);
        setIsLoading(true);
        resetLoadingProgress('segment');
        commands.setSource({
          ...currentSource,
          metadata: {
            ...metadata,
            catchUpHlsStartPositionSeconds: fallbackMediaPositionSeconds,
            catchUpPendingTimelineSeekMs: fallbackPositionMs,
            catchUpPendingMediaSeekSeconds: fallbackMediaPositionSeconds,
            catchUpSeekNoFrameRetryCount: 0,
            catchUpSeekRecoveryFallbackFromMs: targetPositionMs,
            loadKey: Date.now(),
          },
        }, fallbackPositionMs);
        commands.play();
        emitWebObservabilityEvent({
          name: 'catchup.seek_fallback',
          severity: 'warn',
          metadata: {
            renderer: currentSession.renderer,
            positionMs: fallbackPositionMs,
            failedPositionMs: targetPositionMs,
            mediaPositionSeconds: fallbackMediaPositionSeconds,
            ...buildCatchUpEventMetadata(currentSource, {
              status: 'seek_fallback',
              errorCode: 'SEEK_NO_FRAME',
            }),
          },
        });
        return;
      }

      if (switchToCatchUpFallbackIfAvailable('SEEK_NO_FRAME')) {
        return;
      }

      recordCatchUpRuntimeCompatibility(currentSource, 'unsupported', 'seek-no-frame');
      setError(resolveSessionSourceBlockingError(currentSource, 'MEDIA_ERROR')
        ?? resolveCatchUpStartupUnavailableError(currentSource)
        ?? {
          type: 'network',
          message: 'Snimak za TV unazad trenutno nije dostupan',
          details: 'Snimak za TV unazad se zaustavio posle premotavanja. Provajder trenutno ne vraća stabilan arhivski stream za taj termin. Pokušajte ponovo ili gledajte kanal uživo.',
          primaryAction: 'switch-to-live',
          primaryActionLabel: 'Gledaj kanal uživo',
        });
      setIsLoading(false);
      clearLoadingProgress();
      setIsPlaying(false);
      adapter.stop();
      if (sessionWantsPlayback(currentSession)) {
        commands.pause();
      }
      emitWebObservabilityEvent({
        name: 'catchup.seek_timeout',
        severity: 'warn',
        metadata: {
          renderer: currentSession.renderer,
          positionMs: targetPositionMs,
          currentTimeSeconds: currentTimelineTimeSeconds,
          ...buildCatchUpEventMetadata(currentSource, {
            status: 'seek_no_frame_blocked',
            errorCode: 'SEEK_NO_FRAME',
          }),
        },
      });
    }, watchdogDelayMs);
  }, [
    clearCatchUpSeekWatchdog,
    clearCatchUpStartupWatchdog,
    clearLoadingProgress,
    clearStartupAutoplayRecovery,
    commands,
    resetLoadingProgress,
    recordCatchUpRuntimeCompatibility,
    resolveRuntimeCatchUpMediaSeekTimeSeconds,
    resolveRuntimeCatchUpTimelinePositionMs,
    setError,
    switchToCatchUpFallbackIfAvailable,
  ]);

  useEffect(() => () => {
    adapterRef.current?.stop();
  }, [sourceLoadKey, isLocalRenderer]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const adapter = new HlsPlayerAdapter(video, {
      preferNativeHls,
      onUnsupportedAudioCodec: ({ unsupportedAudioCodec, sourceUrl }) => {
        const currentSession = sessionRef.current;
        const currentSource = currentSession.source;
        if (!currentSource || currentSource.url !== sourceUrl) {
          return;
        }

        setUnsupportedAudioCodec(unsupportedAudioCodec);
        const metadata = (
          typeof currentSource.metadata === 'object' &&
          currentSource.metadata !== null
        )
          ? currentSource.metadata as Record<string, unknown>
          : {};

        if (metadata.unsupportedAudioCodec === unsupportedAudioCodec) {
          return;
        }

        commands.setSource({
          ...currentSource,
          metadata: {
            ...metadata,
            unsupportedAudioCodec,
          },
        }, currentSession.positionMs ?? 0);
        emitWebObservabilityEvent({
          name: 'playback.unsupported_audio_codec',
          severity: 'warn',
          metadata: {
            renderer: currentSession.renderer,
            channelId: currentSource.channelId ?? null,
            streamId: metadata.streamId ?? null,
            unsupportedAudioCodec,
            fallback: 'video_only',
          },
        });
      },
      onUnsupportedVideoCodec: ({ unsupportedVideoCodec, sourceUrl }) => {
        const currentSession = sessionRef.current;
        const currentSource = currentSession.source;
        if (!currentSource || currentSource.url !== sourceUrl) {
          return;
        }

        setUnsupportedVideoCodec(unsupportedVideoCodec);
        const metadata = (
          typeof currentSource.metadata === 'object' &&
          currentSource.metadata !== null
        )
          ? currentSource.metadata as Record<string, unknown>
          : {};

        if (metadata.unsupportedVideoCodec === unsupportedVideoCodec) {
          return;
        }

        commands.setSource({
          ...currentSource,
          metadata: {
            ...metadata,
            unsupportedVideoCodec,
          },
        }, currentSession.positionMs ?? 0);
        emitWebObservabilityEvent({
          name: 'playback.unsupported_video_codec',
          severity: 'warn',
          metadata: {
            renderer: currentSession.renderer,
            channelId: currentSource.channelId ?? null,
            streamId: metadata.streamId ?? null,
            unsupportedVideoCodec,
          },
        });
      },
      onCatchUpRebaseFallback: ({ reason, sourceUrl }) => {
        const currentSession = sessionRef.current;
        const currentSource = currentSession.source;
        const metadata = (
          typeof currentSource?.metadata === 'object' &&
          currentSource.metadata !== null
        )
          ? currentSource.metadata as Record<string, unknown>
          : {};
        const streamId = parseNumericMetadataValue(metadata.streamId);
        if (typeof streamId === 'number') {
          recordCatchUpClientRebaseFailure(streamId, reason);
        }
        emitWebObservabilityEvent({
          name: 'catchup.rebase',
          severity: 'warn',
          metadata: {
            status: 'fallback',
            reason,
            renderer: currentSession.renderer,
            channelId: currentSource?.channelId ?? null,
            streamId: streamId ?? null,
            sourceUrl,
          },
        });
      },
      onCatchUpRebaseBoundary: (boundary) => {
        const currentSession = sessionRef.current;
        const currentSource = currentSession.source;
        const metadata = (
          typeof currentSource?.metadata === 'object' &&
          currentSource.metadata !== null
        )
          ? currentSource.metadata as Record<string, unknown>
          : {};
        emitWebObservabilityEvent({
          name: 'catchup.rebase',
          severity: 'info',
          metadata: {
            status: 'boundary',
            renderer: currentSession.renderer,
            channelId: currentSource?.channelId ?? null,
            streamId: metadata.streamId ?? null,
            afterSegmentIndex: boundary.afterSegmentIndex,
            beforeSegmentIndex: boundary.beforeSegmentIndex,
            predictedMediaTimeSeconds: boundary.predictedMediaTimeSeconds,
            videoHoleMs: boundary.videoHoleMs,
            boundaryDeltaMs: boundary.boundaryDeltaMs,
          },
        });
      },
      onCatchUpRebaseSummary: (stats) => {
        const currentSession = sessionRef.current;
        const currentSource = currentSession.source;
        const metadata = (
          typeof currentSource?.metadata === 'object' &&
          currentSource.metadata !== null
        )
          ? currentSource.metadata as Record<string, unknown>
          : {};
        emitWebObservabilityEvent({
          name: 'catchup.rebase',
          severity: 'info',
          metadata: {
            status: 'summary',
            renderer: currentSession.renderer,
            channelId: currentSource?.channelId ?? null,
            streamId: metadata.streamId ?? null,
            segments: stats.segments,
            chained: stats.chained,
            anchored: stats.anchored,
            trimmedPackets: stats.trimmedPackets,
            anomalies: stats.anomalies,
            maxBoundaryDeltaMs: stats.maxBoundaryDeltaMs,
            boundaryCount: stats.boundaries.length,
            processedBytes: stats.processedBytes,
            totalProcessingMs: Number(stats.totalProcessingMs.toFixed(2)),
            maxProcessingMs: Number(stats.maxProcessingMs.toFixed(2)),
            maxSegmentBytes: stats.maxSegmentBytes,
            slowSegments: stats.slowSegments,
          },
        });
      },
      onCatchUpStall: ({
        trigger,
        currentTimeSeconds,
        nearestBoundaryMediaTimeSeconds,
        distanceToBoundaryMs,
        videoHoleMs,
      }) => {
        const currentSession = sessionRef.current;
        const currentSource = currentSession.source;
        const metadata = (
          typeof currentSource?.metadata === 'object' &&
          currentSource.metadata !== null
        )
          ? currentSource.metadata as Record<string, unknown>
          : {};
        emitWebObservabilityEvent({
          name: 'catchup.stall',
          severity: 'warn',
          metadata: {
            trigger,
            renderer: currentSession.renderer,
            channelId: currentSource?.channelId ?? null,
            streamId: metadata.streamId ?? null,
            currentTimeSeconds,
            nearestBoundaryMediaTimeSeconds,
            distanceToBoundaryMs,
            videoHoleMs,
          },
        });
      },
      onManifestResolved: ({ requestedUrl, manifestUrl, finalUrl }) => {
        const source = sessionRef.current.source;
        if (
          !source ||
          typeof source.metadata !== 'object' ||
          source.metadata === null ||
          typeof finalUrl !== 'string'
        ) {
          return;
        }

        const metadata = source.metadata as Record<string, unknown>;
        if (metadata.mode !== 'catchup') {
          return;
        }
        catchUpRuntimeCompatibilityObservedUrlRef.current = finalUrl ?? manifestUrl;
        updateLoadingProgressPhase('playlist');

        const scheduledStartupTimeoutCount = Math.floor(
          parseNumericMetadataValue(metadata.catchUpStartupTimeoutCount) ?? 0,
        );
        const scheduledStartupFallbackCount = Math.floor(
          parseNumericMetadataValue(metadata.catchUpStartupFallbackCount) ?? 0,
        );
        const watchdogDelayMs = resolveCatchUpManifestNoFrameWatchdogDelayMs(
          { source },
          scheduledStartupTimeoutCount,
          scheduledStartupFallbackCount,
          CATCH_UP_MANIFEST_NO_FRAME_FALLBACK_DELAY_MS,
          CATCH_UP_MANIFEST_NO_FRAME_UNAVAILABLE_DELAY_MS,
        );

        clearCatchUpManifestNoFrameWatchdog();
        const watchedSourceUrl = source.url;
        const armManifestNoFrameWatchdog = (delayMs: number) => {
          catchUpManifestNoFrameWatchdogTimerRef.current = setTimeout(
            runManifestNoFrameWatchdog,
            Math.max(0, delayMs),
          );
        };
        const runManifestNoFrameWatchdog = () => {
          catchUpManifestNoFrameWatchdogTimerRef.current = null;
          const currentSession = sessionRef.current;
          const currentSource = currentSession.source;
          if (
            !currentSource ||
            currentSource.url !== watchedSourceUrl ||
            currentSource.metadata?.mode !== 'catchup' ||
            !sessionWantsPlayback(currentSession)
          ) {
            return;
          }

          const mediaElement = videoRef.current;
          if (hasRenderableMediaFrame(mediaElement)) {
            return;
          }

          // A slow first segment may still be in flight from the edge. Reseeking
          // now would re-fetch seg=0 on top of the live load and loop. Wait one
          // more grace window for the segment to land before giving up.
          if (catchUpFirstSegmentLikelyInFlight(
            adapterRef.current?.getSegmentLoadDiagnostics(),
            CATCH_UP_SEGMENT_IN_FLIGHT_GRACE_MS,
          )) {
            emitWebObservabilityEvent({
              name: 'catchup.startup_segment_in_flight',
              severity: 'info',
              metadata: {
                renderer: currentSession.renderer,
                ...buildCatchUpEventMetadata(currentSource, {
                  status: 'segment_in_flight',
                  errorCode: 'STARTUP_TIMEOUT_DEFERRED',
                }),
              },
            });
            armManifestNoFrameWatchdog(CATCH_UP_SEGMENT_IN_FLIGHT_GRACE_MS);
            return;
          }

          const currentMetadata = (
            typeof currentSource.metadata === 'object' &&
            currentSource.metadata !== null
          )
            ? currentSource.metadata as Record<string, unknown>
            : {};
          const startupTimeoutCount = Math.floor(
            parseNumericMetadataValue(currentMetadata.catchUpStartupTimeoutCount) ?? 0,
          );
          const startupFallbackCount = Math.floor(
            parseNumericMetadataValue(currentMetadata.catchUpStartupFallbackCount) ?? 0,
          );
          if (
            !shouldShowCatchUpManifestNoFrameUnavailable(
              currentSession,
              startupTimeoutCount,
              startupFallbackCount,
            ) &&
            switchToCatchUpFallbackIfAvailable('STARTUP_TIMEOUT')
          ) {
            return;
          }

          const providerIssueError = resolveSessionSourceBlockingError(
            currentSource,
            'STARTUP_TIMEOUT',
          );
          if (providerIssueError) {
            clearStartupAutoplayRecovery();
            clearCatchUpStartupWatchdog();
            pendingAutoplaySourceUrlRef.current = null;
            recordCatchUpRuntimeCompatibility(currentSource, 'unsupported', 'manifest-no-frame');
            setError(providerIssueError);
            setIsLoading(false);
            clearLoadingProgress();
            setIsPlaying(false);
            adapterRef.current?.stop();
            if (sessionWantsPlayback(currentSession)) {
              commands.pause();
            }
            emitWebObservabilityEvent({
              name: 'catchup.startup_timeout',
              severity: 'warn',
              metadata: {
                renderer: currentSession.renderer,
                ...buildCatchUpEventMetadata(currentSource, {
                  status: 'provider_issue',
                  errorCode: 'STARTUP_TIMEOUT',
                }),
              },
            });
            return;
          }

          clearStartupAutoplayRecovery();
          clearLiveNoFrameWatchdog();
          clearCatchUpStartupWatchdog();
          pendingAutoplaySourceUrlRef.current = null;
          recordCatchUpRuntimeCompatibility(currentSource, 'unsupported', 'manifest-no-frame');
          setError(resolveCatchUpStartupUnavailableError(currentSource) ?? {
            type: 'network',
            message: 'Snimak za TV unazad trenutno nije dostupan',
            details: 'Provajder trenutno ne vraća ispravan arhivski snimak za ovaj termin. Pokušajte ponovo ili gledajte kanal uživo.',
          });
          setIsLoading(false);
          clearLoadingProgress();
          setIsPlaying(false);
          adapterRef.current?.stop();
          if (sessionWantsPlayback(currentSession)) {
            commands.pause();
          }
          emitWebObservabilityEvent({
            name: 'catchup.startup_timeout',
            severity: 'warn',
            metadata: {
              renderer: currentSession.renderer,
              ...buildCatchUpEventMetadata(currentSource, {
                status: 'manifest_no_frame',
                errorCode: 'STARTUP_TIMEOUT',
              }),
            },
          });
        };
        armManifestNoFrameWatchdog(watchdogDelayMs);

        const requestHost = resolveCatchUpTargetOrigin(requestedUrl);
        const finalHost = rememberCatchUpHostAffinity(requestedUrl, finalUrl) ??
          resolveCatchUpTargetOrigin(finalUrl);
        if (!requestHost || !finalHost || requestHost === finalHost) {
          return;
        }

        const { currentAttemptIndex } = resolveCatchUpAttemptState(metadata, source.url);
        emitWebObservabilityEvent({
          name: 'catchup.redirect',
          severity: 'info',
          metadata: {
            ...buildCatchUpEventMetadata(source, {
              attemptIndex: currentAttemptIndex,
              status: 'redirect',
              errorCode: null,
              finalHost,
            }),
            requestHost,
            finalHost,
            requestUrl: requestedUrl,
            manifestUrl,
            finalUrl,
          },
        });
      },
    });
    adapterRef.current = adapter;
    adapter.setDocumentHidden(document.visibilityState === 'hidden');

    const unsubscribeState = adapter.onStateChange((state) => {
      const currentSession = sessionRef.current;
      const recoverUnexpectedLiveStop = (
        reason: 'pause' | 'idle' | 'no-frame',
        manualPauseRequested: boolean,
        recoverySession: typeof currentSession = sessionRef.current,
      ): boolean => {
        const currentSourceUrl = recoverySession.source?.url ?? null;
        const hasRenderableFrame = hasRenderableMediaFrame(videoRef.current);
        if (
          recoverySession.source &&
          shouldResumeRenderableLiveAfterUnexpectedStop(recoverySession, {
            manualPauseRequested,
            hasRenderableFrame,
          })
        ) {
          liveUnexpectedPauseRecoverySourceRef.current = recoverySession.source.url;
          liveUnexpectedPauseRecoveryAttemptsRef.current = 0;
          clearStartupAutoplayRecovery();
          clearLiveNoFrameWatchdog();
          clearCatchUpStartupWatchdog();
          pendingAutoplaySourceUrlRef.current = recoverySession.source.url;
          setError(null);
          setIsPlaying(true);
          setIsLoading(false);
          clearLoadingProgress();
          adapter.play();
          const metadata = (
            typeof recoverySession.source.metadata === 'object' &&
            recoverySession.source.metadata !== null
          )
            ? recoverySession.source.metadata
            : {};
          const errorCode = reason === 'pause'
            ? 'LIVE_UNEXPECTED_PAUSE'
            : (reason === 'idle' ? 'LIVE_UNEXPECTED_IDLE' : 'LIVE_NO_FRAME');
          emitWebObservabilityEvent({
            name: 'playback.retry',
            severity: 'warn',
            metadata: {
              renderer: recoverySession.renderer,
              channelId: recoverySession.source.channelId ?? null,
              streamId: metadata.streamId ?? null,
              status: `unexpected_${reason}_resume`,
              errorCode,
            },
          });
          return true;
        }
        const attemptedRetries = (
          currentSourceUrl !== null &&
          liveUnexpectedPauseRecoverySourceRef.current === currentSourceUrl
        )
          ? liveUnexpectedPauseRecoveryAttemptsRef.current
          : 0;
        const decision = resolveLiveUnexpectedStopDecision(recoverySession, {
          manualPauseRequested,
          attemptedRetries,
          maxRetries: LIVE_UNEXPECTED_PAUSE_MAX_RETRIES,
        });

        if (decision === 'retry' && recoverySession.source) {
          const metadata = (
            typeof recoverySession.source.metadata === 'object' &&
            recoverySession.source.metadata !== null
          )
            ? recoverySession.source.metadata
            : {};
          liveUnexpectedPauseRecoverySourceRef.current = recoverySession.source.url;
          liveUnexpectedPauseRecoveryAttemptsRef.current = attemptedRetries + 1;
          clearStartupAutoplayRecovery();
          clearLiveNoFrameWatchdog();
          clearCatchUpStartupWatchdog();
          pendingAutoplaySourceUrlRef.current = recoverySession.source.url;
          setError(null);
          setIsPlaying(true);
          setIsLoading(true);
          resetLoadingProgress('requesting');
          commands.setSource({
            ...recoverySession.source,
            metadata: {
              ...metadata,
              liveUnexpectedStopRecoveryRetryCount: attemptedRetries + 1,
              loadKey: Date.now(),
            },
          }, recoverySession.positionMs ?? 0);
          commands.play();
          const errorCode = reason === 'pause'
            ? 'LIVE_UNEXPECTED_PAUSE'
            : (reason === 'idle' ? 'LIVE_UNEXPECTED_IDLE' : 'LIVE_NO_FRAME');
          emitWebObservabilityEvent({
            name: 'playback.retry',
            severity: 'warn',
            metadata: {
              renderer: recoverySession.renderer,
              channelId: recoverySession.source.channelId ?? null,
              streamId: metadata.streamId ?? null,
              status: `unexpected_${reason}_retry`,
              errorCode,
            },
          });
          return true;
        }

        if (decision === 'block' && recoverySession.source) {
          const liveFailureError = resolveSessionSourceBlockingError(
            recoverySession.source,
            'MEDIA_ERROR'
          ) ?? {
            type: 'network',
            message: 'Live kanal trenutno nije dostupan',
            details: `Live stream se prekinuo tokom reprodukcije. Stream ne stiže stabilno od provajdera ili servera. Nije do vašeg uređaja niti do ${BRAND_SHORT} playera.`,
            primaryAction: 'report-problem',
            primaryActionLabel: 'Prijavi problem',
          } satisfies PlayerError;
          clearStartupAutoplayRecovery();
          clearLiveNoFrameWatchdog();
          clearCatchUpStartupWatchdog();
          pendingAutoplaySourceUrlRef.current = null;
          setError(liveFailureError);
          setIsPlaying(false);
          setIsLoading(false);
          clearLoadingProgress();
          adapter.stop();
          if (sessionWantsPlayback(recoverySession)) {
            commands.pause();
          }
          const errorCode = reason === 'pause'
            ? 'LIVE_UNEXPECTED_PAUSE'
            : (reason === 'idle' ? 'LIVE_UNEXPECTED_IDLE' : 'LIVE_NO_FRAME');
          emitWebObservabilityEvent({
            name: 'playback.error',
            severity: 'warn',
            metadata: {
              renderer: recoverySession.renderer,
              channelId: recoverySession.source.channelId ?? null,
              code: errorCode,
              fatal: false,
              terminal: true,
              status: `unexpected_${reason}_blocked`,
            },
          });
          return true;
        }

        return false;
      };

      if (state === 'loading' || state === 'buffering') {
        clearLiveNoFrameWatchdog();
        if (state === 'loading') {
          resetLoadingProgress('requesting');
        } else {
          updateLoadingProgressPhase('segment');
        }
        setIsLoading(true);
      }

      if (state === 'playing') {
        foregroundPlaybackRecoverySourceRef.current = null;
        clearLiveNoFrameWatchdog();
        const playingMediaElement = videoRef.current;
        const isCatchUpPlaying = currentSession.source?.metadata?.mode === 'catchup';
        const hasRenderablePlayingFrame = hasRenderableMediaFrame(playingMediaElement);

        if (isCatchUpPlaying && !hasRenderablePlayingFrame) {
          updateLoadingProgressPhase('segment');
          setIsPlaying(false);
          setIsLoading(true);
          return;
        }

        clearStartupAutoplayRecovery();
        clearCatchUpStartupWatchdog();
        clearCatchUpManifestNoFrameWatchdog();
        startupHardRetrySourceUrlRef.current = null;
        pendingAutoplaySourceUrlRef.current = null;
        autoplayBlockedSourceUrlRef.current = null;
        setError(null);
        setIsPlaying(true);
        setIsLoading(false);
        clearLoadingProgress();
        onCanPlay?.();

        if (
          isCatchUpPlaying &&
          hasRenderablePlayingFrame
        ) {
          recordCatchUpRuntimeCompatibility(currentSession.source, 'playable', 'rendered-frame');
          lastRenderableCatchUpPositionMsRef.current = resolveRuntimeCatchUpTimelinePositionMs(
            currentSession.source,
            adapter.getCurrentTime(),
          );
        }

        const pendingCatchUpSeek = resolveCatchUpPendingStartupSeek(currentSession.source, {
          fallbackTimelinePositionMs: currentSession.positionMs,
          minimumMediaPositionSeconds: resolveCatchUpMinimumHlsStartPositionSeconds(currentSession.source),
        });
        if (pendingCatchUpSeek) {
          const metadata = (
            typeof currentSession.source?.metadata === 'object' &&
            currentSession.source.metadata !== null
          )
            ? currentSession.source.metadata as Record<string, unknown>
            : {};
          const pendingSeekKey = [
            currentSession.source?.url ?? '',
            metadata.loadKey ?? '',
            pendingCatchUpSeek.timelinePositionMs,
            pendingCatchUpSeek.mediaPositionSeconds,
          ].join(':');
          const mediaElement = videoRef.current;
          const hasRenderableFrame = hasRenderableMediaFrame(mediaElement);
          if (
            hasRenderableFrame &&
            catchUpPendingStartupSeekAppliedKeyRef.current !== pendingSeekKey
          ) {
            catchUpPendingStartupSeekAppliedKeyRef.current = pendingSeekKey;
            isApplyingSessionSeekRef.current = true;
            applyingSessionSeekTargetMsRef.current = pendingCatchUpSeek.timelinePositionMs;
            pendingAutoplaySourceUrlRef.current = null;
            adapter.seek(pendingCatchUpSeek.mediaPositionSeconds);
            scheduleCatchUpSeekWatchdog(adapter, pendingCatchUpSeek.timelinePositionMs);
            if (currentSession.positionMs !== pendingCatchUpSeek.timelinePositionMs) {
              commands.seek(pendingCatchUpSeek.timelinePositionMs);
            }
            emitWebObservabilityEvent({
              name: 'catchup.pending_seek_applied',
              severity: 'info',
              metadata: {
                renderer: currentSession.renderer,
                positionMs: pendingCatchUpSeek.timelinePositionMs,
                mediaPositionSeconds: pendingCatchUpSeek.mediaPositionSeconds,
                ...buildCatchUpEventMetadata(currentSession.source, {
                  status: 'pending_seek_applied',
                  errorCode: null,
                }),
              },
            });
          }
        }

        const sourceUrl = sessionRef.current.source?.url ?? null;
        if (sourceUrl && sourceUrl !== lastStartedSourceRef.current) {
          lastStartedSourceRef.current = sourceUrl;
          emitWebObservabilityEvent({
            name: 'playback.started',
            severity: 'info',
            metadata: {
              renderer: sessionRef.current.renderer,
              sourceType: sessionRef.current.source?.type ?? 'unknown',
            },
          });
        }

        if (!sessionWantsPlayback(currentSession)) {
          commands.play();
        }
        return;
      }

      if (state === 'paused') {
        const manualPauseRequested = manualPauseRequestedRef.current;
        manualPauseRequestedRef.current = false;
        if (shouldPreservePlaybackIntentDuringBackgroundPause(currentSession, {
          isDocumentHidden: document.visibilityState === 'hidden',
          isForegroundRecoveryPending: (
            foregroundPlaybackRecoverySourceRef.current === currentSession.source?.url
          ),
          isBackgroundPlaybackIntent: (
            backgroundPlaybackIntentSourceRef.current === currentSession.source?.url
          ),
          manualPauseRequested,
        })) {
          backgroundPlaybackIntentSourceRef.current = currentSession.source?.url ?? null;
          return;
        }
        const sourceMetadata = (
          typeof currentSession.source?.metadata === 'object' &&
          currentSession.source.metadata !== null
        )
          ? currentSession.source.metadata as Record<string, unknown>
          : null;
        const catchUpSeekFallbackFromMs = parseNumericMetadataValue(
          sourceMetadata?.catchUpSeekRecoveryFallbackFromMs,
        );
        if (
          !manualPauseRequested &&
          autoPlay &&
          currentSession.source?.metadata?.mode === 'catchup' &&
          isApplyingSessionSeekRef.current &&
          applyingSessionSeekTargetMsRef.current !== null &&
          sessionWantsPlayback(currentSession)
        ) {
          const retryKey = [
            currentSession.source.url,
            sourceMetadata?.loadKey ?? '',
            applyingSessionSeekTargetMsRef.current,
          ].join(':');
          if (catchUpSeekAutoplayRetryKeyRef.current !== retryKey) {
            catchUpSeekAutoplayRetryKeyRef.current = retryKey;
            pendingAutoplaySourceUrlRef.current = currentSession.source.url;
            adapter.play();
            return;
          }
        }
        if (
          !manualPauseRequested &&
          autoPlay &&
          currentSession.source?.metadata?.mode === 'catchup' &&
          typeof catchUpSeekFallbackFromMs === 'number'
        ) {
          const retryKey = [
            currentSession.source.url,
            sourceMetadata?.loadKey ?? '',
            catchUpSeekFallbackFromMs,
          ].join(':');
          if (catchUpSeekFallbackAutoplayRetryKeyRef.current !== retryKey) {
            catchUpSeekFallbackAutoplayRetryKeyRef.current = retryKey;
            pendingAutoplaySourceUrlRef.current = currentSession.source.url;
            commands.play();
            adapter.play();
            return;
          }
        }

        if (!manualPauseRequested && shouldHoldPauseSyncOnSourceStartup(
          currentSession,
          pendingAutoplaySourceUrlRef.current
        )) {
          const isCatchUpStartup = currentSession.source?.metadata?.mode === 'catchup';
          const maxAutoplayRecoveryRetries = isCatchUpStartup
            ? CATCH_UP_STARTUP_AUTOPLAY_RECOVERY_MAX_RETRIES
            : STARTUP_AUTOPLAY_RECOVERY_MAX_RETRIES;
          if (
            shouldRetryPendingAutoplayAfterPausedEvent(
              currentSession,
              pendingAutoplaySourceUrlRef.current,
              startupAutoplayRecoveryAttemptsRef.current,
              maxAutoplayRecoveryRetries
            )
          ) {
            if (startupAutoplayRecoveryTimerRef.current !== null) {
              clearTimeout(startupAutoplayRecoveryTimerRef.current);
            }

            startupAutoplayRecoveryAttemptsRef.current += 1;
            const retryDelayMs = Math.min(
              isCatchUpStartup
                ? CATCH_UP_STARTUP_AUTOPLAY_RECOVERY_MAX_DELAY_MS
                : Number.POSITIVE_INFINITY,
              STARTUP_AUTOPLAY_RECOVERY_BASE_DELAY_MS * startupAutoplayRecoveryAttemptsRef.current,
            );
            if (isCatchUpStartup) {
              setIsLoading(true);
              updateLoadingProgressPhase('segment');
            }
            startupAutoplayRecoveryTimerRef.current = setTimeout(() => {
              startupAutoplayRecoveryTimerRef.current = null;
              const nextSession = sessionRef.current;
              if (
                shouldHoldPauseSyncOnSourceStartup(
                  nextSession,
                  pendingAutoplaySourceUrlRef.current
                )
              ) {
                adapterRef.current?.play();
              }
            }, retryDelayMs);
            return;
          }

          clearStartupAutoplayRecovery();
          pendingAutoplaySourceUrlRef.current = null;
          setIsPlaying(false);
          setIsLoading(false);
          clearLoadingProgress();
          if (currentSession.source && sessionWantsPlayback(currentSession)) {
            commands.pause();
          }
          return;
        }

        if (recoverUnexpectedLiveStop('pause', manualPauseRequested)) {
          return;
        }

        setIsPlaying(false);
        setIsLoading(false);
        clearLoadingProgress();

        if (currentSession.source && sessionWantsPlayback(currentSession)) {
          commands.pause();
        }
        return;
      }

      if (state === 'ended') {
        clearStartupAutoplayRecovery();
        clearCatchUpStartupWatchdog();
        pendingAutoplaySourceUrlRef.current = null;
        setIsPlaying(false);
        setIsLoading(false);
        clearLoadingProgress();
        onEndedRef.current?.();
        return;
      }

      if (state === 'idle') {
        if (deferPlaybackFailureWhileBackgrounded('BACKGROUND_PLAYBACK_IDLE')) {
          return;
        }
        if (shouldResumeForegroundRecoveryOnIdle(
          currentSession,
          foregroundPlaybackRecoverySourceRef.current,
        )) {
          adapter.play();
          return;
        }
        const shouldKeepPendingAutoplay = shouldKeepPendingAutoplayOnIdle(
          currentSession,
          pendingAutoplaySourceUrlRef.current
        );
        if (!shouldKeepPendingAutoplay && recoverUnexpectedLiveStop('idle', false)) {
          return;
        }
        if (!shouldKeepPendingAutoplay) {
          clearStartupAutoplayRecovery();
          pendingAutoplaySourceUrlRef.current = null;
        }
        setIsPlaying(false);
        setIsLoading(false);
        clearLoadingProgress();
      }
    });

    const unsubscribeError = adapter.onError((playbackError) => {
      const currentSession = sessionRef.current;
      const mediaElement = videoRef.current;
      const hasRenderableFrame = Boolean(
        mediaElement &&
        mediaElement.readyState >= 2 &&
        mediaElement.videoWidth > 0
      );

      // The browser refused autoplay. No retry, source switch or watchdog can
      // clear this — only a user gesture can — so stop every recovery path,
      // gate play() for this source and park the session in `paused` so the UI
      // shows a play button instead of a permanent spinner.
      if (isAutoplayBlockedError(playbackError)) {
        const blockedSourceUrl = currentSession.source?.url ?? null;
        if (autoplayBlockedSourceUrlRef.current === blockedSourceUrl) {
          return;
        }
        autoplayBlockedSourceUrlRef.current = blockedSourceUrl;
        clearStartupAutoplayRecovery();
        clearCatchUpStartupWatchdog();
        clearCatchUpManifestNoFrameWatchdog();
        clearCatchUpSeekWatchdog();
        clearLiveNoFrameWatchdog();
        pendingAutoplaySourceUrlRef.current = null;
        setIsPlaying(false);
        setIsLoading(false);
        clearLoadingProgress();
        if (sessionWantsPlayback(currentSession)) {
          commands.pause();
        }
        emitWebObservabilityEvent({
          name: 'playback.autoplay_blocked',
          severity: 'warn',
          metadata: {
            renderer: currentSession.renderer,
            channelId: currentSession.source?.channelId ?? null,
            playbackMode: currentSession.source?.metadata?.mode ?? null,
            status: 'awaiting_user_gesture',
            errorCode: playbackError.code,
          },
        });
        return;
      }

      if (deferPlaybackFailureWhileBackgrounded(
        playbackError.code,
        playbackError.message,
      )) {
        return;
      }

      // Catch-up shadow step-aside: the MP2->AAC shadow endpoint answers 409 when
      // the channel is already browser-playable (AAC/MP3), telling us to use the
      // normal catch-up path instead of the (pointless) transcode. Treat it as a
      // routing signal, not a fatal error, and fall through to the next attempt.
      if (
        playbackError.httpStatus === 409 &&
        currentSession.source?.metadata?.mode === 'catchup'
      ) {
        if (switchToCatchUpFallbackIfAvailable('SHADOW_STEP_ASIDE')) {
          emitWebObservabilityEvent({
            name: 'catchup.retry',
            severity: 'info',
            metadata: {
              renderer: currentSession.renderer,
              ...buildCatchUpEventMetadata(currentSession.source, {
                status: 'shadow_step_aside',
                errorCode: 'SHADOW_STEP_ASIDE',
              }),
            },
          });
          return;
        }

        // M1.4-b: no further attempt to fall back to — surface a clear
        // unavailable overlay instead of silently spinning until the 60s
        // visible-loading timeout fires.
        clearStartupAutoplayRecovery();
        clearCatchUpStartupWatchdog();
        clearCatchUpManifestNoFrameWatchdog();
        clearCatchUpSeekWatchdog();
        pendingAutoplaySourceUrlRef.current = null;
        recordCatchUpRuntimeCompatibility(currentSession.source, 'unsupported', 'shadow-step-aside');
        setError(resolveCatchUpStartupUnavailableError(currentSession.source) ?? {
          type: 'network',
          message: 'Snimak za TV unazad trenutno nije dostupan',
          primaryAction: 'switch-to-live',
          primaryActionLabel: 'Gledaj kanal uživo',
        });
        setIsLoading(false);
        clearLoadingProgress();
        setIsPlaying(false);
        return;
      }

      const seekTargetPositionMs = applyingSessionSeekTargetMsRef.current;
      const seekFallbackPositionMs = resolveCatchUpSeekRecoveryFallbackPositionMs({
        targetPositionMs: seekTargetPositionMs,
        lastRenderablePositionMs: lastRenderableCatchUpPositionMsRef.current,
      });
      if (
        seekFallbackPositionMs !== null &&
        currentSession.source?.metadata?.mode === 'catchup'
      ) {
        const metadata = (
          typeof currentSession.source.metadata === 'object' &&
          currentSession.source.metadata !== null
        )
          ? currentSession.source.metadata as Record<string, unknown>
          : {};
        const fallbackMediaPositionSeconds = resolveRuntimeCatchUpMediaSeekTimeSeconds(
          currentSession.source,
          seekFallbackPositionMs,
          resolveCatchUpMinimumHlsStartPositionSeconds(currentSession.source),
        );
        clearStartupAutoplayRecovery();
        clearCatchUpStartupWatchdog();
        clearCatchUpSeekWatchdog();
        isApplyingSessionSeekRef.current = true;
        applyingSessionSeekTargetMsRef.current = seekFallbackPositionMs;
        pendingAutoplaySourceUrlRef.current = currentSession.source.url;
        setError(null);
        setIsLoading(true);
        resetLoadingProgress('segment');
        commands.setSource({
          ...currentSession.source,
          metadata: {
            ...metadata,
            catchUpHlsStartPositionSeconds: fallbackMediaPositionSeconds,
            catchUpPendingTimelineSeekMs: seekFallbackPositionMs,
            catchUpPendingMediaSeekSeconds: fallbackMediaPositionSeconds,
            catchUpSeekNoFrameRetryCount: 0,
            catchUpSeekRecoveryFallbackFromMs: seekTargetPositionMs,
            loadKey: Date.now(),
          },
        }, seekFallbackPositionMs);
        commands.play();
        emitWebObservabilityEvent({
          name: 'catchup.seek_fallback',
          severity: 'warn',
          metadata: {
            renderer: currentSession.renderer,
            positionMs: seekFallbackPositionMs,
            failedPositionMs: seekTargetPositionMs,
            mediaPositionSeconds: fallbackMediaPositionSeconds,
            errorCode: playbackError.code,
            ...buildCatchUpEventMetadata(currentSession.source, {
              status: 'seek_error_fallback',
              errorCode: playbackError.code,
            }),
          },
        });
        return;
      }
      const sourceHasStarted = Boolean(
        currentSession.source &&
        lastStartedSourceRef.current === currentSession.source.url
      );
      if (shouldDeferLiveStartupPlaybackError(
        currentSession,
        playbackError,
        { hasRenderableFrame },
        { sourceHasStarted },
      )) {
        setError(null);
        setIsLoading(true);
        updateLoadingProgressPhase('segment');
        const failureTelemetry = resolvePlaybackFailureTelemetry('deferred', playbackError.fatal);
        emitWebObservabilityEvent({
          name: failureTelemetry.name,
          severity: failureTelemetry.severity,
          metadata: {
            code: playbackError.code,
            fatal: playbackError.fatal,
            terminal: failureTelemetry.terminal,
            message: playbackError.message,
            renderer: sessionRef.current.renderer,
            status: 'live_startup_deferred',
          },
        });
        return;
      }
      const shouldDeferCatchUpStartupError = shouldDeferCatchUpStartupPlaybackError(
        currentSession,
        playbackError,
        { hasRenderableFrame },
        { sourceHasStarted },
      );
      if (shouldDeferCatchUpStartupError) {
        setError(null);
        setIsLoading(true);
        updateLoadingProgressPhase('segment');
        const failureTelemetry = resolvePlaybackFailureTelemetry('deferred', playbackError.fatal);
        emitWebObservabilityEvent({
          name: failureTelemetry.name,
          severity: failureTelemetry.severity,
          metadata: {
            code: playbackError.code,
            fatal: playbackError.fatal,
            terminal: failureTelemetry.terminal,
            message: playbackError.message,
            renderer: sessionRef.current.renderer,
            ...buildCatchUpEventMetadata(sessionRef.current.source, {
              status: 'startup_deferred',
              errorCode: playbackError.code,
            }),
          },
        });
        return;
      }

      if (
        playbackError.code === 'MEDIA_ELEMENT_3' &&
        currentSession.source?.metadata?.mode === 'catchup' &&
        sourceHasStarted &&
        sessionWantsPlayback(currentSession)
      ) {
        const metadata = (
          typeof currentSession.source.metadata === 'object' &&
          currentSession.source.metadata !== null
        )
          ? currentSession.source.metadata as Record<string, unknown>
          : {};
        const attemptedDecodeSkips = Math.floor(
          parseNumericMetadataValue(metadata.catchUpRuntimeDecodeSkipCount) ?? 0,
        );
        const durationSeconds = Math.max(
          0,
          parseNumericMetadataValue(metadata.catchUpDurationSeconds) ?? 0,
        );
        const mediaTimeSeconds = Math.max(
          0,
          mediaElement?.currentTime || 0,
        );
        const currentTimelinePositionMs = Math.max(
          0,
          resolveRuntimeCatchUpTimelinePositionMs(currentSession.source, mediaTimeSeconds),
          currentSession.positionMs ?? 0,
        );
        const unclampedTargetPositionMs = currentTimelinePositionMs + CATCH_UP_RUNTIME_DECODE_SKIP_MS;
        const targetPositionMs = durationSeconds > 1
          ? Math.min(Math.floor(durationSeconds * 1000) - 1_000, unclampedTargetPositionMs)
          : unclampedTargetPositionMs;
        if (
          attemptedDecodeSkips < CATCH_UP_RUNTIME_DECODE_SKIP_MAX_ATTEMPTS &&
          targetPositionMs > currentTimelinePositionMs
        ) {
          const targetMediaPositionSeconds = resolveRuntimeCatchUpMediaSeekTimeSeconds(
            currentSession.source,
            targetPositionMs,
            resolveCatchUpMinimumHlsStartPositionSeconds(currentSession.source),
          );
          clearStartupAutoplayRecovery();
          clearCatchUpStartupWatchdog();
          clearCatchUpManifestNoFrameWatchdog();
          clearCatchUpSeekWatchdog();
          isApplyingSessionSeekRef.current = true;
          applyingSessionSeekTargetMsRef.current = targetPositionMs;
          pendingAutoplaySourceUrlRef.current = currentSession.source.url;
          setError(null);
          setIsLoading(true);
          resetLoadingProgress('segment');
          commands.setSource({
            ...currentSession.source,
            metadata: {
              ...metadata,
              catchUpHlsStartupMode: 'complete',
              catchUpHlsStartPositionSeconds: targetMediaPositionSeconds,
              catchUpPendingTimelineSeekMs: targetPositionMs,
              catchUpPendingMediaSeekSeconds: targetMediaPositionSeconds,
              catchUpRuntimeDecodeSkipCount: attemptedDecodeSkips + 1,
              catchUpSeekNoFrameRetryCount: 0,
              loadKey: Date.now(),
            },
          }, targetPositionMs);
          commands.play();
          emitWebObservabilityEvent({
            name: 'catchup.retry',
            severity: 'warn',
            metadata: {
              renderer: currentSession.renderer,
              positionMs: targetPositionMs,
              failedPositionMs: currentTimelinePositionMs,
              mediaPositionSeconds: targetMediaPositionSeconds,
              ...buildCatchUpEventMetadata(currentSession.source, {
                status: 'runtime_decode_skip',
                errorCode: playbackError.code,
              }),
            },
          });
          return;
        }
      }

      const providerIssueError = shouldResolveProviderBlockingErrorAfterPlaybackError(
        currentSession,
        playbackError,
        { hasRenderableFrame },
      )
        ? resolveSessionSourceBlockingError(currentSession.source, playbackError.code)
        : null;
      const shouldAttemptRuntimeFallback = shouldAttemptCatchUpErrorFallback(
        currentSession,
        playbackError,
        { hasRenderableFrame },
      );
      const catchUpRuntimeUnavailableError = shouldResolveCatchUpRuntimeUnavailableAfterPlaybackError(
        currentSession,
        playbackError,
        { hasRenderableFrame },
      )
        ? resolveCatchUpStartupUnavailableError(currentSession.source)
        : null;
      const shouldShowPlaybackError = shouldShowPlaybackErrorAfterPlaybackError(
        currentSession,
        playbackError,
        { hasRenderableFrame },
      );
      const terminalPlaybackFailure = Boolean(
        providerIssueError ||
        catchUpRuntimeUnavailableError ||
        shouldShowPlaybackError
      );
      const failureTelemetry = resolvePlaybackFailureTelemetry(
        terminalPlaybackFailure ? 'terminal' : 'rendering-continues',
        playbackError.fatal,
      );
      if (!providerIssueError &&
        shouldAttemptRuntimeFallback &&
        switchToCatchUpFallbackIfAvailable(playbackError.code)) {
        return;
      }

      if (providerIssueError || catchUpRuntimeUnavailableError || playbackError.fatal) {
        clearStartupAutoplayRecovery();
        clearCatchUpStartupWatchdog();
        clearCatchUpSeekWatchdog();
      }
      if (shouldClearPendingAutoplayOnPlaybackError(playbackError)) {
        pendingAutoplaySourceUrlRef.current = null;
      }
      if (
        providerIssueError ||
        catchUpRuntimeUnavailableError ||
        shouldShowPlaybackError
      ) {
        if (currentSession.source?.metadata?.mode === 'catchup' && !hasRenderableFrame) {
          recordCatchUpRuntimeCompatibility(currentSession.source, 'unsupported', 'playback-error');
        }
        setError(providerIssueError ?? catchUpRuntimeUnavailableError ?? mapPlaybackError(playbackError));
      }
      if (
        playbackError.code !== 'PLAYBACK_START_FAILED' &&
        shouldWatchCatchUpSeekAfterPlaybackError(currentSession, {
          fatal: playbackError.fatal,
          hasRenderableFrame,
          targetPositionMs: seekTargetPositionMs,
        })
      ) {
        scheduleCatchUpSeekWatchdog(adapter, seekTargetPositionMs ?? 0);
      }
      setIsLoading(false);
      if (
        currentSession.source?.metadata?.mode === 'catchup' &&
        hasRenderableFrame &&
        sessionWantsPlayback(currentSession) &&
        !providerIssueError &&
        !catchUpRuntimeUnavailableError &&
        !shouldShowPlaybackError
      ) {
        adapter.play();
      }
      if (
        providerIssueError ||
        catchUpRuntimeUnavailableError ||
        shouldShowPlaybackError
      ) {
        clearLoadingProgress();
      }
      emitWebObservabilityEvent({
        name: failureTelemetry.name,
        severity: failureTelemetry.severity,
        metadata: {
          code: playbackError.code,
          fatal: playbackError.fatal,
          terminal: failureTelemetry.terminal,
          message: playbackError.message,
          renderer: sessionRef.current.renderer,
          ...buildCatchUpEventMetadata(sessionRef.current.source, {
            status: terminalPlaybackFailure ? 'error' : 'rendering_continues',
            errorCode: playbackError.code,
          }),
        },
      });
      onError?.(playbackError.message);
    });

    const unsubscribeTime = adapter.onTimeUpdate((time) => {
      const currentSession = sessionRef.current;
      if (!currentSession.source) {
        return;
      }

      let currentPositionMs = resolveRuntimeCatchUpTimelinePositionMs(
        currentSession.source,
        time,
      );
      const hasRenderableCatchUpFrame = Boolean(
        currentSession.source.metadata?.mode === 'catchup' &&
        hasRenderableMediaFrame(videoRef.current)
      );
      const pendingTimelineTargetMs = applyingSessionSeekTargetMsRef.current ?? currentSession.positionMs;
      if (
        hasRenderableCatchUpFrame &&
        !getCatchUpRuntimeTimelineAnchor(currentSession.source) &&
        pendingTimelineTargetMs !== null &&
        time * 1000 > pendingTimelineTargetMs + 1_000 &&
        Math.abs(currentPositionMs - pendingTimelineTargetMs) > 1_000
      ) {
        rememberCatchUpRuntimeTimelineAnchor(
          currentSession.source,
          pendingTimelineTargetMs,
          time,
        );
        currentPositionMs = resolveRuntimeCatchUpTimelinePositionMs(
          currentSession.source,
          time,
        );
      }
      if (hasRenderableCatchUpFrame) {
        recordCatchUpRuntimeCompatibility(currentSession.source, 'playable', 'rendered-frame');
        lastRenderableCatchUpPositionMsRef.current = currentPositionMs;
        clearCatchUpStartupWatchdog();
        clearCatchUpManifestNoFrameWatchdog();
        clearStartupAutoplayRecovery();
        pendingAutoplaySourceUrlRef.current = null;
        setError(null);
        setIsPlaying(true);
        setIsLoading(false);
        clearLoadingProgress();
        const sourceUrl = currentSession.source.url;
        if (sourceUrl && sourceUrl !== lastStartedSourceRef.current) {
          lastStartedSourceRef.current = sourceUrl;
          onCanPlay?.();
          emitWebObservabilityEvent({
            name: 'playback.started',
            severity: 'info',
            metadata: {
              renderer: sessionRef.current.renderer,
              sourceType: sessionRef.current.source?.type ?? 'unknown',
            },
          });
        }
      }
      if (isApplyingSessionSeekRef.current) {
        const seekTargetPositionMs = applyingSessionSeekTargetMsRef.current ?? currentSession.positionMs;
        const requiresRenderableFrame = currentSession.source.metadata?.mode === 'catchup';
        const hasRenderableFrame = Boolean(
          videoRef.current &&
          videoRef.current.readyState >= 2 &&
          videoRef.current.videoWidth > 0
        );
        const settleToleranceMs = requiresRenderableFrame && hasRenderableFrame
          ? CATCH_UP_SEEK_SETTLE_TOLERANCE_MS
          : 500;
        if (
          seekTargetPositionMs === null ||
          (
            Math.abs(currentPositionMs - seekTargetPositionMs) < settleToleranceMs &&
            (!requiresRenderableFrame || hasRenderableFrame)
          )
        ) {
          isApplyingSessionSeekRef.current = false;
          applyingSessionSeekTargetMsRef.current = null;
          clearCatchUpSeekWatchdog();
        }
        return;
      }

      const lastReportedPositionMs = lastReportedPositionMsRef.current;
      if (
        lastReportedPositionMs !== null &&
        Math.abs(currentPositionMs - lastReportedPositionMs) < 1000
      ) {
        return;
      }

      if (
        currentSession.positionMs !== null &&
        Math.abs(currentPositionMs - currentSession.positionMs) < 1000
      ) {
        return;
      }

      lastReportedPositionMsRef.current = currentPositionMs;
      commands.seek(currentPositionMs);
    });

    return () => {
      unsubscribeState();
      unsubscribeError();
      unsubscribeTime();
      clearStartupAutoplayRecovery();
      clearLiveNoFrameWatchdog();
      clearCatchUpStartupWatchdog();
      clearCatchUpManifestNoFrameWatchdog();
      clearCatchUpSeekWatchdog();
      isApplyingSessionSeekRef.current = false;
      applyingSessionSeekTargetMsRef.current = null;
      adapter.destroy();
      if (adapterRef.current === adapter) {
        adapterRef.current = null;
      }
    };
  }, [
    autoPlay,
    clearStartupAutoplayRecovery,
    clearLiveNoFrameWatchdog,
    clearCatchUpStartupWatchdog,
    clearCatchUpManifestNoFrameWatchdog,
    clearCatchUpSeekWatchdog,
    clearLoadingProgress,
    commands,
    deferPlaybackFailureWhileBackgrounded,
    getCatchUpRuntimeTimelineAnchor,
    mapPlaybackError,
    rememberCatchUpRuntimeTimelineAnchor,
    onCanPlay,
    onError,
    preferNativeHls,
    resetLoadingProgress,
    recordCatchUpRuntimeCompatibility,
    resolveRuntimeCatchUpMediaSeekTimeSeconds,
    resolveRuntimeCatchUpTimelinePositionMs,
    scheduleCatchUpSeekWatchdog,
    setError,
    switchToCatchUpFallbackIfAvailable,
    updateLoadingProgressPhase,
  ]);

  useEffect(() => {
    if (!isLoading || error || !loadingProgress) {
      return;
    }

    const currentSession = sessionRef.current;
    const currentSource = currentSession.source;
    if (!currentSource || currentSource.metadata?.mode !== 'catchup') {
      return;
    }

    const elapsedMs = loadingTickMs - loadingProgress.startedAtMs;
    // Do not reseek while the first segment is still legitimately downloading
    // from a slow edge — that would re-fetch seg=0 on top of an in-flight load.
    const segmentLikelyInFlight = catchUpFirstSegmentLikelyInFlight(
      adapterRef.current?.getSegmentLoadDiagnostics(),
      CATCH_UP_SEGMENT_IN_FLIGHT_GRACE_MS,
    );
    if (
      elapsedMs >= CATCH_UP_MANIFEST_NO_FRAME_FALLBACK_DELAY_MS &&
      !hasRenderableMediaFrame(videoRef.current) &&
      !segmentLikelyInFlight &&
      switchToCatchUpFallbackIfAvailable('STARTUP_TIMEOUT')
    ) {
      return;
    }

    if (!shouldStopLongCatchUpStartupLoading(
      currentSession,
      { hasRenderableFrame: hasRenderableMediaFrame(videoRef.current) },
      elapsedMs,
      CATCH_UP_VISIBLE_LOADING_UNAVAILABLE_MS,
    )) {
      return;
    }

    const longLoadingError = resolveSessionSourceBlockingError(
      currentSource,
      'STARTUP_TIMEOUT',
    ) ?? {
      type: 'network',
      message: 'Snimak za TV unazad trenutno nije dostupan',
      details: 'Snimak postoji u listi, ali web player nije dobio prvi video kadar u očekivanom vremenu. Provajder trenutno ne šalje stabilan arhivski stream za ovaj termin. Pokušajte ponovo ili gledajte kanal uživo.',
      primaryAction: 'switch-to-live',
      primaryActionLabel: 'Gledaj kanal uživo',
    } satisfies PlayerError;

    clearStartupAutoplayRecovery();
    clearLiveNoFrameWatchdog();
    clearCatchUpStartupWatchdog();
    clearCatchUpManifestNoFrameWatchdog();
    clearCatchUpSeekWatchdog();
    pendingAutoplaySourceUrlRef.current = null;
    recordCatchUpRuntimeCompatibility(currentSource, 'unsupported', 'visible-loading-timeout');
    setError(longLoadingError);
    setIsLoading(false);
    clearLoadingProgress();
    setIsPlaying(false);
    adapterRef.current?.stop();
    if (sessionWantsPlayback(currentSession)) {
      commands.pause();
    }
    emitWebObservabilityEvent({
      name: 'catchup.startup_timeout',
      severity: 'warn',
      metadata: {
        renderer: currentSession.renderer,
        elapsedMs,
        ...buildCatchUpEventMetadata(currentSource, {
          status: 'visible_loading_timeout',
          errorCode: 'STARTUP_TIMEOUT',
        }),
      },
    });
  }, [
    clearCatchUpManifestNoFrameWatchdog,
    clearCatchUpSeekWatchdog,
    clearCatchUpStartupWatchdog,
    clearLiveNoFrameWatchdog,
    clearLoadingProgress,
    clearStartupAutoplayRecovery,
    commands,
    error,
    isLoading,
    loadingProgress,
    loadingTickMs,
    recordCatchUpRuntimeCompatibility,
    setError,
    switchToCatchUpFallbackIfAvailable,
  ]);

  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter) {
      return;
    }

    isApplyingSessionSeekRef.current = false;
    lastReportedPositionMsRef.current = null;
    catchUpPendingStartupSeekAppliedKeyRef.current = null;
    catchUpSeekAutoplayRetryKeyRef.current = null;
    catchUpSeekFallbackAutoplayRetryKeyRef.current = null;
    catchUpRuntimeCompatibilityObservedUrlRef.current = null;
    lastRecordedCatchUpRuntimeCompatibilityRef.current = null;
    setUnsupportedAudioCodec(
      sessionRef.current.source?.metadata?.unsupportedAudioCodec === 'mp2' ? 'mp2' : null,
    );
    setUnsupportedVideoCodec(
      sessionRef.current.source?.metadata?.unsupportedVideoCodec === 'hevc' ? 'hevc' : null,
    );
    const sourceMetadataForReset = (
      typeof sessionRef.current.source?.metadata === 'object' &&
      sessionRef.current.source.metadata !== null
    )
      ? sessionRef.current.source.metadata as Record<string, unknown>
      : null;
    const isCatchUpSeekRecoveryReload = (
      sourceMetadataForReset?.mode === 'catchup' &&
      (
        (parseNumericMetadataValue(sourceMetadataForReset.catchUpSeekNoFrameRetryCount) ?? 0) > 0 ||
        typeof parseNumericMetadataValue(sourceMetadataForReset.catchUpSeekRecoveryFallbackFromMs) === 'number'
      )
    );
    if (!isCatchUpSeekRecoveryReload) {
      lastRenderableCatchUpPositionMsRef.current = null;
    }

    const cachedRuntimeCompatibility = getCachedCatchUpRuntimeCompatibility(sessionRef.current.source);
    const sourceBlockingError = resolveSessionSourceBlockingError(sessionRef.current.source)
      ?? resolveCatchUpRuntimeCompatibilityBlockingError(
        sessionRef.current.source,
        cachedRuntimeCompatibility,
      );
    if (sourceBlockingError && isLocalRenderer) {
      void exitPictureInPicture();
      clearStartupAutoplayRecovery();
      clearLiveNoFrameWatchdog();
      clearCatchUpStartupWatchdog();
      clearCatchUpManifestNoFrameWatchdog();
      pendingAutoplaySourceUrlRef.current = null;
      lastStartedSourceRef.current = null;
      startupHardRetrySourceUrlRef.current = null;
      setError(sourceBlockingError);
      setIsLoading(false);
      clearLoadingProgress();
      setIsPlaying(false);
      adapter.stop();
      return;
    }

    if (!src || !isLocalRenderer) {
      void exitPictureInPicture();
      clearStartupAutoplayRecovery();
      clearCatchUpStartupWatchdog();
      clearCatchUpManifestNoFrameWatchdog();
      pendingAutoplaySourceUrlRef.current = null;
      setError(null);
      setIsLoading(false);
      clearLoadingProgress();
      setIsPlaying(false);
      adapter.stop();
      return;
    }

    let cancelled = false;
    let onDemandStartupPositionMs: number | null = null;
    const startupVideo = videoRef.current;
    const applyOnDemandStartupPosition = () => {
      if (cancelled || onDemandStartupPositionMs === null || !startupVideo || startupVideo.readyState < 1) return;
      const duration = adapter.getDuration();
      const targetMs = Number.isFinite(duration) && duration > 0
        ? Math.min(onDemandStartupPositionMs, Math.max(0, duration * 1000 - 1000))
        : onDemandStartupPositionMs;
      onDemandStartupPositionMs = null;
      applyingSessionSeekTargetMsRef.current = targetMs;
      isApplyingSessionSeekRef.current = true;
      adapter.seek(targetMs / 1000);
    };
    startupVideo?.addEventListener('loadedmetadata', applyOnDemandStartupPosition);

    adapter.stop();
    foregroundPlaybackRecoverySourceRef.current = null;
    setError(null);
    setIsLoading(true);
    resetLoadingProgress('requesting');
    clearStartupAutoplayRecovery();
    clearLiveNoFrameWatchdog();
    clearCatchUpStartupWatchdog();
    clearCatchUpManifestNoFrameWatchdog();
    lastStartedSourceRef.current = null;
    manualPauseRequestedRef.current = false;
    if (liveUnexpectedPauseRecoverySourceRef.current !== src) {
      liveUnexpectedPauseRecoverySourceRef.current = src;
      liveUnexpectedPauseRecoveryAttemptsRef.current = 0;
    }
    startupHardRetrySourceUrlRef.current = null;
    // A different source deserves a fresh autoplay attempt; reloading the same
    // blocked one does not, since the gesture requirement still stands.
    if (autoplayBlockedSourceUrlRef.current !== src) {
      autoplayBlockedSourceUrlRef.current = null;
    }
    pendingAutoplaySourceUrlRef.current = autoPlay && (
      sessionWantsPlayback(sessionRef.current) ||
      sessionRef.current.source?.metadata?.mode === 'live'
    )
      ? src
      : null;

    const scheduleCatchUpStartupWatchdog = () => {
      if (!shouldUseCatchUpStartupWatchdog(sessionRef.current)) {
        return;
      }

      if (catchUpStartupWatchdogTimerRef.current !== null) {
        clearTimeout(catchUpStartupWatchdogTimerRef.current);
      }

      const watchedSourceUrl = src;
      catchUpStartupWatchdogTimerRef.current = setTimeout(() => {
        catchUpStartupWatchdogTimerRef.current = null;
        if (cancelled) {
          return;
        }

        const currentSession = sessionRef.current;
        const mediaElement = videoRef.current;
        if (
          !mediaElement ||
          !shouldResolveCatchUpStartupWatchdog(
            currentSession,
            watchedSourceUrl,
          )
        ) {
          return;
        }

        const hasUsableMedia = hasRenderableMediaFrame(mediaElement);
        if (hasUsableMedia) {
          return;
        }

        if (switchToCatchUpFallbackIfAvailable('STARTUP_TIMEOUT')) {
          return;
        }

        const providerIssueError = resolveSessionSourceBlockingError(
          currentSession.source,
          'STARTUP_TIMEOUT',
        );
        if (providerIssueError) {
          clearStartupAutoplayRecovery();
          clearCatchUpStartupWatchdog();
          clearCatchUpManifestNoFrameWatchdog();
          pendingAutoplaySourceUrlRef.current = null;
          recordCatchUpRuntimeCompatibility(currentSession.source, 'unsupported', 'startup-timeout');
          setError(providerIssueError);
          setIsLoading(false);
          clearLoadingProgress();
          setIsPlaying(false);
          adapter.stop();
          if (sessionWantsPlayback(currentSession)) {
            commands.pause();
          }
          emitWebObservabilityEvent({
            name: 'catchup.startup_timeout',
            severity: 'warn',
            metadata: {
              renderer: currentSession.renderer,
              ...buildCatchUpEventMetadata(currentSession.source, {
                status: 'provider_issue',
                errorCode: 'STARTUP_TIMEOUT',
              }),
            },
          });
          return;
        }

        clearStartupAutoplayRecovery();
        clearLiveNoFrameWatchdog();
        clearCatchUpStartupWatchdog();
        clearCatchUpManifestNoFrameWatchdog();
        pendingAutoplaySourceUrlRef.current = null;
        recordCatchUpRuntimeCompatibility(currentSession.source, 'unsupported', 'startup-timeout');
        setError(resolveCatchUpStartupUnavailableError(currentSession.source) ?? {
          type: 'network',
          message: 'Snimak za TV unazad trenutno nije dostupan',
          details: 'Provajder trenutno ne vraća ispravan arhivski snimak za ovaj termin. Pokušajte ponovo ili gledajte kanal uživo.',
        });
        setIsLoading(false);
        clearLoadingProgress();
        setIsPlaying(false);
        adapter.stop();
        if (sessionWantsPlayback(currentSession)) {
          commands.pause();
        }
      }, CATCH_UP_STARTUP_WATCHDOG_DELAY_MS);
    };

    const beginLoad = (allowHardRetry: boolean) => {
      scheduleCatchUpStartupWatchdog();
      const currentSource = sessionRef.current.source;
      const currentSourceMetadata = (
        typeof currentSource?.metadata === 'object' &&
        currentSource.metadata !== null
      )
        ? currentSource.metadata
        : null;
      const isCatchUpSource = currentSourceMetadata?.mode === 'catchup';
      const isOnDemand = currentSourceMetadata?.mode === 'vod' || currentSourceMetadata?.mode === 'series-episode';
      onDemandStartupPositionMs = isOnDemand && (sessionRef.current.positionMs ?? 0) > 0
        ? sessionRef.current.positionMs
        : null;
      if (onDemandStartupPositionMs !== null) {
        // Ignore the initial 0:00 timeupdate until metadata permits restoring the saved position.
        isApplyingSessionSeekRef.current = true;
        applyingSessionSeekTargetMsRef.current = onDemandStartupPositionMs;
      }

      const catchUpStartPositionSeconds = isCatchUpSource
        ? resolveRuntimeCatchUpMediaSeekTimeSeconds(
          currentSource,
          sessionRef.current.positionMs,
          resolveCatchUpMinimumHlsStartPositionSeconds(currentSource),
        )
        : 0;
      const sourceMetadata = (
        typeof currentSource?.metadata === 'object' &&
        currentSource.metadata !== null
      )
        ? {
          ...currentSource.metadata,
          ...(isCatchUpSource && catchUpStartPositionSeconds > 0
            ? { catchUpHlsStartPositionSeconds: catchUpStartPositionSeconds }
            : {}),
          ...(isCatchUpSource && usesMediaKingCatchUpManifestGuard(currentSource)
            ? { catchUpHlsStartupMode: 'progressive' }
            : {}),
        }
        : currentSource?.metadata;
      const sourceForAdapter = {
        url: src,
        type: sourceType,
        metadata: sourceMetadata,
      };
      const analyticsLoadStartedAtMs = Date.now();
      if (sourceType === 'hls') {
        emitWebObservabilityEvent({
          name: 'playback.manifest_started',
          metadata: {
            renderer: sessionRef.current.renderer,
            channelId: currentSource?.channelId ?? null,
            streamId: currentSourceMetadata?.streamId ?? null,
            playbackMode: currentSourceMetadata?.mode ?? null,
          },
        });
      }

      void adapter.load(sourceForAdapter).then(() => {
        if (cancelled) {
          return;
        }

        applyOnDemandStartupPosition();
        const loadedSession = sessionRef.current;
        const loadedMetadata = (
          typeof loadedSession.source?.metadata === 'object' &&
          loadedSession.source.metadata !== null
        )
          ? loadedSession.source.metadata as Record<string, unknown>
          : null;
        const seekRecoveryRetryCount = Math.floor(
          parseNumericMetadataValue(loadedMetadata?.catchUpSeekNoFrameRetryCount) ?? 0,
        );
        const loadedMediaElement = videoRef.current;
        if (sourceType === 'hls') {
          emitWebObservabilityEvent({
            name: 'playback.manifest_succeeded',
            metadata: {
              renderer: loadedSession.renderer,
              channelId: loadedSession.source?.channelId ?? null,
              streamId: loadedMetadata?.streamId ?? null,
              playbackMode: loadedMetadata?.mode ?? null,
              durationMs: Date.now() - analyticsLoadStartedAtMs,
            },
          });
        }
        const loadedHasRenderableFrame = Boolean(
          loadedMediaElement &&
          loadedMediaElement.readyState >= 2 &&
          loadedMediaElement.videoWidth > 0
        );
        if (
          loadedMetadata?.mode === 'catchup' &&
          !loadedHasRenderableFrame
        ) {
          setIsLoading(true);
          updateLoadingProgressPhase('segment');
        } else {
          setIsLoading(false);
          onCanPlay?.();
        }
        const pendingStartupSeek = resolveCatchUpPendingStartupSeek(
          loadedSession.source,
          {
            fallbackTimelinePositionMs: loadedSession.positionMs,
            minimumMediaPositionSeconds: resolveCatchUpMinimumHlsStartPositionSeconds(loadedSession.source),
          },
        );
        if (
          loadedMetadata?.mode === 'catchup' &&
          loadedHasRenderableFrame
        ) {
          recordCatchUpRuntimeCompatibility(loadedSession.source, 'playable', 'rendered-frame');
        }
        if (
          loadedMetadata?.mode === 'catchup' &&
          (seekRecoveryRetryCount > 0 || pendingStartupSeek !== null) &&
          loadedSession.positionMs !== null &&
          !loadedHasRenderableFrame
        ) {
          isApplyingSessionSeekRef.current = true;
          applyingSessionSeekTargetMsRef.current = pendingStartupSeek?.timelinePositionMs ?? loadedSession.positionMs;
          scheduleCatchUpSeekWatchdog(
            adapter,
            pendingStartupSeek?.timelinePositionMs ?? loadedSession.positionMs,
          );
        }
        const shouldResumeAfterCatchUpSeekFallback = typeof parseNumericMetadataValue(
          loadedMetadata?.catchUpSeekRecoveryFallbackFromMs,
        ) === 'number';
        if (
          autoPlay &&
          (
            sessionWantsPlayback(sessionRef.current) ||
            shouldResumeAfterCatchUpSeekFallback
          )
        ) {
          adapter.play();
        }

        if (!allowHardRetry) {
          return;
        }

        const scheduleStartupHardRetry = (
          delayMs: number,
          requireDetachedLiveStartup: boolean,
        ) => {
          if (startupHardRetryTimerRef.current !== null) {
            clearTimeout(startupHardRetryTimerRef.current);
          }

          startupHardRetryTimerRef.current = setTimeout(() => {
          startupHardRetryTimerRef.current = null;
          if (cancelled) {
            return;
          }

          const currentSession = sessionRef.current;
          const mediaElement = videoRef.current;
          if (
            !mediaElement ||
            !currentSession.source ||
            currentSession.source.url !== src ||
            !sessionWantsPlayback(currentSession) ||
            lastStartedSourceRef.current === src ||
            startupHardRetrySourceUrlRef.current === src
          ) {
            return;
          }

          const hasStartupProgress = (
            mediaElement.currentTime > 0.25 ||
            (
              mediaElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
              mediaElement.videoWidth > 0
            )
          );
          if (hasStartupProgress) {
            return;
          }

          const isLiveStartup = currentSession.source.metadata?.mode === 'live';
          const isDetachedLiveStartup = (
            isLiveStartup &&
            mediaElement.readyState === 0 &&
            mediaElement.networkState === mediaElement.NETWORK_EMPTY
          );
          if (requireDetachedLiveStartup && !isDetachedLiveStartup) {
            scheduleStartupHardRetry(
              Math.max(0, STARTUP_HARD_RETRY_DELAY_MS - delayMs),
              false,
            );
            return;
          }

          startupHardRetrySourceUrlRef.current = src;
          pendingAutoplaySourceUrlRef.current = src;
          setIsLoading(true);
          beginLoad(false);
          }, delayMs);
        };

        if (allowHardRetry && shouldScheduleStartupHardRetry(sessionRef.current)) {
          scheduleStartupHardRetry(LIVE_STARTUP_DETACHED_RETRY_DELAY_MS, true);
        }
      }).catch((loadError: unknown) => {
        if (cancelled) {
          return;
        }

        const message = loadError instanceof Error ? loadError.message : 'Neuspešno učitavanje streama';
        if (message === 'Playback load was cancelled.') {
          return;
        }

        if (sourceType === 'hls') {
          emitWebObservabilityEvent({
            name: 'playback.manifest_failed',
            severity: 'error',
            metadata: {
              renderer: sessionRef.current.renderer,
              channelId: sessionRef.current.source?.channelId ?? null,
              errorCode: 'LOAD_FAILED',
              message,
              durationMs: Date.now() - analyticsLoadStartedAtMs,
            },
          });
        }

        const currentSession = sessionRef.current;
        const mediaElement = videoRef.current;
        const hasRenderableFrame = hasRenderableMediaFrame(mediaElement);
        const sourceHasStarted = Boolean(
          currentSession.source &&
          lastStartedSourceRef.current === currentSession.source.url
        );
        if (shouldDeferLiveStartupPlaybackError(
          currentSession,
          { code: 'LOAD_FAILED', fatal: true },
          { hasRenderableFrame },
          { sourceHasStarted },
        )) {
          setError(null);
          setIsLoading(true);
          updateLoadingProgressPhase('requesting');
          const failureTelemetry = resolvePlaybackFailureTelemetry('deferred', true);
          emitWebObservabilityEvent({
            name: failureTelemetry.name,
            severity: failureTelemetry.severity,
            metadata: {
              code: 'LOAD_FAILED',
              fatal: true,
              terminal: failureTelemetry.terminal,
              message,
              renderer: currentSession.renderer,
              status: 'live_startup_deferred',
            },
          });
          if (startupHardRetrySourceUrlRef.current !== src) {
            startupHardRetrySourceUrlRef.current = src;
            pendingAutoplaySourceUrlRef.current = src;
            window.setTimeout(() => {
              if (!cancelled && sessionRef.current.source?.url === src) {
                beginLoad(false);
              }
            }, LIVE_STARTUP_DETACHED_RETRY_DELAY_MS);
          }
          return;
        }
        if (shouldDeferCatchUpStartupPlaybackError(
          currentSession,
          { code: 'LOAD_FAILED', fatal: true },
          { hasRenderableFrame },
          { sourceHasStarted },
        )) {
          setError(null);
          setIsLoading(true);
          updateLoadingProgressPhase('segment');
          const failureTelemetry = resolvePlaybackFailureTelemetry('deferred', true);
          emitWebObservabilityEvent({
            name: failureTelemetry.name,
            severity: failureTelemetry.severity,
            metadata: {
              code: 'LOAD_FAILED',
              fatal: true,
              terminal: failureTelemetry.terminal,
              message,
              renderer: currentSession.renderer,
              ...buildCatchUpEventMetadata(currentSession.source, {
                status: 'startup_deferred',
                errorCode: 'LOAD_FAILED',
              }),
            },
          });
          return;
        }

        const providerIssueError = resolveSessionSourceBlockingError(
          sessionRef.current.source,
          'LOAD_FAILED',
        );
        if (!providerIssueError && switchToCatchUpFallbackIfAvailable('LOAD_FAILED')) {
          return;
        }
        const catchUpRuntimeUnavailableError = providerIssueError
          ? null
          : resolveCatchUpStartupUnavailableError(sessionRef.current.source);

        setIsLoading(false);
        clearStartupAutoplayRecovery();
        clearCatchUpStartupWatchdog();
        clearCatchUpManifestNoFrameWatchdog();
        pendingAutoplaySourceUrlRef.current = null;
        recordCatchUpRuntimeCompatibility(sessionRef.current.source, 'unsupported', 'load-failed');
        emitWebObservabilityEvent({
          name: 'playback.error',
          severity: 'error',
          metadata: {
            code: 'LOAD_FAILED',
            fatal: true,
            terminal: true,
            message,
            renderer: sessionRef.current.renderer,
            ...buildCatchUpEventMetadata(sessionRef.current.source, {
              status: 'error',
              errorCode: 'LOAD_FAILED',
            }),
          },
        });
        setErrorIfMissing(providerIssueError ?? catchUpRuntimeUnavailableError ?? {
          type: 'unknown',
          message: 'Nije moguće učitati stream',
          details: message,
        });
        onError?.(message);
      });
    };

    beginLoad(true);

    return () => {
      cancelled = true;
      startupVideo?.removeEventListener('loadedmetadata', applyOnDemandStartupPosition);
      adapter.stop();
      if (startupHardRetryTimerRef.current !== null) {
        clearTimeout(startupHardRetryTimerRef.current);
        startupHardRetryTimerRef.current = null;
      }
      if (catchUpStartupWatchdogTimerRef.current !== null) {
        clearTimeout(catchUpStartupWatchdogTimerRef.current);
        catchUpStartupWatchdogTimerRef.current = null;
      }
      clearCatchUpSeekWatchdog();
      clearCatchUpManifestNoFrameWatchdog();
      clearLiveNoFrameWatchdog();
    };
  }, [
    autoPlay,
    clearCatchUpSeekWatchdog,
    clearCatchUpManifestNoFrameWatchdog,
    clearLiveNoFrameWatchdog,
    clearStartupAutoplayRecovery,
    clearCatchUpStartupWatchdog,
    commands,
    exitPictureInPicture,
    isLocalRenderer,
    onCanPlay,
    onError,
    clearLoadingProgress,
    resetLoadingProgress,
    recordCatchUpRuntimeCompatibility,
    resolveRuntimeCatchUpMediaSeekTimeSeconds,
    setError,
    setErrorIfMissing,
    scheduleCatchUpSeekWatchdog,
    sourceType,
    src,
    sourceLoadKey,
    switchToCatchUpFallbackIfAvailable,
    updateLoadingProgressPhase,
  ]);

  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter || !session.source || session.positionMs === null) {
      return;
    }

    if (adapter.getState() === 'loading') {
      return;
    }

    if (resolveSessionSourceBlockingError(session.source)) {
      return;
    }

    const sourceMetadata = (
      typeof session.source.metadata === 'object' &&
      session.source.metadata !== null
    )
      ? session.source.metadata as Record<string, unknown>
      : null;
    if (sourceMetadata?.mode === 'live') {
      return;
    }

    const minimumStartPositionSeconds = resolveCatchUpMinimumHlsStartPositionSeconds(session.source);
    const targetTime = resolveRuntimeCatchUpMediaSeekTimeSeconds(
      session.source,
      session.positionMs,
      minimumStartPositionSeconds,
    );
    const targetPositionMs = resolveRuntimeCatchUpTimelineSeekTargetMs(
      session.source,
      session.positionMs,
      minimumStartPositionSeconds,
    );
    const mediaElement = videoRef.current;
    const hasRenderableFrame = Boolean(
      mediaElement &&
      mediaElement.readyState >= 2 &&
      mediaElement.videoWidth > 0
    );
    if (minimumStartPositionSeconds > 0 && targetTime * 1000 > session.positionMs + 500) {
      if (sourceMetadata?.mode === 'catchup' && !hasRenderableFrame) {
        isApplyingSessionSeekRef.current = true;
        applyingSessionSeekTargetMsRef.current = session.positionMs;
        return;
      }
      commands.seek(targetPositionMs);
    }
    const currentTime = adapter.getCurrentTime();
    const seekRecoveryRetryCount = Math.floor(
      parseNumericMetadataValue(sourceMetadata?.catchUpSeekNoFrameRetryCount) ?? 0,
    );
    const shouldWatchCatchUpSeek = shouldWatchCatchUpSeekAfterPositionChange({ source: session.source }, {
      playbackWantsPlaying,
      hasRenderableFrame,
      retryCount: seekRecoveryRetryCount,
      sourceHasStarted: lastStartedSourceRef.current === session.source.url,
    });
    if (Math.abs(currentTime - targetTime) < 1) {
      if (shouldWatchCatchUpSeek && !hasRenderableFrame) {
        isApplyingSessionSeekRef.current = true;
        applyingSessionSeekTargetMsRef.current = targetPositionMs;
        scheduleCatchUpSeekWatchdog(adapter, targetPositionMs);
        return;
      }

      applyingSessionSeekTargetMsRef.current = null;
      clearCatchUpSeekWatchdog();
      return;
    }

    isApplyingSessionSeekRef.current = true;
    applyingSessionSeekTargetMsRef.current = targetPositionMs;
    if (shouldWatchCatchUpSeek) {
      scheduleCatchUpSeekWatchdog(adapter, targetPositionMs);
    }
    adapter.seek(targetTime);
  }, [
    clearCatchUpSeekWatchdog,
    commands,
    playbackWantsPlaying,
    resolveRuntimeCatchUpMediaSeekTimeSeconds,
    resolveRuntimeCatchUpTimelineSeekTargetMs,
    scheduleCatchUpSeekWatchdog,
    session.positionMs,
    session.source,
  ]);

  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter) {
      return;
    }

    if (!session.source || !isLocalRenderer) {
      adapter.pause();
      return;
    }

    if (resolveSessionSourceBlockingError(session.source)) {
      adapter.pause();
      return;
    }

    if (playbackWantsPlaying) {
      if (adapter.getState() === 'loading') {
        return;
      }
      // Autoplay was refused for this source and no user gesture has arrived
      // yet. Calling play() again would only be rejected and bounce back here
      // through the media element's pause event.
      if (shouldSkipPlayForBlockedAutoplay(
        session.source.url,
        autoplayBlockedSourceUrlRef.current,
      )) {
        return;
      }
      adapter.play();
      return;
    }

    adapter.pause();
  }, [isLocalRenderer, playbackWantsPlaying, session.source]);

  useEffect(() => {
    const video = videoRef.current as WebKitPictureInPictureVideoElement | null;
    if (!video) {
      return;
    }

    let wasInPictureInPicture = isVideoInPictureInPicture(video);
    const updatePictureInPictureState = () => {
      const isInPictureInPicture = isVideoInPictureInPicture(video);
      const didExitPictureInPicture = wasInPictureInPicture && !isInPictureInPicture;
      wasInPictureInPicture = isInPictureInPicture;
      setIsPictureInPicture(isInPictureInPicture);

      if (
        didExitPictureInPicture &&
        shouldResumePlaybackAfterPictureInPictureExit(sessionRef.current, video.paused)
      ) {
        adapterRef.current?.play();
        commands.play();
      }
    };

    updatePictureInPictureState();
    video.addEventListener('enterpictureinpicture', updatePictureInPictureState);
    video.addEventListener('leavepictureinpicture', updatePictureInPictureState);
    video.addEventListener('webkitpresentationmodechanged', updatePictureInPictureState);

    return () => {
      video.removeEventListener('enterpictureinpicture', updatePictureInPictureState);
      video.removeEventListener('leavepictureinpicture', updatePictureInPictureState);
      video.removeEventListener('webkitpresentationmodechanged', updatePictureInPictureState);
    };
  }, [commands]);

  useEffect(() => {
    const video = videoRef.current as WebKitAirPlayVideoElement | null;
    if (!video) {
      return;
    }

    const syncAirPlayState = () => {
      if (!canUseAirPlayPicker(video)) {
        setIsAirPlayAvailable(false);
        setIsAirPlayConnected(false);
        return;
      }

      setIsAirPlayAvailable(isAirPlayDeviceAvailable(video));
      setIsAirPlayConnected(isAirPlayDeviceConnected(video));
    };

    const handleTargetAvailabilityChange = (
      event: Event & { availability?: AirPlayAvailability }
    ) => {
      if (event.availability === 'available') {
        setIsAirPlayAvailable(true);
        return;
      }

      if (event.availability === 'not-available') {
        setIsAirPlayAvailable(false);
        return;
      }

      syncAirPlayState();
    };

    const handleWirelessTargetChange = () => {
      syncAirPlayState();
    };

    syncAirPlayState();
    video.addEventListener(
      'webkitplaybacktargetavailabilitychanged',
      handleTargetAvailabilityChange as EventListener
    );
    video.addEventListener(
      'webkitcurrentplaybacktargetiswirelesschanged',
      handleWirelessTargetChange
    );

    return () => {
      video.removeEventListener(
        'webkitplaybacktargetavailabilitychanged',
        handleTargetAvailabilityChange as EventListener
      );
      video.removeEventListener(
        'webkitcurrentplaybacktargetiswirelesschanged',
        handleWirelessTargetChange
      );
    };
  }, []);

  const ErrorDisplay = ({
    error,
    sourceForPrimaryAction,
  }: {
    error: PlayerError;
    sourceForPrimaryAction: SessionSource | null;
  }) => {
    const Icon = error.type === 'mixed-content' ? ShieldAlert
      : error.type === 'network' ? WifiOff
      : AlertCircle;
    const primaryAction = error.primaryAction ?? 'switch-to-live';
    const primaryActionHandler = primaryAction === 'report-problem'
      ? onReportPlaybackProblem
      : onSourceBlockingPrimaryAction;
    const PrimaryActionIcon = primaryAction === 'report-problem' ? AlertCircle : Radio;
    const showPrimaryAction = Boolean(
      error.primaryActionLabel &&
      sourceForPrimaryAction &&
      primaryActionHandler,
    );

    return (
      <div className="pointer-events-auto absolute inset-0 flex flex-col items-center justify-center bg-background/90 backdrop-blur-sm z-10">
        <div className="flex flex-col items-center gap-4 p-6 max-w-md text-center">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
            <Icon className="w-8 h-8 text-destructive" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">{error.message}</h3>
          {error.details && (
            <p className="text-sm text-muted-foreground">{error.details}</p>
          )}
          {showPrimaryAction && sourceForPrimaryAction && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                if (primaryAction === 'report-problem') {
                  onReportPlaybackProblem?.(sourceForPrimaryAction, error);
                  return;
                }

                onSourceBlockingPrimaryAction?.(sourceForPrimaryAction);
              }}
            >
              <PrimaryActionIcon className="h-4 w-4" />
              {error.primaryActionLabel}
            </Button>
          )}
        </div>
      </div>
    );
  };

  const currentLoadingProgress = loadingProgress ?? createLoadingProgressState('requesting', loadingTickMs);
  const isCatchUpLoading = session.source?.metadata?.mode === 'catchup';
  const loadingElapsedSeconds = Math.max(
    0,
    Math.floor((loadingTickMs - currentLoadingProgress.startedAtMs) / 1000),
  );
  const loadingTargetMediaSeconds = isCatchUpLoading
    ? resolveRuntimeCatchUpMediaSeekTimeSeconds(
      session.source,
      session.positionMs,
      resolveCatchUpMinimumHlsStartPositionSeconds(session.source),
    )
    : 0;
  const loadingBufferedAheadSeconds = isCatchUpLoading
    ? resolveBufferedAheadSeconds(videoRef.current, loadingTargetMediaSeconds)
    : 0;
  const loadingHasRenderableFrame = hasRenderableMediaFrame(videoRef.current);
  const loadingProgressPercent = resolveCatchUpLoadingProgressPercent({
    phase: currentLoadingProgress.phase,
    bufferedAheadSeconds: loadingBufferedAheadSeconds,
    hasRenderableFrame: loadingHasRenderableFrame,
  });
  const loadingCopy = resolveCatchUpLoadingCopy({
    phase: currentLoadingProgress.phase,
    elapsedSeconds: loadingElapsedSeconds,
    bufferedAheadSeconds: loadingBufferedAheadSeconds,
  });
  const codecNoticeKind = unsupportedVideoCodec === 'hevc' && !isHevcPlaybackLikelySupported()
    ? 'video'
    : unsupportedAudioCodec === 'mp2' ? 'audio' : null;

  return (
    <div className={`pointer-events-none relative w-full h-full bg-black ${className}`}>
      <video
        ref={videoRef}
        poster={poster}
        autoPlay={autoPlay}
        playsInline
        className="pointer-events-none w-full h-full object-contain"
      />

      {isLoading && isLoadingOverlayVisible && !error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/50 z-10">
          {isCatchUpLoading ? (
            <div className="flex w-[min(420px,calc(100%-32px))] flex-col items-center gap-3 text-center text-white">
              <Loader2 className="h-9 w-9 animate-spin text-primary" />
              <div className="space-y-1">
                <p className="text-sm font-semibold">{loadingCopy.title}</p>
                <p className="text-xs text-white/75">{loadingCopy.detail}</p>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/15">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${loadingProgressPercent}%` }}
                />
              </div>
              <p className="text-[11px] text-white/55">
                {loadingCopy.status} · {loadingElapsedSeconds}s
              </p>
            </div>
          ) : (
            <Loader2 className="w-12 h-12 text-primary animate-spin" />
          )}
        </div>
      )}

      {codecNoticeKind && !error && (
        <CodecNotice key={`${session.source?.url}:${codecNoticeKind}`} kind={codecNoticeKind} />
      )}

      {error && (
        <ErrorDisplay
          error={error}
          sourceForPrimaryAction={resolvePlayerErrorActionSource(errorState, session.source)}
        />
      )}
    </div>
  );
});

VideoPlayer.displayName = 'VideoPlayer';

export default VideoPlayer;
