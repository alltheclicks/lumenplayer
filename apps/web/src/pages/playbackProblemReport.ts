import type { SessionSource } from '@lumen/session-core';
import { parseSessionSourceMetadata } from '@/components/player/sessionSources';

export type PlaybackProblemReportMetadata = {
  channelId: string | null;
  streamId: number | null;
  mode: 'live' | 'catchup' | null;
  title: string;
  errorMessage: string;
  errorDetails: string | null;
};

export const buildPlaybackProblemReportMetadata = (
  source: SessionSource,
  error: { message: string; details?: string },
): PlaybackProblemReportMetadata => {
  const metadata = parseSessionSourceMetadata(source.metadata);
  const title = source.title?.trim() || 'Live kanal';

  return {
    channelId: source.channelId ?? metadata.channelId ?? null,
    streamId: metadata.streamId ?? null,
    mode: metadata.mode === 'live' || metadata.mode === 'catchup'
      ? metadata.mode
      : null,
    title,
    errorMessage: error.message,
    errorDetails: error.details ?? null,
  };
};
