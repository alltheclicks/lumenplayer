import Hls, {
  type ErrorData,
  type LoadPolicy,
  type LoaderResponse,
  type RetryConfig,
} from 'hls.js';
import type {
  AudioTrackOption,
  MediaSource,
  PlaybackError,
  PlaybackState,
  PlayerAdapter,
  SubtitleTrackOption,
} from '@lumen/types';
import {
  detectMpegTsAudio,
  stripUnsupportedMpegAudioFromTs,
} from './mpegTsAudioStrip';
import {
  createCatchUpRebaseSession,
  recordCatchUpRebaseProcessing,
  rebaseCatchUpSegment,
  type CatchUpRebaseBoundary,
  type CatchUpRebaseSession,
  type CatchUpRebaseSessionStats,
} from './mpegTsPtsRebase';

const HLS_MIME_TYPE = 'application/vnd.apple.mpegurl';
const MEDIA_READY_STATE_HAVE_CURRENT_DATA = 2;
const HLS_BUFFERING_RECOVERY_DELAY_MS = 4_000;
const HLS_BUFFERING_PROGRESS_TOLERANCE_SECONDS = 0.25;
const HLS_BUFFERING_MAX_RECOVERY_ATTEMPTS = 2;
const HLS_LIVE_MEDIA_RECOVERY_MAX_ATTEMPTS = 4;
// Catch-up streams hit periodic decode/transmux discontinuities mid-playback.
// Like live, prefer a few cheap hls.recoverMediaError() passes (no reload, no
// timeline jump) before surfacing the error to the session layer, which would
// otherwise skip ahead and leave a visible gap (KN catch-up decode-skip).
const HLS_CATCHUP_MEDIA_RECOVERY_MAX_ATTEMPTS = 4;
// Recoveries spaced further apart than this are treated as independent
// incidents (fresh budget); closer together they accumulate toward the cap
// so a hard-stuck decoder still escalates to the session layer.
const HLS_ELEMENT_DECODE_RECOVERY_COOLDOWN_MS = 5_000;
// How long a foreground-resumed pipeline gets to prove it is actually alive
// before the "already usable" diagnosis is overturned into a full rebuild.
// The observed async death (element emptied after the resume snapshot looked
// healthy) lands well inside this window.
const BACKGROUND_RESUME_LIVENESS_TIMEOUT_MS = 2_500;
// A rebuilt pipeline needs stronger proof than a resumed one: the manifest
// being parsed only proves that the playlist loaded, not that the browser can
// decode and render the stream. Catch-up gets the longer window because its
// first archive segment is measurably slower than live startup in production.
const BACKGROUND_REBUILD_LIVE_FRAME_TIMEOUT_MS = 8_000;
const BACKGROUND_REBUILD_CATCHUP_FRAME_TIMEOUT_MS = 12_000;
// recoverMediaError() detaches/re-attaches MediaSource; the session layer's
// startup logic can react to the re-attach by pulling the playhead back to
// the catch-up start. Enforce the pre-error position for this long after a
// recovery so the viewer resumes where the decoder tripped.
const HLS_DECODE_RECOVERY_RESUME_WINDOW_MS = 12_000;
const HLS_DECODE_RECOVERY_RESUME_TOLERANCE_SECONDS = 3;
const HLS_CATCHUP_MAX_BUFFER_LENGTH_SECONDS = 90;
const HLS_CATCHUP_MAX_BUFFER_SIZE_MB = 180;
const HLS_CATCHUP_REBASE_MAX_BUFFER_SIZE_MB = 96;
const HLS_CATCHUP_REBASE_MAX_SEGMENT_BYTES = 64 * 1024 * 1024;
const HLS_LIVE_MAX_BUFFER_LENGTH_SECONDS = 30;
const HLS_LIVE_MAX_BUFFER_SIZE_MB = 60;
// Back-buffer retention: catch-up keeps a wide window so the user can scrub back,
// while live only needs a short tail to recover from brief decode hiccups (KN-3).
const HLS_CATCHUP_BACK_BUFFER_LENGTH_SECONDS = 90;
const HLS_LIVE_BACK_BUFFER_LENGTH_SECONDS = 30;
const HLS_LIVE_MPEG_AUDIO_PREFLIGHT_TIMEOUT_MS = 4_000;
const HLS_LIVE_MPEG_AUDIO_PREFLIGHT_RANGE_END = 256 * 1024 - 1;
// Structured load-retry policy (KN/M1.1-d): exponential backoff with a capped
// max delay, applied to both fragment and playlist loaders.
const HLS_LOAD_POLICY_MAX_RETRY_DELAY_MS = 8_000;
const HLS_LOAD_POLICY_INITIAL_RETRY_DELAY_MS = 1_000;
const HLS_FRAG_LOAD_MAX_RETRY = 4;
const HLS_PLAYLIST_LOAD_MAX_RETRY = 3;
const HLS_LOAD_TIMEOUT_MS = 20_000;
const HLS_LOAD_TIMEOUT_MAX_RETRY = 2;
// Throttle for fatal NETWORK_ERROR startLoad() recovery (M1.1-e) so a flapping
// upstream cannot trigger a tight reload loop that trips provider 429 limits.
const HLS_NETWORK_ERROR_RECOVERY_DELAY_MS = 3_000;
const HLS_NETWORK_ERROR_RECOVERY_MAX_ATTEMPTS = 3;
// HTTP statuses that must never be retried — the upstream is rejecting auth, so
// retrying only burns request budget and risks provider rate limiting.
const HLS_NON_RETRYABLE_HTTP_STATUSES = new Set([401, 403]);
// Catch-up archives are byte-copied mid-GOP, so the first buffered video frame
// (first keyframe with SPS/PPS) lands 0.6-1.5s past the segment's nominal start
// while the playhead sits at 0. hls.js can snap the start position onto the
// buffer start (stream-controller seekToStartPos + startOnSegmentBoundary), but
// that code path only runs when currentTime < startPosition — with a
// startPosition of exactly 0 it is dead code and the playhead is stranded in
// the dead zone. Start "from the beginning" at a tiny positive position
// instead; combined with startOnSegmentBoundary the start then snaps to the
// first decodable keyframe, and for clean archives (buffer starts at 0) the
// snap resolves right back to 0, so nothing is skipped.
const HLS_CATCHUP_START_FROM_BEGINNING_POSITION_SECONDS = 0.1;
const PLAYBACK_LOAD_CANCELLED_MESSAGE = 'Playback load was cancelled.';

type StateListener = (state: PlaybackState) => void;
type ErrorListener = (error: PlaybackError) => void;
type TimeListener = (time: number) => void;
type AudioTracksListener = (tracks: AudioTrackOption[], selectedTrackId: string | null) => void;
type SubtitleTracksListener = (
  tracks: SubtitleTrackOption[],
  selectedTrackId: string | null
) => void;

interface ManifestResolvedEvent {
  requestedUrl: string;
  manifestUrl: string;
  finalUrl: string | null;
}

interface UnsupportedAudioCodecEvent {
  unsupportedAudioCodec: 'mp2';
  sourceUrl: string;
  playbackMode: 'live' | 'catchup';
}

interface UnsupportedVideoCodecEvent {
  unsupportedVideoCodec: 'hevc';
  sourceUrl: string;
  playbackMode: 'live' | 'catchup';
}

interface CatchUpRebaseFallbackEvent {
  reason: string;
  sourceUrl: string;
}

interface CatchUpStallEvent {
  trigger: 'waiting' | 'buffer-stalled';
  currentTimeSeconds: number;
  nearestBoundaryMediaTimeSeconds: number | null;
  distanceToBoundaryMs: number | null;
  videoHoleMs: number | null;
}

interface HlsPlayerAdapterOptions {
  preferNativeHls?: boolean;
  onManifestResolved?: (event: ManifestResolvedEvent) => void;
  onUnsupportedAudioCodec?: (event: UnsupportedAudioCodecEvent) => void;
  onUnsupportedVideoCodec?: (event: UnsupportedVideoCodecEvent) => void;
  onCatchUpRebaseFallback?: (event: CatchUpRebaseFallbackEvent) => void;
  onCatchUpRebaseBoundary?: (boundary: CatchUpRebaseBoundary) => void;
  onCatchUpRebaseSummary?: (stats: CatchUpRebaseSessionStats) => void;
  onCatchUpStall?: (event: CatchUpStallEvent) => void;
}

type PlaybackMetadataCarrier = MediaSource & {
  metadata?: {
    mode?: unknown;
    streamId?: unknown;
    catchUpHlsStartupMode?: unknown;
    catchUpHlsStartPositionSeconds?: unknown;
    catchUpClientRebase?: unknown;
  };
};

type CatchUpHlsStartupMode = 'progressive' | 'complete';
type HlsSourceMode = 'live' | 'catchup' | 'other';

export type BackgroundPlaybackResumeResult =
  | 'pipeline-already-usable'
  | 'pipeline-recovered'
  | 'pipeline-superseded'
  | 'pipeline-rebuilt';

export type BackgroundPlaybackResumeFailureCode =
  | 'source-reload-failed'
  | 'playback-start-failed'
  | 'rebuild-no-frame';

export class BackgroundPlaybackResumeError extends Error {
  readonly code: BackgroundPlaybackResumeFailureCode;
  readonly cause: unknown;

  constructor(
    code: BackgroundPlaybackResumeFailureCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'BackgroundPlaybackResumeError';
    this.code = code;
    this.cause = cause;
  }
}

type HlsLoaderResponse = { data?: unknown; [key: string]: unknown };
type HlsLoaderCallbacks = {
  onSuccess: (
    response: HlsLoaderResponse,
    stats: unknown,
    context: unknown,
    networkDetails: unknown,
  ) => void;
  [key: string]: unknown;
};
type HlsLoaderInstance = {
  context: unknown;
  stats: unknown;
  load: (context: unknown, config: unknown, callbacks: HlsLoaderCallbacks) => void;
  abort: () => void;
  destroy: () => void;
  getCacheAge?: () => number | null;
  getResponseHeader?: (name: string) => string | null;
};
type HlsLoaderConstructor = new (config: unknown) => HlsLoaderInstance;

const parsePositiveFiniteNumber = (value: unknown): number => {
  const numericValue = typeof value === 'number'
    ? value
    : (typeof value === 'string' ? Number(value) : NaN);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : 0;
};

const createTimeoutSignal = (timeoutMs: number): AbortSignal | undefined => {
  if (typeof AbortSignal === 'undefined') {
    return undefined;
  }

  const timeoutFactory = AbortSignal as typeof AbortSignal & {
    timeout?: (milliseconds: number) => AbortSignal;
  };
  if (typeof timeoutFactory.timeout === 'function') {
    return timeoutFactory.timeout(timeoutMs);
  }

  if (typeof AbortController === 'undefined') {
    return undefined;
  }

  const controller = new AbortController();
  globalThis.setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
};

const parsePlaylistLines = (playlist: string): string[] => (
  playlist
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
);

const resolvePlaylistUrl = (baseUrl: string, value: string): string | null => {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
};

const findFirstVariantUrl = (baseUrl: string, playlist: string): string | null => {
  const lines = parsePlaylistLines(playlist);
  const variantIndex = lines.findIndex((line) => line.startsWith('#EXT-X-STREAM-INF'));
  if (variantIndex < 0) {
    return null;
  }

  const variantLine = lines[variantIndex + 1];
  if (!variantLine || variantLine.startsWith('#')) {
    return null;
  }

  return resolvePlaylistUrl(baseUrl, variantLine);
};

const findProbeSegmentUrl = (baseUrl: string, playlist: string, fromStart = false): string | null => {
  const segments = parsePlaylistLines(playlist)
    .filter((line) => !line.startsWith('#'))
    .filter((line) => !/\.m3u8(?:[?#]|$)/i.test(line))
    .map((line) => resolvePlaylistUrl(baseUrl, line))
    .filter((value): value is string => Boolean(value));

  return segments.at(fromStart ? 0 : -1) ?? null;
};

const fetchPlaylistText = async (url: string): Promise<{ url: string; text: string }> => {
  const response = await fetch(url, {
    cache: 'no-store',
    redirect: 'follow',
    signal: createTimeoutSignal(HLS_LIVE_MPEG_AUDIO_PREFLIGHT_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Live manifest preflight failed: ${response.status}`);
  }

  return {
    url: response.url || url,
    text: await response.text(),
  };
};

// Low-latency HLS markers. Their presence in the *media* playlist means the
// server actually supports LL-HLS partial segments; only then is it safe to
// turn on hls.js `lowLatencyMode` for a live stream (M1.1-b / KN-2). Plain
// Xtream live playlists never carry these, so they default to standard mode.
const isLowLatencyHlsManifest = (text: string): boolean => (
  /^#EXT-X-PART(?:-INF)?:/m.test(text) ||
  /^#EXT-X-SERVER-CONTROL:[^\n]*CAN-BLOCK-RELOAD=YES/m.test(text)
);

interface LiveProbeManifestResult {
  segmentUrl: string | null;
  lowLatencyHls: boolean;
}

const resolveLiveProbeSegmentUrl = async (manifestUrl: string, fromStart = false): Promise<LiveProbeManifestResult> => {
  const manifest = await fetchPlaylistText(manifestUrl);
  const variantUrl = findFirstVariantUrl(manifest.url, manifest.text);
  if (!variantUrl) {
    return {
      segmentUrl: findProbeSegmentUrl(manifest.url, manifest.text, fromStart),
      lowLatencyHls: isLowLatencyHlsManifest(manifest.text),
    };
  }

  const mediaManifest = await fetchPlaylistText(variantUrl);
  return {
    segmentUrl: findProbeSegmentUrl(mediaManifest.url, mediaManifest.text, fromStart),
    lowLatencyHls: isLowLatencyHlsManifest(mediaManifest.text),
  };
};

const fetchProbeSegmentBytes = async (segmentUrl: string): Promise<ArrayBuffer> => {
  const response = await fetch(segmentUrl, {
    cache: 'no-store',
    redirect: 'follow',
    headers: {
      Range: `bytes=0-${HLS_LIVE_MPEG_AUDIO_PREFLIGHT_RANGE_END}`,
    },
    signal: createTimeoutSignal(HLS_LIVE_MPEG_AUDIO_PREFLIGHT_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Live segment preflight failed: ${response.status}`);
  }

  return response.arrayBuffer();
};

interface LiveCodecProbeResult {
  // Video present but audio is MPEG-1/2 (MP2), which browsers can't decode in MSE.
  unsupportedMpegAudio: boolean;
  // Video is H.265/HEVC, which most browsers can't decode in MSE.
  unsupportedHevcVideo: boolean;
  // Manifest advertises genuine LL-HLS (EXT-X-PART / blocking reload).
  lowLatencyHls: boolean;
}

const probeLiveCodecSupport = async (manifestUrl: string, fromStart = false): Promise<LiveCodecProbeResult> => {
  const empty: LiveCodecProbeResult = {
    unsupportedMpegAudio: false,
    unsupportedHevcVideo: false,
    lowLatencyHls: false,
  };
  if (typeof fetch !== 'function') {
    return empty;
  }

  try {
    const { segmentUrl, lowLatencyHls } = await resolveLiveProbeSegmentUrl(manifestUrl, fromStart);
    if (!segmentUrl) {
      return { ...empty, lowLatencyHls };
    }

    const segmentBytes = await fetchProbeSegmentBytes(segmentUrl);
    const detection = detectMpegTsAudio(segmentBytes);
    return {
      unsupportedMpegAudio: detection.hasVideo && detection.hasMpegAudio,
      unsupportedHevcVideo: detection.hasHevcVideo,
      lowLatencyHls,
    };
  } catch {
    return empty;
  }
};

const createMpegAudioStrippingFragmentLoader = (
  BaseLoader: HlsLoaderConstructor,
): HlsLoaderConstructor => class {
  private readonly loader: HlsLoaderInstance;
  context: unknown = null;
  stats: unknown;

  constructor(config: unknown) {
    this.loader = new BaseLoader(config);
    this.stats = this.loader.stats;
  }

  load(context: unknown, config: unknown, callbacks: HlsLoaderCallbacks): void {
    this.context = context;
    this.loader.load(context, config, {
      ...callbacks,
      onSuccess: (response, stats, callbackContext, networkDetails) => {
        const payload = response.data;
        callbacks.onSuccess({
          ...response,
          data: payload instanceof ArrayBuffer
            ? stripUnsupportedMpegAudioFromTs(payload)
            : payload,
        }, stats, callbackContext, networkDetails);
      },
    });
  }

  abort(): void {
    this.loader.abort();
  }

  destroy(): void {
    this.loader.destroy();
  }

  getCacheAge(): number | null {
    return this.loader.getCacheAge?.() ?? null;
  }

  getResponseHeader(name: string): string | null {
    return this.loader.getResponseHeader?.(name) ?? null;
  }
};

// Rewrites each catch-up TS segment in place so the per-minute archive files
// form one continuous PTS timeline (see mpegTsPtsRebase.ts). Un-rebased bytes
// must never reach the discontinuity-stripped timeline, so any rebase failure
// escalates through `onFatal` and the adapter reloads without rebasing.
const createCatchUpRebaseFragmentLoader = (
  BaseLoader: HlsLoaderConstructor,
  session: CatchUpRebaseSession,
  hooks: {
    onFatal: (reason: string) => void;
    onBoundary: (boundary: CatchUpRebaseBoundary) => void;
  },
): HlsLoaderConstructor => class {
  private readonly loader: HlsLoaderInstance;
  context: unknown = null;
  stats: unknown;

  constructor(config: unknown) {
    this.loader = new BaseLoader(config);
    this.stats = this.loader.stats;
  }

  load(context: unknown, config: unknown, callbacks: HlsLoaderCallbacks): void {
    this.context = context;
    const fragmentSn = (context as { frag?: { sn?: unknown } } | null)?.frag?.sn;
    this.loader.load(context, config, {
      ...callbacks,
      onSuccess: (response, stats, callbackContext, networkDetails) => {
        const payload = response.data;
        if (!(payload instanceof ArrayBuffer) || typeof fragmentSn !== 'number') {
          callbacks.onSuccess(response, stats, callbackContext, networkDetails);
          return;
        }

        if (payload.byteLength > HLS_CATCHUP_REBASE_MAX_SEGMENT_BYTES) {
          hooks.onFatal('segment-too-large');
          return;
        }

        const processingStartedAt = performance.now();
        const outcome = rebaseCatchUpSegment(session, fragmentSn, payload);
        recordCatchUpRebaseProcessing(
          session,
          payload.byteLength,
          performance.now() - processingStartedAt,
        );
        if (outcome.status === 'rebased') {
          outcome.updatedBoundaries.forEach(hooks.onBoundary);
          callbacks.onSuccess(
            { ...response, data: outcome.data },
            stats,
            callbackContext,
            networkDetails,
          );
          return;
        }

        hooks.onFatal(outcome.reason);
      },
    });
  }

  abort(): void {
    this.loader.abort();
  }

  destroy(): void {
    this.loader.destroy();
  }

  getCacheAge(): number | null {
    return this.loader.getCacheAge?.() ?? null;
  }

  getResponseHeader(name: string): string | null {
    return this.loader.getResponseHeader?.(name) ?? null;
  }
};

const stripDiscontinuityTags = (playlist: string): string => (
  playlist
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '#EXT-X-DISCONTINUITY')
    .join('\n')
);

// Companion to the rebase fragment loader: with the per-segment timestamps
// rewritten into one continuous timeline, the #EXT-X-DISCONTINUITY tags must
// disappear so hls.js keeps a single continuity counter and never resets the
// demuxer/remuxer at the archive minute boundaries.
const createDiscontinuityStrippingPlaylistLoader = (
  BaseLoader: HlsLoaderConstructor,
): HlsLoaderConstructor => class {
  private readonly loader: HlsLoaderInstance;
  context: unknown = null;
  stats: unknown;

  constructor(config: unknown) {
    this.loader = new BaseLoader(config);
    this.stats = this.loader.stats;
  }

  load(context: unknown, config: unknown, callbacks: HlsLoaderCallbacks): void {
    this.context = context;
    this.loader.load(context, config, {
      ...callbacks,
      onSuccess: (response, stats, callbackContext, networkDetails) => {
        const payload = response.data;
        callbacks.onSuccess(
          typeof payload === 'string' && payload.includes('#EXTINF')
            ? { ...response, data: stripDiscontinuityTags(payload) }
            : response,
          stats,
          callbackContext,
          networkDetails,
        );
      },
    });
  }

  abort(): void {
    this.loader.abort();
  }

  destroy(): void {
    this.loader.destroy();
  }

  getCacheAge(): number | null {
    return this.loader.getCacheAge?.() ?? null;
  }

  getResponseHeader(name: string): string | null {
    return this.loader.getResponseHeader?.(name) ?? null;
  }
};

interface NativeAudioTrack {
  enabled?: boolean;
  language?: string;
  label?: string;
}

interface NativeAudioTrackListLike {
  length: number;
  [index: number]: NativeAudioTrack;
  addEventListener?: (event: string, handler: () => void) => void;
  removeEventListener?: (event: string, handler: () => void) => void;
}

interface NativeTextTrack {
  mode: string;
  language?: string;
  label?: string;
  kind?: string;
}

interface NativeTextTrackListLike {
  length: number;
  [index: number]: NativeTextTrack;
  addEventListener?: (event: string, handler: () => void) => void;
  removeEventListener?: (event: string, handler: () => void) => void;
}

export class HlsPlayerAdapter implements PlayerAdapter {
  private static readonly activeAdapters = new Set<HlsPlayerAdapter>();
  private readonly video: HTMLVideoElement;
  private readonly preferNativeHls: boolean;
  private hls: Hls | null = null;
  private cancelHlsStartup: (() => void) | null = null;
  private audioTracks: AudioTrackOption[] = [];
  private selectedAudioTrackId: string | null = null;
  private subtitleTracks: SubtitleTrackOption[] = [];
  private selectedSubtitleTrackId: string | null = null;
  private state: PlaybackState = 'idle';
  private readonly stateListeners = new Set<StateListener>();
  private readonly errorListeners = new Set<ErrorListener>();
  private readonly timeListeners = new Set<TimeListener>();
  private readonly audioTracksListeners = new Set<AudioTracksListener>();
  private readonly subtitleTracksListeners = new Set<SubtitleTracksListener>();
  private readonly removeVideoListeners: () => void;
  private readonly onManifestResolved?: (event: ManifestResolvedEvent) => void;
  private bufferingRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private bufferingRecoveryAttempts = 0;
  private bufferingRecoveryEnabled = false;
  private bufferingRecoveryArmed = false;
  // M1.1-e: throttled fatal NETWORK_ERROR recovery state.
  private networkErrorRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private networkErrorRecoveryAttempts = 0;
  private documentHidden = false;
  private backgroundMediaRecoveryPending = false;
  private backgroundNetworkRecoveryPending = false;
  private backgroundResumePromise: Promise<BackgroundPlaybackResumeResult> | null = null;
  private backgroundResumeSourceUrl: string | null = null;
  private elementDecodeRecoveryAttempts = 0;
  private lastElementDecodeRecoveryAt = 0;
  private decodeRecoveryResumeAtSeconds: number | null = null;
  private decodeRecoveryResumeDeadline = 0;
  private nativeHlsLoaded = false;
  private hlsSourceMode: HlsSourceMode | null = null;
  private loadGeneration = 0;
  // Catch-up startup diagnostics: track whether a fragment is currently being
  // fetched so a startup watchdog can tell "slow first segment in flight" apart
  // from "no segment will ever come" and avoid reseeking on top of a live load.
  private fragmentInFlight = false;
  private lastFragmentLoadStartedAt: number | null = null;
  private lastFragmentLoadedAt: number | null = null;
  private readonly onUnsupportedAudioCodec?: (event: UnsupportedAudioCodecEvent) => void;
  private readonly onUnsupportedVideoCodec?: (event: UnsupportedVideoCodecEvent) => void;
  private readonly onCatchUpRebaseFallback?: (event: CatchUpRebaseFallbackEvent) => void;
  private readonly onCatchUpRebaseBoundary?: (boundary: CatchUpRebaseBoundary) => void;
  private readonly onCatchUpRebaseSummary?: (stats: CatchUpRebaseSessionStats) => void;
  private readonly onCatchUpStall?: (event: CatchUpStallEvent) => void;
  private catchUpRebaseSession: CatchUpRebaseSession | null = null;

  constructor(video: HTMLVideoElement, options: HlsPlayerAdapterOptions = {}) {
    this.video = video;
    this.preferNativeHls = options.preferNativeHls ?? false;
    this.onManifestResolved = options.onManifestResolved;
    this.onUnsupportedAudioCodec = options.onUnsupportedAudioCodec;
    this.onUnsupportedVideoCodec = options.onUnsupportedVideoCodec;
    this.onCatchUpRebaseFallback = options.onCatchUpRebaseFallback;
    this.onCatchUpRebaseBoundary = options.onCatchUpRebaseBoundary;
    this.onCatchUpRebaseSummary = options.onCatchUpRebaseSummary;
    this.onCatchUpStall = options.onCatchUpStall;
    this.removeVideoListeners = this.attachVideoListeners();
    HlsPlayerAdapter.activeAdapters.add(this);
  }

  async load(source: MediaSource): Promise<void> {
    const loadGeneration = this.nextLoadGeneration();
    this.fragmentInFlight = false;
    this.lastFragmentLoadStartedAt = null;
    this.lastFragmentLoadedAt = null;
    HlsPlayerAdapter.stopCompetingPlayback(this);
    const nextHlsSourceMode = source.type === 'hls'
      ? HlsPlayerAdapter.resolveHlsSourceMode((source as PlaybackMetadataCarrier).metadata?.mode)
      : null;
    const shouldFlushPreviousNativeHls = this.nativeHlsLoaded;
    const shouldFlushPreviousHlsModeSwitch = (
      this.hls !== null &&
      this.hlsSourceMode !== null &&
      nextHlsSourceMode !== null &&
      this.hlsSourceMode !== nextHlsSourceMode &&
      (
        this.hlsSourceMode === 'live' ||
        this.hlsSourceMode === 'catchup' ||
        nextHlsSourceMode === 'live' ||
        nextHlsSourceMode === 'catchup'
      )
    );
    this.clearHls();
    this.resetPlaybackState(shouldFlushPreviousNativeHls || shouldFlushPreviousHlsModeSwitch);
    this.updateState('loading');
    this.bufferingRecoveryEnabled = (
      (source as PlaybackMetadataCarrier).metadata?.mode === 'catchup'
    );
    this.bufferingRecoveryArmed = false;

    if (this.isMixedContentBlocked(source.url)) {
      const error: PlaybackError = {
        code: 'MIXED_CONTENT',
        message: 'HTTPS page cannot access HTTP stream.',
        fatal: true,
      };
      this.emitError(error);
      throw new Error(error.message);
    }

    if (source.type === 'hls') {
      const sourceMode = (source as PlaybackMetadataCarrier).metadata?.mode;
      const streamId = (source as PlaybackMetadataCarrier).metadata?.streamId;
      const catchUpStartPositionSeconds = parsePositiveFiniteNumber(
        (source as PlaybackMetadataCarrier).metadata?.catchUpHlsStartPositionSeconds,
      );
      const catchUpStartupMode = (
        (source as PlaybackMetadataCarrier).metadata?.catchUpHlsStartupMode === 'complete'
          ? 'complete'
          : 'progressive'
      );
      const catchUpClientRebase = (
        (source as PlaybackMetadataCarrier).metadata?.catchUpClientRebase === true
      );
      await this.loadHlsSource(
        source.url,
        sourceMode === 'live',
        sourceMode === 'catchup',
        0,
        catchUpStartupMode,
        catchUpStartPositionSeconds,
        (sourceMode === 'live' || sourceMode === 'catchup') && typeof streamId === 'number' && Number.isFinite(streamId),
        catchUpClientRebase,
        loadGeneration,
      );
      return;
    }

    this.assertCurrentLoad(loadGeneration);

    this.nativeHlsLoaded = false;
    this.video.src = source.url;
    this.video.load();
    this.updateState('paused');
  }

  // True when the media element actually has something to play: hls.js is
  // attached (MSE blob source) or a non-empty src/currentSrc is set. Used to
  // avoid calling play() on a source-less element, which throws "Empty src"
  // and, under autoplay-recovery retries, floods MEDIA_ELEMENT_4 errors.
  private hasPlayableSource(): boolean {
    if (this.hls !== null) {
      return true;
    }
    const src = this.video.src ?? '';
    const currentSrc = this.video.currentSrc ?? '';
    const pageHref = typeof window !== 'undefined' ? window.location.href : '';
    const hasExplicitSrc = src !== '' && src !== pageHref;
    const hasResolvedSrc = currentSrc !== '' && currentSrc !== pageHref;
    return hasExplicitSrc || hasResolvedSrc;
  }

  play(): void {
    HlsPlayerAdapter.stopCompetingPlayback(this);
    // Autoplay-recovery may call play() before the source is attached. Calling
    // play() with no source produces a spurious "Empty src" media error in a
    // tight loop; skip the call until a real source exists.
    if (!this.hasPlayableSource()) {
      return;
    }
    const playGeneration = this.loadGeneration;
    this.video.play().catch((error: unknown) => {
      if (!this.isCurrentLoad(playGeneration)) return;
      const message = error instanceof Error && error.message
        ? `Unable to start playback: ${error.name}: ${error.message}`
        : 'Unable to start playback.';
      // NotAllowedError means the browser refuses autoplay until the user
      // interacts with the page. Unlike the other play() rejections it is a
      // standing condition, not a transient one: retrying without a user
      // gesture always fails again. Report it under its own code so the
      // recovery layer can stop retrying and ask for a tap instead of
      // spinning on play()/pause() forever.
      const isAutoplayBlocked = error instanceof Error && error.name === 'NotAllowedError';
      this.emitError({
        code: isAutoplayBlocked ? 'PLAYBACK_AUTOPLAY_BLOCKED' : 'PLAYBACK_START_FAILED',
        message,
        fatal: false,
      });
    });
  }

  setDocumentHidden(hidden: boolean): void {
    this.documentHidden = hidden;
    if (hidden) {
      return;
    }

    this.recoverDeferredBackgroundFailures();
  }

  resumeAfterBackground(source: MediaSource): Promise<BackgroundPlaybackResumeResult> {
    if (
      this.backgroundResumePromise &&
      this.backgroundResumeSourceUrl === source.url
    ) {
      return this.backgroundResumePromise;
    }

    const resumePromise = this.resumeMediaPipelineAfterBackground(source);
    this.backgroundResumePromise = resumePromise;
    this.backgroundResumeSourceUrl = source.url;
    const clearResumePromise = () => {
      if (this.backgroundResumePromise === resumePromise) {
        this.backgroundResumePromise = null;
        this.backgroundResumeSourceUrl = null;
      }
    };
    void resumePromise.then(clearResumePromise, clearResumePromise);
    return resumePromise;
  }

  private async resumeMediaPipelineAfterBackground(
    source: MediaSource,
  ): Promise<BackgroundPlaybackResumeResult> {
    this.documentHidden = false;

    // Chromium may suspend or discard the MediaSource backing a background
    // video while leaving both our Hls instance and the logical session alive.
    // In that state video.play() rejects with "no supported sources". Rebuild
    // only the media pipeline from the same source; the channel/session/UI stay
    // untouched.
    if (this.isMediaPipelineDetached()) {
      return this.rebuildMediaPipeline(source);
    }

    const recovered = this.recoverDeferredBackgroundFailures();
    this.play();
    if (recovered) {
      return 'pipeline-recovered';
    }

    // "Usable" is a snapshot: the pipeline can die asynchronously right after
    // the tab returns to the foreground (observed live: healthy at resume,
    // emptied ~400ms later with no recovery path left). Verify the element
    // actually keeps or produces media data before trusting the diagnosis.
    const generationAtResume = this.loadGeneration;
    const alive = await this.verifyResumedPipelineAlive();
    if (this.loadGeneration !== generationAtResume) {
      // Another load took over while we were verifying (e.g. a channel
      // switch) — do not clobber it with a rebuild of the old source.
      return 'pipeline-superseded';
    }
    if (alive) {
      return 'pipeline-already-usable';
    }
    return this.rebuildMediaPipeline(source);
  }

  private async rebuildMediaPipeline(
    source: MediaSource,
  ): Promise<BackgroundPlaybackResumeResult> {
    this.backgroundMediaRecoveryPending = false;
    this.backgroundNetworkRecoveryPending = false;
    const reload = this.load(source);
    const rebuildGeneration = this.loadGeneration;
    try {
      await reload;
    } catch (error) {
      if (!this.isCurrentLoad(rebuildGeneration)) return 'pipeline-superseded';
      throw new BackgroundPlaybackResumeError(
        'source-reload-failed',
        error instanceof Error ? error.message : 'Unable to reload playback source.',
        error,
      );
    }

    if (!this.isCurrentLoad(rebuildGeneration)) return 'pipeline-superseded';

    try {
      HlsPlayerAdapter.stopCompetingPlayback(this);
      if (!this.hasPlayableSource()) {
        throw new Error('Playback source is not attached after reload.');
      }
      await this.video.play();
    } catch (error) {
      if (!this.isCurrentLoad(rebuildGeneration)) return 'pipeline-superseded';
      throw new BackgroundPlaybackResumeError(
        'playback-start-failed',
        error instanceof Error ? error.message : 'Unable to restart playback.',
        error,
      );
    }

    if (!this.isCurrentLoad(rebuildGeneration)) return 'pipeline-superseded';

    const renderedFrame = await this.verifyRebuiltPipelineRenderedFrame(source);
    if (!this.isCurrentLoad(rebuildGeneration)) return 'pipeline-superseded';
    if (!renderedFrame) {
      throw new BackgroundPlaybackResumeError(
        'rebuild-no-frame',
        'Playback pipeline reloaded but did not render a video frame.',
      );
    }
    return 'pipeline-rebuilt';
  }

  private verifyRebuiltPipelineRenderedFrame(source: MediaSource): Promise<boolean> {
    const video = this.video;
    const sourceMode = HlsPlayerAdapter.resolveHlsSourceMode(
      (source as PlaybackMetadataCarrier).metadata?.mode,
    );
    const timeoutMs = sourceMode === 'catchup'
      ? BACKGROUND_REBUILD_CATCHUP_FRAME_TIMEOUT_MS
      : BACKGROUND_REBUILD_LIVE_FRAME_TIMEOUT_MS;
    const initialTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;

    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const progressEvents = ['timeupdate', 'playing', 'canplay', 'loadeddata'];
      const deadEvents = ['emptied', 'error'];
      const hasRenderedFrame = () => (
        !video.error &&
        (
          video.currentTime > initialTime + 0.01 ||
          (
            video.readyState >= MEDIA_READY_STATE_HAVE_CURRENT_DATA &&
            video.videoWidth > 0
          )
        )
      );
      const cleanup = () => {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        progressEvents.forEach((name) => video.removeEventListener(name, onProgress));
        deadEvents.forEach((name) => video.removeEventListener(name, onDead));
      };
      const finish = (rendered: boolean) => {
        cleanup();
        resolve(rendered);
      };
      const onProgress = () => {
        if (hasRenderedFrame()) {
          finish(true);
        }
      };
      const onDead = () => finish(false);

      if (hasRenderedFrame()) {
        resolve(true);
        return;
      }
      if (video.error) {
        resolve(false);
        return;
      }
      progressEvents.forEach((name) => video.addEventListener(name, onProgress));
      deadEvents.forEach((name) => video.addEventListener(name, onDead));
      timer = setTimeout(() => finish(hasRenderedFrame()), timeoutMs);
    });
  }

  // Resolves true when the resumed element proves it is alive (playback
  // progresses or it already holds media data at the deadline), false when it
  // is emptied/errored or still has no media data when the window closes.
  private verifyResumedPipelineAlive(): Promise<boolean> {
    const video = this.video;
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const aliveEvents = ['timeupdate', 'playing', 'canplay', 'loadeddata'];
      const deadEvents = ['emptied', 'error'];
      const cleanup = () => {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        aliveEvents.forEach((name) => video.removeEventListener(name, onAlive));
        deadEvents.forEach((name) => video.removeEventListener(name, onDead));
      };
      const onAlive = () => {
        cleanup();
        resolve(true);
      };
      const onDead = () => {
        cleanup();
        resolve(false);
      };
      if (video.error) {
        resolve(false);
        return;
      }
      aliveEvents.forEach((name) => video.addEventListener(name, onAlive));
      deadEvents.forEach((name) => video.addEventListener(name, onDead));
      timer = setTimeout(() => {
        const hasMediaData = (
          video.readyState > 0 ||
          video.videoWidth > 0 ||
          video.buffered.length > 0
        );
        cleanup();
        resolve(hasMediaData && !video.error);
      }, BACKGROUND_RESUME_LIVENESS_TIMEOUT_MS);
    });
  }

  private recoverDeferredBackgroundFailures(): boolean {
    const hls = this.hls;
    const recoverMedia = this.backgroundMediaRecoveryPending;
    const recoverNetwork = this.backgroundNetworkRecoveryPending;
    this.backgroundMediaRecoveryPending = false;
    this.backgroundNetworkRecoveryPending = false;
    if (!hls || (!recoverMedia && !recoverNetwork)) {
      return false;
    }

    this.updateState('buffering');
    if (recoverMedia) {
      hls.recoverMediaError();
    }
    if (recoverNetwork) {
      hls.startLoad();
    }
    return true;
  }

  private isMediaPipelineDetached(): boolean {
    const hasMediaData = (
      this.video.readyState > 0 ||
      this.video.videoWidth > 0 ||
      this.video.buffered.length > 0
    );

    if (this.hls) {
      const attachedMedia = this.hls.media;
      return attachedMedia !== this.video || !hasMediaData;
    }

    if (this.nativeHlsLoaded) {
      return !hasMediaData;
    }

    // With no active playback engine, a leftover MSE object URL is dead: after
    // the element is emptied Chromium keeps the revoked blob URL in currentSrc
    // (src attribute already cleared), so hasPlayableSource() alone misreads
    // the dead pipeline as usable and play() rejects with NotSupportedError.
    const src = this.video.src ?? '';
    const currentSrc = this.video.currentSrc ?? '';
    if (
      !hasMediaData &&
      (src.startsWith('blob:') || currentSrc.startsWith('blob:'))
    ) {
      return true;
    }

    return !this.hasPlayableSource();
  }

  pause(): void {
    this.video.pause();
  }

  seek(time: number): void {
    this.video.currentTime = Math.max(0, time);
  }

  stop(): void {
    this.nextLoadGeneration();
    this.clearHls();
    this.resetPlaybackState(true);
  }

  destroy(): void {
    this.nextLoadGeneration();
    this.clearHls();
    this.removeVideoListeners();
    this.stop();
    HlsPlayerAdapter.activeAdapters.delete(this);
    this.stateListeners.clear();
    this.errorListeners.clear();
    this.timeListeners.clear();
    this.audioTracksListeners.clear();
    this.subtitleTracksListeners.clear();
  }

  getCurrentTime(): number {
    return this.video.currentTime || 0;
  }

  getDuration(): number {
    return this.video.duration || 0;
  }

  getState(): PlaybackState {
    return this.state;
  }

  // Catch-up startup diagnostics. A startup watchdog can use this to avoid
  // reseeking while a (slow) fragment is still legitimately downloading.
  getSegmentLoadDiagnostics(): {
    fragmentInFlight: boolean;
    lastFragmentLoadStartedAt: number | null;
    lastFragmentLoadedAt: number | null;
  } {
    return {
      fragmentInFlight: this.fragmentInFlight,
      lastFragmentLoadStartedAt: this.lastFragmentLoadStartedAt,
      lastFragmentLoadedAt: this.lastFragmentLoadedAt,
    };
  }

  setVolume(volume: number): void {
    this.video.volume = Math.max(0, Math.min(1, volume));
  }

  getVolume(): number {
    return this.video.volume;
  }

  getAudioTracks(): AudioTrackOption[] {
    return this.audioTracks;
  }

  getSelectedAudioTrackId(): string | null {
    return this.selectedAudioTrackId;
  }

  getSubtitleTracks(): SubtitleTrackOption[] {
    return this.subtitleTracks;
  }

  getSelectedSubtitleTrackId(): string | null {
    return this.selectedSubtitleTrackId;
  }

  setAudioTrack(trackId: string): boolean {
    const selectedTrack = this.audioTracks.find((track) => track.id === trackId);
    if (!selectedTrack) {
      return false;
    }

    if (this.hls) {
      const hlsIndex = this.parseTrackIndex(trackId, 'hls-');
      if (hlsIndex === null || hlsIndex < 0 || hlsIndex >= this.hls.audioTracks.length) {
        return false;
      }
      this.hls.audioTrack = hlsIndex;
      this.selectedAudioTrackId = trackId;
      this.emitAudioTracksChange();
      return true;
    }

    const nativeAudioTracks = this.getNativeAudioTracks();
    if (nativeAudioTracks) {
      const nativeIndex = this.parseTrackIndex(trackId, 'native-');
      if (nativeIndex === null || nativeIndex < 0 || nativeIndex >= nativeAudioTracks.length) {
        return false;
      }

      for (let index = 0; index < nativeAudioTracks.length; index += 1) {
        nativeAudioTracks[index].enabled = index === nativeIndex;
      }

      this.syncNativeAudioTracks();
      return true;
    }

    return false;
  }

  setSubtitleTrack(trackId: string | null): boolean {
    if (trackId !== null) {
      const selectedTrack = this.subtitleTracks.find((track) => track.id === trackId);
      if (!selectedTrack) {
        return false;
      }
    }

    if (this.hls) {
      if (trackId === null) {
        this.hls.subtitleTrack = -1;
        this.selectedSubtitleTrackId = null;
        this.emitSubtitleTracksChange();
        return true;
      }

      const hlsIndex = this.parseTrackIndex(trackId, 'hls-subtitle-');
      if (hlsIndex === null || hlsIndex < 0 || hlsIndex >= this.hls.subtitleTracks.length) {
        return false;
      }

      this.hls.subtitleTrack = hlsIndex;
      this.selectedSubtitleTrackId = trackId;
      this.emitSubtitleTracksChange();
      return true;
    }

    const nativeTextTracks = this.getNativeTextTracks();
    if (nativeTextTracks) {
      if (trackId === null) {
        for (let index = 0; index < nativeTextTracks.length; index += 1) {
          nativeTextTracks[index].mode = 'disabled';
        }
        this.syncNativeSubtitleTracks();
        return true;
      }

      const nativeIndex = this.parseTrackIndex(trackId, 'native-subtitle-');
      if (nativeIndex === null || nativeIndex < 0 || nativeIndex >= nativeTextTracks.length) {
        return false;
      }

      for (let index = 0; index < nativeTextTracks.length; index += 1) {
        nativeTextTracks[index].mode = index === nativeIndex ? 'showing' : 'disabled';
      }

      this.syncNativeSubtitleTracks();
      return true;
    }

    return false;
  }

  onStateChange(callback: StateListener): () => void {
    this.stateListeners.add(callback);
    return () => this.stateListeners.delete(callback);
  }

  onError(callback: ErrorListener): () => void {
    this.errorListeners.add(callback);
    return () => this.errorListeners.delete(callback);
  }

  onTimeUpdate(callback: TimeListener): () => void {
    this.timeListeners.add(callback);
    return () => this.timeListeners.delete(callback);
  }

  onAudioTracksChange(callback: AudioTracksListener): () => void {
    this.audioTracksListeners.add(callback);
    callback(this.audioTracks, this.selectedAudioTrackId);
    return () => this.audioTracksListeners.delete(callback);
  }

  onSubtitleTracksChange(callback: SubtitleTracksListener): () => void {
    this.subtitleTracksListeners.add(callback);
    callback(this.subtitleTracks, this.selectedSubtitleTrackId);
    return () => this.subtitleTracksListeners.delete(callback);
  }

  private async loadHlsSource(
    url: string,
    isLiveSource = false,
    isCatchUpSource = false,
    liveStartupMediaRetryCount = 0,
    catchUpStartupMode: CatchUpHlsStartupMode = 'progressive',
    catchUpStartPositionSeconds = 0,
    probeLiveMpegAudio = false,
    catchUpClientRebase = false,
    loadGeneration = this.loadGeneration,
  ): Promise<void> {
    const codecProbe = (isLiveSource || isCatchUpSource) && probeLiveMpegAudio
      ? await probeLiveCodecSupport(url, isCatchUpSource)
      : { unsupportedMpegAudio: false, unsupportedHevcVideo: false, lowLatencyHls: false };
    const useMpegAudioVideoOnlyFallback = codecProbe.unsupportedMpegAudio;
    this.assertCurrentLoad(loadGeneration);

    if (useMpegAudioVideoOnlyFallback) {
      this.onUnsupportedAudioCodec?.({
        unsupportedAudioCodec: 'mp2',
        sourceUrl: url,
        playbackMode: isCatchUpSource ? 'catchup' : 'live',
      });
    }

    if (codecProbe.unsupportedHevcVideo) {
      this.onUnsupportedVideoCodec?.({
        unsupportedVideoCodec: 'hevc',
        sourceUrl: url,
        playbackMode: isCatchUpSource ? 'catchup' : 'live',
      });
    }

    if (
      !useMpegAudioVideoOnlyFallback &&
      !catchUpClientRebase &&
      this.preferNativeHls &&
      this.video.canPlayType(HLS_MIME_TYPE)
    ) {
      this.assertCurrentLoad(loadGeneration);
      this.loadNativeHlsSource(url);
      return;
    }

    if (Hls.isSupported()) {
      const useProgressiveCatchUpStartup = isCatchUpSource && catchUpStartupMode === 'progressive';
      const shouldUseProgressiveLoading = isLiveSource || useProgressiveCatchUpStartup;
      const MpegAudioStrippingFragmentLoader = useMpegAudioVideoOnlyFallback
        ? createMpegAudioStrippingFragmentLoader(Hls.DefaultConfig.loader as unknown as HlsLoaderConstructor)
        : null;

      // Client-side PTS rebase: stitch the per-minute archive files into one
      // continuous timeline (fLoader) and drop the discontinuity tags
      // (pLoader). Any rebase failure tears this hls instance down and
      // reloads the same URL without rebasing, so the legacy discontinuity
      // path behaves exactly as before.
      const catchUpRebaseSession = isCatchUpSource && catchUpClientRebase
        ? createCatchUpRebaseSession()
        : null;
      let rebaseFatalHandled = false;
      const onCatchUpRebaseFatal = (reason: string) => {
        if (rebaseFatalHandled || !this.isCurrentLoad(loadGeneration)) {
          return;
        }
        rebaseFatalHandled = true;
        // The loader callback runs deep inside hls.js's fragment pipeline;
        // defer the teardown so hls is never destroyed from its own stack.
        globalThis.setTimeout(() => {
          if (!this.isCurrentLoad(loadGeneration)) {
            return;
          }
          this.onCatchUpRebaseFallback?.({ reason, sourceUrl: url });
          this.emitCatchUpRebaseSummaryIfAny();
          const shouldResumePlayback = !this.video.paused;
          const resumePositionSeconds = (this.video.currentTime || 0) > 1
            ? this.video.currentTime
            : catchUpStartPositionSeconds;
          if (this.hls) {
            this.hls.destroy();
            this.hls = null;
          }
          this.updateState('loading');
          this.loadHlsSource(
            url,
            isLiveSource,
            isCatchUpSource,
            liveStartupMediaRetryCount,
            catchUpStartupMode,
            resumePositionSeconds,
            probeLiveMpegAudio,
            false,
            loadGeneration,
          ).then(() => {
            if (shouldResumePlayback && this.isCurrentLoad(loadGeneration)) {
              this.play();
            }
          }).catch((error: unknown) => {
            this.emitError({
              code: 'PLAYBACK_START_FAILED',
              message: error instanceof Error
                ? error.message
                : 'Catch-up reload without client rebase failed.',
              fatal: true,
            });
          });
        }, 0);
      };
      const CatchUpRebaseFragmentLoader = catchUpRebaseSession
        ? createCatchUpRebaseFragmentLoader(
          // Strip unsupported audio before rebasing so both transformations
          // apply to archive segments, including the no-rebase retry path.
          MpegAudioStrippingFragmentLoader ?? Hls.DefaultConfig.loader as unknown as HlsLoaderConstructor,
          catchUpRebaseSession,
          {
            onFatal: onCatchUpRebaseFatal,
            onBoundary: (boundary) => this.onCatchUpRebaseBoundary?.(boundary),
          },
        )
        : null;
      const DiscontinuityStrippingPlaylistLoader = catchUpRebaseSession
        ? createDiscontinuityStrippingPlaylistLoader(
          Hls.DefaultConfig.loader as unknown as HlsLoaderConstructor,
        )
        : null;
      // "From the beginning" must not map to startPosition 0: hls.js's
      // seekToStartPos() is a no-op at 0 (currentTime < startPosition never
      // holds), which strands the playhead inside the archive's header-less
      // dead zone. See HLS_CATCHUP_START_FROM_BEGINNING_POSITION_SECONDS.
      const isCatchUpFromProgramStart = isCatchUpSource && catchUpStartPositionSeconds <= 0;
      const safeCatchUpStartPositionSeconds = (
        isCatchUpSource
          ? (isCatchUpFromProgramStart
            ? HLS_CATCHUP_START_FROM_BEGINNING_POSITION_SECONDS
            : catchUpStartPositionSeconds)
          : -1
      );
      const hls = new Hls({
        // M1.1-a (KN-1): the web worker offloads demux/remux off the main thread
        // for live too — the previous `!isLiveSource` left live on the main thread.
        enableWorker: true,
        // M1.1-b (KN-2): Xtream live playlists are not genuine LL-HLS. Only enable
        // low-latency mode when the manifest probe actually saw EXT-X-PART /
        // blocking reload; otherwise hls.js chases a non-existent live edge and
        // hammers the playlist endpoint (429 risk).
        lowLatencyMode: isLiveSource && codecProbe.lowLatencyHls,
        startPosition: safeCatchUpStartPositionSeconds,
        // Snap the start position onto the first buffered keyframe so playback
        // never starts inside the mid-GOP dead zone at the archive head. Only
        // for "from the beginning" loads: startOnSegmentBoundary also snaps
        // BACKWARD (seekToStartPos applies a negative delta), which would yank
        // a user who scrubbed mid-program back to the segment boundary.
        ...(isCatchUpFromProgramStart ? { startOnSegmentBoundary: true } : {}),
        // Progressive fragment streaming bypasses the onSuccess loader
        // transform (chunks flow through onProgress), so it must stay off
        // whenever a byte-rewriting fragment loader is active.
        ...(shouldUseProgressiveLoading && !useMpegAudioVideoOnlyFallback && !catchUpRebaseSession
          ? { progressive: true }
          : {}),
        ...(CatchUpRebaseFragmentLoader ? {
          fLoader: CatchUpRebaseFragmentLoader as never,
        } : MpegAudioStrippingFragmentLoader ? {
          fLoader: MpegAudioStrippingFragmentLoader as never,
        } : {}),
        ...(DiscontinuityStrippingPlaylistLoader ? {
          pLoader: DiscontinuityStrippingPlaylistLoader as never,
        } : {}),
        ...(useProgressiveCatchUpStartup ? {
          fragLoadingTimeOut: 60_000,
          startFragPrefetch: true,
        } : {}),
        // M1.1-c (KN-3): catch-up keeps a wide scrub-back window; live only needs
        // a short tail so memory stays bounded during rapid channel zapping.
        backBufferLength: isCatchUpSource
          ? HLS_CATCHUP_BACK_BUFFER_LENGTH_SECONDS
          : HLS_LIVE_BACK_BUFFER_LENGTH_SECONDS,
        maxBufferLength: isCatchUpSource
          ? HLS_CATCHUP_MAX_BUFFER_LENGTH_SECONDS
          : HLS_LIVE_MAX_BUFFER_LENGTH_SECONDS,
        maxMaxBufferLength: 600,
        maxBufferSize: (
          catchUpRebaseSession
            ? HLS_CATCHUP_REBASE_MAX_BUFFER_SIZE_MB
            : isCatchUpSource
            ? HLS_CATCHUP_MAX_BUFFER_SIZE_MB
            : HLS_LIVE_MAX_BUFFER_SIZE_MB
        ) * 1000 * 1000,
        // The rebase path joins independently cut minute files. Let hls.js
        // bridge their measured sub-2s GOP holes and hold the last valid video
        // frame across the missing tail. Legacy catch-up/live/VOD retain their
        // previous buffering behaviour.
        maxBufferHole: catchUpRebaseSession ? 2 : 0.5,
        ...(catchUpRebaseSession ? { stretchShortVideoTrack: true } : {}),
        startLevel: -1,
        // M1.1-d: structured load policies with exponential backoff and an
        // explicit bail on auth failures so we never retry 401/403 into a ban.
        fragLoadPolicy: HlsPlayerAdapter.buildLoadPolicy(HLS_FRAG_LOAD_MAX_RETRY),
        playlistLoadPolicy: HlsPlayerAdapter.buildLoadPolicy(HLS_PLAYLIST_LOAD_MAX_RETRY),
      });
      this.assertCurrentLoad(loadGeneration);
      this.hls = hls;
      this.catchUpRebaseSession = catchUpRebaseSession;
      this.hlsSourceMode = isLiveSource ? 'live' : isCatchUpSource ? 'catchup' : 'other';
      this.elementDecodeRecoveryAttempts = 0;
      this.lastElementDecodeRecoveryAt = 0;
      this.decodeRecoveryResumeAtSeconds = null;

      try {
        await new Promise<void>((resolve, reject) => {
          let mediaErrorRecoveryAttempts = 0;
          let startupBufferSeekApplied = false;
          let startupSettled = false;

          const resolveStartup = () => {
            if (startupSettled) return;
            startupSettled = true;
            if (this.cancelHlsStartup === cancelStartup) this.cancelHlsStartup = null;
            resolve();
          };

          const rejectStartup = (error: Error) => {
            if (startupSettled) return;
            startupSettled = true;
            if (this.cancelHlsStartup === cancelStartup) this.cancelHlsStartup = null;
            reject(error);
          };

          // Snap startup playback to the first buffered range (the first
          // decodable keyframe). hls.js never appends the archive's header-less
          // dead-zone frames (the mp4-remuxer drops them on the keyframe batch,
          // and the stream-controller gap-marks keyframe-less first chunks), so
          // buffered.start(0) is the first decodable keyframe — but the
          // playhead is left at 0 in front of it, where playback stalls.
          //
          // This is the earliest snap layer (per BUFFER_APPENDED chunk, before
          // hls.js's own seekToStartPos which waits for the whole first
          // fragment). Live skips to the live-edge buffer. Catch-up gets it
          // only for "from the beginning" loads: on a scrubbed load the buffer
          // start (segment head keyframe) sits BEFORE the requested position,
          // and snapping would land the user at the segment boundary instead —
          // there hls.js's startPosition seek is already reliable.
          const seekStartupToBufferedRange = () => {
            if (!this.isCurrentLoad(loadGeneration)) {
              return;
            }

            if (!isLiveSource && !isCatchUpFromProgramStart) {
              return;
            }

            if (startupBufferSeekApplied) {
              return;
            }

            const buffered = this.video.buffered;
            if (!buffered || buffered.length === 0) {
              return;
            }

            let bufferStart: number;
            try {
              bufferStart = buffered.start(0);
            } catch {
              return;
            }

            if (!Number.isFinite(bufferStart)) {
              return;
            }

            const currentTime = this.video.currentTime || 0;
            if (currentTime + 0.1 >= bufferStart) {
              return;
            }

            startupBufferSeekApplied = true;
            this.video.currentTime = bufferStart + 0.05;
            if (!this.video.paused) {
              this.video.play().catch(() => {
                // The normal autoplay recovery path will retry play() if this fails.
              });
            }
          };

          const onManifestParsed = () => {
            if (!this.isCurrentLoad(loadGeneration) || this.hls !== hls) {
              hls.destroy();
              rejectStartup(new Error(PLAYBACK_LOAD_CANCELLED_MESSAGE));
              return;
            }

            this.syncHlsAudioTracks(hls.audioTrack);
            this.syncHlsSubtitleTracks(hls.subtitleTrack);
            cleanupStartupListeners();
            this.updateState('paused');
            resolveStartup();
          };

          const onManifestLoaded = (
            _event: string,
            data: {
              url?: string;
              networkDetails?: unknown;
            },
          ) => {
            if (!this.isCurrentLoad(loadGeneration) || this.hls !== hls) {
              return;
            }

            const manifestUrl = typeof data.url === 'string' && data.url.length > 0
              ? data.url
              : url;
            this.onManifestResolved?.({
              requestedUrl: url,
              manifestUrl,
              finalUrl: HlsPlayerAdapter.resolveNetworkResponseUrl(
                data.networkDetails,
                manifestUrl,
              ),
            });
          };

          const onHlsError = (_event: string, data: ErrorData) => {
            if (!this.isCurrentLoad(loadGeneration) || this.hls !== hls) {
              return;
            }

            if (data.details === 'bufferStalledError') {
              this.emitCatchUpStall('buffer-stalled');
            }

            if (data.fatal && this.documentHidden) {
              const httpStatus = HlsPlayerAdapter.resolveNetworkHttpStatus(data.networkDetails);
              const deferMediaRecovery = data.type === Hls.ErrorTypes.MEDIA_ERROR;
              const deferNetworkRecovery = (
                data.type === Hls.ErrorTypes.NETWORK_ERROR &&
                !(typeof httpStatus === 'number' && HLS_NON_RETRYABLE_HTTP_STATUSES.has(httpStatus))
              );
              if (deferMediaRecovery || deferNetworkRecovery) {
                this.backgroundMediaRecoveryPending ||= deferMediaRecovery;
                this.backgroundNetworkRecoveryPending ||= deferNetworkRecovery;
                this.errorListeners.forEach((listener) => listener({
                  ...this.mapHlsError(data),
                  fatal: false,
                }));
                return;
              }
            }

            if (data.fatal && data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              if (
                isLiveSource &&
                liveStartupMediaRetryCount < 1 &&
                (this.video.currentTime || 0) <= 0.25
              ) {
                cleanupStartupListeners();
                hls.destroy();
                if (this.hls === hls) {
                  this.hls = null;
                }

                const shouldResumePlayback = !this.video.paused;
                this.updateState('loading');
                const retryStartup = this.loadHlsSource(
                  url,
                  isLiveSource,
                  isCatchUpSource,
                  liveStartupMediaRetryCount + 1,
                  catchUpStartupMode,
                  catchUpStartPositionSeconds,
                  probeLiveMpegAudio,
                  catchUpClientRebase,
                  loadGeneration,
                ).then(() => {
                  if (shouldResumePlayback && this.isCurrentLoad(loadGeneration)) {
                    this.play();
                  }
                });

                if (startupSettled) {
                  retryStartup.catch((error: unknown) => {
                    const mappedError = this.mapHlsError(data);
                    this.emitError({
                      ...mappedError,
                      message: error instanceof Error ? error.message : mappedError.message,
                    });
                  });
                } else {
                  retryStartup.then(resolveStartup).catch((error: unknown) => {
                    rejectStartup(error instanceof Error
                      ? error
                      : new Error('Media error while decoding stream.'));
                  });
                }
                return;
              }

              if (
                isCatchUpSource &&
                !this.bufferingRecoveryArmed &&
                (this.video.currentTime || 0) <= 0.25
              ) {
                if (catchUpStartupMode === 'progressive') {
                  cleanupStartupListeners();
                  hls.destroy();
                  if (this.hls === hls) {
                    this.hls = null;
                  }

                  const shouldResumePlayback = !this.video.paused;
                  this.updateState('loading');
                  const retryStartup = this.loadHlsSource(
                    url,
                    isLiveSource,
                    isCatchUpSource,
                    liveStartupMediaRetryCount,
                    'complete',
                    catchUpStartPositionSeconds,
                    probeLiveMpegAudio,
                    catchUpClientRebase,
                    loadGeneration,
                  ).then(() => {
                    if (shouldResumePlayback && this.isCurrentLoad(loadGeneration)) {
                      this.play();
                    }
                  });

                  if (startupSettled) {
                    retryStartup.catch((error: unknown) => {
                      const mappedError = this.mapHlsError(data);
                      this.emitError({
                        ...mappedError,
                        message: error instanceof Error ? error.message : mappedError.message,
                      });
                    });
                  } else {
                    retryStartup.then(resolveStartup).catch((error: unknown) => {
                      rejectStartup(error instanceof Error
                        ? error
                        : new Error('Media error while decoding stream.'));
                    });
                  }
                  return;
                }

                const mappedError = this.mapHlsError(data);
                this.emitError(mappedError);
                cleanupStartupListeners();
                hls.destroy();
                if (this.hls === hls) {
                  this.hls = null;
                }
                rejectStartup(new Error(mappedError.message));
                return;
              }

              const hasResumablePlaybackProgress = (
                (isLiveSource || isCatchUpSource) &&
                (
                  (this.video.currentTime || 0) > 0.25 ||
                  (
                    this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
                    this.video.videoWidth > 0
                  )
                )
              );
              const maxMediaRecoveryAttempts = hasResumablePlaybackProgress
                ? (isLiveSource
                  ? HLS_LIVE_MEDIA_RECOVERY_MAX_ATTEMPTS
                  : HLS_CATCHUP_MEDIA_RECOVERY_MAX_ATTEMPTS)
                : 1;
              if (mediaErrorRecoveryAttempts < maxMediaRecoveryAttempts) {
                mediaErrorRecoveryAttempts += 1;
                hls.recoverMediaError();
                return;
              }

              const mappedError = this.mapHlsError(data);
              this.emitError(mappedError);
              cleanupStartupListeners();
              hls.destroy();
              reject(new Error(mappedError.message));
              return;
            }

            // M1.1-e: fatal NETWORK_ERROR after hls.js exhausted its own load-policy
            // retries. Instead of tearing playback down, schedule a throttled
            // startLoad() recovery (bounded attempts, 3s spacing) so a transient
            // upstream blip self-heals without a tight reload loop. Auth failures
            // (401/403) are never retried — they would only burn request budget.
            if (
              data.fatal &&
              data.type === Hls.ErrorTypes.NETWORK_ERROR &&
              startupSettled
            ) {
              const httpStatus = HlsPlayerAdapter.resolveNetworkHttpStatus(data.networkDetails);
              const isNonRetryable = (
                typeof httpStatus === 'number' && HLS_NON_RETRYABLE_HTTP_STATUSES.has(httpStatus)
              );
              if (
                !isNonRetryable &&
                this.networkErrorRecoveryAttempts < HLS_NETWORK_ERROR_RECOVERY_MAX_ATTEMPTS
              ) {
                this.emitError(this.mapHlsError(data));
                this.scheduleNetworkErrorRecovery(hls, loadGeneration);
                return;
              }
            }

            const mappedError = this.mapHlsError(data);
            this.emitError(mappedError);

            if (!data.fatal) {
              return;
            }

            cleanupStartupListeners();
            hls.destroy();
            reject(new Error(mappedError.message));
          };

          const onAudioTracksUpdated = () => {
            if (!this.isCurrentLoad(loadGeneration) || this.hls !== hls) {
              return;
            }
            this.syncHlsAudioTracks(hls.audioTrack);
          };

          const onAudioTrackSwitched = () => {
            if (!this.isCurrentLoad(loadGeneration) || this.hls !== hls) {
              return;
            }
            this.syncHlsAudioTracks(hls.audioTrack);
          };

          const onSubtitleTracksUpdated = () => {
            if (!this.isCurrentLoad(loadGeneration) || this.hls !== hls) {
              return;
            }
            this.syncHlsSubtitleTracks(hls.subtitleTrack);
          };

          const onSubtitleTrackSwitched = () => {
            if (!this.isCurrentLoad(loadGeneration) || this.hls !== hls) {
              return;
            }
            this.syncHlsSubtitleTracks(hls.subtitleTrack);
          };

          const onBufferAppended = () => {
            if (!this.isCurrentLoad(loadGeneration) || this.hls !== hls) {
              return;
            }
            mediaErrorRecoveryAttempts = 0;
            // Fresh data means the network recovered — reset the throttled
            // NETWORK_ERROR recovery budget so future blips get full retries.
            this.networkErrorRecoveryAttempts = 0;
            seekStartupToBufferedRange();
          };

          const onFragLoading = () => {
            if (!this.isCurrentLoad(loadGeneration) || this.hls !== hls) {
              return;
            }
            this.fragmentInFlight = true;
            this.lastFragmentLoadStartedAt = Date.now();
          };

          const onFragLoaded = () => {
            if (!this.isCurrentLoad(loadGeneration) || this.hls !== hls) {
              return;
            }
            this.fragmentInFlight = false;
            this.lastFragmentLoadedAt = Date.now();
          };

          const cleanupStartupListeners = () => {
            hls.off(Hls.Events.MANIFEST_PARSED, onManifestParsed);
            hls.off(Hls.Events.MANIFEST_LOADED, onManifestLoaded);
          };

          const cancelStartup = () => {
            cleanupStartupListeners();
            rejectStartup(new Error(PLAYBACK_LOAD_CANCELLED_MESSAGE));
          };
          this.cancelHlsStartup = cancelStartup;

          hls.on(Hls.Events.MANIFEST_LOADED, onManifestLoaded);
          hls.on(Hls.Events.MANIFEST_PARSED, onManifestParsed);
          hls.on(Hls.Events.ERROR, onHlsError);
          hls.on(Hls.Events.FRAG_LOADING, onFragLoading);
          hls.on(Hls.Events.FRAG_LOADED, onFragLoaded);
          hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, onAudioTracksUpdated);
          hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, onAudioTrackSwitched);
          hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, onSubtitleTracksUpdated);
          hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, onSubtitleTrackSwitched);
          hls.on(Hls.Events.BUFFER_APPENDED, onBufferAppended);
          this.assertCurrentLoad(loadGeneration);
          hls.loadSource(url);
          hls.attachMedia(this.video);
        });
      } catch (error) {
        if (this.hls === hls) {
          this.hls = null;
          this.hlsSourceMode = null;
        }
        hls.destroy();
        throw error;
      }

      return;
    }

    if (catchUpClientRebase) {
      this.onCatchUpRebaseFallback?.({
        reason: 'hls-js-unsupported',
        sourceUrl: url,
      });
      const error: PlaybackError = {
        code: 'CATCHUP_REBASE_NOT_SUPPORTED',
        message: 'Client catch-up normalization requires Media Source Extensions.',
        fatal: true,
      };
      this.emitError(error);
      throw new Error(error.message);
    }

    if (!useMpegAudioVideoOnlyFallback && this.video.canPlayType(HLS_MIME_TYPE)) {
      this.assertCurrentLoad(loadGeneration);
      this.loadNativeHlsSource(url);
      return;
    }

    const error: PlaybackError = {
      code: 'HLS_NOT_SUPPORTED',
      message: 'Your browser does not support HLS playback.',
      fatal: true,
    };
    this.emitError(error);
    throw new Error(error.message);
  }

  private static resolveNetworkResponseUrl(
    networkDetails: unknown,
    fallbackUrl: string,
  ): string | null {
    if (!networkDetails || typeof networkDetails !== 'object') {
      return fallbackUrl || null;
    }

    const details = networkDetails as {
      responseURL?: unknown;
      url?: unknown;
    };
    if (typeof details.responseURL === 'string' && details.responseURL.length > 0) {
      return details.responseURL;
    }
    if (typeof details.url === 'string' && details.url.length > 0) {
      return details.url;
    }

    return fallbackUrl || null;
  }

  private static resolveHlsSourceMode(mode: unknown): HlsSourceMode {
    if (mode === 'live' || mode === 'catchup') {
      return mode;
    }

    return 'other';
  }

  private static stopCompetingPlayback(activeAdapter: HlsPlayerAdapter): void {
    for (const adapter of HlsPlayerAdapter.activeAdapters) {
      if (adapter !== activeAdapter) {
        adapter.stop();
      }
    }

    if (typeof document === 'undefined') {
      return;
    }

    document.querySelectorAll<HTMLMediaElement>('video,audio').forEach((mediaElement) => {
      if (mediaElement === activeAdapter.video) {
        return;
      }

      mediaElement.pause();
      if (mediaElement instanceof HTMLMediaElement) {
        mediaElement.srcObject = null;
      }
      mediaElement.removeAttribute('src');
      mediaElement.load();
    });
  }

  private nextLoadGeneration(): number {
    this.loadGeneration += 1;
    return this.loadGeneration;
  }

  private isCurrentLoad(loadGeneration: number): boolean {
    return this.loadGeneration === loadGeneration;
  }

  private assertCurrentLoad(loadGeneration: number): void {
    if (!this.isCurrentLoad(loadGeneration)) {
      throw new Error(PLAYBACK_LOAD_CANCELLED_MESSAGE);
    }
  }

  private loadNativeHlsSource(url: string): void {
    this.nativeHlsLoaded = true;
    this.video.src = url;
    this.video.load();
    this.syncNativeAudioTracks();
    this.syncNativeSubtitleTracks();
    this.updateState('paused');
  }

  private attachVideoListeners(): () => void {
    const handlePlaying = () => {
      this.bufferingRecoveryArmed = true;
      this.resetBufferingRecovery();
      this.updateState('playing');
    };
    const handlePause = () => {
      this.clearBufferingRecoveryTimer();
      this.updateState('paused');
    };
    const handleWaiting = () => {
      this.updateState('buffering');
      this.emitCatchUpStall('waiting');
      this.scheduleBufferingRecovery();
    };
    const handleEnded = () => {
      this.bufferingRecoveryArmed = false;
      this.resetBufferingRecovery();
      this.updateState('ended');
    };
    const handleSeeking = () => {
      this.clearBufferingRecoveryTimer();
      this.updateState('seeking');
    };
    const handleSeeked = () => {
      this.clearBufferingRecoveryTimer();
      this.updateState(this.video.paused ? 'paused' : 'playing');
    };
    const handleTimeUpdate = () => {
      if ((this.video.currentTime || 0) > 0.25) {
        this.bufferingRecoveryArmed = true;
      }
      this.enforceDecodeRecoveryResumePosition();
      this.resetBufferingRecovery();
      this.timeListeners.forEach((listener) => listener(this.video.currentTime));
    };
    const handleError = () => {
      const mediaError = this.video.error;
      if (!mediaError) {
        return;
      }

      // MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED === 4. Use the numeric code
      // directly so this does not depend on the MediaError global being present.
      const isSrcNotSupported = mediaError.code === 4;
      const isManagedByHls = this.hls !== null;

      // A code-4 "Empty src attribute" while no real source is attached is
      // transient teardown/attach noise (src was cleared, MSE not yet bound).
      // Emitting it floods MEDIA_ELEMENT_4 during autoplay-recovery; swallow it.
      if (isSrcNotSupported && !this.hasPlayableSource()) {
        return;
      }

      // hls.js detachMedia() (live startup retry, source switch) removes the
      // src attribute and calls load(), which queues an async "Empty src
      // attribute" error. When it fires mid-reload (e.g. during the live codec
      // probe await), video.currentSrc can still report the stale MSE blob URL,
      // so hasPlayableSource() above lets it through and it would surface as a
      // fatal error that tears down an otherwise-recovering stream. With no hls
      // instance and no src attribute there is nothing to play — swallow it.
      if (isSrcNotSupported && !isManagedByHls && !this.video.getAttribute('src')) {
        return;
      }

      // A raw MEDIA_ERR_DECODE never reaches hls.js (it does not listen to
      // the element's error event), so without this the session layer's
      // runtime decode-skip (+15s reload) would be the first responder.
      // Archive catch-up can trip the decoder right at the per-minute video
      // holes (hls.js bridges them by stretching the next fragment's first
      // sample); an in-place recoverMediaError() keeps the position and
      // resolves in well under a second, so spend that budget first.
      if (
        mediaError.code === 3 &&
        isManagedByHls &&
        this.hlsSourceMode === 'catchup' &&
        this.elementDecodeRecoveryAttempts < HLS_CATCHUP_MEDIA_RECOVERY_MAX_ATTEMPTS
      ) {
        this.elementDecodeRecoveryAttempts += 1;
        this.lastElementDecodeRecoveryAt = performance.now();
        const resumeAt = this.video.currentTime || 0;
        if (resumeAt > 1) {
          this.decodeRecoveryResumeAtSeconds = resumeAt;
          this.decodeRecoveryResumeDeadline = performance.now() + HLS_DECODE_RECOVERY_RESUME_WINDOW_MS;
        }
        this.hls?.recoverMediaError();
        return;
      }

      this.emitError({
        code: `MEDIA_ELEMENT_${mediaError.code}`,
        message: mediaError.message || 'Playback error',
        // When hls.js is attached, code 4 can be emitted during segment retries
        // and should not immediately hard-stop playback/fallback flow.
        fatal: isSrcNotSupported && !isManagedByHls,
      });
    };
    const handleLoadedMetadata = () => {
      this.syncNativeAudioTracks();
      this.syncNativeSubtitleTracks();
    };
    const handleNativeAudioTracksChange = () => {
      this.syncNativeAudioTracks();
    };
    const handleNativeTextTracksChange = () => {
      this.syncNativeSubtitleTracks();
    };

    this.video.addEventListener('playing', handlePlaying);
    this.video.addEventListener('pause', handlePause);
    this.video.addEventListener('waiting', handleWaiting);
    this.video.addEventListener('ended', handleEnded);
    this.video.addEventListener('seeking', handleSeeking);
    this.video.addEventListener('seeked', handleSeeked);
    this.video.addEventListener('timeupdate', handleTimeUpdate);
    this.video.addEventListener('error', handleError);
    this.video.addEventListener('loadedmetadata', handleLoadedMetadata);

    const nativeAudioTracks = this.getNativeAudioTracks();
    const nativeTextTracks = this.getNativeTextTracks();

    nativeAudioTracks?.addEventListener?.('change', handleNativeAudioTracksChange);
    nativeAudioTracks?.addEventListener?.('addtrack', handleNativeAudioTracksChange);
    nativeAudioTracks?.addEventListener?.('removetrack', handleNativeAudioTracksChange);
    nativeTextTracks?.addEventListener?.('change', handleNativeTextTracksChange);
    nativeTextTracks?.addEventListener?.('addtrack', handleNativeTextTracksChange);
    nativeTextTracks?.addEventListener?.('removetrack', handleNativeTextTracksChange);

    return () => {
      this.video.removeEventListener('playing', handlePlaying);
      this.video.removeEventListener('pause', handlePause);
      this.video.removeEventListener('waiting', handleWaiting);
      this.video.removeEventListener('ended', handleEnded);
      this.video.removeEventListener('seeking', handleSeeking);
      this.video.removeEventListener('seeked', handleSeeked);
      this.video.removeEventListener('timeupdate', handleTimeUpdate);
      this.video.removeEventListener('error', handleError);
      this.video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      nativeAudioTracks?.removeEventListener?.('change', handleNativeAudioTracksChange);
      nativeAudioTracks?.removeEventListener?.('addtrack', handleNativeAudioTracksChange);
      nativeAudioTracks?.removeEventListener?.('removetrack', handleNativeAudioTracksChange);
      nativeTextTracks?.removeEventListener?.('change', handleNativeTextTracksChange);
      nativeTextTracks?.removeEventListener?.('addtrack', handleNativeTextTracksChange);
      nativeTextTracks?.removeEventListener?.('removetrack', handleNativeTextTracksChange);
    };
  }

  private clearHls(): void {
    this.cancelHlsStartup?.();
    this.cancelHlsStartup = null;
    this.resetBufferingRecovery();
    this.backgroundMediaRecoveryPending = false;
    this.backgroundNetworkRecoveryPending = false;
    this.emitCatchUpRebaseSummaryIfAny();
    if (!this.hls) {
      this.hlsSourceMode = null;
      return;
    }
    this.hls.stopLoad();
    this.hls.detachMedia();
    this.hls.destroy();
    this.hls = null;
    this.hlsSourceMode = null;
  }

  // Surfaces per-session rebase statistics (segment counts, joint deltas,
  // trims) once, when the rebased playback session ends.
  private emitCatchUpRebaseSummaryIfAny(): void {
    const session = this.catchUpRebaseSession;
    this.catchUpRebaseSession = null;
    if (session && session.stats.segments > 0) {
      this.onCatchUpRebaseSummary?.({
        ...session.stats,
        boundaries: [...session.stats.boundaries],
      });
    }
  }

  private emitCatchUpStall(trigger: CatchUpStallEvent['trigger']): void {
    const session = this.catchUpRebaseSession;
    if (!session) {
      return;
    }

    const currentTimeSeconds = this.video.currentTime || 0;
    const nearestBoundary = session.stats.boundaries.reduce<CatchUpRebaseBoundary | null>(
      (nearest, boundary) => (
        !nearest || Math.abs(boundary.predictedMediaTimeSeconds - currentTimeSeconds)
          < Math.abs(nearest.predictedMediaTimeSeconds - currentTimeSeconds)
          ? boundary
          : nearest
      ),
      null,
    );
    this.onCatchUpStall?.({
      trigger,
      currentTimeSeconds,
      nearestBoundaryMediaTimeSeconds: nearestBoundary?.predictedMediaTimeSeconds ?? null,
      distanceToBoundaryMs: nearestBoundary
        ? Math.round((currentTimeSeconds - nearestBoundary.predictedMediaTimeSeconds) * 1000)
        : null,
      videoHoleMs: nearestBoundary?.videoHoleMs ?? null,
    });
  }

  private resetPlaybackState(flushMediaElement: boolean): void {
    this.resetBufferingRecovery();
    this.video.pause();
    this.video.srcObject = null;
    this.video.removeAttribute('src');
    this.video.src = '';
    if (flushMediaElement) {
      this.video.load();
    }
    this.audioTracks = [];
    this.selectedAudioTrackId = null;
    this.subtitleTracks = [];
    this.selectedSubtitleTrackId = null;
    this.nativeHlsLoaded = false;
    this.bufferingRecoveryArmed = false;
    this.emitAudioTracksChange();
    this.emitSubtitleTracksChange();
    this.updateState('idle');
  }

  private static resolveNetworkHttpStatus(networkDetails: unknown): number | undefined {
    if (!networkDetails || typeof networkDetails !== 'object') {
      return undefined;
    }
    // hls.js attaches the raw loader response under networkDetails; the upstream
    // HTTP status is exposed either as `.status` (XHR) or `.response.code`.
    const details = networkDetails as {
      status?: unknown;
      response?: { code?: unknown } | null;
    };
    if (typeof details.status === 'number' && details.status > 0) {
      return details.status;
    }
    if (details.response && typeof details.response.code === 'number' && details.response.code > 0) {
      return details.response.code;
    }
    return undefined;
  }

  // M1.1-d: builds a structured hls.js load policy with exponential backoff and a
  // capped retry delay. `shouldRetry` bails immediately on auth-style HTTP errors
  // (401/403) so a rejected token never turns into a retry storm / provider ban.
  private static buildLoadPolicy(maxNumRetry: number): LoadPolicy {
    const errorRetry: RetryConfig = {
      maxNumRetry,
      retryDelayMs: HLS_LOAD_POLICY_INITIAL_RETRY_DELAY_MS,
      maxRetryDelayMs: HLS_LOAD_POLICY_MAX_RETRY_DELAY_MS,
      backoff: 'exponential',
      shouldRetry: (
        retryConfig: RetryConfig | null | undefined,
        retryCount: number,
        _isTimeout: boolean,
        loaderResponse: LoaderResponse | undefined,
        retry: boolean,
      ): boolean => {
        const status = loaderResponse?.code;
        if (typeof status === 'number' && HLS_NON_RETRYABLE_HTTP_STATUSES.has(status)) {
          return false;
        }
        return retry && retryCount < (retryConfig?.maxNumRetry ?? maxNumRetry);
      },
    };

    return {
      default: {
        maxTimeToFirstByteMs: HLS_LOAD_TIMEOUT_MS,
        maxLoadTimeMs: HLS_LOAD_TIMEOUT_MS,
        timeoutRetry: {
          maxNumRetry: HLS_LOAD_TIMEOUT_MAX_RETRY,
          retryDelayMs: 0,
          maxRetryDelayMs: 0,
        },
        errorRetry,
      },
    };
  }

  private mapHlsError(data: ErrorData): PlaybackError {
    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
      return {
        code: 'NETWORK_ERROR',
        message: 'Network error while loading stream.',
        fatal: data.fatal,
        details: data.details,
        httpStatus: HlsPlayerAdapter.resolveNetworkHttpStatus(data.networkDetails),
      };
    }

    if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
      return {
        code: 'MEDIA_ERROR',
        message: 'Media error while decoding stream.',
        fatal: data.fatal,
        details: data.details,
      };
    }

    return {
      code: 'HLS_ERROR',
      message: data.details || 'Unknown HLS playback error.',
      fatal: data.fatal,
      details: data.details,
    };
  }

  private emitError(error: PlaybackError): void {
    if (error.fatal) {
      this.updateState('error');
    }
    this.errorListeners.forEach((listener) => listener(error));
  }

  private updateState(nextState: PlaybackState): void {
    if (this.state === nextState) {
      return;
    }
    this.state = nextState;
    this.stateListeners.forEach((listener) => listener(nextState));
  }

  private isMixedContentBlocked(url: string): boolean {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.location.protocol === 'https:' && url.startsWith('http://');
  }

  private syncHlsAudioTracks(selectedIndex: number): void {
    if (!this.hls) {
      this.audioTracks = [];
      this.selectedAudioTrackId = null;
      this.emitAudioTracksChange();
      return;
    }

    this.audioTracks = this.hls.audioTracks.map((track, index) => ({
      id: `hls-${index}`,
      label: track.name || track.lang || `Track ${index + 1}`,
      language: track.lang || null,
      isDefault: Boolean(track.default),
    }));

    const safeSelectedIndex = (
      selectedIndex >= 0 && selectedIndex < this.audioTracks.length
    ) ? selectedIndex : 0;
    this.selectedAudioTrackId = this.audioTracks.length > 0
      ? this.audioTracks[safeSelectedIndex]?.id ?? null
      : null;
    this.emitAudioTracksChange();
  }

  private syncHlsSubtitleTracks(selectedIndex: number): void {
    if (!this.hls) {
      this.subtitleTracks = [];
      this.selectedSubtitleTrackId = null;
      this.emitSubtitleTracksChange();
      return;
    }

    this.subtitleTracks = this.hls.subtitleTracks.map((track, index) => ({
      id: `hls-subtitle-${index}`,
      label: track.name || track.lang || `Subtitle ${index + 1}`,
      language: track.lang || null,
      isDefault: Boolean(track.default),
    }));

    if (selectedIndex < 0 || selectedIndex >= this.subtitleTracks.length) {
      this.selectedSubtitleTrackId = null;
      this.emitSubtitleTracksChange();
      return;
    }

    this.selectedSubtitleTrackId = this.subtitleTracks[selectedIndex]?.id ?? null;
    this.emitSubtitleTracksChange();
  }

  private syncNativeAudioTracks(): void {
    const nativeAudioTracks = this.getNativeAudioTracks();
    if (!nativeAudioTracks || nativeAudioTracks.length === 0) {
      this.audioTracks = [];
      this.selectedAudioTrackId = null;
      this.emitAudioTracksChange();
      return;
    }

    const mappedTracks: AudioTrackOption[] = [];
    let selectedId: string | null = null;

    for (let index = 0; index < nativeAudioTracks.length; index += 1) {
      const track = nativeAudioTracks[index];
      const id = `native-${index}`;
      mappedTracks.push({
        id,
        label: track.label || track.language || `Track ${index + 1}`,
        language: track.language || null,
        isDefault: index === 0,
      });

      if (track.enabled) {
        selectedId = id;
      }
    }

    this.audioTracks = mappedTracks;
    this.selectedAudioTrackId = selectedId ?? mappedTracks[0]?.id ?? null;
    this.emitAudioTracksChange();
  }

  private syncNativeSubtitleTracks(): void {
    const nativeTextTracks = this.getNativeTextTracks();
    if (!nativeTextTracks || nativeTextTracks.length === 0) {
      this.subtitleTracks = [];
      this.selectedSubtitleTrackId = null;
      this.emitSubtitleTracksChange();
      return;
    }

    const mappedTracks: SubtitleTrackOption[] = [];
    let selectedId: string | null = null;

    for (let index = 0; index < nativeTextTracks.length; index += 1) {
      const track = nativeTextTracks[index];
      const kind = track.kind?.toLowerCase() ?? '';
      if (kind && kind !== 'subtitles' && kind !== 'captions') {
        continue;
      }

      const id = `native-subtitle-${index}`;
      mappedTracks.push({
        id,
        label: track.label || track.language || `Subtitle ${mappedTracks.length + 1}`,
        language: track.language || null,
        isDefault: mappedTracks.length === 0,
      });

      if (track.mode === 'showing' || track.mode === 'hidden') {
        selectedId = id;
      }
    }

    this.subtitleTracks = mappedTracks;
    this.selectedSubtitleTrackId = selectedId;
    this.emitSubtitleTracksChange();
  }

  private getNativeAudioTracks(): NativeAudioTrackListLike | null {
    const elementWithTracks = this.video as HTMLVideoElement & { audioTracks?: NativeAudioTrackListLike };
    return elementWithTracks.audioTracks ?? null;
  }

  private getNativeTextTracks(): NativeTextTrackListLike | null {
    const elementWithTracks = this.video as HTMLVideoElement & { textTracks?: NativeTextTrackListLike };
    return elementWithTracks.textTracks ?? null;
  }

  private parseTrackIndex(trackId: string, prefix: string): number | null {
    if (!trackId.startsWith(prefix)) {
      return null;
    }

    const numericIndex = Number(trackId.slice(prefix.length));
    if (!Number.isInteger(numericIndex)) {
      return null;
    }

    return numericIndex;
  }

  private emitAudioTracksChange(): void {
    this.audioTracksListeners.forEach((listener) => {
      listener(this.audioTracks, this.selectedAudioTrackId);
    });
  }

  private emitSubtitleTracksChange(): void {
    this.subtitleTracksListeners.forEach((listener) => {
      listener(this.subtitleTracks, this.selectedSubtitleTrackId);
    });
  }

  private clearBufferingRecoveryTimer(): void {
    if (this.bufferingRecoveryTimer !== null) {
      clearTimeout(this.bufferingRecoveryTimer);
      this.bufferingRecoveryTimer = null;
    }
  }

  // After recoverMediaError() the session layer's re-attach reactions can pull
  // the playhead back toward the catch-up start. Whichever layer seeks last
  // would win, so on every timeupdate inside the resume window the pre-error
  // position is re-applied until playback actually continues from there.
  private enforceDecodeRecoveryResumePosition(): void {
    const resumeAt = this.decodeRecoveryResumeAtSeconds;
    if (resumeAt === null) {
      return;
    }
    if (performance.now() > this.decodeRecoveryResumeDeadline) {
      this.decodeRecoveryResumeAtSeconds = null;
      return;
    }
    const currentTime = this.video.currentTime || 0;
    if (Math.abs(currentTime - resumeAt) <= HLS_DECODE_RECOVERY_RESUME_TOLERANCE_SECONDS) {
      this.decodeRecoveryResumeAtSeconds = null;
      return;
    }
    this.video.currentTime = resumeAt;
    if (this.video.paused) {
      this.video.play().catch(() => {
        // The session-level autoplay recovery retries play() when needed.
      });
    }
  }

  private resetBufferingRecovery(): void {
    this.clearBufferingRecoveryTimer();
    this.bufferingRecoveryAttempts = 0;
    this.clearNetworkErrorRecoveryTimer();
    this.networkErrorRecoveryAttempts = 0;
    if (
      this.elementDecodeRecoveryAttempts > 0 &&
      performance.now() - this.lastElementDecodeRecoveryAt > HLS_ELEMENT_DECODE_RECOVERY_COOLDOWN_MS
    ) {
      this.elementDecodeRecoveryAttempts = 0;
    }
  }

  private scheduleBufferingRecovery(): void {
    if (
      !this.bufferingRecoveryEnabled ||
      !this.bufferingRecoveryArmed ||
      !this.hls ||
      this.video.paused ||
      this.bufferingRecoveryAttempts >= HLS_BUFFERING_MAX_RECOVERY_ATTEMPTS
    ) {
      return;
    }

    this.clearBufferingRecoveryTimer();
    const checkpointSeconds = this.video.currentTime || 0;
    this.bufferingRecoveryTimer = setTimeout(() => {
      this.bufferingRecoveryTimer = null;

      if (!this.hls || this.video.paused || this.state !== 'buffering') {
        return;
      }

      const currentTime = this.video.currentTime || 0;
      if (
        Math.abs(currentTime - checkpointSeconds) >
        HLS_BUFFERING_PROGRESS_TOLERANCE_SECONDS
      ) {
        this.resetBufferingRecovery();
        return;
      }

      this.bufferingRecoveryAttempts += 1;
      this.hls.recoverMediaError();
      this.video.play().catch(() => {
        // Ignore autoplay rejections; this recovery path is best-effort only.
      });

      if (this.bufferingRecoveryAttempts < HLS_BUFFERING_MAX_RECOVERY_ATTEMPTS) {
        this.scheduleBufferingRecovery();
      }
    }, HLS_BUFFERING_RECOVERY_DELAY_MS);
  }

  private clearNetworkErrorRecoveryTimer(): void {
    if (this.networkErrorRecoveryTimer !== null) {
      clearTimeout(this.networkErrorRecoveryTimer);
      this.networkErrorRecoveryTimer = null;
    }
  }

  // M1.1-e: after a fatal NETWORK_ERROR, wait HLS_NETWORK_ERROR_RECOVERY_DELAY_MS
  // (a single bounded timer, never stacked) then ask hls.js to resume loading.
  // The attempt budget is reset by BUFFER_APPENDED once real data flows again.
  private scheduleNetworkErrorRecovery(hls: Hls, loadGeneration: number): void {
    this.clearNetworkErrorRecoveryTimer();
    this.networkErrorRecoveryAttempts += 1;
    this.updateState('buffering');
    this.networkErrorRecoveryTimer = setTimeout(() => {
      this.networkErrorRecoveryTimer = null;
      if (!this.isCurrentLoad(loadGeneration) || this.hls !== hls) {
        return;
      }
      hls.startLoad();
    }, HLS_NETWORK_ERROR_RECOVERY_DELAY_MS);
  }
}

export default HlsPlayerAdapter;
