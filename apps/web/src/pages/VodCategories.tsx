import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Film, Loader2, Search, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useVodCatalog } from '@/hooks/useVodCatalog';

const ALL_CATEGORY = '__all__';
const PAGE_SIZE = 60;

const VodCategories = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialCategory = (searchParams.get('category') ?? '').trim();
  const initialSearch = searchParams.get('search') ?? '';
  const initialVisibleRaw = Number(searchParams.get('visible') ?? PAGE_SIZE);
  const initialVisibleCount = Number.isFinite(initialVisibleRaw)
    ? Math.max(PAGE_SIZE, Math.trunc(initialVisibleRaw))
    : PAGE_SIZE;

  const [selectedCategory, setSelectedCategory] = useState<string | undefined>(
    initialCategory.length > 0 ? initialCategory : undefined
  );
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [visibleCount, setVisibleCount] = useState(initialVisibleCount);
  const { data, isLoading, error } = useVodCatalog(selectedCategory);

  const categories = useMemo(() => data?.categories ?? [], [data?.categories]);

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
  const catalogBackPath = useMemo(() => {
    const params = new URLSearchParams();
    if (selectedCategory && selectedCategory !== ALL_CATEGORY) {
      params.set('category', selectedCategory);
    }
    const trimmedSearch = searchQuery.trim();
    if (trimmedSearch.length > 0) {
      params.set('search', trimmedSearch);
    }
    if (visibleCount > PAGE_SIZE) {
      params.set('visible', String(visibleCount));
    }
    const query = params.toString();
    return query.length > 0 ? `/vod?${query}` : '/vod';
  }, [searchQuery, selectedCategory, visibleCount]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (selectedCategory && selectedCategory !== ALL_CATEGORY) {
      params.set('category', selectedCategory);
    }
    const trimmedSearch = searchQuery.trim();
    if (trimmedSearch.length > 0) {
      params.set('search', trimmedSearch);
    }
    if (visibleCount > PAGE_SIZE) {
      params.set('visible', String(visibleCount));
    }
    setSearchParams(params, { replace: true });
  }, [searchQuery, selectedCategory, setSearchParams, visibleCount]);

  return (
    <>
      <Helmet>
        <title>VOD Categories - IPTV Player</title>
      </Helmet>

      <div className="bg-background p-4 md:p-6">
        <div className="mx-auto max-w-7xl space-y-5">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight">VOD Catalog</h1>
            <p className="text-sm text-muted-foreground">
              Dense poster grid with persistent filters for faster browse-return flow.
            </p>
          </div>

          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search movies..."
              className="pl-9"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </div>

          <div className="flex gap-2 overflow-x-auto pb-2">
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

          {isLoading && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading VOD catalog...
            </div>
          )}

          {!isLoading && !error && selectedCategory === undefined && (
            <p className="text-sm text-muted-foreground">
              Select a category to load movies, or choose <strong>All</strong> to load the full catalog.
            </p>
          )}

          {error && (
            <p className="text-destructive">
              Failed to load VOD catalog: {error.message}
            </p>
          )}

          {!isLoading && !error && selectedCategory !== undefined && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{filteredItems.length} titles</span>
                <span>Showing {visibleItems.length}</span>
              </div>

              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">
                {visibleItems.map((item) => (
                  <Link key={item.id} to={`/vod/${item.id}?back=${encodeURIComponent(catalogBackPath)}`}>
                    <Card className="group h-full overflow-hidden border-border/70 bg-card/70 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg">
                      <CardContent className="p-0">
                        <div className="relative aspect-[2/3] bg-muted">
                          {item.poster ? (
                            <img
                              src={item.poster}
                              alt={item.name}
                              loading="lazy"
                              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center">
                              <Film className="h-8 w-8 text-muted-foreground" />
                            </div>
                          )}
                          {item.rating && (
                            <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-1 text-[10px] font-medium text-white backdrop-blur-sm">
                              <Star className="h-2.5 w-2.5" />
                              {item.rating}
                            </span>
                          )}
                        </div>
                        <div className="space-y-1 p-2.5">
                          <p className="line-clamp-2 text-xs font-medium leading-snug sm:text-sm">{item.name}</p>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>

              {hasMoreItems && (
                <div className="flex justify-center">
                  <Button variant="outline" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
                    Load more
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

export default VodCategories;
