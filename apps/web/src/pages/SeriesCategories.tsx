import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { CalendarDays, ChevronLeft, Clapperboard, Home, Loader2, Search, Star, Tv, Film } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSeriesCatalog } from '@/hooks/useSeriesCatalog';
import { buildCatalogParams } from '@/pages/catalogQueryParams';
import { formatSeriesCountLabel } from '@/pages/seriesCountLabel';

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

const resolveYearRange = (yearRange?: string, releaseDate?: string): string => {
  if (yearRange && yearRange.trim().length > 0) {
    return yearRange;
  }

  if (!releaseDate) {
    return '2024-';
  }

  const parsed = new Date(releaseDate);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getUTCFullYear()}-`;
  }

  return `${releaseDate.slice(0, 4)}-`;
};

const getStatusBadgeClassName = (value?: string): string => {
  if (value?.toLowerCase().includes('zavr')) {
    return 'bg-indigo-900/80 text-white';
  }

  return 'bg-emerald-900/80 text-emerald-100';
};

const SeriesCategories = () => {
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
  const { data, isLoading, error } = useSeriesCatalog(selectedCategory);

  const categories = useMemo(() => data?.categories ?? [], [data?.categories]);
  const categoryNameById = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );
  const activeCategoryLabel = useMemo(() => {
    if (selectedCategory === ALL_CATEGORY || selectedCategory === undefined) {
      return 'Sve serije';
    }

    return categoryNameById.get(selectedCategory) ?? 'Serije';
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
    return query.length > 0 ? `/series?${query}` : '/series';
  }, [catalogParams]);

  useEffect(() => {
    setSearchParams(catalogParams, { replace: true });
  }, [catalogParams, setSearchParams]);

  return (
    <>
      <Helmet>
        <title>Serije - IPTV Player</title>
      </Helmet>

      <div className="min-h-screen bg-background pb-24 md:pb-8">
        <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur-md">
          <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-2 px-3 md:gap-4 md:px-6">
            <Link
              to="/player"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              aria-label="Nazad na TV"
            >
              <ChevronLeft className="h-4 w-4" />
            </Link>
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Clapperboard className="h-4 w-4" />
              </div>
              <span className="truncate text-lg font-semibold">Serije</span>
            </div>

            <div className="mx-1 hidden max-w-lg flex-1 md:block">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Pretraži serije..."
                  className="h-10 border-border/80 bg-background/40 pl-9"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
              </div>
            </div>

            <div className="ml-auto hidden items-center gap-1 md:flex">
              <Link to="/player">
                <Button variant="ghost" size="sm" className="gap-2">
                  <Tv className="h-4 w-4" />
                  TV Uživo
                </Button>
              </Link>
              <Link to="/vod">
                <Button variant="ghost" size="sm" className="gap-2">
                  <Film className="h-4 w-4" />
                  Filmovi
                </Button>
              </Link>
              <Link to="/">
                <Button variant="ghost" size="icon" className="h-9 w-9">
                  <Home className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </header>

        <div className="border-b border-border/60 bg-card/70 px-3 py-3 md:hidden">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Pretraži serije..."
              className="h-10 border-border/80 bg-background/40 pl-9"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </div>
        </div>

        <div className="sticky top-16 z-30 border-b border-border/60 bg-background/95 backdrop-blur-md">
          <div className="mx-auto max-w-[1440px] px-3 py-3 md:px-6">
            <div className="flex touch-scroll-x gap-2 overflow-x-auto pb-1">
              <Button
                size="sm"
                className="rounded-full px-4"
                variant={selectedCategory === ALL_CATEGORY ? 'default' : 'outline'}
                onClick={() => setSelectedCategory(ALL_CATEGORY)}
              >
                Sve serije
              </Button>
              {categories.map((category) => (
                <Button
                  key={category.id}
                  size="sm"
                  className="rounded-full px-4"
                  variant={selectedCategory === category.id ? 'default' : 'outline'}
                  onClick={() => setSelectedCategory(category.id)}
                >
                  {category.name}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <main className="mx-auto max-w-[1440px] space-y-4 px-3 py-6 md:px-6">
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Učitavanje serijskog kataloga...
            </div>
          )}

          {error && (
            <p className="text-destructive">
              Neuspešno učitavanje serija: {error.message}
            </p>
          )}

          {!isLoading && !error && selectedCategory !== undefined && (
            <div className="space-y-4">
              <div className="flex items-end justify-between gap-3">
                <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{activeCategoryLabel}</h1>
                <span className="text-sm text-muted-foreground">
                  {filteredItems.length} {formatSeriesCountLabel(filteredItems.length)}
                </span>
              </div>

              {filteredItems.length === 0 ? (
                <div className="rounded-xl border border-border/70 bg-card/40 p-8 text-center">
                  <Clapperboard className="mx-auto h-10 w-10 text-muted-foreground/40" />
                  <p className="mt-3 text-sm text-muted-foreground">
                    Nema rezultata za zadatu pretragu ili kategoriju.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
                  {visibleItems.map((item) => (
                    <Link
                      key={item.id}
                      to={`/series/${item.id}?back=${encodeURIComponent(catalogBackPath)}`}
                      className="group block"
                    >
                      <article className="overflow-hidden rounded-xl border border-border/60 bg-card/90 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg">
                        <div className="relative aspect-[2/3] overflow-hidden">
                          {item.cover ? (
                            <img
                              src={item.cover}
                              alt={item.name}
                              loading="lazy"
                              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                            />
                          ) : (
                            <div className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${item.posterGradient ?? getFallbackGradient(item.id)}`}>
                              <div className="px-4 text-center text-base font-semibold text-white/90 drop-shadow">
                                <div className="mb-2 text-4xl">📺</div>
                                <div>{item.name}</div>
                              </div>
                            </div>
                          )}

                          <span className={`absolute left-2 top-2 rounded-lg px-2 py-1 text-[11px] font-semibold ${getStatusBadgeClassName(item.statusLabel)}`}>
                            {item.statusLabel ?? 'U toku'}
                          </span>

                          {item.rating && (
                            <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-lg bg-black/55 px-2 py-1 text-[11px] font-semibold text-white">
                              <Star className="h-3 w-3 fill-current text-yellow-400" />
                              {item.rating}
                            </span>
                          )}

                          {item.seasonsLabel && (
                            <span className="absolute bottom-2 left-2 rounded-lg bg-black/55 px-2 py-1 text-[11px] font-semibold text-white">
                              {item.seasonsLabel}
                            </span>
                          )}
                        </div>

                        <div className="space-y-2 border-t border-border/60 bg-card/95 p-2.5">
                          <p className="line-clamp-2 text-[15px] font-semibold leading-5">{item.name}</p>
                          <div className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
                            <CalendarDays className="h-3 w-3" />
                            <span>{resolveYearRange(item.yearRange, item.releaseDate)}</span>
                            {typeof item.episodeCount === 'number' && item.episodeCount > 0 && (
                              <>
                                <span>·</span>
                                <span>{item.episodeCount} ep.</span>
                              </>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-1.5 text-[11px]">
                            {(item.genres?.slice(0, 2) ?? [categoryNameById.get(item.categoryId) ?? 'Serija']).map((genre) => (
                              <span key={`${item.id}-${genre}`} className="rounded-full bg-secondary px-2 py-0.5 text-muted-foreground">
                                {genre}
                              </span>
                            ))}
                          </div>
                        </div>
                      </article>
                    </Link>
                  ))}
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
          <div className="flex items-center justify-around py-2">
            <Link to="/player" className="flex flex-col items-center gap-1 px-4 py-2 text-muted-foreground transition-colors hover:text-foreground">
              <Tv className="h-5 w-5" />
              <span className="text-xs">TV Uživo</span>
            </Link>
            <Link to="/vod" className="flex flex-col items-center gap-1 px-4 py-2 text-muted-foreground transition-colors hover:text-foreground">
              <Film className="h-5 w-5" />
              <span className="text-xs">Filmovi</span>
            </Link>
            <div className="flex flex-col items-center gap-1 px-4 py-2 text-primary">
              <Clapperboard className="h-5 w-5" />
              <span className="text-xs font-medium">Serije</span>
            </div>
            <Link to="/" className="flex flex-col items-center gap-1 px-4 py-2 text-muted-foreground transition-colors hover:text-foreground">
              <Home className="h-5 w-5" />
              <span className="text-xs">Početna</span>
            </Link>
          </div>
        </nav>
      </div>
    </>
  );
};

export default SeriesCategories;
