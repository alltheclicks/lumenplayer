import type { SessionSource } from '@lumen/session-core';
import type { PlayerChannel, Program } from '@lumen/types';
import Hls from 'hls.js';
import type {
  CatchUpTransportAttempt,
  CatchUpTransportPlan,
  CatchUpUrlBuilder,
} from './catchupTransport';
import { XTREAM_SERVER_URL, resolveXtreamApiServer } from '../../config/xtream';
import {
  resolveCatchUpGatewayPlayback,
  type CatchUpGatewayClientOptions,
  type CatchUpGatewayPlaybackMetadata,
} from './catchupGateway';
import { applyKnownCatchUpHostAffinity } from './catchupTransport';
import {
  buildCatchUpMetadata,
  buildCatchUpSessionSourceFromMetadata,
} from './sessionSources';
import {
  getCatchUpWebCapabilityNotice,
  resolveCatchUpWebCapability,
} from './catchupCapability';
import { readCatchUpClientRebaseFailure } from './catchupClientRebaseCompat';

export interface CatchUpPlaybackSourceResult {
  source: SessionSource;
  transportPlan: CatchUpTransportPlan;
  initialPositionSeconds: number;
  fullDurationSeconds: number;
  gateway: CatchUpGatewayPlaybackMetadata | null;
}

const CATCHUP_SHADOW_VALIDATION_ENABLED = import.meta.env.VITE_CATCHUP_SHADOW_VALIDATION === '1';
const CATCHUP_CLIENT_REBASE_ENABLED = import.meta.env.VITE_CATCHUP_CLIENT_REBASE === '1';
const MEDIAKING_CATCHUP_SAFE_START_POSITION_SECONDS = 75;

export const isCatchUpClientRebaseRuntimeSupported = (): boolean => Hls.isSupported();

const MEDIAKING_CATCHUP_HOSTS = [
  'mediaking.fi',
  'castcdn.net',
];
const MEDIAKING_CATCHUP_EXACT_HOSTS = new Set([
  '79.137.99.121',
]);

const parseTimeshiftPathUrl = (
  url: string,
): {
  origin: string;
  pathType: 'timeshift' | 'timeshift_hls';
  username: string;
  password: string;
  duration: string;
  start: string;
  streamId: string;
} | null => {
  let parsed: URL;
  try {
    parsed = new URL(url, typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  } catch {
    return null;
  }

  const match = parsed.pathname.match(
    /^\/(timeshift|timeshift_hls)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/(\d+)\.(?:m3u8|ts)$/i,
  );
  if (!match) {
    return null;
  }

  const [, pathType, username, password, duration, start, streamId] = match;
  return {
    origin: parsed.origin,
    pathType: pathType.toLowerCase() === 'timeshift_hls' ? 'timeshift_hls' : 'timeshift',
    username,
    password,
    duration,
    start,
    streamId,
  };
};

const isTimeshiftGeneratorUrl = (url: string): boolean => {
  let parsed: URL;
  try {
    parsed = new URL(url, typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  } catch {
    return false;
  }

  return parsed.pathname.toLowerCase().endsWith('/streaming/timeshift.php');
};

const resolveShadowValidationSeedUrl = ({
  queryUrls,
  redirectUrls,
  legacyUrls,
}: {
  queryUrls: string[];
  redirectUrls: string[];
  legacyUrls: string[];
}): string | null => {
  const generatorUrl = queryUrls.find(isTimeshiftGeneratorUrl) ?? null;
  if (generatorUrl) {
    return generatorUrl;
  }

  const pathCandidates = [
    ...queryUrls,
    ...redirectUrls,
    ...legacyUrls,
  ]
    .map((url) => parseTimeshiftPathUrl(url))
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);
  const directCandidate = pathCandidates.find((candidate) => candidate.pathType === 'timeshift_hls')
    ?? pathCandidates[0]
    ?? null;
  if (!directCandidate) {
    return null;
  }

  const loginOrigin = pathCandidates.find((candidate) => candidate.pathType === 'timeshift')?.origin
    ?? (XTREAM_SERVER_URL ? resolveXtreamApiServer(XTREAM_SERVER_URL) : null)
    ?? directCandidate.origin;
  if (!loginOrigin) {
    return null;
  }

  const shadowSeedUrl = new URL(`${loginOrigin}/streaming/timeshift.php`);
  shadowSeedUrl.searchParams.set('username', directCandidate.username);
  shadowSeedUrl.searchParams.set('password', directCandidate.password);
  shadowSeedUrl.searchParams.set('stream', directCandidate.streamId);
  shadowSeedUrl.searchParams.set('start', directCandidate.start);
  shadowSeedUrl.searchParams.set('duration', directCandidate.duration);
  shadowSeedUrl.searchParams.set('extension', 'm3u8');
  return shadowSeedUrl.toString();
};

const resolveShadowValidationPlayback = async ({
  channelId,
  programId,
  sourceCandidates,
  fetchImpl,
}: {
  channelId: string;
  programId: string;
  sourceCandidates: {
    redirectUrls: string[];
    queryUrls: string[];
    legacyUrls: string[];
  };
  fetchImpl?: typeof fetch;
}): Promise<CatchUpGatewayPlaybackMetadata | null> => {
  const shadowSeedUrl = resolveShadowValidationSeedUrl(sourceCandidates);
  if (!shadowSeedUrl) {
    return null;
  }

  const performFetch = fetchImpl ?? fetch;
  const response = await performFetch(shadowSeedUrl, {
    redirect: 'follow',
    cache: 'no-store',
  });
  if (!response.ok) {
    return null;
  }

  const playbackUrl = applyKnownCatchUpHostAffinity(response.url);
  if (!playbackUrl.includes('/streaming/timeshift_shadow.php?token=')) {
    return null;
  }

  return {
    serverId: 'shadow-validation',
    assetKey: `shadow:${channelId}:${programId}`,
    transportMode: 'provider-direct',
    playbackUrl,
    assetState: 'ready',
    fallbackReason: 'shadow-validation',
    hotStart: true,
  };
};

const buildShadowOnlyResult = ({
  result,
  gateway,
}: {
  result: CatchUpPlaybackSourceResult;
  gateway: CatchUpGatewayPlaybackMetadata;
}): CatchUpPlaybackSourceResult => {
  const initialAttempt = {
    ...result.transportPlan.initialAttempt,
    url: gateway.playbackUrl,
    strategy: 'shadow-validation' as const,
  };
  // Keep the original (legacy timeshift.php) attempts as fallbacks behind the
  // shadow attempt. The shadow endpoint produces a clean A/V-normalized fMP4
  // stream, but if it fails to play (e.g. the player can't start the fMP4
  // source, or a segment errors), the player must still be able to fall back to
  // the legacy path rather than dying with no source. This makes enabling
  // shadow strictly non-regressive: worst case is the old (overlapping) stream.
  const legacyAttempts = result.transportPlan.allAttempts.filter(
    (attempt) => attempt.url !== initialAttempt.url,
  );
  const fallbackUrls = legacyAttempts.map((attempt) => attempt.url);
  const allAttempts = [initialAttempt, ...legacyAttempts];
  const sourceMetadata = {
    ...(result.source.metadata as Record<string, unknown>),
    gateway,
    catchUpAttemptPlan: allAttempts,
    catchUpAttemptIndex: 0,
    catchUpAttemptStrategy: initialAttempt.strategy,
    catchUpFallbackUrl: fallbackUrls[0] ?? '',
    catchUpFallbackUrls: fallbackUrls,
    catchUpFallbackIndex: -1,
    catchUpFallbackUsed: false,
  };

  return {
    ...result,
    source: {
      ...result.source,
      url: initialAttempt.url,
      metadata: sourceMetadata,
    },
    transportPlan: {
      initialAttempt,
      fallbackAttempts: legacyAttempts,
      allAttempts,
    },
    gateway,
  };
};

const appendShadowFallbackToClientRebaseResult = ({
  result,
  gateway,
}: {
  result: CatchUpPlaybackSourceResult;
  gateway: CatchUpGatewayPlaybackMetadata;
}): CatchUpPlaybackSourceResult => {
  const currentAttempts = result.transportPlan.allAttempts;
  const initialAttempt = currentAttempts[0];
  if (!initialAttempt || initialAttempt.url === gateway.playbackUrl) {
    return result;
  }

  const shadowAttempt: CatchUpTransportAttempt = {
    ...initialAttempt,
    url: gateway.playbackUrl,
    strategy: 'shadow-validation',
  };
  const attemptLimit = Math.max(2, currentAttempts.length);
  const allAttempts = [
    initialAttempt,
    shadowAttempt,
    ...currentAttempts.slice(1).filter((attempt) => attempt.url !== shadowAttempt.url),
  ].slice(0, attemptLimit);
  const fallbackAttempts = allAttempts.slice(1);
  const fallbackUrls = fallbackAttempts.map((attempt) => attempt.url);

  return {
    ...result,
    source: {
      ...result.source,
      metadata: {
        ...(result.source.metadata ?? {}),
        catchUpClientRebaseRequested: true,
        catchUpAttemptPlan: allAttempts,
        catchUpFallbackUrl: fallbackUrls[0] ?? '',
        catchUpFallbackUrls: fallbackUrls,
      },
    },
    transportPlan: {
      initialAttempt,
      fallbackAttempts,
      allAttempts,
    },
  };
};

const alignTimestampToMinute = (timestampSeconds: number): number => {
  const normalized = Math.max(1, Math.floor(timestampSeconds));
  return Math.floor(normalized / 60) * 60;
};

const extractCatchUpTargetHost = (url: string): string | null => {
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

const isMediaKingCatchUpHost = (host: string | null): boolean => {
  if (!host) {
    return false;
  }

  return (
    MEDIAKING_CATCHUP_EXACT_HOSTS.has(host) ||
    MEDIAKING_CATCHUP_HOSTS.some((knownHost) => (
      host === knownHost || host.endsWith(`.${knownHost}`)
    ))
  );
};

const resolveProviderSafeStartPositionSeconds = ({
  sourceCandidates,
  gateway,
  durationSeconds,
  streamId,
}: {
  sourceCandidates: {
    redirectUrls: string[];
    queryUrls: string[];
    legacyUrls: string[];
  };
  gateway?: CatchUpGatewayPlaybackMetadata | null;
  durationSeconds: number;
  streamId: number;
}): number => {
  const urls = [
    ...(gateway?.playbackUrl ? [gateway.playbackUrl] : []),
    ...sourceCandidates.queryUrls,
    ...sourceCandidates.redirectUrls,
    ...sourceCandidates.legacyUrls,
  ];
  const isMediaKingProvider = urls.some((url) => (
    isMediaKingCatchUpHost(extractCatchUpTargetHost(url))
  ));
  if (!isMediaKingProvider) {
    return 0;
  }

  return Math.min(
    Math.max(0, Math.floor(durationSeconds)),
    MEDIAKING_CATCHUP_SAFE_START_POSITION_SECONDS,
  );
};

const buildProviderSafeStartMetadata = (
  metadata: ReturnType<typeof buildCatchUpMetadata>,
  gateway: CatchUpGatewayPlaybackMetadata | null | undefined,
  providerSafeStartPositionSeconds: number,
): ReturnType<typeof buildCatchUpMetadata> => ({
  ...metadata,
  ...(gateway ? { gateway } : {}),
  ...(providerSafeStartPositionSeconds > 0
    ? {
      catchUpHlsStartupMode: 'progressive' as const,
      catchUpHlsStartPositionSeconds: 0,
      catchUpProviderSafeStartPositionSeconds: providerSafeStartPositionSeconds,
    }
    : {}),
});

const buildBlockedCatchUpPlaybackSourceResult = ({
  channel,
  program,
  metadata,
  capability,
  minuteAlignedStartTimestamp,
  resolvedDurationSeconds,
  initialPositionSeconds,
  fullDurationSeconds,
  channelTitle,
}: {
  channel: Pick<PlayerChannel, 'id' | 'name' | 'streamId'>;
  program: Pick<Program, 'id' | 'title'>;
  metadata: ReturnType<typeof buildCatchUpMetadata>;
  capability: ReturnType<typeof resolveCatchUpWebCapability>;
  minuteAlignedStartTimestamp: number;
  resolvedDurationSeconds: number;
  initialPositionSeconds: number;
  fullDurationSeconds: number;
  channelTitle?: string;
}): CatchUpPlaybackSourceResult => {
  const blockedUrl = `lumen://catchup-unavailable/${channel.streamId}/${encodeURIComponent(program.id)}`;
  const initialAttempt: CatchUpTransportAttempt = {
    url: blockedUrl,
    streamId: channel.streamId,
    startTimestamp: minuteAlignedStartTimestamp,
    durationSeconds: resolvedDurationSeconds,
    offsetMinutes: 0,
    strategy: 'blocked-web-capability',
  };
  const notice = getCatchUpWebCapabilityNotice(capability);

  return {
    source: {
      url: blockedUrl,
      type: 'hls',
      title: `${channelTitle ?? channel.name} - ${program.title}`,
      channelId: channel.id,
      metadata: {
        ...metadata,
        gateway: null,
        catchUpProgramId: metadata.programId,
        catchUpStartTimestamp: minuteAlignedStartTimestamp,
        catchUpDurationSeconds: resolvedDurationSeconds,
        catchUpAttemptPlan: [initialAttempt],
        catchUpAttemptIndex: 0,
        catchUpAttemptStrategy: initialAttempt.strategy,
        catchUpFallbackUrl: '',
        catchUpFallbackUrls: [],
        catchUpFallbackIndex: -1,
        catchUpFallbackUsed: false,
        catchUpUnavailable: {
          code: 'catchup_web_provider_incompatible',
          reasonCode: capability.reasonCode,
          channelName: capability.channelName,
          title: notice.title,
          description: notice.description,
          primaryActionLabel: notice.primaryActionLabel,
          summary: capability.summary,
          evidence: capability.evidence,
          observedAt: capability.observedAt,
        },
      },
    },
    transportPlan: {
      initialAttempt,
      fallbackAttempts: [],
      allAttempts: [initialAttempt],
    },
    initialPositionSeconds,
    fullDurationSeconds,
    gateway: null,
  };
};

const buildCatchUpWebProviderIssueMetadata = (
  capability: ReturnType<typeof resolveCatchUpWebCapability>,
): Record<string, unknown> | null => {
  if (
    capability.blockPlayback ||
    capability.reasonCode === 'not-in-provider-matrix' ||
    capability.reasonCode === 'browser-compatible-provider-archive'
  ) {
    return null;
  }

  return {
    reasonCode: capability.reasonCode,
    channelName: capability.channelName,
    summary: capability.summary,
    evidence: capability.evidence,
    observedAt: capability.observedAt,
  };
};

const attachCatchUpWebProviderIssue = (
  result: CatchUpPlaybackSourceResult,
  capability: ReturnType<typeof resolveCatchUpWebCapability>,
): CatchUpPlaybackSourceResult => {
  const providerIssue = buildCatchUpWebProviderIssueMetadata(capability);
  if (!providerIssue) {
    return result;
  }

  return {
    ...result,
    source: {
      ...result.source,
      metadata: {
        ...(result.source.metadata ?? {}),
        catchUpWebProviderIssue: providerIssue,
      },
    },
  };
};

export const resolveCatchUpPlaybackSource = async ({
  channel,
  program,
  urlBuilder,
  fallbackStreamIds = [],
  durationSeconds,
  preferredPositionSeconds = 0,
  channelTitle,
  gatewayOptions,
  shadowValidation = CATCHUP_SHADOW_VALIDATION_ENABLED,
  clientRebase = CATCHUP_CLIENT_REBASE_ENABLED,
  clientRebaseSupported = isCatchUpClientRebaseRuntimeSupported(),
}: {
  channel: Pick<PlayerChannel, 'id' | 'name' | 'streamId' | 'source' | 'catchUpDays' | 'hasCatchUp'>;
  program: Pick<Program, 'id' | 'title' | 'startTime' | 'endTime'>;
  urlBuilder: CatchUpUrlBuilder;
  fallbackStreamIds?: readonly number[];
  durationSeconds?: number;
  preferredPositionSeconds?: number;
  initialPositionGuardSeconds?: number;
  channelTitle?: string;
  gatewayOptions?: CatchUpGatewayClientOptions;
  shadowValidation?: boolean;
  clientRebase?: boolean;
  clientRebaseSupported?: boolean;
}): Promise<CatchUpPlaybackSourceResult> => {
  const startTimestamp = Math.floor(program.startTime.getTime() / 1000);
  const fullDurationSeconds = Math.max(
    1,
    Math.floor((program.endTime.getTime() - program.startTime.getTime()) / 1000),
  );
  const resolvedDurationSeconds = typeof durationSeconds === 'number' && Number.isFinite(durationSeconds)
    ? Math.max(1, Math.floor(durationSeconds))
    : fullDurationSeconds;
  const metadata = buildCatchUpMetadata({
    channel,
    program,
    fallbackStreamIds,
    durationSeconds: resolvedDurationSeconds,
  });
  const minuteAlignedStartTimestamp = alignTimestampToMinute(startTimestamp);
  const timelineInitialPositionSeconds = preferredPositionSeconds > 0
    ? Math.max(0, Math.min(resolvedDurationSeconds, preferredPositionSeconds))
    : 0;
  const capability = resolveCatchUpWebCapability(channel);
  if (capability.blockPlayback) {
    return buildBlockedCatchUpPlaybackSourceResult({
      channel,
      program,
      metadata,
      capability,
      minuteAlignedStartTimestamp,
      resolvedDurationSeconds,
      initialPositionSeconds: timelineInitialPositionSeconds,
      fullDurationSeconds,
      channelTitle,
    });
  }

  const sourceCandidates = {
    redirectUrls: urlBuilder.getCatchUpRedirectUrlVariants(
      channel.streamId,
      minuteAlignedStartTimestamp,
      resolvedDurationSeconds,
    ),
    queryUrls: urlBuilder.getCatchUpUrlVariants(
      channel.streamId,
      minuteAlignedStartTimestamp,
      resolvedDurationSeconds,
    ),
    legacyUrls: urlBuilder.getLegacyCatchUpUrlVariants(
      channel.streamId,
      minuteAlignedStartTimestamp,
      resolvedDurationSeconds,
    ),
  };

  // Client-side PTS rebase stitches the legacy TS segments into one continuous
  // timeline on the viewer device (mpegTsPtsRebase.ts). A lightweight provider
  // seed request may prepare a shadow URL as fallback, but no media bytes pass
  // through Lumen and the shadow build is not touched unless fallback is used.
  // A previous runtime failure disables rebase temporarily (compat cache).
  const clientRebaseActive = clientRebase
    && clientRebaseSupported
    // The rewriter preserves codecs; it cannot make known MP2/MP3/AC3 archive
    // audio browser-compatible. Let the existing shadow resolver lead for
    // those matrix entries instead of discovering the same fact after a large
    // segment has already been downloaded on the user's device.
    && capability.reasonCode !== 'unsupported-audio-codec'
    && readCatchUpClientRebaseFailure(channel.streamId) === null;

  const shadowGateway = shadowValidation
    ? await resolveShadowValidationPlayback({
      channelId: channel.id,
      programId: program.id,
      sourceCandidates,
      fetchImpl: gatewayOptions?.fetchImpl,
    }).catch(() => null)
    : null;

  if (shadowGateway && !clientRebaseActive) {
    // Graceful fallback: if the shadow (MP2->AAC remux) endpoint can't be
    // resolved for this program, fall through to the original timeshift.php
    // gateway path below instead of throwing. The legacy path still plays
    // (with the minute-boundary overlap) — far better than killing catch-up
    // entirely. Shadow stays best-effort, per-program.
    const providerSafeStartPositionSeconds = resolveProviderSafeStartPositionSeconds({
      sourceCandidates,
      gateway: shadowGateway,
      durationSeconds: resolvedDurationSeconds,
      streamId: channel.streamId,
    });
    const stableStartupMetadata = buildProviderSafeStartMetadata(
      metadata,
      shadowGateway,
      providerSafeStartPositionSeconds,
    );
    const resolvedSource = buildCatchUpSessionSourceFromMetadata({
      channel,
      metadata: stableStartupMetadata,
      channelTitle,
      urlBuilder,
      preferredPositionSeconds: timelineInitialPositionSeconds,
      initialPositionGuardSeconds: 0,
    });
    const result = {
      source: resolvedSource.source,
      transportPlan: resolvedSource.transportPlan,
      initialPositionSeconds: timelineInitialPositionSeconds,
      fullDurationSeconds,
      gateway: shadowGateway,
    };

    return buildShadowOnlyResult({
      result: attachCatchUpWebProviderIssue(result, capability),
      gateway: shadowGateway,
    });
  }

  // Client rebase is deliberately device-direct: do not even resolve the
  // same-origin catch-up gateway, whose proxy-normalized response would route
  // large archive segments through the Lumen VPS. Legacy/shadow fallback keeps
  // the existing gateway behavior when rebase is unavailable.
  const gateway = clientRebaseActive
    ? null
    : await resolveCatchUpGatewayPlayback({
      channel,
      program,
      streamId: channel.streamId,
      startTimestamp: minuteAlignedStartTimestamp,
      durationSeconds: resolvedDurationSeconds,
      sourceCandidates,
      gatewayOptions,
    });
  const providerSafeStartPositionSeconds = resolveProviderSafeStartPositionSeconds({
    sourceCandidates,
    gateway,
    durationSeconds: resolvedDurationSeconds,
    streamId: channel.streamId,
  });
  const stableStartupMetadata = buildProviderSafeStartMetadata(
    metadata,
    gateway,
    providerSafeStartPositionSeconds,
  );
  const resolvedSource = buildCatchUpSessionSourceFromMetadata({
    channel,
    metadata: clientRebaseActive
      ? { ...stableStartupMetadata, catchUpClientRebase: true }
      : stableStartupMetadata,
    channelTitle,
    urlBuilder,
    preferredPositionSeconds: timelineInitialPositionSeconds,
    initialPositionGuardSeconds: 0,
  });

  const result = {
    source: resolvedSource.source,
    transportPlan: resolvedSource.transportPlan,
    initialPositionSeconds: timelineInitialPositionSeconds,
    fullDurationSeconds,
    gateway,
  };

  const resultWithShadowFallback = clientRebaseActive && shadowGateway
    ? appendShadowFallbackToClientRebaseResult({ result, gateway: shadowGateway })
    : result;

  return attachCatchUpWebProviderIssue(resultWithShadowFallback, capability);
};
