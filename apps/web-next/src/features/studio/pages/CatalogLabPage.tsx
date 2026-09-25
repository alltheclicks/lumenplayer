import { useDeferredValue, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { ChevronLeft, Film, Home, Search, Tv, Clapperboard, Clock3, Star } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCatalogDataset } from '@/features/studio/hooks/useStudioData';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const CatalogLabPage = () => {
  const { data } = useCatalogDataset('movies');
  const [selectedCategoryId, setSelectedCategoryId] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const filteredItems = useMemo(() => {
    if (!data) {
      return [];
    }

    return data.items.filter((item) => {
      const matchesCategory = selectedCategoryId === 'all' || item.categoryId === selectedCategoryId;
      const normalizedQuery = deferredSearchQuery.trim().toLowerCase();
      const matchesQuery = normalizedQuery.length === 0 || item.title.toLowerCase().includes(normalizedQuery);
      return matchesCategory && matchesQuery;
    });
  }, [data, deferredSearchQuery, selectedCategoryId]);

  if (!data) {
    return null;
  }

  return (
    <>
      <Helmet>
        <title>Filmovi - Lumen Next</title>
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
                <Film className="h-4 w-4" />
              </div>
              <span className="truncate text-lg font-semibold">{data.title}</span>
            </div>

            <div className="mx-1 hidden max-w-lg flex-1 md:block">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder={data.searchPlaceholder}
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
              <Link to="/series">
                <Button variant="ghost" size="sm" className="gap-2">
                  <Clapperboard className="h-4 w-4" />
                  Serije
                </Button>
              </Link>
              <Link to="/studio">
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
              placeholder={data.searchPlaceholder}
              className="h-10 border-border/80 bg-background/40 pl-9"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </div>
        </div>

        <div className="sticky top-16 z-30 border-b border-border/60 bg-background/95 backdrop-blur-md">
          <div className="mx-auto max-w-[1440px] px-3 py-3 md:px-6">
            <div className="flex touch-scroll-x gap-2 overflow-x-auto pb-1">
              {data.categories.map((category) => (
                <Button
                  key={category.id}
                  size="sm"
                  className="rounded-full px-4"
                  variant={selectedCategoryId === category.id ? 'default' : 'outline'}
                  onClick={() => setSelectedCategoryId(category.id)}
                >
                  {category.label}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <main className="mx-auto max-w-[1440px] space-y-4 px-3 py-6 md:px-6">
          <div className="flex items-end justify-between gap-3">
            <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Svi filmovi</h1>
            <span className="text-sm text-muted-foreground">{filteredItems.length} filmova</span>
          </div>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6">
            {filteredItems.map((item) => (
              <article key={item.id} className="overflow-hidden rounded-2xl border border-border bg-card">
                <div className={cn('relative h-72 bg-gradient-to-b', item.gradientClassName)}>
                  <div className="absolute left-2 top-2 rounded-lg bg-background/80 px-2.5 py-1 text-xs font-semibold text-foreground">
                    {item.yearLabel}
                  </div>
                  <div className="absolute right-2 top-2 flex items-center gap-1 rounded-lg bg-background/80 px-2.5 py-1 text-xs font-semibold text-foreground">
                    <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                    {item.ratingLabel}
                  </div>
                  <div className="flex h-full flex-col items-center justify-center gap-4 text-center text-white">
                    <div className="text-4xl">🎬</div>
                    <div className="px-6 text-lg font-semibold leading-tight">{item.title}</div>
                  </div>
                </div>

                <div className="space-y-3 p-4">
                  <div className="text-xl font-semibold leading-tight">{item.title}</div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock3 className="h-4 w-4" />
                    <span>{item.durationLabel}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {item.genreLabels.map((genre) => (
                      <span key={genre} className="rounded-full bg-secondary px-2 py-1 text-xs text-muted-foreground">
                        {genre}
                      </span>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </main>
      </div>
    </>
  );
};

export default CatalogLabPage;
