import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Heart } from 'lucide-react';
import { getCurrentProgram } from '@lumen/core';
import type { PlayerChannel } from '@lumen/types';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChannelLogo } from '@/components/player/ChannelLogo';

type ChannelListVariant = 'desktop' | 'mobile';

interface ChannelListProps {
  channels: PlayerChannel[];
  currentChannelId?: string;
  variant: ChannelListVariant;
  className?: string;
  onSelectChannel: (channel: PlayerChannel) => void;
  isFavorite: (channelId: string) => boolean;
  onToggleFavorite?: (channelId: string) => void;
}

const rowHeightByVariant: Record<ChannelListVariant, number> = {
  desktop: 74,
  mobile: 78,
};

const ChannelList = ({
  channels,
  currentChannelId,
  variant,
  className,
  onSelectChannel,
  isFavorite,
  onToggleFavorite,
}: ChannelListProps) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const previousActiveChannelIdRef = useRef<string | undefined>(undefined);
  const rowHeight = rowHeightByVariant[variant];

  const rowVirtualizer = useVirtualizer({
    count: channels.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => rowHeight,
    overscan: variant === 'desktop' ? 10 : 8,
  });

  useEffect(() => {
    if (!currentChannelId || previousActiveChannelIdRef.current === currentChannelId) {
      return;
    }

    const activeChannelIndex = channels.findIndex((channel) => channel.id === currentChannelId);
    if (activeChannelIndex < 0) {
      return;
    }

    previousActiveChannelIdRef.current = currentChannelId;
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const activeTop = activeChannelIndex * rowHeight;
    const activeBottom = activeTop + rowHeight;
    const visibleTop = viewport.scrollTop;
    const visibleBottom = visibleTop + viewport.clientHeight;

    if (activeTop < visibleTop) {
      viewport.scrollTo({ top: Math.max(0, activeTop - rowHeight), behavior: 'smooth' });
      return;
    }

    if (activeBottom > visibleBottom) {
      const targetTop = activeBottom - viewport.clientHeight + rowHeight;
      viewport.scrollTo({ top: targetTop, behavior: 'smooth' });
    }
  }, [channels, currentChannelId, rowHeight]);

  const virtualRows = rowVirtualizer.getVirtualItems();

  return (
    <ScrollArea className={className} viewportRef={viewportRef}>
      {channels.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">Nema pronađenih kanala.</div>
      ) : (
        <div
          className={variant === 'desktop' ? 'p-2' : 'px-2'}
          style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}
        >
          {virtualRows.map((virtualRow) => {
            const channel = channels[virtualRow.index];
            const isActive = currentChannelId === channel.id;
            const favorite = isFavorite(channel.id);
            const currentProgram = getCurrentProgram(channel as any);

            return (
              <div
                key={channel.id}
                className="absolute left-0 top-0 w-full"
                style={{
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div
                  className={`h-full ${
                    variant === 'desktop' ? 'px-0 py-0.5' : 'px-0 py-1'
                  }`}
                >
                  <div
                    className={`relative flex h-full items-center gap-3 rounded-xl transition-all ${
                      variant === 'desktop' ? 'px-3 py-2' : 'px-3 py-2.5'
                    } ${
                      isActive
                        ? 'bg-primary/15 ring-2 ring-primary ring-inset shadow-[0_0_0_1px_hsl(var(--primary)/0.25)]'
                        : 'hover:bg-secondary/60'
                    }`}
                  >
                    <span className="w-6 flex-shrink-0 text-xs tabular-nums text-muted-foreground">
                      {channel.number}
                    </span>
                    <button
                      type="button"
                      onClick={() => onSelectChannel(channel)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <div
                        className={`flex-shrink-0 rounded-lg bg-background/50 flex items-center justify-center ${
                          variant === 'desktop' ? 'w-9 h-9' : 'w-10 h-10'
                        }`}
                      >
                        <ChannelLogo
                          logo={channel.logo}
                          name={channel.name}
                          size={variant === 'desktop' ? 'md' : 'lg'}
                        />
                      </div>
                      <div className="min-w-0 flex-1 text-left">
                        <p className={`font-medium truncate ${variant === 'desktop' ? 'text-[1rem] leading-tight' : 'text-sm'}`}>
                          {channel.name}
                        </p>
                        <p
                          className={`text-muted-foreground truncate ${
                            variant === 'desktop' ? 'text-xs' : 'text-[11px]'
                          }`}
                        >
                          {currentProgram?.title ?? channel.categoryName}
                        </p>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleFavorite?.(channel.id)}
                      className={`p-1.5 rounded-lg transition-colors flex-shrink-0 ${
                        favorite
                          ? 'text-primary hover:bg-primary/15'
                          : 'text-muted-foreground/50 hover:bg-secondary/80 hover:text-foreground'
                      }`}
                      aria-label={favorite ? `Ukloni ${channel.name} iz omiljenih` : `Dodaj ${channel.name} u omiljene`}
                      aria-pressed={favorite}
                      disabled={!onToggleFavorite}
                    >
                      <Heart
                        className={`flex-shrink-0 ${variant === 'desktop' ? 'w-5 h-5' : 'w-[18px] h-[18px]'} ${
                          favorite ? 'fill-primary' : ''
                        }`}
                      />
                    </button>
                    {isActive && (
                      <span className="pointer-events-none absolute inset-y-2 left-0 w-[2px] rounded bg-primary" aria-hidden />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ScrollArea>
  );
};

export default ChannelList;
