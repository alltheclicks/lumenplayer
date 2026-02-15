import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import {
  Search,
  Menu,
  Star,
  LogOut,
  Loader2,
  AlertCircle,
  Film,
  Play,
  Pause,
  PictureInPicture2,
  Cast,
  Airplay,
  SkipBack,
  SkipForward,
  Smartphone,
  CalendarDays,
  Settings2,
} from 'lucide-react';
import VideoPlayer, { type VideoPlayerHandle } from '@/components/player/VideoPlayer';
import PlayerControls from '@/components/player/PlayerControls';
import ChannelList from '@/components/player/ChannelList';
import { useXtreamChannels } from '@/hooks/useXtreamChannels';
import { useFavorites } from '@/hooks/useFavorites';
import { useSessionContext } from '@/context/session-context';
import { useGoogleCastSender } from '@/hooks/useGoogleCastSender';
import { NumericChannelInput, WebKeyCodes } from '@lumen/input';
import { filterChannels, getCurrentProgram, getProgramProgress } from '@lumen/core';
import type { PlayerChannel, Program, XtreamEPGItem } from '@lumen/types';
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
import { addWatchHistoryEntry } from '@/services/watchHistory';
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

type SessionSourceMetadata = {
  channelId?: string;
  streamId?: number;
  mode?: 'live' | 'catchup' | 'vod' | 'series-episode';
  catchUpProgramId?: string;
  seriesId?: string;
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
    catchUpProgramId: typeof metadata.catchUpProgramId === 'string' ? metadata.catchUpProgramId : undefined,
    seriesId: typeof metadata.seriesId === 'string' ? metadata.seriesId : undefined,
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

const PICTURE_IN_PICTURE_KEY_CODE = 80; // Keyboard "P"

const parseEpgTimestamp = (timestamp: string, fallback: string): Date => {
  const numericTimestamp = Number(timestamp);
  if (Number.isFinite(numericTimestamp) && numericTimestamp > 0) {
    return new Date(numericTimestamp * 1000);
  }

  const normalizedDate = fallback.replace(' ', 'T');
  const parsedTimestamp = Date.parse(normalizedDate);
  if (!Number.isNaN(parsedTimestamp)) {
    return new Date(parsedTimestamp);
  }

  return new Date();
};

const mapXtreamEpgItemToProgram = (item: XtreamEPGItem, index: number): Program => {
  const startTime = parseEpgTimestamp(item.start_timestamp, item.start);
  const endTime = parseEpgTimestamp(item.stop_timestamp, item.end);
  const now = Date.now();

  return {
    id: item.id || item.epg_id || `${item.channel_id}-${index}`,
    title: item.title || 'Untitled Program',
    description: item.description || '',
    startTime,
    endTime,
    category: 'show',
    hasCatchUp: item.has_archive === 1 || startTime.getTime() < now,
  };
};

const Player = () => {
  const navigate = useNavigate();
  const playerRef = useRef<VideoPlayerHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { channels, categories, isLoading, error } = useXtreamChannels();
  const { favorites, toggleFavorite, isFavorite } = useFavorites();
  const { session, commands } = useSessionContext();
  const { toast } = useToast();
  const castSender = useGoogleCastSender({ session, commands });

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [numericZapBuffer, setNumericZapBuffer] = useState<string | null>(null);
  const [numericZapMatchName, setNumericZapMatchName] = useState<string | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings>(getDefaultAppSettings());
  const [isPictureInPictureSupported, setIsPictureInPictureSupported] = useState(false);
  const [isPictureInPicture, setIsPictureInPicture] = useState(false);
  const [isAirPlaySupported, setIsAirPlaySupported] = useState(false);
  const [isAirPlayAvailable, setIsAirPlayAvailable] = useState(false);
  const [isAirPlayConnected, setIsAirPlayConnected] = useState(false);
  const numericInputRef = useRef<NumericChannelInput<PlayerChannel> | null>(null);
  const watchedChannelIdRef = useRef<string | null>(null);
  const watchedStartedAtRef = useRef<number | null>(null);
  const lastCastErrorRef = useRef<string | null>(null);

  const sessionSourceMetadata = useMemo(
    () => parseSessionSourceMetadata(session.source?.metadata),
    [session.source?.metadata]
  );
  const isOnDemandSource = sessionSourceMetadata.mode === 'vod' ||
    sessionSourceMetadata.mode === 'series-episode';
  const usesLocalRenderer = session.renderer === 'local-web' || session.renderer === 'airplay';

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
      const epg = await xtreamCodesService.getEPG(String(currentChannel.streamId));
      return epg.map(mapXtreamEpgItemToProgram);
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
    (channel: PlayerChannel) => {
      const sourceUrl = channel.streamUrl ?? xtreamCodesService.getLiveStreamUrl(channel.streamId);
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
      commands.play();
    },
    [commands]
  );

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
      const loadedSettings = await loadAppSettings();
      if (!isCancelled) {
        setAppSettings(loadedSettings);
      }
    };

    void hydrateSettings();

    return () => {
      isCancelled = true;
    };
  }, []);

  // Set first channel when loaded
  useEffect(() => {
    if (channels.length > 0 && !currentChannel && !session.source) {
      switchToLiveChannel(channels[0]);
    }
  }, [channels, currentChannel, session.source, switchToLiveChannel]);

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

  const togglePlayback = useCallback(() => {
    if (!session.source) {
      return;
    }

    if (session.playback === 'playing' || session.playback === 'buffering') {
      playerRef.current?.pause();
      commands.pause();
      return;
    }

    playerRef.current?.play();
    commands.play();
  }, [commands, session.playback, session.source]);

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
          playerRef.current?.play();
          commands.play();
          return;
        case WebKeyCodes.pause:
          event.preventDefault();
          playerRef.current?.pause();
          commands.pause();
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
  const onDemandTitle = sessionSourceMetadata.mode === 'series-episode'
    ? 'Episode Playback'
    : 'VOD Playback';
  const onDemandBackPath = sessionSourceMetadata.mode === 'series-episode' && sessionSourceMetadata.seriesId
    ? `/series/${sessionSourceMetadata.seriesId}`
    : '/vod';
  const onDemandBackLabel = sessionSourceMetadata.mode === 'series-episode'
    ? 'Back to Series'
    : 'Back to VOD';

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading channels...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Failed to load channels</h2>
          <p className="text-muted-foreground mb-4">{error.message}</p>
          <Button onClick={() => navigate('/login')}>Back to Login</Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Helmet>
        <title>{currentChannel ? `${currentChannel.name} - IPTV Player` : 'IPTV Player'}</title>
      </Helmet>

      <div className="min-h-screen bg-background flex">
        {/* Sidebar for desktop */}
        <aside className="hidden lg:flex w-80 flex-col border-r border-border bg-card">
          <div className="p-4 border-b border-border">
            <div className="flex items-center justify-between mb-4">
              <h1 className="text-xl font-bold">Channels</h1>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => navigate('/vod')}>
                  VOD
                </Button>
                <Button variant="ghost" size="sm" onClick={() => navigate('/series')}>
                  Series
                </Button>
                <Button variant="ghost" size="sm" onClick={() => navigate('/epg')}>
                  EPG
                </Button>
                <Button variant="ghost" size="sm" onClick={() => navigate('/settings')}>
                  Settings
                </Button>
                {castSender.isAvailable && (
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={castSender.isConnecting}
                    onClick={() => {
                      void castSender.toggleCasting();
                    }}
                    title={castSender.isConnected ? 'Disconnect Cast' : 'Connect Cast'}
                  >
                    <Cast className={`w-4 h-4 ${castSender.isConnected ? 'text-primary' : ''}`} />
                  </Button>
                )}
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

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search channels..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          {/* Categories */}
          <div className="p-2 border-b border-border overflow-x-auto">
            <div className="flex gap-1 min-w-max">
              <Button
                variant={selectedCategory === null ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setSelectedCategory(null)}
              >
                All
              </Button>
              <Button
                variant={selectedCategory === 'favorites' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setSelectedCategory('favorites')}
              >
                <Star className="w-4 h-4 mr-1" />
                Favorites
              </Button>
              {categories.map(cat => (
                <Button
                  key={cat.id}
                  variant={selectedCategory === cat.id ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setSelectedCategory(cat.id)}
                >
                  {cat.name}
                </Button>
              ))}
            </div>
          </div>

          {/* Channel list */}
          <ChannelList
            className="flex-1"
            channels={filteredChannels}
            currentChannelId={currentChannel?.id}
            variant="desktop"
            onSelectChannel={switchToLiveChannel}
            isFavorite={isFavorite}
          />
        </aside>

        {/* Main content */}
        <main className="flex-1 flex flex-col">
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
                  <div className="text-xs text-destructive mt-1">No channel</div>
                )}
              </div>
            )}

            {session.source && usesLocalRenderer && (
              <VideoPlayer
                ref={playerRef}
                autoPlay={appSettings.player.autoplay}
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
                  playerRef={playerRef}
                  defaultVolume={appSettings.player.defaultVolume}
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
                        {castSender.isConnected ? 'Disconnect Cast' : 'Cast'}
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
              <div className="absolute inset-0 flex items-center justify-center">
                <p className="text-muted-foreground">Select a channel to start watching</p>
              </div>
            )}
          </div>

          {/* Mobile channel selector */}
          <div className="lg:hidden p-4 border-t border-border">
            <div className="mb-3 grid grid-cols-4 gap-2">
              <Button variant="outline" size="sm" onClick={() => navigate('/vod')}>
                <Film className="mr-1 h-4 w-4" />
                VOD
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate('/series')}>
                <Play className="mr-1 h-4 w-4" />
                Series
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate('/epg')}>
                <CalendarDays className="mr-1 h-4 w-4" />
                EPG
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate('/settings')}>
                <Settings2 className="mr-1 h-4 w-4" />
                Settings
              </Button>
            </div>
            {castSender.isAvailable && (
              <Button
                variant={castSender.isConnected ? 'default' : 'outline'}
                size="sm"
                className="mb-2 w-full"
                disabled={castSender.isConnecting}
                onClick={() => {
                  void castSender.toggleCasting();
                }}
              >
                <Cast className="mr-2 h-4 w-4" />
                {castSender.isConnected ? 'Disconnect Cast' : 'Connect Cast'}
              </Button>
            )}
            {isAirPlaySupported && session.renderer !== 'cast' && (
              <Button
                variant={isAirPlayConnected ? 'default' : 'outline'}
                size="sm"
                className="mb-2 w-full"
                disabled={!isAirPlayAvailable}
                onClick={openAirPlayPicker}
              >
                <Airplay className="mr-2 h-4 w-4" />
                {isAirPlayConnected ? 'AirPlay Active' : 'Connect AirPlay'}
              </Button>
            )}
            <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" className="w-full gap-2">
                  <Menu className="w-4 h-4" />
                  {currentChannel?.name || 'Select Channel'}
                </Button>
              </SheetTrigger>
              <SheetContent side="bottom" className="h-[80vh]">
                <SheetHeader>
                  <SheetTitle>Channels</SheetTitle>
                </SheetHeader>

                <div className="mt-4 space-y-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Search channels..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9"
                    />
                  </div>

                  <div className="flex gap-1 overflow-x-auto pb-2">
                    <Button
                      variant={selectedCategory === null ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setSelectedCategory(null)}
                    >
                      All
                    </Button>
                    <Button
                      variant={selectedCategory === 'favorites' ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setSelectedCategory('favorites')}
                    >
                      <Star className="w-4 h-4 mr-1" />
                      Favorites
                    </Button>
                    {categories.map(cat => (
                      <Button
                        key={cat.id}
                        variant={selectedCategory === cat.id ? 'default' : 'ghost'}
                        size="sm"
                        onClick={() => setSelectedCategory(cat.id)}
                      >
                        {cat.name}
                      </Button>
                    ))}
                  </div>

                  <ChannelList
                    className="h-[calc(80vh-200px)]"
                    channels={filteredChannels}
                    currentChannelId={currentChannel?.id}
                    variant="mobile"
                    onSelectChannel={(channel) => {
                      switchToLiveChannel(channel);
                      setSidebarOpen(false);
                    }}
                    isFavorite={isFavorite}
                  />
                </div>
              </SheetContent>
            </Sheet>

            <Button
              variant="outline"
              size="sm"
              className="w-full mt-2"
              onClick={() => navigate('/vod')}
            >
              VOD Catalog
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="w-full mt-2"
              onClick={() => navigate('/series')}
            >
              Series Catalog
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="w-full mt-2"
              onClick={() => setShowLogoutDialog(true)}
            >
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </Button>
          </div>
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
