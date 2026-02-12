import { useState, useRef, useEffect, useCallback } from 'react';
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

const Player = () => {
  const navigate = useNavigate();
  const playerRef = useRef<VideoPlayerHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { channels, categories, isLoading, error } = useXtreamChannels();
  const { favorites, toggleFavorite, isFavorite } = useFavorites();

  const [currentChannel, setCurrentChannel] = useState<PlayerChannel | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isPlaying, setIsPlaying] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [catchUpProgram, setCatchUpProgram] = useState<Program | null>(null);
  const [catchUpPosition, setCatchUpPosition] = useState(0);
  const [progress, setProgress] = useState(0);

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
      setCurrentChannel(channels[0]);
    }
  }, [channels, currentChannel]);

  // Update progress for live stream
  useEffect(() => {
    if (!currentChannel || catchUpProgram) return;

    const interval = setInterval(() => {
      const program = getCurrentProgram(currentChannel as any);
      if (program) {
        setProgress(getProgramProgress(program));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [currentChannel, catchUpProgram]);

  // Get stream URL
  const getStreamUrl = useCallback((): string => {
    if (!currentChannel) return '';

    if (catchUpProgram) {
      const startTimestamp = Math.floor(catchUpProgram.startTime.getTime() / 1000);
      const duration = Math.floor(
        (catchUpProgram.endTime.getTime() - catchUpProgram.startTime.getTime()) / 1000
      );
      return xtreamCodesService.getCatchUpUrl(
        currentChannel.streamId,
        startTimestamp,
        duration
      );
    }

    return xtreamCodesService.getLiveStreamUrl(currentChannel.streamId);
  }, [currentChannel, catchUpProgram]);

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
    setCurrentChannel(channels[nextIndex]);
    setCatchUpProgram(null);
    setCatchUpPosition(0);
  }, [currentChannel, channels]);

  const goToPrevChannel = useCallback(() => {
    if (!currentChannel || channels.length === 0) return;
    const currentIndex = channels.findIndex(c => c.id === currentChannel.id);
    const prevIndex = (currentIndex - 1 + channels.length) % channels.length;
    setCurrentChannel(channels[prevIndex]);
    setCatchUpProgram(null);
    setCatchUpPosition(0);
  }, [currentChannel, channels]);

  // Handle logout
  const handleLogout = () => {
    clearXtreamCredentials();
    navigate('/login');
  };

  // Toggle play/pause
  const togglePlay = useCallback(() => {
    if (isPlaying) {
      playerRef.current?.pause();
    } else {
      playerRef.current?.play();
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying]);

  const handleVolumeChange = useCallback((newVolume: number) => {
    playerRef.current?.setVolume(newVolume / 100);
  }, []);

  const handleMuteChange = useCallback((muted: boolean) => {
    playerRef.current?.setMuted(muted);
  }, []);

  const handleCatchUpPositionChange = useCallback((position: number) => {
    setCatchUpPosition(position);

    if (catchUpProgram) {
      playerRef.current?.seek(position);
    }
  }, [catchUpProgram]);

  const currentProgram = currentChannel ? getCurrentProgram(currentChannel as any) : undefined;

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
                  onClick={() => {
                    setCurrentChannel(channel);
                    setCatchUpProgram(null);
                    setCatchUpPosition(0);
                  }}
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
                  src={getStreamUrl()}
                  autoPlay={true}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
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
                  onCatchUpProgramChange={setCatchUpProgram}
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
                            setCurrentChannel(channel);
                            setCatchUpProgram(null);
                            setCatchUpPosition(0);
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
