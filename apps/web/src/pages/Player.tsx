import { useState, useRef, useEffect, useCallback, useMemo, type ChangeEvent, type ReactNode } from 'react';
import { getBrandWordmark, BRAND_NAME } from '@/config/brand';
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
  ChevronsDown,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUp,
  Home,
  Play,
  Pause,
  Maximize,
  Minimize,
  PictureInPicture2,
  Cast,
  Airplay,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
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
import { filterChannels, formatDuration, formatTime, getCurrentProgram, getProgramProgress } from '@lumen/core';
import type { SessionSource } from '@lumen/session-core';
import type { PlayerChannel, XtreamUserInfo } from '@lumen/types';
import {
  loadXtreamCredentials,
  clearXtreamCredentials,
  saveXtreamCredentials,
} from '@/services/xtreamCredentials';
import {
  getDefaultAppSettings,
  loadAppSettings,
  type AppSettings,
} from '@/services/appSettings';
import {
  loadPlayerLayoutPreferences,
  savePlayerLayoutPreferences,
  type PlayerLayoutPreferences,
} from '@/services/playerLayoutPreferences';
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
import {
  findCatchUpProgramById,
  findNextCatchUpProgram,
} from '@/components/player/catchupProgramNavigation';
import {
  buildCatchUpPrefetchKey,
  CATCH_UP_PREFETCH_LOOKAHEAD_MS,
  isCatchUpPrefetchFresh,
  isCatchUpPrefetchRetryDue,
  shouldPrefetchNextCatchUpProgram,
} from '@/components/player/catchupPrefetch';
import { hasLiveCatchUpEntries, shouldShowLiveCatchUpSection } from '@/pages/liveCatchUpVisibility';
import { resolveCatchUpClockActionTarget } from '@/pages/liveCatchUpDiscoverability';
import { resolveXtreamCanonicalServer } from '@/config/xtream';
import { buildPlaybackProblemReportMetadata } from '@/pages/playbackProblemReport';
import {
  resolveCatchUpPlaybackSource,
  type CatchUpPlaybackSourceResult,
} from '@/components/player/catchupSource';
import {
  shouldRetryCatchUpBufferingStall,
  shouldRetryLiveStartupWithoutFrame,
} from '@/components/player/videoPlaybackSync';
import {
  buildCatchUpSessionSourceFromMetadata,
  buildLiveSessionSource,
  isCatchUpSessionSourceMetadata,
  parseSessionSourceMetadata,
} from '@/components/player/sessionSources';
import { normalizeRestoredSessionSource } from '@/pages/restoreSessionSource';

const brandWordmark = getBrandWordmark();

const SHADOW_VALIDATION_ENABLED = import.meta.env.VITE_CATCHUP_SHADOW_VALIDATION === '1';

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

const CATCH_UP_STALL_RECOVERY_DELAY_MS = 6_000;
const CATCH_UP_STALL_RECOVERY_BUCKET_MS = 5_000;
const LIVE_STARTUP_RETRY_DELAY_MS = 3_000;

const withStartupRetryHash = (url: string): string => {
  const [baseUrl] = url.split('#', 1);
  return `${baseUrl}#__lumenStartupRetry=${Date.now()}`;
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

  return date.toLocaleDateString('sr-Latn-RS', { weekday: 'long', day: 'numeric', month: 'long' });
};

const normalizeCatchUpVariantBaseName = (channelName: string): string => (
  channelName
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(ultra\s*hd|full\s*hd|uhd|fhd|4k|2160p|1080p|720p|hd|sd)\b/g, ' ')
    .replace(/[-_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
);

const normalizeCatchUpVariantLooseName = (channelName: string): string => (
  normalizeCatchUpVariantBaseName(channelName).replace(/\s+/g, '')
);

const resolveCatchUpVariantPriority = (channelName: string): number => {
  const normalized = channelName.toLowerCase();
  if (/\b(ultra\s*hd|uhd|4k|2160p)\b/.test(normalized)) {
    return 4;
  }
  if (/\b(full\s*hd|fhd|1080p)\b/.test(normalized)) {
    return 3;
  }
  if (/\b(hd|720p)\b/.test(normalized)) {
    return 2;
  }
  if (/\bsd\b/.test(normalized)) {
    return 0;
  }
  return 1;
};

const buildCatchUpFallbackStreamIdsByChannelId = (
  channels: PlayerChannel[],
): Map<string, number[]> => {
  const xtreamCatchUpChannels = channels.filter((channel) => (
    channel.source === 'xtream' && channel.hasCatchUp
  ));
  const fallbackStreamIdsByChannelId = new Map<string, number[]>();

  for (const channel of channels) {
    if (channel.source !== 'xtream' || !channel.hasCatchUp) {
      continue;
    }
    const baseName = normalizeCatchUpVariantBaseName(channel.name);
    const looseName = normalizeCatchUpVariantLooseName(channel.name);
    const epgChannelId = channel.epgChannelId?.trim() || null;
    const alternativeStreamIds = xtreamCatchUpChannels
      .filter((candidate) => candidate.id !== channel.id && candidate.streamId !== channel.streamId)
      .filter((candidate) => {
        const candidateBaseName = normalizeCatchUpVariantBaseName(candidate.name);
        const candidateLooseName = normalizeCatchUpVariantLooseName(candidate.name);
        const sameByName = baseName.length > 0 && (
          candidateBaseName === baseName || candidateLooseName === looseName
        );
        const sameByEpgChannelId = Boolean(
          epgChannelId &&
          candidate.epgChannelId &&
          candidate.epgChannelId.trim() === epgChannelId
        );
        return sameByName || sameByEpgChannelId;
      })
      .sort((left, right) => (
        resolveCatchUpVariantPriority(right.name) - resolveCatchUpVariantPriority(left.name) ||
        left.number - right.number
      ))
      .map((candidate) => candidate.streamId)
      .filter((streamId, index, streamIds) => streamIds.indexOf(streamId) === index);

    fallbackStreamIdsByChannelId.set(channel.id, alternativeStreamIds);
  }

  return fallbackStreamIdsByChannelId;
};

const PICTURE_IN_PICTURE_KEY_CODE = 80; // Keyboard "P"
const ON_DEMAND_LOADING_OVERLAY_MAX_MS = 2500;
const CATCH_UP_INITIAL_POSITION_GUARD_MS = 15_000;

const clampVolumePercent = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));
const DEFAULT_ON_DEMAND_VOLUME = clampVolumePercent(getDefaultAppSettings().player.defaultVolume);

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

const isSameSessionSource = (
  left: SessionSource | null,
  right: SessionSource | null,
): boolean => {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.url === right.url &&
    left.type === right.type &&
    left.title === right.title &&
    left.channelId === right.channelId &&
    JSON.stringify(left.metadata ?? null) === JSON.stringify(right.metadata ?? null)
  );
};

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
  const [catchUpPanelRequestKey, setCatchUpPanelRequestKey] = useState(0);
  const [numericZapBuffer, setNumericZapBuffer] = useState<string | null>(null);
  const [numericZapMatchName, setNumericZapMatchName] = useState<string | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings>(getDefaultAppSettings());
  const [isSettingsHydrated, setIsSettingsHydrated] = useState(false);
  const [layoutPreferences, setLayoutPreferences] = useState<PlayerLayoutPreferences>(
    loadPlayerLayoutPreferences,
  );
  const updateLayoutPreferences = useCallback(
    (patch: Partial<PlayerLayoutPreferences>) => {
      setLayoutPreferences((previous) => {
        const next = { ...previous, ...patch };
        savePlayerLayoutPreferences(next);
        return next;
      });
    },
    [],
  );
  const isCategorySidebarWide = layoutPreferences.categorySidebarWidth === 'wide';
  const isChannelListWide = layoutPreferences.channelListWidth === 'wide';
  const isGuidePanelExpanded = layoutPreferences.guidePanelSize === 'expanded';
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
  const lastCastUnsupportedReasonRef = useRef<string | null>(null);
  const previousRendererRef = useRef(session.renderer);
  const lastChannelLoadErrorRef = useRef<string | null>(null);
  const previousCastConnectedRef = useRef(castSender.isConnected);
  const tvUnazadSectionRef = useRef<HTMLDivElement>(null);
  const tvUnazadHighlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const livePauseStartedAtRef = useRef<number | null>(null);
  const startupLiveRestoreAppliedRef = useRef(false);
  const playbackBootstrapAppliedRef = useRef(false);
  const restoreNoticeRef = useRef<string | null>(null);
  const [isTvUnazadHighlighted, setIsTvUnazadHighlighted] = useState(false);
  const [isPlaybackBootstrapReady, setIsPlaybackBootstrapReady] = useState(false);
  const [onDemandDurationMs, setOnDemandDurationMs] = useState(0);
  const [onDemandVolume, setOnDemandVolume] = useState(DEFAULT_ON_DEMAND_VOLUME);
  const [isOnDemandMuted, setIsOnDemandMuted] = useState(DEFAULT_ON_DEMAND_VOLUME === 0);
  const [isOnDemandVolumePanelOpen, setIsOnDemandVolumePanelOpen] = useState(false);
  const onDemandLastNonZeroVolumeRef = useRef(DEFAULT_ON_DEMAND_VOLUME > 0 ? DEFAULT_ON_DEMAND_VOLUME : 60);

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
  const onDemandPositionMs = useMemo(() => {
    const normalizedPosition = Math.max(0, session.positionMs ?? 0);
    if (onDemandDurationMs <= 0) {
      return normalizedPosition;
    }

    return Math.min(normalizedPosition, onDemandDurationMs);
  }, [onDemandDurationMs, session.positionMs]);
  const onDemandDurationSeconds = onDemandDurationMs > 0 ? Math.floor(onDemandDurationMs / 1000) : 0;
  const onDemandPositionSeconds = Math.max(0, Math.floor(onDemandPositionMs / 1000));
  const hasOnDemandDuration = onDemandDurationMs > 0;
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
      return fetchChannelShortEpgPrograms(currentChannel.streamId, {
        includeArchiveFallback: currentChannel.hasCatchUp,
      });
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
  const catchUpFallbackStreamIdsByChannelId = useMemo(
    () => buildCatchUpFallbackStreamIdsByChannelId(channels),
    [channels]
  );
  const currentCatchUpFallbackStreamIds = useMemo(
    () => currentChannelWithEPG
      ? catchUpFallbackStreamIdsByChannelId.get(currentChannelWithEPG.id) ?? []
      : [],
    [catchUpFallbackStreamIdsByChannelId, currentChannelWithEPG]
  );
  const resolveLiveSourceUrl = useCallback(
    (channel: PlayerChannel) => channel.streamUrl ?? xtreamCodesService.getLiveStreamUrl(channel.streamId),
    [],
  );

  const switchToLiveChannel = useCallback(
    (channel: PlayerChannel, options?: { forceAutoplay?: boolean }) => {
      const sourceUrl = resolveLiveSourceUrl(channel);
      emitWebObservabilityEvent({
        name: 'playback.source-selected',
        severity: 'info',
        metadata: {
          channelId: channel.id,
          streamId: channel.streamId,
          source: channel.source,
        },
      });

      const source = buildLiveSessionSource({
        channel,
        sourceUrl,
        loadKey: Date.now(),
      });

      playerRef.current?.stop();
      commands.setSource(source, 0);

      if (options?.forceAutoplay || shouldAutoplayLiveOnSelect) {
        commands.play();
      }
    },
    [commands, resolveLiveSourceUrl, shouldAutoplayLiveOnSelect]
  );

  const switchBlockedSourceToLive = useCallback((source: SessionSource) => {
    const metadata = parseSessionSourceMetadata(source.metadata);
    const channelId = source.channelId ?? metadata.channelId;
    const targetChannel = (
      (channelId ? channels.find(channel => channel.id === channelId) : undefined)
      ?? (
        typeof metadata.streamId === 'number'
          ? channels.find(channel => channel.streamId === metadata.streamId)
          : undefined
      )
    );

    if (!targetChannel) {
      return;
    }

    switchToLiveChannel(targetChannel, { forceAutoplay: true });
  }, [channels, switchToLiveChannel]);

  const reportPlaybackProblem = useCallback((
    source: SessionSource,
    error: { message: string; details?: string },
  ) => {
    const metadata = buildPlaybackProblemReportMetadata(source, error);

    emitWebObservabilityEvent({
      name: 'playback.problem_reported',
      severity: 'warn',
      metadata,
    });

    toast({
      title: 'Problem prijavljen',
      description: `${metadata.title} je zabeležen za proveru streama.`,
    });
  }, [toast]);

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
        const canonicalServer = resolveXtreamCanonicalServer(
          credentials.server,
          authResponse.server_info,
        );
        if (canonicalServer !== credentials.server) {
          await saveXtreamCredentials({
            ...credentials,
            server: canonicalServer,
          });
        }
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

  useEffect(() => {
    if (playbackBootstrapAppliedRef.current) {
      return;
    }

    if (!isSettingsHydrated) {
      return;
    }

    if (isOnDemandSource) {
      playbackBootstrapAppliedRef.current = true;
      startupLiveRestoreAppliedRef.current = true;
      setIsPlaybackBootstrapReady(true);
      return;
    }

    if (channels.length === 0) {
      return;
    }

    if (SHADOW_VALIDATION_ENABLED) {
      playbackBootstrapAppliedRef.current = true;
      startupLiveRestoreAppliedRef.current = true;
      if (session.source) {
        commands.stop();
      }
      setIsPlaybackBootstrapReady(true);
      return;
    }

    let isCancelled = false;
    const parsedMetadata = parseSessionSourceMetadata(session.source?.metadata);
    const showRestoreNotice = (title: string, description: string) => {
      const noticeKey = `${title}:${description}`;
      if (restoreNoticeRef.current === noticeKey) {
        return;
      }

      restoreNoticeRef.current = noticeKey;
      toast({
        title,
        description,
      });
    };

    const bootstrapPlayback = async () => {
      if (session.source && !SHADOW_VALIDATION_ENABLED) {
        const rawMetadataMode = (
          session.source.metadata &&
          typeof session.source.metadata === 'object' &&
          session.source.metadata !== null &&
          'mode' in session.source.metadata
        )
          ? (session.source.metadata as { mode?: unknown }).mode
          : undefined;
        const shouldNormalizePersistedSource = (
          rawMetadataMode === 'catchup' ||
          isCatchUpSessionSourceMetadata(parsedMetadata) ||
          shouldSnapSessionRestoreToLiveEdge(session.source)
        );

        if (shouldNormalizePersistedSource) {
          const normalizedRestore = normalizeRestoredSessionSource({
            source: session.source,
            positionMs: session.positionMs,
            channels,
            fallbackStreamIdsByChannelId: catchUpFallbackStreamIdsByChannelId,
            urlBuilder: xtreamCodesService,
            resolveLiveSourceUrl,
          });
          const normalizedPositionMs = normalizedRestore.normalizedPositionMs ?? 0;
          const isSameSource = isSameSessionSource(session.source, normalizedRestore.normalizedSource);
          const isSamePosition = (session.positionMs ?? null) === normalizedRestore.normalizedPositionMs;

          if (normalizedRestore.notice) {
            showRestoreNotice(normalizedRestore.notice.title, normalizedRestore.notice.description);
          }

          if (!normalizedRestore.normalizedSource) {
            commands.stop();
            return;
          }

          if (!isSameSource || !isSamePosition) {
            commands.setSource(normalizedRestore.normalizedSource, normalizedPositionMs);
            if (
              session.playback === 'playing' ||
              shouldAutoplaySource(parsedMetadata.mode, appSettings)
            ) {
              commands.play();
            }
            return;
          }

          if (isCatchUpSessionSourceMetadata(parsedMetadata)) {
            playbackBootstrapAppliedRef.current = true;
            startupLiveRestoreAppliedRef.current = true;
            setIsPlaybackBootstrapReady(true);
            return;
          }
        }
      }

      const shouldSnapPersistedLiveSource = SHADOW_VALIDATION_ENABLED
        ? false
        : shouldSnapSessionRestoreToLiveEdge(session.source);
      const lastWatchedChannelId = SHADOW_VALIDATION_ENABLED
        ? null
        : await loadLastWatchedChannelId();
      if (isCancelled) {
        return;
      }

      const shouldApplyStartupRestore = shouldSnapPersistedLiveSource
        || (!currentChannel && (!session.source || SHADOW_VALIDATION_ENABLED));
      if (!shouldApplyStartupRestore) {
        startupLiveRestoreAppliedRef.current = true;
        playbackBootstrapAppliedRef.current = true;
        setIsPlaybackBootstrapReady(true);
        return;
      }

      const startupChannel = resolveStartupLiveChannel(
        channels,
        lastWatchedChannelId,
        shouldSnapPersistedLiveSource
          ? (currentChannel?.id ?? session.source?.channelId ?? null)
          : null,
        {
          preferCatchUp: SHADOW_VALIDATION_ENABLED,
        }
      );
      if (startupChannel) {
        switchToLiveChannel(startupChannel, {
          forceAutoplay: shouldSnapPersistedLiveSource || SHADOW_VALIDATION_ENABLED,
        });
      }

      startupLiveRestoreAppliedRef.current = true;
      playbackBootstrapAppliedRef.current = true;
      setIsPlaybackBootstrapReady(true);
    };

    void bootstrapPlayback();

    return () => {
      isCancelled = true;
    };
  }, [
    appSettings,
    catchUpFallbackStreamIdsByChannelId,
    channels,
    commands,
    currentChannel,
    isOnDemandSource,
    isSettingsHydrated,
    resolveLiveSourceUrl,
    session.playback,
    session.positionMs,
    session.source,
    switchToLiveChannel,
    toast,
  ]);

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

  const resolveCatchUpProgramPlayback = useCallback(async (
    program: PlayerChannel['epg'][number],
    options?: {
      allowPrefetchCache?: boolean;
      background?: boolean;
    },
  ): Promise<CatchUpPlaybackSourceResult | null> => {
    if (!currentChannelWithEPG) {
      return null;
    }

    const cacheKey = buildCatchUpPrefetchKey(currentChannelWithEPG.id, program.id);
    const nowMs = Date.now();
    const allowPrefetchCache = options?.allowPrefetchCache ?? true;

    if (allowPrefetchCache) {
      const cached = catchUpPrefetchCacheRef.current.get(cacheKey);
      if (cached && isCatchUpPrefetchFresh(cached.resolvedAtMs, nowMs)) {
        return cached.resolved;
      }
    }

    const existingRequest = catchUpPrefetchInFlightRef.current.get(cacheKey);
    if (existingRequest) {
      return existingRequest;
    }

    if (options?.background) {
      const failedAtMs = catchUpPrefetchFailureRef.current.get(cacheKey);
      if (typeof failedAtMs === 'number' && !isCatchUpPrefetchRetryDue(failedAtMs, nowMs)) {
        return null;
      }
    }

    const duration = Math.floor(
      (program.endTime.getTime() - program.startTime.getTime()) / 1000
    );
    const request = resolveCatchUpPlaybackSource({
      channel: currentChannelWithEPG,
      program,
      urlBuilder: xtreamCodesService,
      fallbackStreamIds: currentCatchUpFallbackStreamIds,
      durationSeconds: duration,
      initialPositionGuardSeconds: 0,
    }).then((resolved) => {
      catchUpPrefetchCacheRef.current.set(cacheKey, {
        resolved,
        resolvedAtMs: Date.now(),
      });
      catchUpPrefetchFailureRef.current.delete(cacheKey);
      return resolved;
    }).catch((error) => {
      catchUpPrefetchFailureRef.current.set(cacheKey, Date.now());
      throw error;
    }).finally(() => {
      catchUpPrefetchInFlightRef.current.delete(cacheKey);
    });

    catchUpPrefetchInFlightRef.current.set(cacheKey, request);
    return request;
  }, [currentCatchUpFallbackStreamIds, currentChannelWithEPG]);

  const playCatchUpProgram = useCallback(async (program: PlayerChannel['epg'][number]) => {
    if (!currentChannelWithEPG) {
      return;
    }

    const startTimestamp = Math.floor(program.startTime.getTime() / 1000);
    const duration = Math.floor(
      (program.endTime.getTime() - program.startTime.getTime()) / 1000
    );
    try {
      const resolved = await resolveCatchUpProgramPlayback(program, {
        allowPrefetchCache: true,
      });
      if (!resolved) {
        throw new Error('catchup_prefetch_unavailable');
      }

      const catchUpFallbackUrls = resolved.transportPlan.fallbackAttempts.map((attempt) => attempt.url);

      emitWebObservabilityEvent({
        name: 'catchup.requested',
        severity: 'info',
        metadata: {
          channelId: currentChannelWithEPG.id,
          streamId: currentChannelWithEPG.streamId,
          programId: program.id,
          start: startTimestamp,
          duration,
          attempt: 1,
          status: 'requested',
          finalHost: null,
          errorCode: null,
          initialStrategy: resolved.transportPlan.initialAttempt.strategy,
          initialStartTs: resolved.transportPlan.initialAttempt.startTimestamp,
          fallbackStreamIds: currentCatchUpFallbackStreamIds,
          fallbackCount: catchUpFallbackUrls.length,
          transportMode: resolved.gateway?.transportMode ?? 'provider-direct',
          assetKey: resolved.gateway?.assetKey ?? null,
          hotStart: resolved.gateway?.hotStart ?? false,
          fallbackReason: resolved.gateway?.fallbackReason ?? null,
        },
      });

      playerRef.current?.stop();
      commands.setSource(resolved.source, Math.floor(resolved.initialPositionSeconds * 1000));
      commands.play();
    } catch (error) {
      emitWebObservabilityEvent({
        name: 'playback.error',
        severity: 'error',
        metadata: {
          channelId: currentChannelWithEPG.id,
          streamId: currentChannelWithEPG.streamId,
          programId: program.id,
          status: 'catchup_resolve_failed',
          errorCode: error instanceof Error ? error.message : 'unknown_error',
        },
      });
    }
  }, [commands, currentCatchUpFallbackStreamIds, currentChannelWithEPG, resolveCatchUpProgramPlayback]);

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

  const seekOnDemandTo = useCallback((targetPositionMs: number) => {
    if (!session.source) {
      return;
    }

    const clampedPositionMs = hasOnDemandDuration
      ? Math.max(0, Math.min(onDemandDurationMs, targetPositionMs))
      : Math.max(0, targetPositionMs);

    playerRef.current?.seek(clampedPositionMs / 1000);
    commands.seek(clampedPositionMs);
  }, [commands, hasOnDemandDuration, onDemandDurationMs, session.source]);

  const seekBySeconds = useCallback(
    (deltaSeconds: number) => {
      if (!session.source) {
        return;
      }

      const currentPositionMs = session.positionMs ?? 0;
      const nextPositionMs = currentPositionMs + deltaSeconds * 1000;
      seekOnDemandTo(nextPositionMs);
    },
    [seekOnDemandTo, session.positionMs, session.source]
  );

  const handleOnDemandSeekChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const nextPositionSeconds = Number(event.target.value);
    if (!Number.isFinite(nextPositionSeconds)) {
      return;
    }

    seekOnDemandTo(nextPositionSeconds * 1000);
  }, [seekOnDemandTo]);

  const toggleOnDemandMute = useCallback(() => {
    if (!isOnDemandMuted && onDemandVolume > 0) {
      setIsOnDemandMuted(true);
      return;
    }

    const restoredVolume = onDemandLastNonZeroVolumeRef.current;
    setOnDemandVolume(restoredVolume);
    setIsOnDemandMuted(false);
    setIsOnDemandVolumePanelOpen(true);
  }, [isOnDemandMuted, onDemandVolume]);

  const handleOnDemandVolumeChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const nextVolume = clampVolumePercent(Number(event.target.value));
    setOnDemandVolume(nextVolume);
    if (nextVolume > 0) {
      onDemandLastNonZeroVolumeRef.current = nextVolume;
      setIsOnDemandMuted(false);
      return;
    }

    setIsOnDemandMuted(true);
  }, []);

  const retryCurrentPlayback = useCallback(() => {
    if (!session.source) {
      return;
    }

    if (isCatchUpSessionSourceMetadata(sessionSourceMetadata) && currentChannelWithEPG) {
      const rebuiltCatchUp = buildCatchUpSessionSourceFromMetadata({
        channel: currentChannelWithEPG,
        metadata: {
          ...sessionSourceMetadata,
          fallbackStreamIds: (
            sessionSourceMetadata.fallbackStreamIds.length > 0
              ? sessionSourceMetadata.fallbackStreamIds
              : currentCatchUpFallbackStreamIds
          ),
        },
        channelTitle: currentChannelWithEPG.name,
        urlBuilder: xtreamCodesService,
      });

      commands.setSource(
        rebuiltCatchUp.source,
        Math.max(0, Math.min(session.positionMs ?? 0, sessionSourceMetadata.durationSeconds * 1000)),
      );
      commands.play();
      return;
    }

    if (isLiveSourcePlayback && currentChannel) {
      commands.setSource(buildLiveSessionSource({
        channel: currentChannel,
        sourceUrl: resolveLiveSourceUrl(currentChannel),
      }), 0);
      commands.play();
      return;
    }

    commands.setSource({ ...session.source }, onDemandPositionMs);
    commands.play();
  }, [
    commands,
    currentCatchUpFallbackStreamIds,
    currentChannel,
    currentChannelWithEPG,
    isLiveSourcePlayback,
    onDemandPositionMs,
    resolveLiveSourceUrl,
    session.positionMs,
    session.source,
    sessionSourceMetadata,
  ]);

  useEffect(() => {
    const defaultVolume = clampVolumePercent(appSettings.player.defaultVolume);
    setOnDemandVolume(defaultVolume);
    setIsOnDemandMuted(defaultVolume === 0);
    if (defaultVolume > 0) {
      onDemandLastNonZeroVolumeRef.current = defaultVolume;
    }
  }, [appSettings.player.defaultVolume]);

  useEffect(() => {
    const onDemandSourceUrl = session.source?.url ?? null;
    if (!isOnDemandSource || !onDemandSourceUrl || !usesLocalRenderer) {
      setOnDemandDurationMs(0);
      return;
    }

    const syncDuration = () => {
      const nextDurationSeconds = isCatchUpSessionSourceMetadata(sessionSourceMetadata)
        ? sessionSourceMetadata.durationSeconds
        : playerRef.current?.getDuration() ?? 0;
      if (!Number.isFinite(nextDurationSeconds) || nextDurationSeconds <= 0) {
        return;
      }

      const nextDurationMs = Math.floor(nextDurationSeconds * 1000);
      setOnDemandDurationMs((previousDurationMs) => (
        Math.abs(previousDurationMs - nextDurationMs) < 500
          ? previousDurationMs
          : nextDurationMs
      ));
    };

    syncDuration();
    const intervalId = window.setInterval(syncDuration, 400);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [isOnDemandSource, session.source?.url, sessionSourceMetadata, usesLocalRenderer]);

  useEffect(() => {
    if (!isOnDemandSource || !session.source || !usesLocalRenderer) {
      return;
    }

    const effectiveVolume = isOnDemandMuted ? 0 : onDemandVolume;
    if (effectiveVolume > 0) {
      onDemandLastNonZeroVolumeRef.current = effectiveVolume;
    }

    playerRef.current?.setVolume(effectiveVolume / 100);
    playerRef.current?.setMuted(effectiveVolume === 0);
  }, [isOnDemandMuted, isOnDemandSource, onDemandVolume, session.source, usesLocalRenderer]);

  useEffect(() => {
    if (!isOnDemandSource) {
      setIsOnDemandVolumePanelOpen(false);
    }
  }, [isOnDemandSource]);

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
    if (!castSender.sourceUnsupportedReason) {
      lastCastUnsupportedReasonRef.current = null;
      return;
    }

    if (castSender.sourceUnsupportedReason === lastCastUnsupportedReasonRef.current) {
      return;
    }

    lastCastUnsupportedReasonRef.current = castSender.sourceUnsupportedReason;
    toast({
      title: 'Google Cast nije dostupan',
      description: castSender.sourceUnsupportedReason,
    });
  }, [castSender.sourceUnsupportedReason, toast]);

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
  const currentCatchUpProgram = useMemo(() => {
    if (!currentChannelWithEPG || !isCatchUpSessionSourceMetadata(sessionSourceMetadata)) {
      return null;
    }

    return findCatchUpProgramById(currentChannelWithEPG.epg, sessionSourceMetadata.programId);
  }, [currentChannelWithEPG, sessionSourceMetadata]);
  const nextCatchUpProgram = useMemo(() => {
    if (!currentChannelWithEPG || !currentCatchUpProgram) {
      return null;
    }

    return findNextCatchUpProgram(currentChannelWithEPG.epg, currentCatchUpProgram);
  }, [currentCatchUpProgram, currentChannelWithEPG]);
  const catchUpStallRecoveryAttemptedKeysRef = useRef<Set<string>>(new Set());
  const catchUpStallRecoverySourceUrlRef = useRef<string | null>(null);
  const catchUpPrefetchCacheRef = useRef(
    new Map<string, { resolved: CatchUpPlaybackSourceResult; resolvedAtMs: number }>()
  );
  const catchUpPrefetchInFlightRef = useRef(new Map<string, Promise<CatchUpPlaybackSourceResult | null>>());
  const catchUpPrefetchFailureRef = useRef(new Map<string, number>());
  const catchUpPrefetchChannelIdRef = useRef<string | null>(null);
  const liveStartupRetryAttemptedSourceRef = useRef<string | null>(null);
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
  useEffect(() => {
    if (!isCatchUpSessionSourceMetadata(sessionSourceMetadata)) {
      catchUpStallRecoveryAttemptedKeysRef.current.clear();
      catchUpStallRecoverySourceUrlRef.current = null;
      return;
    }

    const sourceUrl = session.source?.url ?? '';
    if (!sourceUrl) {
      catchUpStallRecoveryAttemptedKeysRef.current.clear();
      catchUpStallRecoverySourceUrlRef.current = null;
      return;
    }

    if (catchUpStallRecoverySourceUrlRef.current !== sourceUrl) {
      catchUpStallRecoveryAttemptedKeysRef.current.clear();
      catchUpStallRecoverySourceUrlRef.current = sourceUrl;
    }
  }, [session.source?.url, sessionSourceMetadata]);
  useEffect(() => {
    const channelId = currentChannelWithEPG?.id ?? null;
    const isCatchUpSession = isCatchUpSessionSourceMetadata(sessionSourceMetadata);
    if (!isCatchUpSession || !channelId) {
      catchUpPrefetchCacheRef.current.clear();
      catchUpPrefetchInFlightRef.current.clear();
      catchUpPrefetchFailureRef.current.clear();
      catchUpPrefetchChannelIdRef.current = null;
      return;
    }

    if (catchUpPrefetchChannelIdRef.current !== channelId) {
      catchUpPrefetchCacheRef.current.clear();
      catchUpPrefetchInFlightRef.current.clear();
      catchUpPrefetchFailureRef.current.clear();
      catchUpPrefetchChannelIdRef.current = channelId;
    }
  }, [currentChannelWithEPG?.id, sessionSourceMetadata]);
  useEffect(() => {
    if (
      !currentChannelWithEPG ||
      !isCatchUpSessionSourceMetadata(sessionSourceMetadata) ||
      !currentCatchUpProgram ||
      !nextCatchUpProgram ||
      !shouldPrefetchNextCatchUpProgram({
        currentProgram: currentCatchUpProgram,
        nextProgram: nextCatchUpProgram,
        positionMs: session.positionMs,
        lookaheadMs: CATCH_UP_PREFETCH_LOOKAHEAD_MS,
      })
    ) {
      return;
    }

    const prefetchKey = buildCatchUpPrefetchKey(currentChannelWithEPG.id, nextCatchUpProgram.id);
    const cached = catchUpPrefetchCacheRef.current.get(prefetchKey);
    if (cached && isCatchUpPrefetchFresh(cached.resolvedAtMs)) {
      return;
    }

    if (catchUpPrefetchInFlightRef.current.has(prefetchKey)) {
      return;
    }

    const failedAtMs = catchUpPrefetchFailureRef.current.get(prefetchKey);
    if (typeof failedAtMs === 'number' && !isCatchUpPrefetchRetryDue(failedAtMs)) {
      return;
    }

    emitWebObservabilityEvent({
      name: 'catchup.retry',
      severity: 'info',
      metadata: {
        channelId: currentChannelWithEPG.id,
        streamId: currentChannelWithEPG.streamId,
        programId: nextCatchUpProgram.id,
        status: 'prefetch_requested',
        errorCode: null,
      },
    });

    void resolveCatchUpProgramPlayback(nextCatchUpProgram, {
      allowPrefetchCache: true,
      background: true,
    }).then((resolved) => {
      if (!resolved) {
        return;
      }

      emitWebObservabilityEvent({
        name: 'catchup.retry',
        severity: 'info',
        metadata: {
          channelId: currentChannelWithEPG.id,
          streamId: currentChannelWithEPG.streamId,
          programId: nextCatchUpProgram.id,
          status: 'prefetch_ready',
          errorCode: null,
          transportMode: resolved.gateway?.transportMode ?? 'provider-direct',
          hotStart: resolved.gateway?.hotStart ?? false,
          assetKey: resolved.gateway?.assetKey ?? null,
        },
      });
    }).catch((error) => {
      emitWebObservabilityEvent({
        name: 'catchup.retry',
        severity: 'warn',
        metadata: {
          channelId: currentChannelWithEPG.id,
          streamId: currentChannelWithEPG.streamId,
          programId: nextCatchUpProgram.id,
          status: 'prefetch_failed',
          errorCode: error instanceof Error ? error.message : 'unknown_error',
        },
      });
    });
  }, [
    currentCatchUpProgram,
    currentChannelWithEPG,
    nextCatchUpProgram,
    resolveCatchUpProgramPlayback,
    session.positionMs,
    sessionSourceMetadata,
  ]);
  useEffect(() => {
    if (
      !usesLocalRenderer ||
      !session.source ||
      !isCatchUpSessionSourceMetadata(sessionSourceMetadata) ||
      session.playback !== 'buffering'
    ) {
      return;
    }

    const currentSource = session.source;
    const stallPositionMs = Math.max(0, session.positionMs ?? 0);
    if (!shouldRetryCatchUpBufferingStall({
      source: currentSource,
      playback: session.playback,
    }, {
      currentTimeSeconds: playerRef.current?.getCurrentTime() ?? 0,
      hasRenderableFrame: Boolean(playerRef.current?.hasRenderableFrame()),
    })) {
      return;
    }

    const stallKey = `${session.source.url}:${Math.floor(stallPositionMs / CATCH_UP_STALL_RECOVERY_BUCKET_MS)}`;
    if (catchUpStallRecoveryAttemptedKeysRef.current.has(stallKey)) {
      return;
    }

    const timeoutId = setTimeout(() => {
      catchUpStallRecoveryAttemptedKeysRef.current.add(stallKey);
      emitWebObservabilityEvent({
        name: 'catchup.retry',
        severity: 'warn',
        metadata: {
          channelId: sessionSourceMetadata.channelId,
          streamId: sessionSourceMetadata.streamId,
          programId: sessionSourceMetadata.programId,
          status: 'buffering_watchdog_retry',
          errorCode: 'BUFFERING_STALL',
          positionMs: stallPositionMs,
          sourceUrl: currentSource.url,
        },
      });
      retryCurrentPlayback();
    }, CATCH_UP_STALL_RECOVERY_DELAY_MS);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [
    retryCurrentPlayback,
    session.playback,
    session.positionMs,
    session.source,
    sessionSourceMetadata,
    usesLocalRenderer,
  ]);
  const handleCatchUpEnded = useCallback(() => {
    if (!nextCatchUpProgram) {
      return;
    }

    emitWebObservabilityEvent({
      name: 'catchup.retry',
      severity: 'info',
      metadata: {
        channelId: currentChannelWithEPG?.id ?? null,
        streamId: currentChannelWithEPG?.streamId ?? null,
        programId: nextCatchUpProgram.id,
        status: 'auto_advanced_to_next_program',
        errorCode: null,
      },
    });
    void playCatchUpProgram(nextCatchUpProgram);
  }, [currentChannelWithEPG, nextCatchUpProgram, playCatchUpProgram]);

  useEffect(() => {
    if (
      !usesLocalRenderer ||
      !isPlaybackBootstrapReady ||
      !session.source ||
      sessionSourceMetadata.mode !== 'live' ||
      session.playback !== 'playing'
    ) {
      return;
    }

    const sourceUrl = session.source.url;
    const sourceBaseUrl = sourceUrl.split('#', 1)[0] ?? sourceUrl;
    if (liveStartupRetryAttemptedSourceRef.current !== sourceBaseUrl) {
      liveStartupRetryAttemptedSourceRef.current = null;
    } else {
      return;
    }

    const timeoutId = setTimeout(() => {
      const player = playerRef.current;
      const currentTimeSeconds = player?.getCurrentTime() ?? 0;
      if (!shouldRetryLiveStartupWithoutFrame({
        currentTimeSeconds,
        hasRenderableFrame: Boolean(player?.hasRenderableFrame()),
      })) {
        return;
      }

      liveStartupRetryAttemptedSourceRef.current = sourceBaseUrl;
      emitWebObservabilityEvent({
        name: 'playback.retry',
        severity: 'warn',
        metadata: {
          channelId: session.source?.channelId ?? null,
          streamId: sessionSourceMetadata.streamId ?? null,
          status: 'startup_retry',
          errorCode: 'LIVE_STARTUP_STALL',
          sourceUrl: sourceBaseUrl,
        },
      });
      commands.setSource({
        ...session.source,
        url: withStartupRetryHash(sourceBaseUrl),
      }, 0);
      commands.play();
    }, LIVE_STARTUP_RETRY_DELAY_MS);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [
    commands,
    isPlaybackBootstrapReady,
    session.playback,
    session.source,
    sessionSourceMetadata,
    usesLocalRenderer,
  ]);

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
  const requestCatchUpPanel = useCallback(() => {
    setCatchUpPanelRequestKey((key) => key + 1);
  }, []);

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
  const activeCatchUpProgramId = isCatchUpSessionSourceMetadata(sessionSourceMetadata)
    ? sessionSourceMetadata.programId
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
  const mobileCategoryValue = selectedCategory ?? '__all__';
  const xtreamSubscriptionLabel = xtreamUserInfo
    ? `${xtreamUserInfo.active_cons}/${xtreamUserInfo.max_connections}`
    : null;
  const xtreamExpLabel = xtreamUserInfo ? formatXtreamExpDate(xtreamUserInfo.exp_date) : null;
  const onDemandTitle = onDemandContext?.title ?? 'VOD Playback';
  const onDemandBackPath = onDemandContext?.backPath ?? '/vod';
  const onDemandBackLabel = onDemandContext?.backLabel ?? 'Back to VOD';
  const pageTitle = isOnDemandSource
    ? `${session.source?.title ?? onDemandTitle} - ${BRAND_NAME}`
    : currentChannel
      ? `${currentChannel.name} - ${BRAND_NAME}`
      : BRAND_NAME;

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

      <div className="flex h-full min-h-0 w-full min-w-0 max-w-[100vw] flex-1 overflow-hidden bg-background">
        {/* Sidebar for desktop */}
        {!isOnDemandSource ? (
          <div className="hidden min-h-0 lg:flex lg:h-full">
            <aside
              className={`flex h-full flex-col border-r border-border bg-card/50 transition-[width] duration-200 ${
                isCategorySidebarWide ? 'w-[240px]' : 'w-[180px]'
              }`}
            >
              <div className="relative p-4 flex justify-center border-b border-border">
                <button
                  type="button"
                  className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center hover:scale-105 transition-transform"
                  onClick={goToPlayerHome}
                  aria-label="Player"
                >
                  <Play className="w-5 h-5 text-primary-foreground fill-current" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateLayoutPreferences({
                      categorySidebarWidth: isCategorySidebarWide ? 'normal' : 'wide',
                    })
                  }
                  className="absolute right-1 top-1/2 -translate-y-1/2 flex h-8 w-6 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground transition-all"
                  title={isCategorySidebarWide ? 'Suzi kategorije' : 'Proširi kategorije'}
                  aria-label={isCategorySidebarWide ? 'Suzi kategorije' : 'Proširi kategorije'}
                >
                  {isCategorySidebarWide ? (
                    <ChevronsLeft className="w-4 h-4" />
                  ) : (
                    <ChevronsRight className="w-4 h-4" />
                  )}
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
                        className={`relative ${isCategorySidebarWide ? 'w-[220px]' : 'w-[160px]'} h-12 rounded-xl flex items-center justify-start gap-2 px-3 transition-all ${
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
                    className={`starlight-border starlight-border-amber ${isCategorySidebarWide ? 'w-[220px]' : 'w-[160px]'} h-10 rounded-xl flex items-center justify-start gap-2 px-3 transition-all bg-gradient-to-br from-amber-500/20 to-yellow-600/20 border border-amber-500/30 text-amber-400 hover:from-amber-500/30 hover:to-yellow-600/30 hover:border-amber-500/50 hover:scale-105`}
                  >
                    <Film className="w-4 h-4 shrink-0" />
                    <span className="text-xs font-semibold">Filmovi</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('/series')}
                    className={`starlight-border starlight-border-purple ${isCategorySidebarWide ? 'w-[220px]' : 'w-[160px]'} h-10 rounded-xl flex items-center justify-start gap-2 px-3 transition-all bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-purple-500/30 text-purple-400 hover:from-purple-500/30 hover:to-pink-500/30 hover:border-purple-500/50 hover:scale-105`}
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

            <aside
              className={`bg-card border-r border-border flex flex-col overflow-hidden shrink-0 transition-[width] duration-200 ${
                isChannelListWide
                  ? 'w-96 xl:w-[28rem] 2xl:w-[32rem]'
                  : 'w-72 xl:w-80 2xl:w-96'
              }`}
            >
              <div className="p-4 border-b border-border">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-bold text-lg text-foreground">
                    {brandWordmark.prefix}<span className="text-primary">{brandWordmark.accent}</span>
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
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        updateLayoutPreferences({
                          channelListWidth: isChannelListWide ? 'normal' : 'wide',
                        })
                      }
                      title={isChannelListWide ? 'Suzi listu kanala' : 'Proširi listu kanala'}
                      aria-label={isChannelListWide ? 'Suzi listu kanala' : 'Proširi listu kanala'}
                    >
                      {isChannelListWide ? (
                        <ChevronsLeft className="w-4 h-4" />
                      ) : (
                        <ChevronsRight className="w-4 h-4" />
                      )}
                    </Button>
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
        <main className="flex h-full min-h-0 w-full min-w-0 max-w-[100vw] flex-1 flex-col overflow-hidden">
          {!isOnDemandSource && (
            <header className="flex w-full min-w-0 max-w-full items-center justify-between gap-2 overflow-hidden border-b border-border bg-card px-3 py-2 lg:hidden">
              <button
                type="button"
                onClick={goToPlayerHome}
                className="flex min-w-0 flex-1 items-center gap-2"
              >
                <div className="w-7 h-7 shrink-0 rounded-lg bg-primary flex items-center justify-center">
                  <Play className="w-3 h-3 text-primary-foreground fill-current" />
                </div>
                <span className="truncate font-bold text-sm text-foreground">
                  {brandWordmark.prefix}<span className="text-primary">{brandWordmark.accent}</span>
                </span>
              </button>

              {xtreamUserInfo && (
                <div className="flex max-w-[42vw] shrink-0 items-center gap-2 overflow-hidden rounded-lg bg-secondary/50 px-2 py-1">
                  {xtreamSubscriptionLabel && (
                    <div className="flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
                      <Wifi className="w-3 h-3" />
                      <span className="truncate">{xtreamSubscriptionLabel}</span>
                    </div>
                  )}
                  {xtreamSubscriptionLabel && xtreamExpLabel && (
                    <div className="w-px h-3 bg-border" />
                  )}
                  {xtreamExpLabel && (
                    <div className="flex min-w-0 items-center gap-1 text-[10px] text-primary">
                      <Calendar className="w-3 h-3" />
                      <span className="truncate font-medium">{xtreamExpLabel}</span>
                    </div>
                  )}
                </div>
              )}

              <div className="flex shrink-0 items-center gap-1">
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
            className={`relative w-full min-w-0 max-w-full shrink-0 overflow-hidden bg-black ${
              isFullscreen
                ? 'fixed inset-0 z-50'
                : `aspect-video max-h-[36svh] transition-[max-height] duration-300 ${
                    isOnDemandSource
                      ? 'lg:max-h-none'
                      : isGuidePanelExpanded
                        ? 'lg:max-h-[50svh]'
                        : 'lg:max-h-[calc(100svh-320px)]'
                  }`
            }`}
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

            {session.source && usesLocalRenderer && !isPlaybackBootstrapReady && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
              </div>
            )}

            {session.source && usesLocalRenderer && isPlaybackBootstrapReady && (
              <VideoPlayer
                ref={playerRef}
                autoPlay={shouldAutoplayCurrentSource}
                preferNativeHls={appSettings.player.preferNativeHls}
                loadingOverlayMaxMs={isOnDemandSource ? ON_DEMAND_LOADING_OVERLAY_MAX_MS : undefined}
                onEnded={handleCatchUpEnded}
                onSourceBlockingPrimaryAction={switchBlockedSourceToLive}
                onReportPlaybackProblem={reportPlaybackProblem}
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
              <div className="absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/90 via-black/65 to-transparent p-2.5 sm:p-6">
                <div className="mx-auto flex max-w-screen-xl flex-col gap-2 rounded-xl border border-border/60 bg-background/75 p-3 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:p-4">
                  <div className="min-w-0">
                    <p className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-primary">
                      <Smartphone className="h-4 w-4" />
                      Phone as remote
                    </p>
                    <h2 className="truncate text-sm font-semibold text-foreground sm:text-xl">
                      {session.source.title || currentChannel?.name || 'Remote playback'}
                    </h2>
                    <p className="text-xs text-muted-foreground sm:text-sm">
                      {castSender.deviceName
                        ? `Controlling ${castSender.deviceName}`
                        : 'Controlling Cast device'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
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
                  catchUpFallbackStreamIds={currentCatchUpFallbackStreamIds}
                  currentProgram={currentProgram}
                  progress={progress}
                  isFavorite={isFavorite(currentChannelWithEPG.id)}
                  isFullscreen={isFullscreen}
                  onToggleFavorite={() => toggleFavorite(currentChannelWithEPG.id)}
                  onToggleFullscreen={toggleFullscreen}
                  onPrevChannel={goToPrevChannel}
                  onNextChannel={goToNextChannel}
                  catchUpPanelRequestKey={catchUpPanelRequestKey}
                  playerRef={playerRef}
                  defaultVolume={appSettings.player.defaultVolume}
                  castControl={{
                    isAvailable: castSender.isAvailable,
                    isConnected: castSender.isConnected,
                    isConnecting: castSender.isConnecting,
                    disabledReason: castSender.sourceUnsupportedReason,
                    onToggle: () => {
                      void castSender.toggleCasting();
                    },
                  }}
                />
              </>
            )}

            {isOnDemandSource && session.source && usesLocalRenderer && (
              <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-2.5 sm:p-6">
                <div className="mx-auto max-w-screen-xl space-y-2 rounded-xl border border-border/60 bg-background/70 p-3 shadow-xl backdrop-blur-sm sm:space-y-3 sm:rounded-2xl sm:p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-primary">
                        <Film className="h-4 w-4" />
                        {onDemandTitle}
                      </p>
                      <h2 className="truncate text-sm font-semibold text-foreground sm:text-xl">
                        {session.source.title || 'On-demand playback'}
                      </h2>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                      {session.playback === 'buffering' && (
                        <span className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-xs text-primary">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Ucitavanje
                        </span>
                      )}
                      <Button variant="outline" onClick={retryCurrentPlayback}>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Retry
                      </Button>
                      <Button variant="outline" onClick={() => navigate(onDemandBackPath)}>
                        {onDemandBackLabel}
                      </Button>
                      <Button variant="outline" onClick={() => switchToLiveMode()}>
                        <Tv2 className="mr-2 h-4 w-4" />
                        TV Uzivo
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <input
                      type="range"
                      min="0"
                      max={Math.max(onDemandDurationSeconds, 1)}
                      value={Math.min(onDemandPositionSeconds, Math.max(onDemandDurationSeconds, 1))}
                      onChange={handleOnDemandSeekChange}
                      disabled={!hasOnDemandDuration}
                      className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-secondary/50 accent-primary disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label="On-demand seek timeline"
                    />
                    <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
                      <span>{formatDuration(onDemandPositionSeconds)}</span>
                      <span>{hasOnDemandDuration ? formatDuration(onDemandDurationSeconds) : '--:--'}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-1.5 sm:gap-2">
                    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                      <Button variant="secondary" onClick={togglePlayback}>
                        {session.playback === 'playing' || session.playback === 'buffering' ? (
                          <Pause className="mr-2 h-4 w-4" />
                        ) : (
                          <Play className="mr-2 h-4 w-4" />
                        )}
                        {session.playback === 'playing' || session.playback === 'buffering' ? 'Pause' : 'Play'}
                      </Button>
                      <Button variant="outline" onClick={() => seekBySeconds(-15)} disabled={!hasOnDemandDuration}>
                        <SkipBack className="mr-2 h-4 w-4" />
                        -15s
                      </Button>
                      <Button variant="outline" onClick={() => seekBySeconds(15)} disabled={!hasOnDemandDuration}>
                        <SkipForward className="mr-2 h-4 w-4" />
                        +15s
                      </Button>
                      <div className="relative flex items-center rounded-lg border border-border/50 bg-background/40 p-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={toggleOnDemandMute}
                          title={isOnDemandMuted ? 'Unmute' : 'Mute'}
                        >
                          {isOnDemandMuted || onDemandVolume === 0 ? (
                            <VolumeX className="h-4 w-4" />
                          ) : (
                            <Volume2 className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setIsOnDemandVolumePanelOpen((isOpen) => !isOpen)}
                          title="Audio controls"
                        >
                          <ChevronDown className={`h-4 w-4 transition-transform ${isOnDemandVolumePanelOpen ? 'rotate-180' : ''}`} />
                        </Button>
                        {isOnDemandVolumePanelOpen && (
                          <div className="absolute bottom-full left-0 mb-2 rounded-lg border border-border/60 bg-background/90 p-2 shadow-lg backdrop-blur-sm">
                            <input
                              type="range"
                              min="0"
                              max="100"
                              value={isOnDemandMuted ? 0 : onDemandVolume}
                              onChange={handleOnDemandVolumeChange}
                              className="h-1 w-24 cursor-pointer appearance-none rounded-full bg-secondary/50 accent-primary"
                              aria-label="On-demand volume"
                            />
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                      <Button variant={isFullscreen ? 'secondary' : 'outline'} onClick={toggleFullscreen}>
                        {isFullscreen ? (
                          <Minimize className="mr-2 h-4 w-4" />
                        ) : (
                          <Maximize className="mr-2 h-4 w-4" />
                        )}
                        {isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
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
                          disabled={castSender.isConnecting || Boolean(castSender.sourceUnsupportedReason)}
                          title={castSender.sourceUnsupportedReason ?? undefined}
                        >
                          <Cast className="mr-2 h-4 w-4" />
                          {castSender.isConnected ? 'Prekini cast' : 'Povezi cast'}
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
                    </div>
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
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium text-muted-foreground">Sada na programu</span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        updateLayoutPreferences({
                          guidePanelSize: isGuidePanelExpanded ? 'normal' : 'expanded',
                        })
                      }
                      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground bg-secondary/40 hover:bg-secondary hover:text-foreground transition-all"
                      title={isGuidePanelExpanded ? 'Smanji TV vodič' : 'Proširi TV vodič'}
                    >
                      {isGuidePanelExpanded ? (
                        <>
                          <ChevronsDown className="w-3.5 h-3.5" />
                          <span>Smanji vodič</span>
                        </>
                      ) : (
                        <>
                          <ChevronsUp className="w-3.5 h-3.5" />
                          <span>Proširi vodič</span>
                        </>
                      )}
                    </button>
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
                    className={`rounded-xl transition-colors duration-300 ${isTvUnazadHighlighted ? 'bg-catchup/12' : ''}`}
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-6 h-6 rounded-full bg-catchup/20 flex items-center justify-center">
                        <Play className="w-3 h-3 text-catchup" />
                      </div>
                      <span className="text-sm font-medium bg-gradient-to-r from-catchup via-primary to-catchup bg-[length:200%_100%] animate-shimmer bg-clip-text text-transparent">
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
                                      data-testid="catchup-program"
                                      data-catchup-start-ms={program.startTime.getTime()}
                                      data-catchup-end-ms={program.endTime.getTime()}
                                      onClick={() => playCatchUpProgram(program)}
                                      className={`w-full flex items-center gap-4 p-3 rounded-xl transition-all group text-left ${
                                        isActiveCatchUp
                                          ? 'bg-catchup/20 border-2 border-catchup/50'
                                          : 'bg-catchup/[0.07] hover:bg-catchup/15 border border-catchup/25'
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
                                          <span className="text-[10px] font-semibold text-catchup bg-catchup/20 px-2 py-1 rounded-full">
                                            CATCH-UP
                                          </span>
                                        )}
                                        <Play className="w-4 h-4 text-catchup opacity-0 group-hover:opacity-100 transition-opacity" />
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
                                          data-testid="catchup-program"
                                          data-catchup-start-ms={program.startTime.getTime()}
                                          data-catchup-end-ms={program.endTime.getTime()}
                                          onClick={() => playCatchUpProgram(program)}
                                          className={`w-full flex items-center gap-4 p-3 rounded-xl transition-all group text-left ${
                                            isActiveCatchUp
                                              ? 'bg-catchup/20 border-2 border-catchup/50'
                                              : 'bg-catchup/[0.07] hover:bg-catchup/15 border border-catchup/25'
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
                                              <span className="text-[10px] font-semibold text-catchup bg-catchup/20 px-2 py-1 rounded-full">
                                                CATCH-UP
                                              </span>
                                            )}
                                            <Play className="w-4 h-4 text-catchup opacity-0 group-hover:opacity-100 transition-opacity" />
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
                        <div className="rounded-xl border border-catchup/25 bg-catchup/[0.07] px-4 py-4">
                          <div className="flex items-start gap-3">
                            <Clock className="mt-0.5 h-4 w-4 text-catchup" />
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
            <div className="flex min-h-0 w-full min-w-0 max-w-full flex-1 flex-col overflow-hidden border-t border-border bg-card lg:hidden">
              <div className="sticky top-0 z-10 w-full min-w-0 max-w-full overflow-hidden bg-card border-b border-border">
                <div className="p-2">
                  <div className="grid grid-cols-3 gap-1.5">
                    <Button
                      variant="outline"
                      className="h-9 min-w-0 justify-center gap-1 border-catchup/40 bg-catchup/12 px-1.5 text-xs text-catchup hover:bg-catchup/20"
                      onClick={requestCatchUpPanel}
                    >
                      <Play className="h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 truncate">TV Unazad</span>
                    </Button>
                    <Button
                      variant="outline"
                      className="h-9 min-w-0 justify-center gap-1 border-amber-500/35 bg-amber-500/12 px-1.5 text-xs text-amber-400 hover:bg-amber-500/20"
                      onClick={() => navigate('/vod')}
                    >
                      <Film className="h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 truncate">Filmovi</span>
                    </Button>
                    <Button
                      variant="outline"
                      className="h-9 min-w-0 justify-center gap-1 border-purple-500/35 bg-purple-500/12 px-1.5 text-xs text-purple-400 hover:bg-purple-500/20"
                      onClick={() => navigate('/series')}
                    >
                      <Clapperboard className="h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 truncate">Serije</span>
                    </Button>
                  </div>
                </div>

                <div className="flex gap-1.5 border-t border-border p-2">
                  <label className="sr-only" htmlFor="mobile-channel-category">
                    Kategorija kanala
                  </label>
                  <div className="relative min-w-0 flex-[1.2]">
                    <Tv2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <select
                      id="mobile-channel-category"
                      value={mobileCategoryValue}
                      onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                        const value = event.target.value;
                        setSelectedCategory(value === '__all__' ? null : value);
                      }}
                      className="h-9 w-full min-w-0 appearance-none rounded-lg border border-border bg-secondary py-0 pl-9 pr-7 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      {desktopCategoryItems.map((item) => (
                        <option key={item.id ?? '__all__'} value={item.id ?? '__all__'}>
                          {item.label} ({item.count})
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  </div>
                  <div className="relative min-w-0 flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Pretraži..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-9 min-w-0 rounded-lg border-border bg-secondary pl-9"
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
                className="min-h-0 w-full min-w-0 max-w-full flex-1 px-2 pt-2"
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
