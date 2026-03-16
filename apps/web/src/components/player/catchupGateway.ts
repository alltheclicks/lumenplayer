import type { PlayerChannel, Program } from '@lumen/types';
import { XTREAM_PROXY_ORIGIN } from '../../config/xtream';
import { resolveCatchUpTargetOrigin } from './catchupTransport';

export type CatchUpGatewayTransportMode =
  | 'provider-direct'
  | 'proxy-normalized'
  | 'proxy-remuxed';

export type CatchUpGatewayAssetState = 'ready' | 'preparing' | 'failed';

export interface CatchUpGatewayPlaybackMetadata {
  serverId: string;
  assetKey: string;
  transportMode: CatchUpGatewayTransportMode;
  playbackUrl: string;
  assetState: CatchUpGatewayAssetState;
  fallbackReason: string | null;
  hotStart: boolean;
}

interface CatchUpGatewayResolveResponse extends CatchUpGatewayPlaybackMetadata {
  channelId: string;
  programId: string;
}

interface CatchUpGatewayResolveRequest {
  platform?: string;
  serverUrl?: string | null;
  channelId: string;
  programId: string;
  streamId: number;
  startTimestamp: number;
  durationSeconds: number;
  sourceCandidates: {
    redirectUrls: string[];
    queryUrls: string[];
    legacyUrls: string[];
  };
  channelCapability: {
    channelId: string;
    hasCatchup: boolean;
    archiveWindowHours: number;
    epgCoverageState: 'available' | 'partial' | 'missing';
  };
  debugOverride?: {
    enabled?: boolean;
  } | null;
}

export interface CatchUpGatewayClientOptions {
  enabled?: boolean;
  origin?: string | null;
  platform?: string;
  debugOverride?: boolean;
  fetchImpl?: typeof fetch;
}

const DEFAULT_GATEWAY_PLATFORM = import.meta.env.VITE_CATCHUP_GATEWAY_PLATFORM?.trim() || 'web';
const GATEWAY_RESOLVE_PATH = '/catchup-gateway/resolve';
const CATCHUP_GATEWAY_ENABLED = import.meta.env.VITE_CATCHUP_GATEWAY_ENABLED === '1';
const CATCHUP_GATEWAY_DEBUG_OVERRIDE = import.meta.env.VITE_CATCHUP_GATEWAY_DEBUG_OVERRIDE === '1';
const AUTO_GATEWAY_SERVER_HOSTS = new Set([
  'smart.mediaking.fi',
  'serv2.mediaking.fi',
  'edge6.castcdn.net',
  '79.137.99.121',
]);

const parseStringFilter = (value: string | undefined): Set<string> | null => {
  if (!value) {
    return null;
  }

  const parsed = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return parsed.length > 0 ? new Set(parsed) : null;
};

const CATCHUP_GATEWAY_PLATFORM_FILTER = parseStringFilter(import.meta.env.VITE_CATCHUP_GATEWAY_PLATFORMS);
const CATCHUP_GATEWAY_CHANNEL_FILTER = parseStringFilter(import.meta.env.VITE_CATCHUP_GATEWAY_CHANNEL_IDS);
const CATCHUP_GATEWAY_PROGRAM_FILTER = parseStringFilter(import.meta.env.VITE_CATCHUP_GATEWAY_PROGRAM_IDS);
const CATCHUP_GATEWAY_SERVER_FILTER = parseStringFilter(import.meta.env.VITE_CATCHUP_GATEWAY_SERVER_ORIGINS);

const matchesOptionalFilter = (
  filter: Set<string> | null,
  value: string | null | undefined,
): boolean => filter === null || (typeof value === 'string' && filter.has(value));

const resolveRuntimeOrigin = (): string => (
  typeof window === 'undefined' ? 'http://localhost' : window.location.origin
);

const resolveGatewayOrigin = (explicitOrigin?: string | null): string | null => {
  const configuredOrigin = explicitOrigin?.trim() || import.meta.env.VITE_CATCHUP_GATEWAY_ORIGIN?.trim() || XTREAM_PROXY_ORIGIN;
  if (configuredOrigin) {
    return configuredOrigin.replace(/\/+$/, '');
  }

  return resolveRuntimeOrigin().replace(/\/+$/, '');
};

const normalizeGatewayPlaybackUrl = (
  playbackUrl: string,
  gatewayOrigin: string,
): string => {
  try {
    const parsedPlaybackUrl = new URL(playbackUrl);
    if (!parsedPlaybackUrl.pathname.startsWith('/xui-api/')) {
      return playbackUrl;
    }

    const parsedGatewayOrigin = new URL(gatewayOrigin);
    parsedPlaybackUrl.protocol = parsedGatewayOrigin.protocol;
    parsedPlaybackUrl.username = parsedGatewayOrigin.username;
    parsedPlaybackUrl.password = parsedGatewayOrigin.password;
    parsedPlaybackUrl.hostname = parsedGatewayOrigin.hostname;
    parsedPlaybackUrl.port = parsedGatewayOrigin.port;
    return parsedPlaybackUrl.toString();
  } catch {
    return playbackUrl;
  }
};

const extractServerOrigin = (
  candidates: CatchUpGatewayResolveRequest['sourceCandidates'],
): string | null => {
  const firstCandidate = candidates.redirectUrls[0] ?? candidates.queryUrls[0] ?? candidates.legacyUrls[0] ?? null;
  return firstCandidate ? resolveCatchUpTargetOrigin(firstCandidate) : null;
};

const isAutoGatewayServerOrigin = (serverOrigin: string | null): boolean => {
  if (!serverOrigin) {
    return false;
  }

  try {
    return AUTO_GATEWAY_SERVER_HOSTS.has(new URL(serverOrigin).hostname.toLowerCase());
  } catch {
    return false;
  }
};

export const shouldUseCatchUpGateway = ({
  gatewayOptions,
  channelId,
  programId,
  serverOrigin,
}: {
  gatewayOptions?: CatchUpGatewayClientOptions;
  channelId: string;
  programId: string;
  serverOrigin: string | null;
}): boolean => {
  const gatewayOrigin = resolveGatewayOrigin(gatewayOptions?.origin);
  const enabled = gatewayOptions?.enabled ?? CATCHUP_GATEWAY_ENABLED;
  const debugOverride = gatewayOptions?.debugOverride ?? CATCHUP_GATEWAY_DEBUG_OVERRIDE;
  const platform = gatewayOptions?.platform ?? DEFAULT_GATEWAY_PLATFORM;
  const autoEnabled = Boolean(gatewayOrigin) && isAutoGatewayServerOrigin(serverOrigin);

  if (!enabled && !autoEnabled) {
    return false;
  }

  if (debugOverride) {
    return true;
  }

  return (
    matchesOptionalFilter(CATCHUP_GATEWAY_PLATFORM_FILTER, platform) &&
    matchesOptionalFilter(CATCHUP_GATEWAY_CHANNEL_FILTER, channelId) &&
    matchesOptionalFilter(CATCHUP_GATEWAY_PROGRAM_FILTER, programId) &&
    matchesOptionalFilter(CATCHUP_GATEWAY_SERVER_FILTER, serverOrigin)
  );
};

const isCatchUpGatewayTransportMode = (value: unknown): value is CatchUpGatewayTransportMode => (
  value === 'provider-direct' ||
  value === 'proxy-normalized' ||
  value === 'proxy-remuxed'
);

const isCatchUpGatewayAssetState = (value: unknown): value is CatchUpGatewayAssetState => (
  value === 'ready' ||
  value === 'preparing' ||
  value === 'failed'
);

const isCatchUpGatewayResolveResponse = (
  value: unknown,
): value is CatchUpGatewayResolveResponse => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.serverId === 'string' &&
    typeof candidate.channelId === 'string' &&
    typeof candidate.programId === 'string' &&
    typeof candidate.assetKey === 'string' &&
    isCatchUpGatewayTransportMode(candidate.transportMode) &&
    typeof candidate.playbackUrl === 'string' &&
    isCatchUpGatewayAssetState(candidate.assetState) &&
    (candidate.fallbackReason === null || typeof candidate.fallbackReason === 'string') &&
    typeof candidate.hotStart === 'boolean'
  );
};

export const resolveCatchUpGatewayPlayback = async ({
  channel,
  program,
  streamId,
  startTimestamp,
  durationSeconds,
  sourceCandidates,
  gatewayOptions,
}: {
  channel: Pick<PlayerChannel, 'id' | 'hasCatchUp' | 'catchUpDays'>;
  program: Pick<Program, 'id'>;
  streamId: number;
  startTimestamp: number;
  durationSeconds: number;
  sourceCandidates: CatchUpGatewayResolveRequest['sourceCandidates'];
  gatewayOptions?: CatchUpGatewayClientOptions;
}): Promise<CatchUpGatewayPlaybackMetadata | null> => {
  const serverOrigin = extractServerOrigin(sourceCandidates);
  if (!shouldUseCatchUpGateway({
    gatewayOptions,
    channelId: channel.id,
    programId: program.id,
    serverOrigin,
  })) {
    return null;
  }

  const gatewayOrigin = resolveGatewayOrigin(gatewayOptions?.origin);
  const fetchImpl = gatewayOptions?.fetchImpl ?? fetch;
  if (!gatewayOrigin || typeof fetchImpl !== 'function') {
    return null;
  }

  const gatewayRequest: CatchUpGatewayResolveRequest = {
    platform: gatewayOptions?.platform ?? DEFAULT_GATEWAY_PLATFORM,
    serverUrl: serverOrigin,
    channelId: channel.id,
    programId: program.id,
    streamId,
    startTimestamp,
    durationSeconds,
    sourceCandidates,
    channelCapability: {
      channelId: channel.id,
      hasCatchup: channel.hasCatchUp,
      archiveWindowHours: Math.max(0, Math.floor((channel.catchUpDays ?? 0) * 24)),
      epgCoverageState: 'available',
    },
    debugOverride: (gatewayOptions?.debugOverride ?? CATCHUP_GATEWAY_DEBUG_OVERRIDE)
      ? { enabled: true }
      : null,
  };

  try {
    const response = await fetchImpl(`${gatewayOrigin}${GATEWAY_RESOLVE_PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(gatewayRequest),
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    if (!isCatchUpGatewayResolveResponse(payload)) {
      return null;
    }

    if (payload.assetState === 'failed' || payload.playbackUrl.trim().length === 0) {
      return null;
    }

    const playbackUrl = normalizeGatewayPlaybackUrl(payload.playbackUrl, gatewayOrigin);

    return {
      serverId: payload.serverId,
      assetKey: payload.assetKey,
      transportMode: payload.transportMode,
      playbackUrl,
      assetState: payload.assetState,
      fallbackReason: payload.fallbackReason,
      hotStart: payload.hotStart,
    };
  } catch {
    return null;
  }
};
