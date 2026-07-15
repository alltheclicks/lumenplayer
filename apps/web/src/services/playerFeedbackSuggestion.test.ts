import { describe, expect, it } from 'vitest';
import {
  isPlayerFeedbackSuggestionFresh,
  PLAYER_FEEDBACK_SUGGESTION_TTL_MS,
  resolvePlayerFeedbackSuggestion,
} from './playerFeedbackSuggestion';

describe('player feedback suggestions', () => {
  it('suggests a channel problem after a terminal live playback error', () => {
    expect(resolvePlayerFeedbackSuggestion('playback.error', {
      terminal: true,
      contentKind: 'live',
    }, 1_000)).toMatchObject({
      category: 'channel_not_working',
      detectedAtMs: 1_000,
    });
  });

  it('distinguishes catch-up failures from live channel failures', () => {
    expect(resolvePlayerFeedbackSuggestion('playback.media_error', {
      playbackMode: 'catchup',
    })).toMatchObject({
      category: 'catchup_not_working',
    });
  });

  it('suggests buffering and audio categories from player signals', () => {
    expect(resolvePlayerFeedbackSuggestion('playback.buffering_started', {}))
      .toMatchObject({ category: 'buffering' });
    expect(resolvePlayerFeedbackSuggestion('playback.unsupported_audio_codec', {}))
      .toMatchObject({ category: 'no_audio' });
  });

  it('ignores non-terminal playback errors and unrelated events', () => {
    expect(resolvePlayerFeedbackSuggestion('playback.error', { terminal: false })).toBeNull();
    expect(resolvePlayerFeedbackSuggestion('playback.started', {})).toBeNull();
  });

  it('expires old suggestions', () => {
    const suggestion = resolvePlayerFeedbackSuggestion('playback.buffering_started', {}, 10_000);
    expect(suggestion).not.toBeNull();
    if (!suggestion) return;
    expect(isPlayerFeedbackSuggestionFresh(suggestion, 10_000 + PLAYER_FEEDBACK_SUGGESTION_TTL_MS)).toBe(true);
    expect(isPlayerFeedbackSuggestionFresh(suggestion, 10_001 + PLAYER_FEEDBACK_SUGGESTION_TTL_MS)).toBe(false);
  });
});
