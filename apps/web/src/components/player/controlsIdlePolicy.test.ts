import { describe, expect, it } from 'vitest';
import { shouldRunControlsIdleTimer } from './controlsIdlePolicy';

describe('controlsIdlePolicy', () => {
  it('keeps idle timer active for normal player overlay in fullscreen and windowed mode', () => {
    expect(
      shouldRunControlsIdleTimer({
        isFullscreen: true,
        showCatchUp: false,
        showAudioTracks: false,
        showSubtitleTracks: false,
        isSeeking: false,
      })
    ).toBe(true);

    expect(
      shouldRunControlsIdleTimer({
        isFullscreen: false,
        showCatchUp: false,
        showAudioTracks: false,
        showSubtitleTracks: false,
        isSeeking: false,
      })
    ).toBe(true);
  });

  it('suspends idle timer while interactive overlays are open or while seeking', () => {
    expect(
      shouldRunControlsIdleTimer({
        isFullscreen: false,
        showCatchUp: true,
        showAudioTracks: false,
        showSubtitleTracks: false,
        isSeeking: false,
      })
    ).toBe(false);

    expect(
      shouldRunControlsIdleTimer({
        isFullscreen: true,
        showCatchUp: false,
        showAudioTracks: true,
        showSubtitleTracks: false,
        isSeeking: false,
      })
    ).toBe(false);

    expect(
      shouldRunControlsIdleTimer({
        isFullscreen: true,
        showCatchUp: false,
        showAudioTracks: false,
        showSubtitleTracks: true,
        isSeeking: false,
      })
    ).toBe(false);

    expect(
      shouldRunControlsIdleTimer({
        isFullscreen: true,
        showCatchUp: false,
        showAudioTracks: false,
        showSubtitleTracks: false,
        isSeeking: true,
      })
    ).toBe(false);
  });
});

