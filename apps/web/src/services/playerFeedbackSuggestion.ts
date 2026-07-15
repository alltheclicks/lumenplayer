export type PlayerFeedbackCategory =
  | 'channel_not_working'
  | 'buffering'
  | 'no_audio'
  | 'av_sync'
  | 'catchup_not_working'
  | 'wrong_epg'
  | 'interface'
  | 'suggestion'
  | 'other';

export interface PlayerFeedbackSuggestion {
  category: PlayerFeedbackCategory;
  title: string;
  description: string;
  detectedAtMs: number;
}

export const PLAYER_FEEDBACK_SUGGESTION_TTL_MS = 3 * 60_000;

const stringValue = (value: unknown): string | undefined => (
  typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : undefined
);

const isCatchup = (metadata: Record<string, unknown>): boolean => {
  const mode = stringValue(metadata.contentKind)
    ?? stringValue(metadata.playbackMode)
    ?? stringValue(metadata.mode);
  return mode === 'catchup' || mode === 'archive' || mode === 'timeshift';
};

export const resolvePlayerFeedbackSuggestion = (
  eventName: string,
  metadata: Record<string, unknown>,
  detectedAtMs = Date.now(),
): PlayerFeedbackSuggestion | null => {
  if (eventName === 'playback.unsupported_audio_codec') {
    return {
      category: 'no_audio',
      title: 'Player je prepoznao problem sa zvukom',
      description: 'Možeš da potvrdiš ovaj problem ili da izabereš nešto drugo.',
      detectedAtMs,
    };
  }

  if (eventName === 'playback.buffering_started') {
    return {
      category: 'buffering',
      title: 'Player je primetio zastajkivanje',
      description: 'Predlažemo prijavu za seckanje ili dugo učitavanje.',
      detectedAtMs,
    };
  }

  const terminalPlaybackError = eventName === 'playback.error'
    && (metadata.terminal === true || metadata.fatal === true);
  if (
    terminalPlaybackError
    || eventName === 'playback.media_error'
    || eventName === 'playback.unsupported_video_codec'
  ) {
    if (isCatchup(metadata)) {
      return {
        category: 'catchup_not_working',
        title: 'Player je prepoznao problem sa TV unazad',
        description: 'Možeš da potvrdiš ovaj problem ili da izabereš nešto drugo.',
        detectedAtMs,
      };
    }
    return {
      category: 'channel_not_working',
      title: 'Player je prepoznao da kanal nije učitan',
      description: 'Možeš da potvrdiš ovaj problem ili da izabereš nešto drugo.',
      detectedAtMs,
    };
  }

  return null;
};

export const isPlayerFeedbackSuggestionFresh = (
  suggestion: PlayerFeedbackSuggestion,
  nowMs = Date.now(),
): boolean => (
  nowMs >= suggestion.detectedAtMs
  && nowMs - suggestion.detectedAtMs <= PLAYER_FEEDBACK_SUGGESTION_TTL_MS
);
