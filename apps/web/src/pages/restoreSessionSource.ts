import type { SessionSource } from '@lumen/session-core';
import type { PlayerChannel } from '@lumen/types';
import {
  buildCatchUpSessionSourceFromMetadata,
  buildLiveSessionSource,
  clampCatchUpPositionMs,
  isCatchUpSessionSourceMetadata,
  isLiveSessionSourceMetadata,
  parseSessionSourceMetadata,
  type CatchUpSessionSourceMetadata,
} from '../components/player/sessionSources';
import type { CatchUpUrlBuilder } from '../components/player/catchupTransport';

export interface RestoreSessionSourceNotice {
  title: string;
  description: string;
}

export interface NormalizeRestoredSessionSourceInput {
  source: SessionSource | null;
  positionMs: number | null;
  channels: PlayerChannel[];
  fallbackStreamIdsByChannelId: Map<string, number[]>;
  urlBuilder: CatchUpUrlBuilder;
  resolveLiveSourceUrl: (channel: PlayerChannel) => string;
}

export interface NormalizeRestoredSessionSourceResult {
  normalizedSource: SessionSource | null;
  normalizedPositionMs: number | null;
  notice?: RestoreSessionSourceNotice;
}

const resolveChannelForSource = (
  source: SessionSource,
  channels: PlayerChannel[],
): PlayerChannel | null => {
  const parsedMetadata = parseSessionSourceMetadata(source.metadata);
  const preferredChannelId = source.channelId
    ?? ('channelId' in parsedMetadata ? parsedMetadata.channelId : undefined)
    ?? null;

  if (preferredChannelId) {
    const byId = channels.find((channel) => channel.id === preferredChannelId);
    if (byId) {
      return byId;
    }
  }

  const preferredStreamId = 'streamId' in parsedMetadata ? parsedMetadata.streamId : undefined;
  if (typeof preferredStreamId === 'number') {
    const byStreamId = channels.find((channel) => channel.streamId === preferredStreamId);
    if (byStreamId) {
      return byStreamId;
    }
  }

  return null;
};

const mergeFallbackStreamIds = (
  metadata: CatchUpSessionSourceMetadata,
  fallbackStreamIdsByChannelId: Map<string, number[]>,
): CatchUpSessionSourceMetadata => ({
  ...metadata,
  fallbackStreamIds: (
    metadata.fallbackStreamIds.length > 0
      ? metadata.fallbackStreamIds
      : fallbackStreamIdsByChannelId.get(metadata.channelId) ?? []
  ),
});

export const normalizeRestoredSessionSource = ({
  source,
  positionMs,
  channels,
  fallbackStreamIdsByChannelId,
  urlBuilder,
  resolveLiveSourceUrl,
}: NormalizeRestoredSessionSourceInput): NormalizeRestoredSessionSourceResult => {
  if (!source) {
    return {
      normalizedSource: null,
      normalizedPositionMs: null,
    };
  }

  const parsedMetadata = parseSessionSourceMetadata(source.metadata);
  const channel = resolveChannelForSource(source, channels);

  if (isLiveSessionSourceMetadata(parsedMetadata)) {
    if (!channel) {
      return {
        normalizedSource: null,
        normalizedPositionMs: null,
      };
    }

    return {
      normalizedSource: buildLiveSessionSource({
        channel,
        sourceUrl: resolveLiveSourceUrl(channel),
      }),
      normalizedPositionMs: 0,
    };
  }

  if (isCatchUpSessionSourceMetadata(parsedMetadata)) {
    if (!channel) {
      return {
        normalizedSource: null,
        normalizedPositionMs: null,
        notice: {
          title: 'TV unazad nije moguće vratiti',
          description: 'Kanal iz poslednje sesije više nije dostupan, pa je reprodukcija zaustavljena.',
        },
      };
    }

    const normalizedMetadata = mergeFallbackStreamIds(parsedMetadata, fallbackStreamIdsByChannelId);
    const rebuiltCatchUp = buildCatchUpSessionSourceFromMetadata({
      channel,
      metadata: normalizedMetadata,
      channelTitle: channel.name,
      urlBuilder,
    });

    return {
      normalizedSource: rebuiltCatchUp.source,
      normalizedPositionMs: clampCatchUpPositionMs(positionMs, normalizedMetadata.durationSeconds),
    };
  }

  if (channel) {
    return {
      normalizedSource: buildLiveSessionSource({
        channel,
        sourceUrl: resolveLiveSourceUrl(channel),
      }),
      normalizedPositionMs: 0,
      notice: {
        title: 'TV unazad je vraćen na uživo',
        description: 'Poslednja emisija nema dovoljno podataka za bezbedan restore, pa je otvoren live kanal.',
      },
    };
  }

  return {
    normalizedSource: source,
    normalizedPositionMs: positionMs,
  };
};
