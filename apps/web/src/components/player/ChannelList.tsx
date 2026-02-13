import { useRef } from 'react';
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
}

const rowHeightByVariant: Record<ChannelListVariant, number> = {
  desktop: 56,
  mobile: 72,
};

const ChannelList = ({
  channels,
  currentChannelId,
  variant,
  className,
  onSelectChannel,
  isFavorite,
}: ChannelListProps) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const rowHeight = rowHeightByVariant[variant];

  const rowVirtualizer = useVirtualizer({
    count: channels.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
  });

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
                <button
                  onClick={() => onSelectChannel(channel)}
                  className={`w-full h-full flex items-center gap-3 rounded-lg transition-colors ${
                    variant === 'desktop' ? 'p-2' : 'p-3'
                  } ${
                    isActive
                      ? 'bg-primary/20 border border-primary/50'
                      : 'hover:bg-secondary'
                  }`}
                >
                  <div
                    className={`rounded-lg bg-background/50 flex items-center justify-center ${
                      variant === 'desktop' ? 'w-10 h-10' : 'w-12 h-12'
                    }`}
                  >
                    <ChannelLogo
                      logo={channel.logo}
                      name={channel.name}
                      size={variant === 'desktop' ? 'md' : 'lg'}
                    />
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <p className={`font-medium truncate ${variant === 'desktop' ? 'text-sm' : ''}`}>
                      {channel.name}
                    </p>
                    <p
                      className={`text-muted-foreground truncate ${
                        variant === 'desktop' ? 'text-xs' : 'text-sm'
                      }`}
                    >
                      {channel.categoryName}
                    </p>
                  </div>
                  {favorite && (
                    <Star
                      className={`text-primary fill-primary flex-shrink-0 ${
                        variant === 'desktop' ? 'w-4 h-4' : 'w-5 h-5'
                      }`}
                    />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </ScrollArea>
  );
};

export default ChannelList;
