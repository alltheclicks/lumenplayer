import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BRAND_NAME } from '@/config/brand';
import { Helmet } from 'react-helmet-async';
import { ChevronLeft, Clock3, Film, Home, Loader2, Play, Search, Star, Tv } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useVodCatalog } from '@/hooks/useVodCatalog';
import { buildCatalogParams } from '@/pages/catalogQueryParams';
import { useSwitchToLiveMode } from '@/pages/switchToLiveMode';

const ALL_CATEGORY = '__all__';
const PAGE_SIZE = 60;
const POSTER_GRADIENTS = [
  'from-blue-500 to-violet-500',
  'from-emerald-500 to-teal-400',
  'from-amber-500 to-orange-500',
  'from-fuchsia-500 to-pink-500',
  'from-sky-500 to-blue-500',
  'from-red-500 to-orange-500',
] as const;

const getFallbackGradient = (seed: string): string => {
  const total = seed.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return POSTER_GRADIENTS[total % POSTER_GRADIENTS.length];
};

const formatDuration = (minutes?: number): string | null => {
  if (!minutes || minutes <= 0) {
    return null;
  }

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0) {
    return `${hours}h ${mins}min`;
  }
  return `${mins}min`;
};

const VodCategories = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialCategory = (searchParams.get('category') ?? '').trim();
  const initialSearch = searchParams.get('search') ?? '';
  const initialVisibleRaw = Number(searchParams.get('visible') ?? PAGE_SIZE);
  const initialVisibleCount = Number.isFinite(initialVisibleRaw)
    ? Math.max(PAGE_SIZE, Math.trunc(initialVisibleRaw))
    : PAGE_SIZE;

  const [selectedCategory, setSelectedCategory] = useState<string | undefined>(
    initialCategory.length > 0 ? initialCategory : ALL_CATEGORY
  );
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [visibleCount, setVisibleCount] = useState(initialVisibleCount);
  const { data, isLoading, error } = useVodCatalog(selectedCategory);
  const switchToLiveMode = useSwitchToLiveMode();

  const categories = useMemo(() => data?.categories ?? [], [data?.categories]);
  const categoryNameById = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );
  const activeCategoryLabel = useMemo(() => {
    if (selectedCategory === ALL_CATEGORY || selectedCategory === undefined) {
      return 'Svi filmovi';
    }

    return categoryNameById.get(selectedCategory) ?? 'Filmovi';
  }, [categoryNameById, selectedCategory]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [searchQuery, selectedCategory]);

  const filteredItems = useMemo(
    () => (data?.items ?? []).filter((item) => {
      const matchesSearch = item.name.toLowerCase().includes(searchQuery.trim().toLowerCase());
      return matchesSearch;
    }),
    [data?.items, searchQuery],
  );

  const visibleItems = useMemo(
    () => filteredItems.slice(0, visibleCount),
    [filteredItems, visibleCount],
  );
  const hasMoreItems = visibleCount < filteredItems.length;
  const catalogParams = useMemo(
    () => buildCatalogParams({
      category: selectedCategory,
      search: searchQuery,
      visibleCount,
      allCategory: ALL_CATEGORY,
      pageSize: PAGE_SIZE,
    }),
    [searchQuery, selectedCategory, visibleCount],
  );
  const catalogBackPath = useMemo(() => {
    const query = catalogParams.toString();
    return query.length > 0 ? `/vod?${query}` : '/vod';
  }, [catalogParams]);

  useEffect(() => {
    setSearchParams(catalogParams, { replace: true });
  }, [catalogParams, setSearchParams]);

  return (
    <>
      <Helmet>
        <title>{`Filmovi - ${BRAND_NAME}`}</title>
      </Helmet>

      <div className="min-h-screen bg-background pb-24 md:pb-8">
        <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur-md">
          <div className="mx-auto flex h-12 max-w-[1440px] items-center gap-2 px-3 md:h-16 md:gap-4 md:px-6">
            <Link
              to="/player"
              onClick={(event) => {
                event.preventDefault();
                switchToLiveMode();
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              aria-label="Nazad na TV"
            >
              <ChevronLeft className="h-4 w-4" />
            </Link>
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground md:h-8 md:w-8 md:rounded-xl">
                <Film className="h-3.5 w-3.5 md:h-4 md:w-4" />
              </div>
              <span className="truncate text-base font-semibold md:text-lg">Filmovi</span>
            </div>

            <div className="mx-1 hidden flex-1 max-w-lg md:block">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Pretraži filmove..."
                  className="h-10 border-border/80 bg-background/40 pl-9"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
              </div>
            </div>

            <div className="ml-auto hidden items-center gap-1 md:flex">
              <Link
                to="/player"
                onClick={(event) => {
                  event.preventDefault();
                  switchToLiveMode();
                }}
              >
                <Button variant="ghost" size="sm" className="gap-2">
                  <Tv className="h-4 w-4" />
                  TV Uživo
                </Button>
              </Link>
              <Link to="/series">
                <Button variant="ghost" size="sm" className="gap-2">
                  <Play className="h-4 w-4" />
                  Serije
                </Button>
              </Link>
              <Link to="/">
                <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Početna">
                  <Home className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </header>

        <div className="border-b border-border/60 bg-card/70 px-3 py-2 md:hidden">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Pretraži filmove..."
              className="h-9 border-border/80 bg-background/40 pl-9"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </div>
        </div>

        <div className="sticky top-12 z-30 border-b border-border/60 bg-background/95 backdrop-blur-md md:top-16">
          <div className="mx-auto max-w-[1440px] px-3 py-2 md:px-6 md:py-3">
            <div className="flex touch-scroll-x gap-2 overflow-x-auto pb-1">
              <Button
                size="sm"
                className="h-8 shrink-0 rounded-full px-3 text-xs md:h-9 md:px-4 md:text-sm"
                variant={selectedCategory === ALL_CATEGORY ? 'default' : 'outline'}
                onClick={() => setSelectedCategory(ALL_CATEGORY)}
              >
                Svi filmovi
              </Button>
              {categories.map((category) => (
                <Button
                  key={category.id}
                  size="sm"
                  className="h-8 shrink-0 rounded-full px-3 text-xs md:h-9 md:px-4 md:text-sm"
                  variant={selectedCategory === category.id ? 'default' : 'outline'}
                  onClick={() => setSelectedCategory(category.id)}
                >
                  {category.name}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <main className="mx-auto max-w-[1440px] space-y-3 px-3 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-4 md:space-y-4 md:px-6 md:py-6">
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Učitavanje filmskog kataloga...
            </div>
          )}

          {error && (
            <p className="text-destructive">
              Neuspešno učitavanje filmova: {error.message}
            </p>
          )}

          {!isLoading && !error && selectedCategory !== undefined && (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <h1 className="min-w-0 text-xl font-semibold tracking-tight md:text-4xl">{activeCategoryLabel}</h1>
                <span className="shrink-0 pt-1 text-xs text-muted-foreground md:text-sm">
                  {filteredItems.length} {filteredItems.length === 1 ? 'film' : 'filmova'}
                </span>
              </div>

              {filteredItems.length === 0 ? (
                <div className="rounded-xl border border-border/70 bg-card/40 p-8 text-center">
                  <Film className="mx-auto h-10 w-10 text-muted-foreground/40" />
                  <p className="mt-3 text-sm text-muted-foreground">
                    Nema rezultata za zadatu pretragu ili kategoriju.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:gap-3 lg:grid-cols-5 xl:grid-cols-6">
                  {visibleItems.map((item) => {
                    const formattedDuration = formatDuration(item.durationMinutes);

                    return (
                      <Link
                        key={item.id}
                        to={`/vod/${item.id}?back=${encodeURIComponent(catalogBackPath)}`}
                        className="group block"
                      >
                        <article className="overflow-hidden rounded-lg border border-border/60 bg-card/90 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg md:rounded-xl">
                          <div className="relative aspect-[3/4] overflow-hidden sm:aspect-[2/3]">
                            {item.poster ? (
                              <img
                                src={item.poster}
                                alt={item.name}
                                loading="lazy"
                                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                              />
                            ) : (
                              <div className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${item.posterGradient ?? getFallbackGradient(item.id)}`}>
                                <div className="px-3 text-center text-sm font-semibold text-white/90 drop-shadow md:px-4 md:text-base">
                                  <div className="mb-1 text-2xl md:mb-2 md:text-4xl">🎬</div>
                                  <div>{item.name}</div>
                                </div>
                              </div>
                            )}
                            <span className="absolute left-1.5 top-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white md:left-2 md:top-2 md:rounded-lg md:px-2 md:py-1 md:text-[11px]">
                              {item.releaseYear ?? 'Film'}
                            </span>
                            {item.rating && (
                              <span className="absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white md:right-2 md:top-2 md:rounded-lg md:px-2 md:py-1 md:text-[11px]">
                                <Star className="h-3 w-3 fill-current text-yellow-400" />
                                {item.rating}
                              </span>
                            )}
                          </div>

                          <div className="space-y-1.5 border-t border-border/60 bg-card/95 p-2 md:space-y-2 md:p-2.5">
                            <p className="line-clamp-2 text-[13px] font-semibold leading-4 md:text-[15px] md:leading-5">{item.name}</p>
                            {formattedDuration && (
                              <div className="inline-flex items-center gap-1 text-[11px] text-muted-foreground md:text-[12px]">
                                <Clock3 className="h-3 w-3" />
                                {formattedDuration}
                              </div>
                            )}
                            <div className="hidden flex-wrap gap-1.5 text-[11px] sm:flex">
                              {(item.genres?.slice(0, 2) ?? [categoryNameById.get(item.categoryId) ?? 'Film']).map((genre) => (
                                <span key={`${item.id}-${genre}`} className="rounded-full bg-secondary px-2 py-0.5 text-muted-foreground">
                                  {genre}
                                </span>
                              ))}
                            </div>
                          </div>
                        </article>
                      </Link>
                    );
                  })}
                </div>
              )}

              {hasMoreItems && (
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
                  >
                    Učitaj još
                  </Button>
                </div>
              )}
            </div>
          )}
        </main>

        <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)] md:hidden">
          <div className="flex items-center justify-around py-1.5">
            <Link
              to="/player"
              onClick={(event) => {
                event.preventDefault();
                switchToLiveMode();
              }}
              className="flex min-w-0 flex-1 flex-col items-center gap-0.5 px-2 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <Tv className="h-4 w-4" />
              <span className="text-[10px] font-medium">TV</span>
            </Link>
            <div className="flex min-w-0 flex-1 flex-col items-center gap-0.5 px-2 py-1.5 text-primary">
              <Film className="h-4 w-4" />
              <span className="text-[10px] font-medium">Filmovi</span>
            </div>
            <Link to="/series" className="flex min-w-0 flex-1 flex-col items-center gap-0.5 px-2 py-1.5 text-muted-foreground transition-colors hover:text-foreground">
              <Play className="h-4 w-4" />
              <span className="text-[10px] font-medium">Serije</span>
            </Link>
            <Link to="/" className="flex min-w-0 flex-1 flex-col items-center gap-0.5 px-2 py-1.5 text-muted-foreground transition-colors hover:text-foreground">
              <Home className="h-4 w-4" />
              <span className="text-[10px] font-medium">Start</span>
            </Link>
          </div>
        </nav>
      </div>
    </>
  );
};

export default VodCategories;
