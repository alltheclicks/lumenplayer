import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import {
  CalendarDays,
  Clapperboard,
  Clock3,
  Heart,
  Home,
  Info,
  LogOut,
  Play,
  Search,
  Tv,
  Volume2,
  Maximize,
  ChevronLeft,
  Film,
} from 'lucide-react';
import { useLiveShellSnapshot } from '@/features/studio/hooks/useStudioData';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const LiveShellPage = () => {
  const { data } = useLiveShellSnapshot();
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedChannelId, setSelectedChannelId] = useState<string>('');
  const deferredSearchQuery = useDeferredValue(searchQuery);

  useEffect(() => {
    if (!data || selectedChannelId) {
      return;
    }

    setSelectedChannelId(data.selectedChannelId);
  }, [data, selectedChannelId]);

  const filteredChannels = useMemo(() => {
    if (!data) {
      return [];
    }

    const normalizedQuery = deferredSearchQuery.trim().toLowerCase();

    return data.channels.filter((channel) => {
      const matchesCategory = (
        selectedCategoryId === 'all' ||
        (selectedCategoryId === 'favorites' ? channel.isFavorite : channel.categoryId === selectedCategoryId)
      );

      const matchesQuery = normalizedQuery.length === 0 || (
        channel.name.toLowerCase().includes(normalizedQuery) ||
        channel.subtitle.toLowerCase().includes(normalizedQuery)
      );

      return matchesCategory && matchesQuery;
    });
  }, [data, deferredSearchQuery, selectedCategoryId]);

  const selectedChannel = filteredChannels.find((channel) => channel.id === selectedChannelId)
    ?? filteredChannels[0]
    ?? data?.channels[0];

  useEffect(() => {
    if (!selectedChannel) {
      return;
    }

    if (!filteredChannels.some((channel) => channel.id === selectedChannelId)) {
      setSelectedChannelId(selectedChannel.id);
    }
  }, [filteredChannels, selectedChannel, selectedChannelId]);

  if (!data || !selectedChannel) {
    return null;
  }

  return (
    <>
      <Helmet>
        <title>TV Uživo - Lumen Next</title>
      </Helmet>

      <div className="min-h-screen bg-background text-foreground">
        <div className="mx-auto hidden min-h-screen max-w-[1440px] grid-cols-[152px_274px_minmax(0,1fr)] overflow-hidden lg:grid">
          <aside className="flex min-h-screen flex-col border-r border-border bg-sidebar-background">
            <div className="flex items-center gap-3 border-b border-border px-5 py-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                <Play className="h-5 w-5 fill-current" />
              </div>
              <div>
                <div className="text-xl font-semibold">Lumen</div>
                <div className="text-sm text-muted-foreground">Next sandbox</div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-2 py-4">
              <div className="space-y-1">
                {data.categories.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => setSelectedCategoryId(category.id)}
                    className={cn(
                      'flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-sm transition-colors',
                      selectedCategoryId === category.id
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-secondary/80 hover:text-foreground',
                    )}
                  >
                    <span>{category.label}</span>
                    <span className={cn(
                      'rounded-full px-2 py-0.5 text-xs',
                      selectedCategoryId === category.id ? 'bg-black/20 text-white' : 'bg-primary/15 text-primary',
                    )}
                    >
                      {category.count}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-border p-3">
              <a
                href="/vod"
                className="starlight-border starlight-border-amber mb-2 flex items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-300"
              >
                <Film className="h-4 w-4" />
                Filmovi
              </a>
              <a
                href="/series"
                className="starlight-border starlight-border-purple flex items-center gap-2 rounded-xl border border-purple-500/25 bg-purple-500/10 px-4 py-3 text-sm font-medium text-purple-300"
              >
                <Clapperboard className="h-4 w-4" />
                Serije
              </a>

              <div className="mt-3 rounded-xl border border-border bg-card px-4 py-3">
                <div className="text-sm font-medium">{data.accountLabel}</div>
                <div className="mt-1 text-xs text-muted-foreground">{data.accountMeta}</div>
                <div className="mt-3 flex items-center justify-between text-muted-foreground">
                  <Home className="h-4 w-4" />
                  <LogOut className="h-4 w-4" />
                </div>
              </div>
            </div>
          </aside>

          <section className="min-h-screen border-r border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Pretraži kanale..."
                  className="border-border/80 bg-background/40 pl-9"
                />
              </div>
            </div>

            <div className="player-scrollbar h-[calc(100vh-73px)] overflow-y-auto px-3 py-3">
              <div className="space-y-1.5">
                {filteredChannels.map((channel) => {
                  const currentProgram = channel.programs[0];
                  const active = channel.id === selectedChannel.id;

                  return (
                    <button
                      key={channel.id}
                      type="button"
                      onClick={() => setSelectedChannelId(channel.id)}
                      className={cn(
                        'relative flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-all',
                        active
                          ? 'bg-primary/15 ring-2 ring-primary ring-inset shadow-[0_0_0_1px_hsl(var(--primary)/0.25)]'
                          : 'hover:bg-secondary/60',
                      )}
                    >
                      <span className="w-6 text-xs tabular-nums text-muted-foreground">{channel.number}</span>
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-background/50">
                        <span className="text-lg">{channel.logo}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-base font-medium">{channel.name}</span>
                          {channel.hasCatchUp ? (
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-emerald-500/35 bg-emerald-500/15 text-emerald-400">
                              <Clock3 className="h-3 w-3" />
                            </span>
                          ) : null}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">{currentProgram?.title ?? channel.subtitle}</div>
                      </div>
                      <Heart className={cn('h-5 w-5', channel.isFavorite ? 'fill-primary text-primary' : 'text-muted-foreground/50')} />
                      {active ? <span className="absolute inset-y-2 left-0 w-[2px] rounded bg-primary" aria-hidden /> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="min-h-screen bg-background">
            <div className="border-b border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <div className="font-medium">{data.alertTitle}</div>
              <div className="mt-1 text-destructive/80">{data.alertMessage}</div>
            </div>

            <div className="h-[calc(100vh-89px)] overflow-y-auto">
              <div className="bg-black">
                <div className="relative aspect-video bg-black">
                  <div className="absolute inset-0 gradient-overlay" />
                  <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                    <div className="text-center">
                      <div className="text-4xl">{selectedChannel.logo}</div>
                      <div className="mt-3 text-sm">Konfigurišite IPTV server za gledanje</div>
                    </div>
                  </div>

                  <div className="absolute inset-x-0 bottom-0 p-5">
                    <div className="flex items-end gap-4">
                      <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-card/70 text-3xl">
                        {selectedChannel.logo}
                      </div>
                      <div>
                        <span className="badge-live">UŽIVO</span>
                        <div className="mt-2 text-3xl font-semibold">{selectedChannel.name}</div>
                        <div className="text-muted-foreground">{selectedChannel.programs[0]?.title}</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="border-t border-border bg-black px-5 py-4">
                  <div className="h-1 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${selectedChannel.programs[0]?.progressPercent ?? 0}%` }}
                    />
                  </div>

                  <div className="mt-4 flex items-center justify-between text-muted-foreground">
                    <div className="flex items-center gap-5">
                      <Volume2 className="h-4 w-4" />
                      <span className="text-sm">{selectedChannel.programs[0]?.timeLabel}</span>
                    </div>
                    <div className="flex items-center gap-5">
                      <Heart className="h-4 w-4" />
                      <Clock3 className="h-4 w-4" />
                      <Maximize className="h-4 w-4" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4 bg-background p-5">
                <section className="rounded-2xl bg-card p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock3 className="h-4 w-4" />
                    Sada na programu
                  </div>
                  <div className="rounded-2xl border border-primary/30 bg-primary/10 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <span className="badge-live">UŽIVO</span>
                        <div className="mt-3 text-2xl font-semibold">{selectedChannel.programs[0]?.title}</div>
                      </div>
                      <div className="text-sm text-muted-foreground">{selectedChannel.programs[0]?.timeLabel}</div>
                    </div>
                    <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${selectedChannel.programs[0]?.progressPercent ?? 0}%` }}
                      />
                    </div>
                  </div>
                </section>

                <section className="rounded-2xl bg-card p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
                    <CalendarDays className="h-4 w-4" />
                    Sledi na programu
                  </div>
                  <div className="space-y-2">
                    {selectedChannel.programs.slice(1).map((program, index) => (
                      <div key={program.id} className="flex items-center justify-between rounded-xl bg-secondary/30 px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="text-sm text-muted-foreground">{index + 1}</span>
                          <span className="font-medium">{program.title}</span>
                        </div>
                        <span className="text-sm text-muted-foreground">{program.timeLabel}</span>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          </section>
        </div>

        <div className="lg:hidden">
          <header className="border-b border-border bg-card">
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                  <Play className="h-4 w-4 fill-current" />
                </div>
                <div>
                  <div className="font-semibold">Lumen</div>
                  <div className="text-xs text-muted-foreground">Next sandbox</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="icon" className="h-11 w-11 rounded-2xl">
                  <Home className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-10 w-10">
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </header>

          <div className="bg-black">
            <div className="relative aspect-video bg-black">
              <div className="absolute right-3 top-3 rounded-full bg-card/60 p-2 text-foreground">
                <Info className="h-4 w-4" />
              </div>
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <div className="text-4xl">{selectedChannel.logo}</div>
                  <div className="mt-2 text-sm">Konfigurišite IPTV server za gledanje</div>
                </div>
              </div>
              <div className="absolute inset-x-0 bottom-0 p-4">
                <div className="flex items-end gap-3">
                  <div className="text-3xl">{selectedChannel.logo}</div>
                  <div>
                    <span className="badge-live">UŽIVO</span>
                    <div className="mt-2 text-3xl font-semibold leading-none">{selectedChannel.name}</div>
                    <div className="mt-1 text-muted-foreground">{selectedChannel.programs[0]?.title}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-4 py-3">
              <div className="h-1 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${selectedChannel.programs[0]?.progressPercent ?? 0}%` }}
                />
              </div>
              <div className="mt-4 flex items-center justify-between text-muted-foreground">
                <div className="flex items-center gap-4">
                  <ChevronLeft className="h-4 w-4" />
                  <Volume2 className="h-4 w-4" />
                  <span className="text-sm">{selectedChannel.programs[0]?.timeLabel}</span>
                </div>
                <div className="flex items-center gap-4">
                  <Heart className="h-4 w-4" />
                  <Clock3 className="h-4 w-4" />
                  <Maximize className="h-4 w-4" />
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-border bg-card px-4 py-3">
            <div className="grid grid-cols-3 gap-2">
              <a className="starlight-border flex items-center justify-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-3 text-sm font-medium text-emerald-300" href="/player">
                <Tv className="h-4 w-4" />
                TV Unazad
              </a>
              <a className="starlight-border starlight-border-amber flex items-center justify-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-3 text-sm font-medium text-amber-300" href="/vod">
                <Film className="h-4 w-4" />
                Filmovi
              </a>
              <a className="starlight-border starlight-border-purple flex items-center justify-center gap-2 rounded-xl border border-purple-500/25 bg-purple-500/10 px-3 py-3 text-sm font-medium text-purple-300" href="/series">
                <Clapperboard className="h-4 w-4" />
                Serije
              </a>
            </div>

            <div className="touch-scroll-x mt-3 flex gap-2 overflow-x-auto pb-1">
              {data.categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setSelectedCategoryId(category.id)}
                  className={cn(
                    'shrink-0 rounded-full px-4 py-2 text-sm transition-colors',
                    selectedCategoryId === category.id
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-muted-foreground',
                  )}
                >
                  {category.label}
                </button>
              ))}
            </div>

            <div className="relative mt-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Pretraži kanale..."
                className="border-border/80 bg-background/40 pl-9"
              />
            </div>
          </div>

          <div className="bg-background px-2 py-3">
            <div className="space-y-1">
              {filteredChannels.map((channel) => (
                <button
                  key={channel.id}
                  type="button"
                  onClick={() => setSelectedChannelId(channel.id)}
                  className={cn(
                    'relative flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left',
                    channel.id === selectedChannel.id
                      ? 'bg-primary/15 ring-2 ring-primary ring-inset shadow-[0_0_0_1px_hsl(var(--primary)/0.25)]'
                      : 'hover:bg-secondary/60',
                  )}
                >
                  <span className="w-6 text-xs tabular-nums text-muted-foreground">{channel.number}</span>
                  <div className="text-2xl">{channel.logo}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-base font-medium">{channel.name}</span>
                      {channel.hasCatchUp ? (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-emerald-500/35 bg-emerald-500/15 text-emerald-400">
                          <Clock3 className="h-3 w-3" />
                        </span>
                      ) : null}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{channel.subtitle}</div>
                  </div>
                  <Heart className={cn('h-5 w-5', channel.isFavorite ? 'fill-primary text-primary' : 'text-muted-foreground/50')} />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default LiveShellPage;
