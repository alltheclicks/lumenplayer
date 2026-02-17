import type { AppSettings } from '@/services/appSettings';

type SessionSourceMode = 'live' | 'catchup' | 'vod' | 'series-episode' | undefined;

export const shouldAutoplaySource = (
  mode: SessionSourceMode,
  settings: AppSettings
): boolean => {
  if (mode === 'live') {
    return settings.player.liveChannelStartMode === 'autoplay';
  }

  return settings.player.autoplay;
};
