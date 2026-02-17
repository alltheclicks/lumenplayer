import { useEffect, useMemo, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Helmet } from 'react-helmet-async';

import { Clock, Loader2, RefreshCw, Search, Tv } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useXtreamChannels } from '@/hooks/useXtreamChannels';
import { loadXtreamCredentials } from '@/services/xtreamCredentials';
import { xtreamCodesService } from '@/services/xtreamService';
import {
  getXMLTVCacheTTL,
  loadXMLTVEPGMap,
  resolveXMLTVProgramsForChannel,
} from '@/services/xmltvEpg';
import { mapXtreamEpgItemToProgram } from '@/services/epgProgramMapper';
import type { PlayerChannel, Program } from '@lumen/types';

const ALL_CATEGORY = '__all__';
const TIMELINE_MINUTES_BEFORE = 60;
const TIMELINE_MINUTES_AFTER = 300;
const PIXELS_PER_MINUTE = 2;
const LEFT_COLUMN_WIDTH = 260;
const DEFAULT_VISIBLE_CHANNELS = 24;

const roundToHalfHour = (date: Date): Date => {
  const rounded = new Date(date);
  const minutes = rounded.getMinutes();
  const flooredMinutes = minutes < 30 ? 0 : 30;
  rounded.setMinutes(flooredMinutes, 0, 0);
  return rounded;
};

const toPx = (minutes: number): number => minutes * PIXELS_PER_MINUTE;

const formatHour = (date: Date): string => (
  date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
);

const minutesBetween = (start: Date, end: Date): number => (
  Math.floor((end.getTime() - start.getTime()) / (1000 * 60))
);

const buildTimelineLabels = (windowStart: Date, totalMinutes: number): Date[] => {
  const labels: Date[] = [];
  for (let offset = 0; offset <= totalMinutes; offset += 30) {
    labels.push(new Date(windowStart.getTime() + offset * 60_000));
  }
  return labels;
};

const fetchChannelEpg = async (channel: PlayerChannel): Promise<Program[]> => {
  if (channel.source !== 'xtream') {
    return channel.epg;
  }

  const credentials = await loadXtreamCredentials();
  if (
    !credentials ||
    credentials.username === 'demo' ||
    credentials.server.includes('your-server.com')
  ) {
    return channel.epg;
  }

  xtreamCodesService.setCredentials(credentials);
  const epg = await xtreamCodesService.getEPG(String(channel.streamId));
  return epg.map(mapXtreamEpgItemToProgram);
};

const clipProgramToWindow = (program: Program, windowStart: Date, windowEnd: Date): {
  id: string;
  title: string;
  leftMinutes: number;
  widthMinutes: number;
  startTime: Date;
  endTime: Date;
} | null => {
  if (program.endTime <= windowStart || program.startTime >= windowEnd) {
    return null;
  }

  const clippedStart = program.startTime < windowStart ? windowStart : program.startTime;
  const clippedEnd = program.endTime > windowEnd ? windowEnd : program.endTime;
  const leftMinutes = minutesBetween(windowStart, clippedStart);
  const widthMinutes = Math.max(20, minutesBetween(clippedStart, clippedEnd));

  return {
    id: program.id,
    title: program.title,
    leftMinutes,
    widthMinutes,
    startTime: program.startTime,
    endTime: program.endTime,
  };
};

const EpgGuide = () => {
  const queryClient = useQueryClient();
  const { channels, categories, isLoading, error } = useXtreamChannels();

  const [selectedCategory, setSelectedCategory] = useState<string>(ALL_CATEGORY);
  const [searchQuery, setSearchQuery] = useState('');
  const [now, setNow] = useState(() => new Date());
  const [visibleChannelsCount, setVisibleChannelsCount] = useState(DEFAULT_VISIBLE_CHANNELS);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 30_000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setVisibleChannelsCount(DEFAULT_VISIBLE_CHANNELS);
  }, [searchQuery, selectedCategory]);

  const windowStart = useMemo(() => {
    const roundedNow = roundToHalfHour(now);
    return new Date(roundedNow.getTime() - TIMELINE_MINUTES_BEFORE * 60_000);
  }, [now]);

  const totalMinutes = TIMELINE_MINUTES_BEFORE + TIMELINE_MINUTES_AFTER;
  const windowEnd = useMemo(
    () => new Date(windowStart.getTime() + totalMinutes * 60_000),
    [windowStart, totalMinutes]
  );
  const nowOffsetMinutes = useMemo(
    () => Math.max(0, Math.min(totalMinutes, minutesBetween(windowStart, now))),
    [now, totalMinutes, windowStart]
  );
  const timelineWidth = toPx(totalMinutes);

  const filteredChannels = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return channels.filter((channel) => {
      const categoryMatch = selectedCategory === ALL_CATEGORY || channel.categoryId === selectedCategory;
      const searchMatch = query.length === 0 || channel.name.toLowerCase().includes(query);
      return categoryMatch && searchMatch;
    });
  }, [channels, searchQuery, selectedCategory]);

  const visibleChannels = useMemo(
    () => filteredChannels.slice(0, visibleChannelsCount),
    [filteredChannels, visibleChannelsCount]
  );

  const hasMoreChannels = visibleChannelsCount < filteredChannels.length;

  const xmltvCacheQuery = useQuery({
    queryKey: ['xmltv-epg-map'],
    queryFn: () => loadXMLTVEPGMap(),
    staleTime: getXMLTVCacheTTL(),
    gcTime: getXMLTVCacheTTL() * 2,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const epgQueries = useQueries({
    queries: visibleChannels.map((channel) => ({
      queryKey: ['epg-guide', channel.id, channel.streamId, Boolean(xmltvCacheQuery.data)],
      queryFn: async () => {
        const xmltvPrograms = resolveXMLTVProgramsForChannel(channel, xmltvCacheQuery.data);
        if (xmltvPrograms && xmltvPrograms.length > 0) {
          return xmltvPrograms;
        }

        return fetchChannelEpg(channel);
      },
      staleTime: 2 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      retry: 1,
    })),
  });

  const timelineLabels = useMemo(
    () => buildTimelineLabels(windowStart, totalMinutes),
    [windowStart, totalMinutes]
  );

  return (
    <>
      <Helmet>
        <title>EPG Guide - IPTV Player</title>
      </Helmet>

      <div className="bg-background p-4 md:p-6">
        <div className="mx-auto max-w-[1400px] space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">EPG Grid</h1>
            <span className="text-sm text-muted-foreground">
              TV guide view ({TIMELINE_MINUTES_BEFORE / 60}h back / {TIMELINE_MINUTES_AFTER / 60}h ahead)
            </span>
          </div>

          <div className="flex flex-col gap-3 rounded-lg border border-border/70 bg-card/50 p-3 md:flex-row md:items-center md:justify-between">
            <div className="relative w-full max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search channels..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1">
              <Button
                size="sm"
                variant={selectedCategory === ALL_CATEGORY ? 'default' : 'outline'}
                onClick={() => setSelectedCategory(ALL_CATEGORY)}
              >
                All
              </Button>
              {categories.map((category) => (
                <Button
                  key={category.id}
                  size="sm"
                  variant={selectedCategory === category.id ? 'default' : 'outline'}
                  onClick={() => setSelectedCategory(category.id)}
                >
                  {category.name}
                </Button>
              ))}
            </div>
          </div>

          {isLoading && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading channels...
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive">Failed to load channels: {error.message}</p>
          )}

          {!isLoading && !error && filteredChannels.length === 0 && (
            <p className="text-sm text-muted-foreground">No channels found for the selected filters.</p>
          )}

          {!isLoading && !error && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-card/30 px-3 py-2 text-xs text-muted-foreground">
              <span>
                {xmltvCacheQuery.isLoading
                  ? 'Loading XMLTV cache...'
                  : xmltvCacheQuery.data
                    ? `XMLTV cache active for ${Object.keys(xmltvCacheQuery.data).length} channels`
                    : 'XMLTV cache unavailable (fallback to per-channel EPG requests)'}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                disabled={xmltvCacheQuery.isLoading}
                onClick={async () => {
                  try {
                    const refreshed = await loadXMLTVEPGMap({ forceRefresh: true });
                    queryClient.setQueryData(['xmltv-epg-map'], refreshed);
                    await queryClient.invalidateQueries({ queryKey: ['epg-guide'] });
                  } catch {
                    // UI continues to fallback per channel via existing query pipeline.
                  }
                }}
              >
                <RefreshCw className="mr-1 h-3 w-3" />
                Refresh XMLTV
              </Button>
            </div>
          )}

          {!isLoading && !error && visibleChannels.length > 0 && (
            <div className="space-y-4">
              <div className="overflow-auto rounded-lg border border-border/70 bg-card/30" style={{ maxHeight: '70vh' }}>
                <div style={{ minWidth: LEFT_COLUMN_WIDTH + timelineWidth }}>
                  <div className="sticky top-0 z-20 flex border-b border-border bg-card/95 backdrop-blur">
                    <div
                      className="sticky left-0 z-30 flex items-center gap-2 border-r border-border bg-card px-3 py-3"
                      style={{ width: LEFT_COLUMN_WIDTH }}
                    >
                      <Tv className="h-4 w-4 text-primary" />
                      <span className="text-sm font-semibold">Channel</span>
                    </div>
                    <div className="relative" style={{ width: timelineWidth }}>
                      {timelineLabels.map((label) => {
                        const left = toPx(minutesBetween(windowStart, label));
                        return (
                          <div
                            key={label.toISOString()}
                            className="absolute top-0 bottom-0 border-l border-border/60"
                            style={{ left }}
                          >
                            <span className="absolute left-2 top-2 text-xs text-muted-foreground">
                              {formatHour(label)}
                            </span>
                          </div>
                        );
                      })}
                      <div
                        className="absolute bottom-0 top-0 w-px bg-destructive"
                        style={{ left: toPx(nowOffsetMinutes) }}
                      />
                    </div>
                  </div>

                  <div>
                    {visibleChannels.map((channel, index) => {
                      const query = epgQueries[index];
                      const programs = (query?.data ?? channel.epg)
                        .slice()
                        .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
                        .map((program) => clipProgramToWindow(program, windowStart, windowEnd))
                        .filter((program): program is NonNullable<typeof program> => Boolean(program));

                      return (
                        <div key={channel.id} className="flex border-b border-border/60">
                          <div
                            className="sticky left-0 z-10 flex flex-col justify-center gap-1 border-r border-border bg-card px-3 py-2"
                            style={{ width: LEFT_COLUMN_WIDTH }}
                          >
                            <p className="truncate text-sm font-medium">{channel.number}. {channel.name}</p>
                            <p className="truncate text-xs text-muted-foreground">{channel.categoryName}</p>
                          </div>

                          <div className="relative h-[68px]" style={{ width: timelineWidth }}>
                            {timelineLabels.map((label) => {
                              const left = toPx(minutesBetween(windowStart, label));
                              return (
                                <div
                                  key={`${channel.id}-${label.toISOString()}`}
                                  className="absolute bottom-0 top-0 border-l border-border/40"
                                  style={{ left }}
                                />
                              );
                            })}

                            <div
                              className="absolute bottom-0 top-0 w-px bg-destructive/80"
                              style={{ left: toPx(nowOffsetMinutes) }}
                            />

                            {query?.isLoading && (
                              <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                                Loading EPG...
                              </div>
                            )}

                            {!query?.isLoading && programs.length === 0 && (
                              <div className="absolute inset-0 flex items-center px-3 text-xs text-muted-foreground">
                                No EPG data in current timeline window.
                              </div>
                            )}

                            {programs.map((program) => (
                              <div
                                key={`${channel.id}-${program.id}`}
                                className="absolute top-2 h-12 overflow-hidden rounded-md border border-primary/30 bg-primary/15 px-2 py-1"
                                style={{
                                  left: toPx(program.leftMinutes),
                                  width: toPx(program.widthMinutes),
                                }}
                                title={`${program.title} (${formatHour(program.startTime)} - ${formatHour(program.endTime)})`}
                              >
                                <p className="truncate text-xs font-medium">{program.title}</p>
                                <p className="truncate text-[11px] text-muted-foreground">
                                  {formatHour(program.startTime)} - {formatHour(program.endTime)}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Current time marker is highlighted in red.
                </div>
                <span>
                  Showing {visibleChannels.length} / {filteredChannels.length} channels
                </span>
              </div>

              {hasMoreChannels && (
                <div className="flex justify-center">
                  <Button variant="outline" onClick={() => setVisibleChannelsCount((count) => count + DEFAULT_VISIBLE_CHANNELS)}>
                    Load more channels
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default EpgGuide;
