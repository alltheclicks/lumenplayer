import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Star } from 'lucide-react';
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
  desktop: 52,
  mobile: 64,
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
  const scrollToActiveIndexRef = useRef<(index: number) => void>(() => undefined);
  const rowHeight = rowHeightByVariant[variant];

  const rowVirtualizer = useVirtualizer({
    count: channels.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => rowHeight,
    overscan: variant === 'desktop' ? 10 : 8,
  });

  scrollToActiveIndexRef.current = (index: number) => {
    rowVirtualizer.scrollToIndex(index, { align: 'auto' });
  };

  useEffect(() => {
    if (!currentChannelId || previousActiveChannelIdRef.current === currentChannelId) {
      return;
    }

    const activeChannelIndex = channels.findIndex((channel) => channel.id === currentChannelId);
    if (activeChannelIndex < 0) {
      return;
    }

    previousActiveChannelIdRef.current = currentChannelId;
    scrollToActiveIndexRef.current(activeChannelIndex);
  }, [channels, currentChannelId]);

  const virtualRows = rowVirtualizer.getVirtualItems();

  return (
    <ScrollArea className={className} viewportRef={viewportRef}>
      {channels.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">No channels found.</div>
      ) : (
        <div
          className={variant === 'desktop' ? 'p-2' : 'pr-4'}
          style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}
        >
          {virtualRows.map((virtualRow) => {
            const channel = channels[virtualRow.index];
            const isActive = currentChannelId === channel.id;
            const favorite = isFavorite(channel.id);

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
                  className={`flex h-full items-center gap-2 rounded-lg border transition-colors ${
                    variant === 'desktop' ? 'px-2 py-1.5' : 'px-2.5 py-2'
                  } ${
                    isActive
                      ? 'border-primary/55 bg-primary/15 shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.35)]'
                      : 'border-transparent hover:border-border/70 hover:bg-secondary/80'
                  }`}
                >
                  <span
                    className={`h-7 w-1 rounded-full transition-colors ${
                      isActive ? 'bg-primary' : 'bg-border/30'
                    }`}
                    aria-hidden
                  />
                  <button
                    type="button"
                    onClick={() => onSelectChannel(channel)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                  <div
                    className={`rounded-lg bg-background/50 flex items-center justify-center ${
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
                      <div className="flex items-center gap-2">
                        <p className={`font-medium truncate ${variant === 'desktop' ? 'text-sm leading-tight' : ''}`}>
                          {channel.name}
                        </p>
                        <span className="hidden rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:inline-block">
                          {channel.number}
                        </span>
                      </div>
                      <p
                        className={`text-muted-foreground truncate ${
                          variant === 'desktop' ? 'text-[11px]' : 'text-xs'
                        }`}
                      >
                        {channel.categoryName}
                      </p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleFavorite?.(channel.id)}
                    className={`rounded-md p-1.5 transition-colors ${
                      favorite
                        ? 'text-primary hover:bg-primary/15'
                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                    }`}
                    aria-label={favorite ? `Remove ${channel.name} from favorites` : `Add ${channel.name} to favorites`}
                    aria-pressed={favorite}
                    disabled={!onToggleFavorite}
                  >
                    <Star
                      className={`flex-shrink-0 ${variant === 'desktop' ? 'w-4 h-4' : 'w-[18px] h-[18px]'} ${
                        favorite ? 'fill-primary' : ''
                      }`}
                    />
                  </button>
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
