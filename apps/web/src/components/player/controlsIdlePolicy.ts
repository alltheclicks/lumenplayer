type ControlsIdleTimerContext = {
  isFullscreen: boolean;
  showCatchUp: boolean;
  showAudioTracks: boolean;
  showSubtitleTracks: boolean;
  isSeeking: boolean;
};

export const shouldRunControlsIdleTimer = (
  context: ControlsIdleTimerContext
): boolean => {
  const {
    showCatchUp,
    showAudioTracks,
    showSubtitleTracks,
    isSeeking,
  } = context;

  return !showCatchUp && !showAudioTracks && !showSubtitleTracks && !isSeeking;
};

