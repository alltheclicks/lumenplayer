import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { ArrowLeft, Film, Loader2, Search, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useVodCatalog } from '@/hooks/useVodCatalog';

const ALL_CATEGORY = '__all__';
const PAGE_SIZE = 60;

const VodCategories = () => {
  const navigate = useNavigate();
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const { data, isLoading, error } = useVodCatalog(selectedCategory);

  const categories = useMemo(() => data?.categories ?? [], [data?.categories]);

  useEffect(() => {
    if (selectedCategory !== undefined) {
      return;
    }

    if (categories.length > 0) {
      setSelectedCategory(categories[0].id);
    } else if (!isLoading) {
      setSelectedCategory(ALL_CATEGORY);
    }
  }, [categories, isLoading, selectedCategory]);

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

  return (
    <>
      <Helmet>
        <title>VOD Categories - IPTV Player</title>
      </Helmet>

      <div className="min-h-screen bg-background p-4 md:p-6">
        <div className="mx-auto max-w-7xl space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="ghost" className="gap-2" onClick={() => navigate('/player')}>
              <ArrowLeft className="h-4 w-4" />
              Back to Player
            </Button>
            <h1 className="text-2xl font-bold tracking-tight">VOD Catalog</h1>
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

          {(isLoading || selectedCategory === undefined) && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading VOD catalog...
            </div>
          )}

          {error && (
            <p className="text-destructive">
              Failed to load VOD catalog: {error.message}
            </p>
          )}

          {!isLoading && !error && selectedCategory !== undefined && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {visibleItems.map((item) => (
                  <Link key={item.id} to={`/vod/${item.id}`}>
                    <Card className="group h-full overflow-hidden border-border/70 transition-all hover:-translate-y-0.5 hover:border-primary/40">
                      <CardContent className="p-0">
                        <div className="aspect-[2/3] bg-muted">
                          {item.poster ? (
                            <img
                              src={item.poster}
                              alt={item.name}
                              loading="lazy"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center">
                              <Film className="h-8 w-8 text-muted-foreground" />
                            </div>
                          )}
                        </div>
                        <div className="space-y-1 p-3">
                          <p className="line-clamp-2 text-sm font-medium">{item.name}</p>
                          {item.rating && (
                            <p className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Star className="h-3 w-3" />
                              {item.rating}
                            </p>
                          )}
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
