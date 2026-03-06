import type { PlayerChannel, Program } from '@lumen/types';
import { XUI_PROXY_ORIGIN } from '../../config/xtream';
import { resolveCatchUpTargetOrigin, type CatchUpUrlBuilder } from './catchupTransport';
import {
  buildCatchUpMetadata,
  buildCatchUpSessionSourceFromMetadata,
  type CatchUpSourceBuildResult,
} from './sessionSources';

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

const alignTimestampToMinute = (timestampSeconds: number): number => {
  const normalized = Math.max(1, Math.floor(timestampSeconds));
  return Math.floor(normalized / 60) * 60;
};

const resolveRuntimeOrigin = (): string => (
  typeof window === 'undefined' ? 'http://localhost' : window.location.origin
);

const resolveGatewayOrigin = (
  explicitOrigin?: string | null,
): string | null => {
  const configuredOrigin = explicitOrigin?.trim() || import.meta.env.VITE_CATCHUP_GATEWAY_ORIGIN?.trim() || XUI_PROXY_ORIGIN;
  if (configuredOrigin) {
    return configuredOrigin.replace(/\/+$/, '');
  }

  const runtimeOrigin = resolveRuntimeOrigin();
  return runtimeOrigin.replace(/\/+$/, '');
};

const extractServerOrigin = (candidates: CatchUpGatewayResolveRequest['sourceCandidates']): string | null => {
  const firstCandidate = candidates.redirectUrls[0] ?? candidates.queryUrls[0] ?? candidates.legacyUrls[0] ?? null;
  return firstCandidate ? resolveCatchUpTargetOrigin(firstCandidate) : null;
};

const shouldUseCatchUpGateway = ({
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
  const enabled = gatewayOptions?.enabled ?? CATCHUP_GATEWAY_ENABLED;
  const debugOverride = gatewayOptions?.debugOverride ?? CATCHUP_GATEWAY_DEBUG_OVERRIDE;
  const platform = gatewayOptions?.platform ?? DEFAULT_GATEWAY_PLATFORM;

  if (!enabled) {
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

const isCatchUpGatewayResolveResponse = (
  value: unknown,
): value is CatchUpGatewayResolveResponse => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.serverId === 'string' &&
    typeof candidate.assetKey === 'string' &&
    typeof candidate.transportMode === 'string' &&
    typeof candidate.playbackUrl === 'string' &&
    typeof candidate.assetState === 'string' &&
    typeof candidate.hotStart === 'boolean'
  );
};

export const resolveCatchUpSessionSource = async ({
  channel,
  program,
  urlBuilder,
  fallbackStreamIds = [],
  durationSeconds,
  preferredPositionSeconds = 0,
  initialPositionGuardSeconds = 15,
  channelTitle,
  gatewayOptions,
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
}): Promise<CatchUpSourceBuildResult> => {
  const fullDurationSeconds = Math.floor(
    (program.endTime.getTime() - program.startTime.getTime()) / 1000,
  );
  const resolvedDurationSeconds = typeof durationSeconds === 'number' && Number.isFinite(durationSeconds)
    ? Math.max(1, Math.floor(durationSeconds))
    : Math.max(1, fullDurationSeconds);
  const metadata = buildCatchUpMetadata({
    channel,
    program,
    fallbackStreamIds,
    durationSeconds: resolvedDurationSeconds,
  });
  const minuteAlignedStartTimestamp = alignTimestampToMinute(metadata.startTimestamp);
  const sourceCandidates = {
    redirectUrls: urlBuilder.getCatchUpRedirectUrlVariants(
      metadata.streamId,
      minuteAlignedStartTimestamp,
      metadata.durationSeconds,
    ),
    queryUrls: urlBuilder.getCatchUpUrlVariants(
      metadata.streamId,
      minuteAlignedStartTimestamp,
      metadata.durationSeconds,
    ),
    legacyUrls: urlBuilder.getLegacyCatchUpUrlVariants(
      metadata.streamId,
      minuteAlignedStartTimestamp,
      metadata.durationSeconds,
    ),
  };
  const serverOrigin = extractServerOrigin(sourceCandidates);

  let resolvedMetadata = metadata;
  if (shouldUseCatchUpGateway({
    gatewayOptions,
    channelId: channel.id,
    programId: program.id,
    serverOrigin,
  })) {
    const gatewayOrigin = resolveGatewayOrigin(gatewayOptions?.origin);
    const fetchImpl = gatewayOptions?.fetchImpl ?? fetch;

    if (gatewayOrigin && typeof fetchImpl === 'function') {
      const gatewayRequest: CatchUpGatewayResolveRequest = {
        platform: gatewayOptions?.platform ?? DEFAULT_GATEWAY_PLATFORM,
        serverUrl: serverOrigin,
        channelId: channel.id,
        programId: program.id,
        streamId: metadata.streamId,
        startTimestamp: minuteAlignedStartTimestamp,
        durationSeconds: metadata.durationSeconds,
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

        if (response.ok) {
          const payload = await response.json();
          if (
            isCatchUpGatewayResolveResponse(payload) &&
            payload.assetState !== 'failed' &&
            payload.playbackUrl
          ) {
            resolvedMetadata = {
              ...metadata,
              gateway: {
                serverId: payload.serverId,
                assetKey: payload.assetKey,
                transportMode: payload.transportMode,
                playbackUrl: payload.playbackUrl,
                assetState: payload.assetState,
                fallbackReason: payload.fallbackReason,
                hotStart: payload.hotStart,
              },
            };
          }
        }
      } catch {
        // Fall through to the local transport plan.
      }
    }
  }

  const result = buildCatchUpSessionSourceFromMetadata({
    channel,
    metadata: resolvedMetadata,
    channelTitle,
    urlBuilder,
    preferredPositionSeconds,
    initialPositionGuardSeconds,
  });

  return {
    ...result,
    fullDurationSeconds,
  };
};
