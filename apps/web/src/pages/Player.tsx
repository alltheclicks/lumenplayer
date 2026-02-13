import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import {
  Search,
  Menu,
  Star,
  LogOut,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import VideoPlayer, { type VideoPlayerHandle } from '@/components/player/VideoPlayer';
import PlayerControls from '@/components/player/PlayerControls';
import { ChannelLogo } from '@/components/player/ChannelLogo';
import { useXtreamChannels } from '@/hooks/useXtreamChannels';
import { useFavorites } from '@/hooks/useFavorites';
import { useSessionContext } from '@/context/session-context';
import { NumericChannelInput, WebKeyCodes } from '@lumen/input';
import { filterChannels, getCurrentProgram, getProgramProgress } from '@lumen/core';
import type { PlayerChannel } from '@lumen/types';
import {
  loadXtreamCredentials,
  clearXtreamCredentials,
} from '@/services/xtreamCredentials';
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

type SessionSourceMetadata = {
  channelId?: string;
  streamId?: number;
  mode?: 'live' | 'catchup';
  catchUpProgramId?: string;
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
    mode: metadata.mode === 'live' || metadata.mode === 'catchup' ? metadata.mode : undefined,
    catchUpProgramId: typeof metadata.catchUpProgramId === 'string' ? metadata.catchUpProgramId : undefined,
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

const Player = () => {
  const navigate = useNavigate();
  const playerRef = useRef<VideoPlayerHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { channels, categories, isLoading, error } = useXtreamChannels();
  const { favorites, toggleFavorite, isFavorite } = useFavorites();
  const { session, commands } = useSessionContext();

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [numericZapBuffer, setNumericZapBuffer] = useState<string | null>(null);
  const [numericZapMatchName, setNumericZapMatchName] = useState<string | null>(null);
  const numericInputRef = useRef<NumericChannelInput<PlayerChannel> | null>(null);
  const watchedChannelIdRef = useRef<string | null>(null);
  const watchedStartedAtRef = useRef<number | null>(null);

  const sessionSourceMetadata = useMemo(
    () => parseSessionSourceMetadata(session.source?.metadata),
    [session.source?.metadata]
  );

  const currentChannel = useMemo(() => {
    if (channels.length === 0) {
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
  }, [channels, session.source?.channelId, session.source?.title, sessionSourceMetadata]);

  const switchToLiveChannel = useCallback(
    (channel: PlayerChannel) => {
      const source = {
        url: xtreamCodesService.getLiveStreamUrl(channel.streamId),
        type: 'hls' as const,
        title: channel.name,
        channelId: channel.id,
        metadata: {
          channelId: channel.id,
          streamId: channel.streamId,
          mode: 'live',
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

  // Set first channel when loaded
  useEffect(() => {
    if (channels.length > 0 && !currentChannel && !session.source) {
      switchToLiveChannel(channels[0]);
    }
  }, [channels, currentChannel, session.source, switchToLiveChannel]);

  useEffect(() => {
    if (!currentChannel) {
      return;
    }

    const now = Date.now();
    const previousChannelId = watchedChannelIdRef.current;
    const startedAt = watchedStartedAtRef.current;
    const watchedDuration = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;

    if (previousChannelId && previousChannelId !== currentChannel.id) {
      void addWatchHistoryEntry({
        channelId: previousChannelId,
        timestamp: now,
        duration: watchedDuration,
        progress: watchedDuration,
      });
    }

    watchedChannelIdRef.current = currentChannel.id;
    watchedStartedAtRef.current = now;
  }, [currentChannel]);

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
  const filteredChannels = filterChannels(channels, searchQuery).filter(channel => {
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
    toggleFullscreen,
    togglePlayback,
  ]);

  // Handle logout
  const handleLogout = () => {
    void clearXtreamCredentials().finally(() => {
      navigate('/login');
    });
  };

  const currentProgram = currentChannel ? getCurrentProgram(currentChannel as any) : undefined;
  const progress = currentProgram ? getProgramProgress(currentProgram) : 0;

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
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowLogoutDialog(true)}
              >
                <LogOut className="w-4 h-4" />
              </Button>
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
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {filteredChannels.map(channel => (
                <button
                  key={channel.id}
                  onClick={() => switchToLiveChannel(channel)}
                  className={`w-full flex items-center gap-3 p-2 rounded-lg transition-colors ${currentChannel?.id === channel.id
                      ? 'bg-primary/20 border border-primary/50'
                      : 'hover:bg-secondary'
                    }`}
                >
                  <div className="w-10 h-10 rounded-lg bg-background/50 flex items-center justify-center">
                    <ChannelLogo logo={channel.logo} name={channel.name} />
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <p className="font-medium text-sm truncate">{channel.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {channel.categoryName}
                    </p>
                  </div>
                  {isFavorite(channel.id) && (
                    <Star className="w-4 h-4 text-primary fill-primary flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>
          </ScrollArea>
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

            {currentChannel && (
              <>
                <VideoPlayer
                  ref={playerRef}
                  autoPlay={true}
                />

                <PlayerControls
                  channel={currentChannel}
                  currentProgram={currentProgram}
                  progress={progress}
                  isFavorite={isFavorite(currentChannel.id)}
                  isFullscreen={isFullscreen}
                  onToggleFavorite={() => toggleFavorite(currentChannel.id)}
                  onToggleFullscreen={toggleFullscreen}
                  onPrevChannel={goToPrevChannel}
                  onNextChannel={goToNextChannel}
                  playerRef={playerRef}
                />
              </>
            )}

            {!currentChannel && (
              <div className="absolute inset-0 flex items-center justify-center">
                <p className="text-muted-foreground">Select a channel to start watching</p>
              </div>
            )}
          </div>

          {/* Mobile channel selector */}
          <div className="lg:hidden p-4 border-t border-border">
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

                  <ScrollArea className="h-[calc(80vh-200px)]">
                    <div className="space-y-1 pr-4">
                      {filteredChannels.map(channel => (
                        <button
                          key={channel.id}
                          onClick={() => {
                            switchToLiveChannel(channel);
                            setSidebarOpen(false);
                          }}
                          className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors ${currentChannel?.id === channel.id
                              ? 'bg-primary/20 border border-primary/50'
                              : 'hover:bg-secondary'
                            }`}
                        >
                          <div className="w-12 h-12 rounded-lg bg-background/50 flex items-center justify-center">
                            <ChannelLogo logo={channel.logo} name={channel.name} size="lg" />
                          </div>
                          <div className="flex-1 text-left min-w-0">
                            <p className="font-medium truncate">{channel.name}</p>
                            <p className="text-sm text-muted-foreground truncate">
                              {channel.categoryName}
                            </p>
                          </div>
                          {isFavorite(channel.id) && (
                            <Star className="w-5 h-5 text-primary fill-primary flex-shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              </SheetContent>
            </Sheet>

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
