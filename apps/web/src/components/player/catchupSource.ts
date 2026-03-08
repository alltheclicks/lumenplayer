import type { SessionSource } from '@lumen/session-core';
import type { PlayerChannel, Program } from '@lumen/types';
import type { CatchUpTransportPlan, CatchUpUrlBuilder } from './catchupTransport';
import {
  resolveCatchUpGatewayPlayback,
  type CatchUpGatewayClientOptions,
  type CatchUpGatewayPlaybackMetadata,
} from './catchupGateway';
import {
  buildCatchUpMetadata,
  buildCatchUpSessionSourceFromMetadata,
} from './sessionSources';

export interface CatchUpPlaybackSourceResult {
  source: SessionSource;
  transportPlan: CatchUpTransportPlan;
  initialPositionSeconds: number;
  fullDurationSeconds: number;
  gateway: CatchUpGatewayPlaybackMetadata | null;
}

const alignTimestampToMinute = (timestampSeconds: number): number => {
  const normalized = Math.max(1, Math.floor(timestampSeconds));
  return Math.floor(normalized / 60) * 60;
};

export const resolveCatchUpPlaybackSource = async ({
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
  const initialPositionSeconds = preferredPositionSeconds > 0
    ? Math.max(0, Math.min(resolvedDurationSeconds, preferredPositionSeconds))
    : Math.max(
      0,
      Math.min(resolvedDurationSeconds, initialPositionGuardSeconds),
    );

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

  const gateway = await resolveCatchUpGatewayPlayback({
    channel,
    program,
    streamId: channel.streamId,
    startTimestamp: minuteAlignedStartTimestamp,
    durationSeconds: resolvedDurationSeconds,
    sourceCandidates,
    gatewayOptions,
  });
  const resolvedSource = buildCatchUpSessionSourceFromMetadata({
    channel,
    metadata: gateway ? { ...metadata, gateway } : metadata,
    channelTitle,
    urlBuilder,
    preferredPositionSeconds,
    initialPositionGuardSeconds,
  });

  return {
    source: resolvedSource.source,
    transportPlan: resolvedSource.transportPlan,
    initialPositionSeconds,
    fullDurationSeconds,
    gateway,
  };
};
