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
import {
  xtreamCodesService,
  loadXtreamCredentials,
  clearXtreamCredentials,
} from '@/services/xtreamCodes';
import { getCurrentProgram, getProgramProgress, type Program } from '@/data/channels';
import type { PlayerChannel } from '@/types/player';
import { filterChannels } from '@lumen/core';
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
    streamId: typeof metadata.streamId === 'number' ? metadata.streamId : undefined,
    mode: metadata.mode === 'live' || metadata.mode === 'catchup' ? metadata.mode : undefined,
    catchUpProgramId: typeof metadata.catchUpProgramId === 'string' ? metadata.catchUpProgramId : undefined,
  };
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

    return null;
  }, [channels, session.source?.channelId, sessionSourceMetadata]);

  const catchUpProgram = useMemo(() => {
    if (!currentChannel || sessionSourceMetadata.mode !== 'catchup') {
      return null;
    }

    const catchUpProgramId = sessionSourceMetadata.catchUpProgramId;
    if (!catchUpProgramId) {
      return null;
    }

    return currentChannel.epg.find(program => program.id === catchUpProgramId) ?? null;
  }, [currentChannel, sessionSourceMetadata]);

  const catchUpPosition = catchUpProgram
    ? Math.max(0, (session.positionMs ?? 0) / 1000)
    : 0;
  const isPlaying = session.playback === 'playing' || session.playback === 'buffering';

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

  const handleCatchUpProgramChange = useCallback(
    (program: Program | null) => {
      if (!currentChannel) {
        return;
      }

      if (!program) {
        switchToLiveChannel(currentChannel);
        return;
      }

      const startTimestamp = Math.floor(program.startTime.getTime() / 1000);
      const duration = Math.floor(
        (program.endTime.getTime() - program.startTime.getTime()) / 1000
      );
      const source = {
        url: xtreamCodesService.getCatchUpUrl(
          currentChannel.streamId,
          startTimestamp,
          duration
        ),
        type: 'hls' as const,
        title: `${currentChannel.name} - ${program.title}`,
        channelId: currentChannel.id,
        metadata: {
          channelId: currentChannel.id,
          streamId: currentChannel.streamId,
          mode: 'catchup',
          catchUpProgramId: program.id,
        },
      };

      commands.setSource(source, 0);
      commands.play();
    },
    [commands, currentChannel, switchToLiveChannel]
  );

  // Load credentials on mount
  useEffect(() => {
    const credentials = loadXtreamCredentials();
    if (!credentials) {
      navigate('/login');
    }
  }, [navigate]);

  // Set first channel when loaded
  useEffect(() => {
    if (channels.length > 0 && !currentChannel) {
      switchToLiveChannel(channels[0]);
    }
  }, [channels, currentChannel, switchToLiveChannel]);

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

  // Handle logout
  const handleLogout = () => {
    clearXtreamCredentials();
    navigate('/login');
  };

  // Toggle play/pause
  const togglePlay = useCallback(() => {
    if (isPlaying) {
      playerRef.current?.pause();
      commands.pause();
    } else {
      playerRef.current?.play();
      commands.play();
    }
  }, [commands, isPlaying]);

  const handleVolumeChange = useCallback((newVolume: number) => {
    playerRef.current?.setVolume(newVolume / 100);
  }, []);

  const handleMuteChange = useCallback((muted: boolean) => {
    playerRef.current?.setMuted(muted);
  }, []);

  const handleCatchUpPositionChange = useCallback((position: number) => {
    if (!catchUpProgram) {
      return;
    }

    playerRef.current?.seek(position);
    commands.seek(Math.floor(position * 1000));
  }, [catchUpProgram, commands]);

  const currentProgram = currentChannel ? getCurrentProgram(currentChannel as any) : undefined;
  const progress = !catchUpProgram && currentProgram ? getProgramProgress(currentProgram) : 0;
  const streamUrl = session.source?.url ?? '';

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
            {currentChannel && (
              <>
                <VideoPlayer
                  ref={playerRef}
                  src={streamUrl}
                  autoPlay={true}
                  onPlay={() => commands.play()}
                  onPause={() => commands.pause()}
                />

                <PlayerControls
                  channel={currentChannel}
                  currentProgram={currentProgram}
                  progress={progress}
                  isPlaying={isPlaying}
                  isFavorite={isFavorite(currentChannel.id)}
                  isFullscreen={isFullscreen}
                  catchUpProgram={catchUpProgram}
                  catchUpPosition={catchUpPosition}
                  onCatchUpProgramChange={handleCatchUpProgramChange}
                  onCatchUpPositionChange={handleCatchUpPositionChange}
                  onTogglePlay={togglePlay}
                  onToggleFavorite={() => toggleFavorite(currentChannel.id)}
                  onVolumeChange={handleVolumeChange}
                  onMuteChange={handleMuteChange}
                  onToggleFullscreen={toggleFullscreen}
                  onPrevChannel={goToPrevChannel}
                  onNextChannel={goToNextChannel}
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
