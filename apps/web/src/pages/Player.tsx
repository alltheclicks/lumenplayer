import { useState, useRef, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Search,
  Star,
  LogOut,
  Loader2,
  AlertCircle,
  Film,
  Clapperboard,
  Calendar,
  CalendarDays,
  Clock,
  ChevronDown,
  Home,
  Play,
  Pause,
  PictureInPicture2,
  Cast,
  Airplay,
  SkipBack,
  SkipForward,
  Smartphone,
  RefreshCw,
  Tv2,
  User,
  Wifi,
  type LucideIcon,
} from 'lucide-react';
import VideoPlayer, { type VideoPlayerHandle } from '@/components/player/VideoPlayer';
import PlayerControls from '@/components/player/PlayerControls';
import ChannelList from '@/components/player/ChannelList';
import { useXtreamChannels } from '@/hooks/useXtreamChannels';
import { useFavorites } from '@/hooks/useFavorites';
import { useSessionContext } from '@/context/session-context';
import { useGoogleCastSender } from '@/hooks/useGoogleCastSender';
import { NumericChannelInput, WebKeyCodes } from '@lumen/input';
import { filterChannels, formatTime, getCurrentProgram, getProgramProgress } from '@lumen/core';
import type { PlayerChannel, XtreamUserInfo } from '@lumen/types';
import {
  loadXtreamCredentials,
  clearXtreamCredentials,
} from '@/services/xtreamCredentials';
import {
  getDefaultAppSettings,
  loadAppSettings,
  type AppSettings,
} from '@/services/appSettings';
import { xtreamCodesService } from '@/services/xtreamService';
import { addWatchHistoryEntry, loadLastWatchedChannelId } from '@/services/watchHistory';
import { emitWebObservabilityEvent } from '@/services/observability';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { getPlayerOnDemandContext } from '@/pages/playerOnDemandContext';
import { shouldAutoplaySource } from '@/pages/liveChannelStartupMode';
import {
  isLivePlaybackSource,
  shouldSnapToLiveOnResume,
} from '@/pages/livePauseResumePolicy';
import {
  resolveStartupLiveChannel,
  shouldSnapSessionRestoreToLiveEdge,
} from '@/pages/restoreLiveChannel';
import { useSwitchToLiveMode } from '@/pages/switchToLiveMode';
import { fetchChannelShortEpgPrograms } from '@/services/channelEpg';
import { resolveCatchUpEmptyStateReason } from '@/components/player/catchUpEmptyState';
import { hasLiveCatchUpEntries, shouldShowLiveCatchUpSection } from '@/pages/liveCatchUpVisibility';
import { resolveCatchUpClockActionTarget } from '@/pages/liveCatchUpDiscoverability';

type SessionSourceMetadata = {
  channelId?: string;
  streamId?: number;
  mode?: 'live' | 'catchup' | 'vod' | 'series-episode';
  vodId?: string;
  catchUpProgramId?: string;
  seriesId?: string;
  seasonNumber?: number;
  episodeId?: string;
  backPath?: string;
};

const parseSessionSourceMetadata = (
  metadata: Record<string, unknown> | undefined
): SessionSourceMetadata => {
  if (!metadata) {
    return {};
  }

  return {
    channelId: typeof metadata.channelId === 'string' ? metadata.channelId : undefined,
    streamId: typeof metadata.streamId === 'number'
      ? metadata.streamId
      : typeof metadata.streamId === 'string' && !Number.isNaN(Number(metadata.streamId))
        ? Number(metadata.streamId)
        : undefined,
    mode: metadata.mode === 'live' ||
      metadata.mode === 'catchup' ||
      metadata.mode === 'vod' ||
      metadata.mode === 'series-episode'
      ? metadata.mode
      : undefined,
    vodId: typeof metadata.vodId === 'string' ? metadata.vodId : undefined,
    catchUpProgramId: typeof metadata.catchUpProgramId === 'string' ? metadata.catchUpProgramId : undefined,
    seriesId: typeof metadata.seriesId === 'string' ? metadata.seriesId : undefined,
    seasonNumber: typeof metadata.seasonNumber === 'number'
      ? metadata.seasonNumber
      : typeof metadata.seasonNumber === 'string' && !Number.isNaN(Number(metadata.seasonNumber))
        ? Number(metadata.seasonNumber)
        : undefined,
    episodeId: typeof metadata.episodeId === 'string'
      ? metadata.episodeId
      : typeof metadata.episodeId === 'number' && Number.isFinite(metadata.episodeId)
        ? String(metadata.episodeId)
        : undefined,
    backPath: typeof metadata.backPath === 'string' ? metadata.backPath : undefined,
  };
};

const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName;
  return (
    target.isContentEditable ||
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT'
  );
};

const getDigitFromWebKeyCode = (keyCode: number): number | null => {
  if (keyCode === WebKeyCodes[0]) return 0;
  if (keyCode === WebKeyCodes[1]) return 1;
  if (keyCode === WebKeyCodes[2]) return 2;
  if (keyCode === WebKeyCodes[3]) return 3;
  if (keyCode === WebKeyCodes[4]) return 4;
  if (keyCode === WebKeyCodes[5]) return 5;
  if (keyCode === WebKeyCodes[6]) return 6;
  if (keyCode === WebKeyCodes[7]) return 7;
  if (keyCode === WebKeyCodes[8]) return 8;
  if (keyCode === WebKeyCodes[9]) return 9;
  return null;
};

const formatXtreamExpDate = (expDateUnix: string): string => {
  const numericValue = Number(expDateUnix);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return 'N/A';
  }

  return new Intl.DateTimeFormat('sr-RS', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(numericValue * 1000));
};

const groupCatchUpProgramsByDate = (programs: PlayerChannel['epg']) => {
  const grouped = new Map<string, PlayerChannel['epg']>();
  const now = new Date();

  programs
    .filter((program) => program.endTime < now && program.hasCatchUp)
    .forEach((program) => {
      const dateKey = program.startTime.toDateString();
      if (!grouped.has(dateKey)) {
        grouped.set(dateKey, []);
      }
      grouped.get(dateKey)?.push(program);
    });

  grouped.forEach((items, key) => {
    grouped.set(key, items.sort((a, b) => b.startTime.getTime() - a.startTime.getTime()));
  });

  return grouped;
};

const formatCatchUpDateLabel = (date: Date): string => {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Danas';
  if (date.toDateString() === yesterday.toDateString()) return 'Juče';

  return date.toLocaleDateString('sr-RS', { weekday: 'long', day: 'numeric', month: 'long' });
};

const PICTURE_IN_PICTURE_KEY_CODE = 80; // Keyboard "P"

type MediaEntryLink = {
  path: '/vod' | '/series' | '/epg';
  label: string;
  hint: string;
  icon: LucideIcon;
};

const MEDIA_ENTRY_LINKS: MediaEntryLink[] = [
  {
    path: '/vod',
    label: 'Movies',
    hint: 'VOD catalog',
    icon: Film,
  },
  {
    path: '/series',
    label: 'Series',
    hint: 'Browse episodes',
    icon: Clapperboard,
  },
  {
    path: '/epg',
    label: 'Catch-up',
    hint: 'Program guide',
    icon: CalendarDays,
  },
];

const MediaEntryGrid = ({
  onSelect,
}: {
  onSelect: (path: MediaEntryLink['path']) => void;
}) => (
  <div className="grid grid-cols-3 gap-2">
    {MEDIA_ENTRY_LINKS.map((item) => {
      const Icon = item.icon;

      return (
        <Button
          key={item.path}
          variant="outline"
          size="sm"
          className="h-auto min-h-14 flex-col items-start gap-1 px-2 py-2 text-left"
          onClick={() => onSelect(item.path)}
        >
          <span className="flex items-center gap-1 text-[11px] font-semibold leading-none">
            <Icon className="h-3.5 w-3.5" />
            {item.label}
          </span>
          <span className="line-clamp-1 text-[10px] text-muted-foreground">
            {item.hint}
          </span>
        </Button>
      );
    })}
  </div>
);

const PlayerSurfaceState = ({
  icon: Icon,
  title,
  description,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  actions?: ReactNode;
}) => (
  <div className="mx-auto w-full max-w-md rounded-2xl border border-border/70 bg-card/80 p-6 text-center shadow-xl backdrop-blur-sm">
    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
      <Icon className="h-7 w-7" />
    </div>
    <h2 className="text-xl font-semibold">{title}</h2>
    <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    {actions && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
  </div>
);

const Player = () => {
  const navigate = useNavigate();
  const switchToLiveMode = useSwitchToLiveMode();
  const playerRef = useRef<VideoPlayerHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    channels,
    categories,
    isLoading,
    error,
    refetch: refetchChannels,
  } = useXtreamChannels();
  const { favorites, toggleFavorite, isFavorite } = useFavorites();
  const { session, commands } = useSessionContext();
  const { toast } = useToast();
  const castSender = useGoogleCastSender({ session, commands });

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [numericZapBuffer, setNumericZapBuffer] = useState<string | null>(null);
  const [numericZapMatchName, setNumericZapMatchName] = useState<string | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings>(getDefaultAppSettings());
  const [isSettingsHydrated, setIsSettingsHydrated] = useState(false);
  const [isPictureInPictureSupported, setIsPictureInPictureSupported] = useState(false);
  const [isPictureInPicture, setIsPictureInPicture] = useState(false);
  const [isAirPlaySupported, setIsAirPlaySupported] = useState(false);
  const [isAirPlayAvailable, setIsAirPlayAvailable] = useState(false);
  const [isAirPlayConnected, setIsAirPlayConnected] = useState(false);
  const [xtreamUserInfo, setXtreamUserInfo] = useState<XtreamUserInfo | null>(null);
  const numericInputRef = useRef<NumericChannelInput<PlayerChannel> | null>(null);
  const watchedChannelIdRef = useRef<string | null>(null);
  const watchedStartedAtRef = useRef<number | null>(null);
  const lastCastErrorRef = useRef<string | null>(null);
  const previousRendererRef = useRef(session.renderer);
  const lastChannelLoadErrorRef = useRef<string | null>(null);
  const previousCastConnectedRef = useRef(castSender.isConnected);
  const tvUnazadSectionRef = useRef<HTMLDivElement>(null);
  const tvUnazadHighlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const livePauseStartedAtRef = useRef<number | null>(null);
  const startupLiveRestoreAppliedRef = useRef(false);
  const [isTvUnazadHighlighted, setIsTvUnazadHighlighted] = useState(false);

  const sessionSourceMetadata = useMemo(
    () => parseSessionSourceMetadata(session.source?.metadata),
    [session.source?.metadata]
  );
  const onDemandContext = useMemo(
    () => getPlayerOnDemandContext(sessionSourceMetadata),
    [sessionSourceMetadata]
  );
  const liveSourceChannelId = session.source?.channelId ?? sessionSourceMetadata.channelId ?? null;
  const isOnDemandSource = onDemandContext !== null;
  const isLiveSourcePlayback = isLivePlaybackSource(sessionSourceMetadata.mode, liveSourceChannelId);
  const usesLocalRenderer = session.renderer === 'local-web' || session.renderer === 'airplay';
  const shouldAutoplayLiveOnSelect = shouldAutoplaySource('live', appSettings);
  const shouldAutoplayCurrentSource = shouldAutoplaySource(sessionSourceMetadata.mode, appSettings);

  const currentChannel = useMemo(() => {
    if (channels.length === 0) {
      return null;
    }

    if (isOnDemandSource) {
      return null;
    }

    const channelId = session.source?.channelId ?? sessionSourceMetadata.channelId;
    if (channelId) {
      const byId = channels.find(channel => channel.id === channelId);
      if (byId) {
        return byId;
      }
    }

    if (typeof sessionSourceMetadata.streamId === 'number') {
      const byStreamId = channels.find(
        channel => channel.streamId === sessionSourceMetadata.streamId
      );
      if (byStreamId) {
        return byStreamId;
      }
    }

    const sourceTitle = session.source?.title;
    if (sourceTitle) {
      const normalizedTitle = sourceTitle.split(' - ')[0].trim();
      const byTitle = channels.find(
        channel =>
          channel.name === sourceTitle ||
          channel.name === normalizedTitle
      );
      if (byTitle) {
        return byTitle;
      }
    }

    return null;
  }, [channels, isOnDemandSource, session.source?.channelId, session.source?.title, sessionSourceMetadata]);

  const currentChannelEPGQuery = useQuery({
    queryKey: ['channel-epg', currentChannel?.id, currentChannel?.streamId],
    queryFn: async () => {
      if (!currentChannel || currentChannel.source !== 'xtream') {
        return currentChannel?.epg ?? [];
      }

      const credentials = await loadXtreamCredentials();
      if (!credentials ||
          credentials.username === 'demo' ||
          credentials.server.includes('your-server.com')) {
        return currentChannel.epg;
      }

      xtreamCodesService.setCredentials(credentials);
      return fetchChannelShortEpgPrograms(currentChannel.streamId);
    },
    enabled: Boolean(currentChannel) && !isOnDemandSource,
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });

  const currentChannelWithEPG = useMemo(() => {
    if (!currentChannel) {
      return null;
    }

    const channelEpg = currentChannelEPGQuery.data;
    if (!channelEpg) {
      return currentChannel;
    }

    return {
      ...currentChannel,
      epg: channelEpg,
    };
  }, [currentChannel, currentChannelEPGQuery.data]);

  const switchToLiveChannel = useCallback(
    (channel: PlayerChannel, options?: { forceAutoplay?: boolean }) => {
      const sourceUrl = channel.streamUrl ?? xtreamCodesService.getLiveStreamUrl(channel.streamId);
      emitWebObservabilityEvent({
        name: 'playback.source-selected',
        severity: 'info',
        metadata: {
          channelId: channel.id,
          streamId: channel.streamId,
          source: channel.source,
        },
      });

      const source = {
        url: sourceUrl,
        type: 'hls' as const,
        title: channel.name,
        channelId: channel.id,
        metadata: {
          channelId: channel.id,
          streamId: channel.streamId,
          mode: 'live',
          source: channel.source,
        },
      };

      commands.setSource(source, 0);

      if (options?.forceAutoplay || shouldAutoplayLiveOnSelect) {
        commands.play();
      }
    },
    [commands, shouldAutoplayLiveOnSelect]
  );

  useEffect(() => {
    const previousRenderer = previousRendererRef.current;
    if (previousRenderer !== session.renderer) {
      emitWebObservabilityEvent({
        name: 'renderer.changed',
        severity: 'info',
        metadata: {
          from: previousRenderer,
          to: session.renderer,
        },
      });
      previousRendererRef.current = session.renderer;
    }
  }, [session.renderer]);

  useEffect(() => {
    if (!error) {
      lastChannelLoadErrorRef.current = null;
      return;
    }

    if (lastChannelLoadErrorRef.current === error.message) {
      return;
    }

    lastChannelLoadErrorRef.current = error.message;
    emitWebObservabilityEvent({
      name: 'catalog.error',
      severity: 'error',
      metadata: {
        message: error.message,
      },
    });
  }, [error]);

  useEffect(() => {
    const numericInput = new NumericChannelInput<PlayerChannel>({
      items: () => channels,
      getNumber: (channel) => channel.number,
      onMatch: (match) => {
        const buffer = numericInput.getBuffer();
        setNumericZapBuffer(buffer.length > 0 ? buffer : null);
        setNumericZapMatchName(match?.item.name ?? null);
      },
      onSelect: (match) => {
        setNumericZapBuffer(null);
        setNumericZapMatchName(null);
        if (match) {
          switchToLiveChannel(match.item);
        }
      },
    });

    numericInputRef.current = numericInput;

    return () => {
      numericInput.destroy();
      numericInputRef.current = null;
      setNumericZapBuffer(null);
      setNumericZapMatchName(null);
    };
  }, [channels, switchToLiveChannel]);

  useEffect(() => {
    const debounceTimer = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 200);

    return () => window.clearTimeout(debounceTimer);
  }, [searchQuery]);

  // Load credentials on mount
  useEffect(() => {
    let isCancelled = false;

    const hydrateCredentials = async () => {
      const credentials = await loadXtreamCredentials();
      if (!credentials && !isCancelled) {
        navigate('/login');
        return;
      }

      if (!credentials || isCancelled) {
        return;
      }

      if (
        credentials.username === 'demo' ||
        credentials.server.includes('your-server.com')
      ) {
        setXtreamUserInfo(null);
        return;
      }

      try {
        xtreamCodesService.setCredentials(credentials);
        const authResponse = await xtreamCodesService.authenticate();
        if (!isCancelled) {
          setXtreamUserInfo(authResponse.user_info ?? null);
        }
      } catch {
        if (!isCancelled) {
          setXtreamUserInfo(null);
        }
      }
    };

    void hydrateCredentials();

    return () => {
      isCancelled = true;
    };
  }, [navigate]);

  useEffect(() => {
    let isCancelled = false;

    const hydrateSettings = async () => {
      try {
        const loadedSettings = await loadAppSettings();
        if (!isCancelled) {
          setAppSettings(loadedSettings);
        }
      } finally {
        if (!isCancelled) {
          setIsSettingsHydrated(true);
        }
      }
    };

    void hydrateSettings();

    return () => {
      isCancelled = true;
    };
  }, []);

  // Restore last watched live channel when possible, then fall back to first channel.
  useEffect(() => {
    if (startupLiveRestoreAppliedRef.current) {
      return;
    }

    if (!isSettingsHydrated) {
      return;
    }

    if (channels.length === 0) {
      return;
    }

    let isCancelled = false;
    const shouldSnapPersistedLiveSource = shouldSnapSessionRestoreToLiveEdge(session.source);

    const restoreStartupChannel = async () => {
      const lastWatchedChannelId = await loadLastWatchedChannelId();
      if (isCancelled) {
        return;
      }

      const shouldApplyStartupRestore = shouldSnapPersistedLiveSource || (!currentChannel && !session.source);
      if (!shouldApplyStartupRestore) {
        startupLiveRestoreAppliedRef.current = true;
        return;
      }

      const startupChannel = resolveStartupLiveChannel(
        channels,
        lastWatchedChannelId,
        shouldSnapPersistedLiveSource
          ? (currentChannel?.id ?? session.source?.channelId ?? null)
          : null
      );
      if (!startupChannel) {
        startupLiveRestoreAppliedRef.current = true;
        return;
      }

      switchToLiveChannel(startupChannel);
      startupLiveRestoreAppliedRef.current = true;
    };

    void restoreStartupChannel();

    return () => {
      isCancelled = true;
    };
  }, [channels, currentChannel, isSettingsHydrated, session.source, switchToLiveChannel]);

  const currentChannelId = currentChannel?.id;

  useEffect(() => {
    if (!currentChannelId) {
      return;
    }

    const now = Date.now();
    const previousChannelId = watchedChannelIdRef.current;
    const startedAt = watchedStartedAtRef.current;
    const watchedDuration = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;

    if (previousChannelId && previousChannelId !== currentChannelId) {
      void addWatchHistoryEntry({
        channelId: previousChannelId,
        timestamp: now,
        duration: watchedDuration,
        progress: watchedDuration,
      });
    }

    watchedChannelIdRef.current = currentChannelId;
    watchedStartedAtRef.current = now;
  }, [currentChannelId]);

  useEffect(() => {
    return () => {
      const channelId = watchedChannelIdRef.current;
      const startedAt = watchedStartedAtRef.current;
      if (!channelId || !startedAt) {
        return;
      }

      const now = Date.now();
      const watchedDuration = Math.max(0, Math.floor((now - startedAt) / 1000));
      void addWatchHistoryEntry({
        channelId,
        timestamp: now,
        duration: watchedDuration,
        progress: watchedDuration,
      });
    };
  }, []);

  // Filter channels
  const filteredChannels = filterChannels(channels, debouncedSearchQuery).filter(channel => {
    const matchesCategory = !selectedCategory || selectedCategory === 'favorites'
      ? true
      : channel.categoryId === selectedCategory;
    const matchesFavorites = selectedCategory === 'favorites'
      ? favorites.includes(channel.id)
      : true;

    return matchesCategory && matchesFavorites;
  });

  // Toggle fullscreen
  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;

    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  // Handle fullscreen change
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Navigate channels
  const goToNextChannel = useCallback(() => {
    if (!currentChannel || channels.length === 0) return;
    const currentIndex = channels.findIndex(c => c.id === currentChannel.id);
    const nextIndex = (currentIndex + 1) % channels.length;
    switchToLiveChannel(channels[nextIndex]);
  }, [currentChannel, channels, switchToLiveChannel]);

  const goToPrevChannel = useCallback(() => {
    if (!currentChannel || channels.length === 0) return;
    const currentIndex = channels.findIndex(c => c.id === currentChannel.id);
    const prevIndex = (currentIndex - 1 + channels.length) % channels.length;
    switchToLiveChannel(channels[prevIndex]);
  }, [currentChannel, channels, switchToLiveChannel]);

  const playCatchUpProgram = useCallback((program: PlayerChannel['epg'][number]) => {
    if (!currentChannelWithEPG) {
      return;
    }

    const startTimestamp = Math.floor(program.startTime.getTime() / 1000);
    const duration = Math.floor(
      (program.endTime.getTime() - program.startTime.getTime()) / 1000
    );
    const source = {
      url: xtreamCodesService.getCatchUpUrl(
        currentChannelWithEPG.streamId,
        startTimestamp,
        duration
      ),
      type: 'hls' as const,
      title: `${currentChannelWithEPG.name} - ${program.title}`,
      channelId: currentChannelWithEPG.id,
      metadata: {
        channelId: currentChannelWithEPG.id,
        streamId: currentChannelWithEPG.streamId,
        mode: 'catchup' as const,
        catchUpProgramId: program.id,
      },
    };

    commands.setSource(source, 0);
    commands.play();
  }, [commands, currentChannelWithEPG]);

  const goToPlayerHome = useCallback(() => {
    if (isOnDemandSource) {
      switchToLiveMode();
      return;
    }

    navigate('/player');
  }, [isOnDemandSource, navigate, switchToLiveMode]);

  const resumePlayback = useCallback(() => {
    if (!session.source) {
      livePauseStartedAtRef.current = null;
      return;
    }

    if (
      isLiveSourcePlayback &&
      shouldSnapToLiveOnResume(livePauseStartedAtRef.current, Date.now())
    ) {
      if (currentChannel) {
        switchToLiveChannel(currentChannel, { forceAutoplay: true });
        toast({
          title: 'Vraćeno na UŽIVO',
          description: 'Pauza je preduga, pa je reprodukcija vraćena na live ivicu.',
        });
      } else {
        playerRef.current?.pause();
        commands.stop();
        toast({
          title: 'Live kanal nije dostupan',
          description: 'Kanal više nije u listi. Izaberite drugi kanal za nastavak.',
        });
      }
      livePauseStartedAtRef.current = null;
      return;
    }

    playerRef.current?.play();
    commands.play();
    livePauseStartedAtRef.current = null;
  }, [
    commands,
    currentChannel,
    isLiveSourcePlayback,
    session.source,
    switchToLiveChannel,
    toast,
  ]);

  const togglePlayback = useCallback(() => {
    if (!session.source) {
      livePauseStartedAtRef.current = null;
      return;
    }

    if (session.playback === 'playing' || session.playback === 'buffering') {
      playerRef.current?.pause();
      commands.pause();
      if (isLiveSourcePlayback && session.source.url) {
        livePauseStartedAtRef.current = Date.now();
      }
      return;
    }

    resumePlayback();
  }, [commands, isLiveSourcePlayback, resumePlayback, session.playback, session.source]);

  const togglePictureInPicture = useCallback(() => {
    if (!session.source || !usesLocalRenderer || !isPictureInPictureSupported) {
      return;
    }

    void playerRef.current?.togglePictureInPicture();
  }, [isPictureInPictureSupported, session.source, usesLocalRenderer]);
  const canTogglePictureInPicture = Boolean(
    session.source && usesLocalRenderer && isPictureInPictureSupported
  );

  const openAirPlayPicker = useCallback(() => {
    if (!isAirPlaySupported) {
      return;
    }

    playerRef.current?.showAirPlayPicker();
  }, [isAirPlaySupported]);

  const seekBySeconds = useCallback(
    (deltaSeconds: number) => {
      if (!session.source) {
        return;
      }

      const currentPositionMs = session.positionMs ?? 0;
      const nextPositionMs = Math.max(0, currentPositionMs + deltaSeconds * 1000);
      commands.seek(nextPositionMs);
    },
    [commands, session.positionMs, session.source]
  );

  useEffect(() => {
    if (!session.source) {
      setIsPictureInPicture(false);
      setIsPictureInPictureSupported(false);
      setIsAirPlaySupported(false);
      setIsAirPlayAvailable(false);
      setIsAirPlayConnected(false);
      return;
    }

    const player = playerRef.current;
    if (!player) {
      setIsPictureInPicture(false);
      setIsPictureInPictureSupported(false);
      setIsAirPlaySupported(false);
      setIsAirPlayAvailable(false);
      setIsAirPlayConnected(false);
      return;
    }

    setIsPictureInPictureSupported(player.isPictureInPictureSupported());
    setIsPictureInPicture(player.isPictureInPicture());
    setIsAirPlaySupported(player.isAirPlaySupported());
    setIsAirPlayAvailable(player.isAirPlayAvailable());
    setIsAirPlayConnected(player.isAirPlayConnected());

    const unsubscribeAirPlayAvailability = player.onAirPlayAvailabilityChange((available) => {
      setIsAirPlaySupported(player.isAirPlaySupported());
      setIsAirPlayAvailable(available);
    });
    const unsubscribeAirPlayConnection = player.onAirPlayConnectionChange((connected) => {
      setIsAirPlaySupported(player.isAirPlaySupported());
      setIsAirPlayAvailable(player.isAirPlayAvailable());
      setIsAirPlayConnected(connected);
    });

    const unsubscribePictureInPicture = player.onPictureInPictureChange((inPictureInPicture) => {
      setIsPictureInPicture(inPictureInPicture);
      setIsPictureInPictureSupported(player.isPictureInPictureSupported());
    });

    return () => {
      unsubscribeAirPlayAvailability();
      unsubscribeAirPlayConnection();
      unsubscribePictureInPicture();
    };
  }, [session.source]);

  useEffect(() => {
    if (session.renderer === 'cast') {
      return;
    }

    if (isAirPlayConnected && session.renderer !== 'airplay') {
      commands.switchRenderer('airplay');
      return;
    }

    if (!isAirPlayConnected && session.renderer === 'airplay') {
      commands.switchRenderer('local-web');
    }
  }, [commands, isAirPlayConnected, session.renderer]);

  useEffect(() => {
    if (!castSender.error) {
      lastCastErrorRef.current = null;
      return;
    }

    if (castSender.error === lastCastErrorRef.current) {
      return;
    }

    lastCastErrorRef.current = castSender.error;
    toast({
      title: 'Google Cast error',
      description: castSender.error,
      variant: 'destructive',
    });
  }, [castSender.error, toast]);

  useEffect(() => {
    if (previousCastConnectedRef.current === castSender.isConnected) {
      return;
    }

    previousCastConnectedRef.current = castSender.isConnected;
    emitWebObservabilityEvent({
      name: castSender.isConnected ? 'cast.session.started' : 'cast.session.ended',
      severity: 'info',
      metadata: {
        deviceName: castSender.deviceName,
      },
    });
  }, [castSender.deviceName, castSender.isConnected]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) {
        return;
      }

      const keyCode = event.keyCode || event.which;
      const digit = getDigitFromWebKeyCode(keyCode);
      if (digit !== null) {
        event.preventDefault();
        numericInputRef.current?.addDigit(digit);
        return;
      }

      switch (keyCode) {
        case WebKeyCodes.up:
        case WebKeyCodes.right:
        case WebKeyCodes.forward:
        case WebKeyCodes.channelUp:
          event.preventDefault();
          goToNextChannel();
          return;
        case WebKeyCodes.down:
        case WebKeyCodes.left:
        case WebKeyCodes.backward:
        case WebKeyCodes.channelDown:
          event.preventDefault();
          goToPrevChannel();
          return;
        case WebKeyCodes.smartPlayPause:
          event.preventDefault();
          togglePlayback();
          return;
        case WebKeyCodes.play:
          event.preventDefault();
          togglePlayback();
          return;
        case WebKeyCodes.pause:
          event.preventDefault();
          if (session.playback === 'paused') {
            return;
          }
          playerRef.current?.pause();
          commands.pause();
          if (isLiveSourcePlayback && session.source?.url) {
            livePauseStartedAtRef.current = Date.now();
          }
          return;
        case WebKeyCodes.enter:
          event.preventDefault();
          toggleFullscreen();
          return;
        case WebKeyCodes.blue:
        case PICTURE_IN_PICTURE_KEY_CODE:
          if (!canTogglePictureInPicture) {
            return;
          }
          event.preventDefault();
          togglePictureInPicture();
          return;
        case WebKeyCodes.back:
        case WebKeyCodes.esc:
        case WebKeyCodes.exit:
          if (isFullscreen) {
            event.preventDefault();
            toggleFullscreen();
          }
          return;
        default:
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    commands,
    goToNextChannel,
    goToPrevChannel,
    isFullscreen,
    canTogglePictureInPicture,
    isLiveSourcePlayback,
    resumePlayback,
    session.source,
    session.playback,
    togglePictureInPicture,
    toggleFullscreen,
    togglePlayback,
  ]);

  // Handle logout
  const handleLogout = () => {
    void clearXtreamCredentials().finally(() => {
      navigate('/login');
    });
  };

  const currentProgram = currentChannelWithEPG ? getCurrentProgram(currentChannelWithEPG as any) : undefined;
  const progress = currentProgram ? getProgramProgress(currentProgram) : 0;
  const upcomingPrograms = useMemo(
    () => {
      if (!currentChannelWithEPG) {
        return [];
      }

      const now = new Date();
      return currentChannelWithEPG.epg
        .filter((program) => program.startTime > now)
        .slice(0, 6);
    },
    [currentChannelWithEPG]
  );
  const catchUpProgramsByDate = useMemo(
    () => groupCatchUpProgramsByDate(currentChannelWithEPG?.epg ?? []),
    [currentChannelWithEPG?.epg]
  );
  const catchUpProgramDays = useMemo(
    () => Array.from(catchUpProgramsByDate.keys()).sort((a, b) => new Date(b).getTime() - new Date(a).getTime()),
    [catchUpProgramsByDate]
  );
  const shouldShowTvUnazadSection = useMemo(
    () => shouldShowLiveCatchUpSection(currentChannelWithEPG, catchUpProgramDays.length),
    [catchUpProgramDays.length, currentChannelWithEPG]
  );
  const hasTvUnazadEntries = useMemo(
    () => hasLiveCatchUpEntries(catchUpProgramDays.length),
    [catchUpProgramDays.length]
  );
  const triggerTvUnazadDiscoverability = useCallback(() => {
    const actionTarget = resolveCatchUpClockActionTarget(
      Boolean(tvUnazadSectionRef.current) && shouldShowTvUnazadSection
    );
    if (actionTarget === 'open-epg') {
      navigate('/epg');
      return;
    }

    tvUnazadSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setIsTvUnazadHighlighted(true);
    if (tvUnazadHighlightTimeoutRef.current) {
      clearTimeout(tvUnazadHighlightTimeoutRef.current);
    }
    tvUnazadHighlightTimeoutRef.current = setTimeout(() => {
      setIsTvUnazadHighlighted(false);
      tvUnazadHighlightTimeoutRef.current = null;
    }, 1800);
  }, [navigate, shouldShowTvUnazadSection]);
  useEffect(() => () => {
    if (tvUnazadHighlightTimeoutRef.current) {
      clearTimeout(tvUnazadHighlightTimeoutRef.current);
    }
  }, []);
  const tvUnazadEmptyStateReason = useMemo(() => {
    if (!currentChannelWithEPG) {
      return null;
    }

    return resolveCatchUpEmptyStateReason(currentChannelWithEPG);
  }, [currentChannelWithEPG]);
  const activeCatchUpProgramId = sessionSourceMetadata.mode === 'catchup'
    ? sessionSourceMetadata.catchUpProgramId
    : undefined;
  const desktopCategoryItems = useMemo(
    () => [
      {
        id: null as string | null,
        label: 'Svi kanali',
        icon: Tv2,
        count: channels.length,
      },
      {
        id: 'favorites',
        label: 'Omiljeni',
        icon: Star,
        count: favorites.length,
      },
      ...categories.map((category) => ({
        id: category.id,
        label: category.name,
        icon: Tv2,
        count: channels.filter((channel) => channel.categoryId === category.id).length,
      })),
    ],
    [categories, channels, favorites.length]
  );
  const xtreamSubscriptionLabel = xtreamUserInfo
    ? `${xtreamUserInfo.active_cons}/${xtreamUserInfo.max_connections}`
    : null;
  const xtreamExpLabel = xtreamUserInfo ? formatXtreamExpDate(xtreamUserInfo.exp_date) : null;
  const onDemandTitle = onDemandContext?.title ?? 'VOD Playback';
  const onDemandBackPath = onDemandContext?.backPath ?? '/vod';
  const onDemandBackLabel = onDemandContext?.backLabel ?? 'Back to VOD';
  const pageTitle = isOnDemandSource
    ? `${session.source?.title ?? onDemandTitle} - IPTV Player`
    : currentChannel
      ? `${currentChannel.name} - IPTV Player`
      : 'IPTV Player';

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <PlayerSurfaceState
          icon={Loader2}
          title="Učitavanje kanala"
          description="Pripremamo katalog uživo i obnavljamo player okruženje."
          actions={(
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          )}
        />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <PlayerSurfaceState
          icon={AlertCircle}
          title="Neuspešno učitavanje kanala"
          description={error.message}
          actions={(
            <>
              <Button
                variant="outline"
                onClick={() => {
                  void refetchChannels();
                }}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Pokušaj ponovo
              </Button>
              <Button onClick={() => navigate('/login')}>Nazad na prijavu</Button>
            </>
          )}
        />
      </div>
    );
  }

  return (
    <>
      <Helmet>
        <title>{pageTitle}</title>
      </Helmet>

      <div className="flex flex-1 min-h-0 bg-background lg:h-full lg:overflow-hidden">
        {/* Sidebar for desktop */}
        {!isOnDemandSource ? (
          <div className="hidden min-h-0 lg:flex lg:h-full">
            <aside className="flex h-full w-[180px] flex-col border-r border-border bg-card/50">
              <div className="p-4 flex justify-center border-b border-border">
                <button
                  type="button"
                  className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center hover:scale-105 transition-transform"
                  onClick={goToPlayerHome}
                  aria-label="Player"
                >
                  <Play className="w-5 h-5 text-primary-foreground fill-current" />
                </button>
              </div>

              <ScrollArea className="flex-1">
                <div className="py-4 flex flex-col items-center gap-1">
                  {desktopCategoryItems.map((item) => {
                    const isActive = selectedCategory === item.id;
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id ?? 'all'}
                        type="button"
                        onClick={() => setSelectedCategory(item.id)}
                        className={`relative w-[160px] h-12 rounded-xl flex items-center justify-start gap-2 px-3 transition-all ${
                          isActive
                            ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/25'
                            : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                        }`}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="text-xs font-medium truncate flex-1 text-left">{item.label}</span>
                        {item.count > 0 && (
                          <span className={`min-w-[22px] h-[22px] rounded-full text-[11px] font-medium flex items-center justify-center px-1.5 ${
                            isActive ? 'bg-background text-foreground' : 'bg-primary/20 text-primary'
                          }`}>
                            {item.count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>

              <div className="p-2 border-t border-border/50">
                <div className="mb-1 px-2">
                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-semibold">
                    VOD
                  </span>
                </div>
                <div className="flex flex-col items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => navigate('/vod')}
                    className="starlight-border starlight-border-amber w-[160px] h-10 rounded-xl flex items-center justify-start gap-2 px-3 transition-all bg-gradient-to-br from-amber-500/20 to-yellow-600/20 border border-amber-500/30 text-amber-400 hover:from-amber-500/30 hover:to-yellow-600/30 hover:border-amber-500/50 hover:scale-105"
                  >
                    <Film className="w-4 h-4 shrink-0" />
                    <span className="text-xs font-semibold">Filmovi</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('/series')}
                    className="starlight-border starlight-border-purple w-[160px] h-10 rounded-xl flex items-center justify-start gap-2 px-3 transition-all bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-purple-500/30 text-purple-400 hover:from-purple-500/30 hover:to-pink-500/30 hover:border-purple-500/50 hover:scale-105"
                  >
                    <Clapperboard className="w-4 h-4 shrink-0" />
                    <span className="text-xs font-semibold">Serije</span>
                  </button>
                </div>
              </div>

              {xtreamUserInfo && (
                <div className="p-2 border-t border-border">
                  <div className="bg-secondary/50 rounded-xl p-2 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <User className="w-3 h-3" />
                      <span className="truncate">{xtreamUserInfo.username}</span>
                    </div>
                    {xtreamSubscriptionLabel && (
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <Wifi className="w-3 h-3" />
                        <span>{xtreamSubscriptionLabel}</span>
                      </div>
                    )}
                    {xtreamExpLabel && (
                      <div className="flex items-center gap-1.5 text-[10px]">
                        <Calendar className="w-3 h-3 text-primary" />
                        <span className="text-primary font-medium">{xtreamExpLabel}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="p-4 border-t border-border flex flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={goToPlayerHome}
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-all"
                  title="Početna"
                >
                  <Home className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => setShowLogoutDialog(true)}
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all"
                  title="Logout"
                >
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            </aside>

            <aside className="w-72 xl:w-80 2xl:w-96 bg-card border-r border-border flex flex-col overflow-hidden shrink-0">
              <div className="p-4 border-b border-border">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-bold text-lg text-foreground">
                    Lumen <span className="text-primary">Player</span>
                  </span>
                  <div className="flex items-center gap-1">
                    {isAirPlaySupported && session.renderer !== 'cast' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={!isAirPlayAvailable}
                        onClick={openAirPlayPicker}
                        title={isAirPlayConnected ? 'AirPlay connected' : 'Open AirPlay picker'}
                      >
                        <Airplay className={`w-4 h-4 ${isAirPlayConnected ? 'text-primary' : ''}`} />
                      </Button>
                    )}
                  </div>
                </div>

                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Pretraži kanale..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 bg-secondary/50 border-border rounded-xl"
                  />
                </div>
              </div>

              <ChannelList
                className="flex-1"
                channels={filteredChannels}
                currentChannelId={currentChannel?.id}
                variant="desktop"
                onSelectChannel={switchToLiveChannel}
                isFavorite={isFavorite}
                onToggleFavorite={toggleFavorite}
              />
            </aside>
          </div>
        ) : (
          <aside className="hidden lg:flex w-80 flex-col border-r border-border bg-card">
            <div className="p-4 border-b border-border">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h1 className="text-xl font-bold">{onDemandTitle}</h1>
                <div className="flex items-center gap-1">
                  {isAirPlaySupported && session.renderer !== 'cast' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={!isAirPlayAvailable}
                      onClick={openAirPlayPicker}
                      title={isAirPlayConnected ? 'AirPlay connected' : 'Open AirPlay picker'}
                    >
                      <Airplay className={`w-4 h-4 ${isAirPlayConnected ? 'text-primary' : ''}`} />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowLogoutDialog(true)}
                  >
                    <LogOut className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <p className="line-clamp-2 text-sm text-muted-foreground">
                {session.source?.title || 'On-demand playback'}
              </p>
            </div>

            <div className="space-y-2 p-4">
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Browse
                </p>
                <MediaEntryGrid onSelect={(path) => navigate(path)} />
              </div>
              <Button className="w-full justify-start" onClick={() => navigate(onDemandBackPath)}>
                {onDemandBackLabel}
              </Button>
            </div>
          </aside>
        )}

        {/* Main content */}
        <main className="flex flex-1 min-h-0 flex-col">
          {!isOnDemandSource && (
            <header className="lg:hidden flex items-center justify-between p-3 bg-card border-b border-border">
              <button
                type="button"
                onClick={goToPlayerHome}
                className="flex items-center gap-2"
              >
                <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
                  <Play className="w-3 h-3 text-primary-foreground fill-current" />
                </div>
                <span className="font-bold text-sm text-foreground">
                  Lumen <span className="text-primary">Player</span>
                </span>
              </button>

              {xtreamUserInfo && (
                <div className="flex items-center gap-2 px-2 py-1 bg-secondary/50 rounded-lg">
                  {xtreamSubscriptionLabel && (
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Wifi className="w-3 h-3" />
                      <span>{xtreamSubscriptionLabel}</span>
                    </div>
                  )}
                  {xtreamSubscriptionLabel && xtreamExpLabel && (
                    <div className="w-px h-3 bg-border" />
                  )}
                  {xtreamExpLabel && (
                    <div className="flex items-center gap-1 text-[10px] text-primary">
                      <Calendar className="w-3 h-3" />
                      <span className="font-medium">{xtreamExpLabel}</span>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={goToPlayerHome}
                >
                  <Home className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => setShowLogoutDialog(true)}
                >
                  <LogOut className="w-4 h-4" />
                </Button>
              </div>
            </header>
          )}

          {/* Player area */}
          <div
            ref={containerRef}
            className={`relative bg-black ${isFullscreen ? 'fixed inset-0 z-50' : 'aspect-video'}`}
          >
            {numericZapBuffer && (
              <div className="absolute top-4 right-4 z-[60] rounded-lg bg-black/80 border border-primary/40 px-3 py-2 text-sm">
                <div className="font-semibold tracking-[0.2em] tabular-nums">{numericZapBuffer}</div>
                {numericZapMatchName ? (
                  <div className="text-xs text-muted-foreground mt-1 truncate max-w-44">
                    {numericZapMatchName}
                  </div>
                ) : (
                  <div className="text-xs text-destructive mt-1">Nema kanala</div>
                )}
              </div>
            )}

            {session.source && usesLocalRenderer && (
              <VideoPlayer
                ref={playerRef}
                autoPlay={shouldAutoplayCurrentSource}
                preferNativeHls={appSettings.player.preferNativeHls}
              />
            )}

            {session.source && session.renderer === 'cast' && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70">
                <div className="rounded-xl border border-border/60 bg-background/90 px-5 py-4 text-center shadow-2xl backdrop-blur-sm">
                  <p className="mb-1 flex items-center justify-center gap-2 text-sm font-semibold text-primary">
                    <Cast className="h-4 w-4" />
                    Casting Active
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {castSender.deviceName ? `Playing on ${castSender.deviceName}` : 'Playing on Cast device'}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={castSender.stopCasting}
                  >
                    Stop Casting
                  </Button>
                </div>
              </div>
            )}

            {session.source && session.renderer === 'cast' && (
              <div className="absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/90 via-black/65 to-transparent p-4 sm:p-6">
                <div className="mx-auto flex max-w-screen-xl flex-col gap-3 rounded-xl border border-border/60 bg-background/75 p-4 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-primary">
                      <Smartphone className="h-4 w-4" />
                      Phone as remote
                    </p>
                    <h2 className="truncate text-lg font-semibold text-foreground sm:text-xl">
                      {session.source.title || currentChannel?.name || 'Remote playback'}
                    </h2>
                    <p className="text-xs text-muted-foreground sm:text-sm">
                      {castSender.deviceName
                        ? `Controlling ${castSender.deviceName}`
                        : 'Controlling Cast device'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {!isOnDemandSource && (
                      <>
                        <Button variant="outline" onClick={goToPrevChannel}>
                          <SkipBack className="mr-2 h-4 w-4" />
                          Prev channel
                        </Button>
                        <Button variant="outline" onClick={goToNextChannel}>
                          <SkipForward className="mr-2 h-4 w-4" />
                          Next channel
                        </Button>
                      </>
                    )}
                    {isOnDemandSource && (
                      <>
                        <Button variant="outline" onClick={() => seekBySeconds(-15)}>
                          <SkipBack className="mr-2 h-4 w-4" />
                          -15s
                        </Button>
                        <Button variant="outline" onClick={() => seekBySeconds(15)}>
                          <SkipForward className="mr-2 h-4 w-4" />
                          +15s
                        </Button>
                      </>
                    )}
                    <Button variant="secondary" onClick={togglePlayback}>
                      {session.playback === 'playing' || session.playback === 'buffering' ? (
                        <Pause className="mr-2 h-4 w-4" />
                      ) : (
                        <Play className="mr-2 h-4 w-4" />
                      )}
                      {session.playback === 'playing' || session.playback === 'buffering' ? 'Pause' : 'Play'}
                    </Button>
                    <Button variant="outline" onClick={castSender.stopCasting}>
                      <Cast className="mr-2 h-4 w-4" />
                      Switch to this device
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {currentChannelWithEPG && !isOnDemandSource && usesLocalRenderer && (
              <>
                <PlayerControls
                  channel={currentChannelWithEPG}
                  currentProgram={currentProgram}
                  progress={progress}
                  isFavorite={isFavorite(currentChannelWithEPG.id)}
                  isFullscreen={isFullscreen}
                  onToggleFavorite={() => toggleFavorite(currentChannelWithEPG.id)}
                  onToggleFullscreen={toggleFullscreen}
                  onPrevChannel={goToPrevChannel}
                  onNextChannel={goToNextChannel}
                  onCatchUpDiscoverabilityAction={triggerTvUnazadDiscoverability}
                  playerRef={playerRef}
                  defaultVolume={appSettings.player.defaultVolume}
                  castControl={{
                    isAvailable: castSender.isAvailable,
                    isConnected: castSender.isConnected,
                    isConnecting: castSender.isConnecting,
                    onToggle: () => {
                      void castSender.toggleCasting();
                    },
                  }}
                />
              </>
            )}

            {isOnDemandSource && session.source && usesLocalRenderer && (
              <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-4 sm:p-6">
                <div className="mx-auto flex max-w-screen-xl flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-primary">
                      <Film className="h-4 w-4" />
                      {onDemandTitle}
                    </p>
                    <h2 className="truncate text-lg font-semibold text-foreground sm:text-xl">
                      {session.source.title || 'On-demand playback'}
                    </h2>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      onClick={togglePlayback}
                    >
                      {session.playback === 'playing' || session.playback === 'buffering' ? (
                        <Pause className="mr-2 h-4 w-4" />
                      ) : (
                        <Play className="mr-2 h-4 w-4" />
                      )}
                      {session.playback === 'playing' || session.playback === 'buffering' ? 'Pause' : 'Play'}
                    </Button>
                    {isPictureInPictureSupported && (
                      <Button
                        variant="outline"
                        onClick={togglePictureInPicture}
                        title="Picture in Picture (P / Blue key)"
                      >
                        <PictureInPicture2 className="mr-2 h-4 w-4" />
                        {isPictureInPicture ? 'Exit PiP' : 'PiP'}
                      </Button>
                    )}
                    {castSender.isAvailable && (
                      <Button
                        variant={castSender.isConnected ? 'secondary' : 'outline'}
                        onClick={() => {
                          void castSender.toggleCasting();
                        }}
                        disabled={castSender.isConnecting}
                      >
                        <Cast className="mr-2 h-4 w-4" />
                        {castSender.isConnected ? 'Prekini cast' : 'Poveži cast'}
                      </Button>
                    )}
                    {isAirPlaySupported && session.renderer !== 'cast' && (
                      <Button
                        variant={isAirPlayConnected ? 'secondary' : 'outline'}
                        onClick={openAirPlayPicker}
                        disabled={!isAirPlayAvailable}
                      >
                        <Airplay className="mr-2 h-4 w-4" />
                        {isAirPlayConnected ? 'AirPlay Active' : 'AirPlay'}
                      </Button>
                    )}
                    <Button variant="outline" onClick={() => navigate(onDemandBackPath)}>
                      {onDemandBackLabel}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {!currentChannel && !session.source && (
              <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
                <PlayerSurfaceState
                  icon={Tv2}
                  title="Nema aktivnog kanala"
                  description="Izaberite kanal za početak reprodukcije ili pokrenite prvi dostupan stream."
                  actions={(
                    <>
                      <Button
                        onClick={() => {
                          if (filteredChannels.length === 0) {
                            return;
                          }
                          switchToLiveChannel(filteredChannels[0]);
                        }}
                        disabled={filteredChannels.length === 0}
                      >
                        Pokreni prvi kanal
                      </Button>
                    </>
                  )}
                />
              </div>
            )}
          </div>

          {!isOnDemandSource && (
            <div className="hidden lg:flex flex-1 flex-col bg-card/50 border-t border-border overflow-hidden">
              <div className="flex-1 min-h-0 overflow-y-auto player-scrollbar p-6 space-y-6">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="w-4 h-4 text-primary" />
                    <span className="text-sm font-medium text-muted-foreground">Sada na programu</span>
                  </div>
                  {currentProgram ? (
                    <div className="w-full text-left bg-primary/10 border border-primary/30 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-2 gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="badge-live">UŽIVO</span>
                          <h4 className="font-semibold text-foreground text-lg truncate">{currentProgram.title}</h4>
                        </div>
                        <span className="text-sm text-muted-foreground whitespace-nowrap">
                          {formatTime(currentProgram.startTime)} - {formatTime(currentProgram.endTime)}
                        </span>
                      </div>
                      <div className="h-2 bg-secondary/50 rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progress}%` }} />
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Nema aktivnog programa.</p>
                  )}
                </div>

                {upcomingPrograms.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-medium text-foreground">Sledi na programu</span>
                    </div>
                    <div className="space-y-1.5">
                      {upcomingPrograms.slice(0, 2).map((program) => (
                        <div
                          key={program.id}
                          className="flex items-center gap-4 p-3 rounded-xl bg-secondary/30 hover:bg-secondary/50 transition-all"
                        >
                          <span className="text-sm text-muted-foreground w-16 shrink-0 tabular-nums">
                            {formatTime(program.startTime)}
                          </span>
                          <span className="flex-1 font-medium text-foreground truncate">{program.title}</span>
                          <span className="text-xs text-muted-foreground">
                            {formatTime(program.endTime)}
                          </span>
                        </div>
                      ))}
                      {upcomingPrograms.length > 2 && (
                        <Collapsible>
                          <CollapsibleTrigger className="w-full flex items-center justify-center gap-2 p-2 rounded-xl bg-secondary/20 hover:bg-secondary/40 transition-all group">
                            <span className="text-xs text-muted-foreground">
                              Još {upcomingPrograms.length - 2} emisija
                            </span>
                            <ChevronDown className="w-3 h-3 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                          </CollapsibleTrigger>
                          <CollapsibleContent className="space-y-1.5 mt-1.5">
                            {upcomingPrograms.slice(2).map((program) => (
                              <div
                                key={program.id}
                                className="flex items-center gap-4 p-3 rounded-xl bg-secondary/30 hover:bg-secondary/50 transition-all"
                              >
                                <span className="text-sm text-muted-foreground w-16 shrink-0 tabular-nums">
                                  {formatTime(program.startTime)}
                                </span>
                                <span className="flex-1 font-medium text-foreground truncate">{program.title}</span>
                                <span className="text-xs text-muted-foreground">
                                  {formatTime(program.endTime)}
                                </span>
                              </div>
                            ))}
                          </CollapsibleContent>
                        </Collapsible>
                      )}
                    </div>
                  </div>
                )}

                {shouldShowTvUnazadSection && (
                  <div
                    ref={tvUnazadSectionRef}
                    className={`rounded-xl transition-colors duration-300 ${isTvUnazadHighlighted ? 'bg-emerald-500/10' : ''}`}
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
                        <Play className="w-3 h-3 text-emerald-500" />
                      </div>
                      <span className="text-sm font-medium bg-gradient-to-r from-emerald-400 via-primary to-emerald-400 bg-[length:200%_100%] animate-shimmer bg-clip-text text-transparent">
                        TV Unazad
                      </span>
                      <span className="text-xs text-muted-foreground">(klikni za gledanje)</span>
                    </div>
                    <div className="space-y-2">
                      {hasTvUnazadEntries ? (() => {
                        const todayKey = new Date().toDateString();
                        const todayPrograms = catchUpProgramsByDate.get(todayKey) ?? [];
                        const pastDayKeys = catchUpProgramDays.filter((dayKey) => dayKey !== todayKey);

                        return (
                          <>
                            {todayPrograms.length > 0 && (
                              <div className="space-y-1.5">
                                <div className="flex items-center gap-2 px-2 py-1">
                                  <Calendar className="w-4 h-4 text-primary" />
                                  <span className="text-sm font-semibold text-primary">Danas</span>
                                </div>
                                {todayPrograms.map((program) => {
                                  const isActiveCatchUp = activeCatchUpProgramId === program.id;

                                  return (
                                    <button
                                      key={program.id}
                                      type="button"
                                      onClick={() => playCatchUpProgram(program)}
                                      className={`w-full flex items-center gap-4 p-3 rounded-xl transition-all group text-left ${
                                        isActiveCatchUp
                                          ? 'bg-emerald-500/20 border-2 border-emerald-500/50'
                                          : 'bg-emerald-500/5 hover:bg-emerald-500/15 border border-emerald-500/20'
                                      }`}
                                    >
                                      <span className="text-sm text-muted-foreground w-16 shrink-0 tabular-nums">
                                        {formatTime(program.startTime)}
                                      </span>
                                      <span className="flex-1 font-medium text-foreground truncate">{program.title}</span>
                                      <div className="flex items-center gap-2">
                                        {isActiveCatchUp ? (
                                          <span className="text-[10px] font-semibold text-primary bg-primary/20 px-2 py-1 rounded-full">
                                            PUŠTENO
                                          </span>
                                        ) : (
                                          <span className="text-[10px] font-semibold text-emerald-500 bg-emerald-500/20 px-2 py-1 rounded-full">
                                            CATCH-UP
                                          </span>
                                        )}
                                        <Play className="w-4 h-4 text-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            )}

                            {pastDayKeys.map((dayKey) => {
                              const programs = catchUpProgramsByDate.get(dayKey) ?? [];

                              return (
                                <Collapsible key={dayKey}>
                                  <CollapsibleTrigger className="w-full flex items-center justify-between p-3 rounded-xl bg-secondary/30 hover:bg-secondary/50 transition-all group">
                                    <div className="flex items-center gap-3">
                                      <Calendar className="w-4 h-4 text-muted-foreground" />
                                      <span className="font-medium text-foreground">
                                        {formatCatchUpDateLabel(new Date(dayKey))}
                                      </span>
                                      <span className="text-xs text-muted-foreground">({programs.length} emisija)</span>
                                    </div>
                                    <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                                  </CollapsibleTrigger>
                                  <CollapsibleContent className="space-y-1.5 mt-1.5 pl-2">
                                    {programs.map((program) => {
                                      const isActiveCatchUp = activeCatchUpProgramId === program.id;

                                      return (
                                        <button
                                          key={program.id}
                                          type="button"
                                          onClick={() => playCatchUpProgram(program)}
                                          className={`w-full flex items-center gap-4 p-3 rounded-xl transition-all group text-left ${
                                            isActiveCatchUp
                                              ? 'bg-emerald-500/20 border-2 border-emerald-500/50'
                                              : 'bg-emerald-500/5 hover:bg-emerald-500/15 border border-emerald-500/20'
                                          }`}
                                        >
                                          <span className="text-sm text-muted-foreground w-16 shrink-0 tabular-nums">
                                            {formatTime(program.startTime)}
                                          </span>
                                          <span className="flex-1 font-medium text-foreground truncate">{program.title}</span>
                                          <div className="flex items-center gap-2">
                                            {isActiveCatchUp ? (
                                              <span className="text-[10px] font-semibold text-primary bg-primary/20 px-2 py-1 rounded-full">
                                                PUŠTENO
                                              </span>
                                            ) : (
                                              <span className="text-[10px] font-semibold text-emerald-500 bg-emerald-500/20 px-2 py-1 rounded-full">
                                                CATCH-UP
                                              </span>
                                            )}
                                            <Play className="w-4 h-4 text-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                                          </div>
                                        </button>
                                      );
                                    })}
                                  </CollapsibleContent>
                                </Collapsible>
                              );
                            })}
                          </>
                        );
                      })() : (
                        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-4">
                          <div className="flex items-start gap-3">
                            <Clock className="mt-0.5 h-4 w-4 text-emerald-400" />
                            <div>
                              <p className="text-sm font-medium text-foreground">
                                {tvUnazadEmptyStateReason?.title ?? 'TV Unazad trenutno nema stavki'}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {tvUnazadEmptyStateReason?.description ?? 'Pokušajte ponovo za nekoliko minuta.'}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              {hasTvUnazadEntries && (
                <button
                  type="button"
                  className="flex-shrink-0 w-full p-3 bg-gradient-to-t from-card via-card to-transparent border-t border-border/50 hover:bg-secondary/30 transition-colors cursor-pointer"
                  onClick={triggerTvUnazadDiscoverability}
                >
                  <div className="flex items-center justify-center gap-2">
                    <ChevronDown className="w-4 h-4 animate-bounce text-muted-foreground" />
                    <span className="text-xs bg-gradient-to-r from-muted-foreground via-foreground to-muted-foreground bg-[length:200%_100%] animate-shimmer bg-clip-text text-transparent">
                      Skroluj za TV Unazad
                    </span>
                  </div>
                </button>
              )}
            </div>
          )}

          {/* Mobile channel selector */}
          {!isOnDemandSource ? (
            <div className="lg:hidden flex flex-1 min-h-0 flex-col border-t border-border bg-card">
              <div className="sticky top-0 z-10 bg-card border-b border-border">
                <div className="p-2">
                  <div className="grid grid-cols-3 gap-2">
                    <Button
                      variant="outline"
                      className="justify-start h-10 border-emerald-500/35 bg-emerald-500/12 text-emerald-400 hover:bg-emerald-500/20"
                      onClick={() => navigate('/epg')}
                    >
                      <Play className="mr-2 h-4 w-4" />
                      TV Unazad
                    </Button>
                    <Button
                      variant="outline"
                      className="justify-start h-10 border-amber-500/35 bg-amber-500/12 text-amber-400 hover:bg-amber-500/20"
                      onClick={() => navigate('/vod')}
                    >
                      <Film className="mr-2 h-4 w-4" />
                      Filmovi
                    </Button>
                    <Button
                      variant="outline"
                      className="justify-start h-10 border-purple-500/35 bg-purple-500/12 text-purple-400 hover:bg-purple-500/20"
                      onClick={() => navigate('/series')}
                    >
                      <Clapperboard className="mr-2 h-4 w-4" />
                      Serije
                    </Button>
                  </div>
                </div>

                <div className="relative p-2 border-t border-border">
                  <div className="flex gap-1 overflow-x-auto pb-1">
                    <Button
                      variant={selectedCategory === null ? 'default' : 'secondary'}
                      size="sm"
                      className="shrink-0"
                      onClick={() => setSelectedCategory(null)}
                    >
                      <Tv2 className="mr-1 h-4 w-4" />
                      Svi kanali
                    </Button>
                    <Button
                      variant={selectedCategory === 'favorites' ? 'default' : 'secondary'}
                      size="sm"
                      className="shrink-0"
                      onClick={() => setSelectedCategory('favorites')}
                    >
                      <Star className="mr-1 h-4 w-4" />
                      Omiljeni
                    </Button>
                    {categories.map((category) => (
                      <Button
                        key={category.id}
                        variant={selectedCategory === category.id ? 'default' : 'secondary'}
                        size="sm"
                        className="shrink-0"
                        onClick={() => setSelectedCategory(category.id)}
                      >
                        {category.name}
                      </Button>
                    ))}
                  </div>
                  <div className="pointer-events-none absolute inset-y-2 right-0 w-8 bg-gradient-to-l from-card to-transparent" />
                </div>

                <div className="p-2 border-t border-border">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Pretraži kanale..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9 bg-secondary border-border rounded-lg"
                    />
                  </div>
                </div>

                <div className="p-2 pt-0 space-y-2">
                  {isAirPlaySupported && session.renderer !== 'cast' && (
                    <Button
                      variant={isAirPlayConnected ? 'default' : 'outline'}
                      size="sm"
                      className="w-full"
                      disabled={!isAirPlayAvailable}
                      onClick={openAirPlayPicker}
                    >
                      <Airplay className="mr-2 h-4 w-4" />
                      {isAirPlayConnected ? 'AirPlay aktivan' : 'Poveži AirPlay'}
                    </Button>
                  )}
                </div>
              </div>

              <ChannelList
                className="flex-1 min-h-0 px-2 pb-3 pt-2"
                channels={filteredChannels}
                currentChannelId={currentChannel?.id}
                variant="mobile"
                onSelectChannel={switchToLiveChannel}
                isFavorite={isFavorite}
                onToggleFavorite={toggleFavorite}
              />
            </div>
          ) : (
            <div className="lg:hidden border-t border-border p-4">
              <p className="mb-3 text-sm font-medium text-foreground">{onDemandTitle}</p>
              <div className="space-y-2">
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Browse
                  </p>
                  <MediaEntryGrid onSelect={(path) => navigate(path)} />
                </div>
                <Button className="w-full" onClick={() => navigate(onDemandBackPath)}>
                  {onDemandBackLabel}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => setShowLogoutDialog(true)}
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  Logout
                </Button>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Logout confirmation dialog */}
      <AlertDialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Logout</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to logout? You will need to enter your credentials again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleLogout}>Logout</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default Player;
