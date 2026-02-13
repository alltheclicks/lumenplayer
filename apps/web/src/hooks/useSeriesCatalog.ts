import { useQuery } from '@tanstack/react-query';
import type { XtreamSeries } from '@lumen/types';
import { loadXtreamCredentials } from '@/services/xtreamCredentials';
import { xtreamCodesService } from '@/services/xtreamService';

export interface SeriesCategory {
  id: string;
  name: string;
}

export interface SeriesItem {
  id: string;
  name: string;
  categoryId: string;
  cover: string;
  rating?: string;
  releaseDate?: string;
}

interface SeriesCatalogResult {
  categories: SeriesCategory[];
  items: SeriesItem[];
}

const mockCategories: SeriesCategory[] = [
  { id: 'crime', name: 'Crime' },
  { id: 'thriller', name: 'Thriller' },
  { id: 'comedy', name: 'Comedy' },
];

const mockItems: SeriesItem[] = [
  { id: '3001', name: 'Demo Crime Files', categoryId: 'crime', cover: '', rating: '7.8', releaseDate: '2024-05-10' },
  { id: '3002', name: 'Demo Midnight Thriller', categoryId: 'thriller', cover: '', rating: '8.1', releaseDate: '2023-09-22' },
  { id: '3003', name: 'Demo Sitcom Nights', categoryId: 'comedy', cover: '', rating: '7.3', releaseDate: '2025-01-12' },
];

const mapSeriesItem = (series: XtreamSeries): SeriesItem => ({
  id: String(series.series_id),
  name: series.name,
  categoryId: series.category_id,
  cover: series.cover || '',
  rating: series.rating || undefined,
  releaseDate: series.release_date || undefined,
});

const isDemoCredentials = (server: string, username: string): boolean => (
  username === 'demo' || server.includes('your-server.com')
);

const fetchSeriesCategories = async (): Promise<SeriesCategory[]> => {
  const credentials = await loadXtreamCredentials();
  if (!credentials ||
      isDemoCredentials(credentials.server, credentials.username)) {
    return mockCategories;
  }

  xtreamCodesService.setCredentials(credentials);
  const categories = await xtreamCodesService.getSeriesCategories();

  return categories.map((category) => ({
    id: category.category_id,
    name: category.category_name,
  }));
};

const fetchSeriesItems = async (categoryId: string | null): Promise<SeriesItem[]> => {
  const credentials = await loadXtreamCredentials();
  if (!credentials ||
      isDemoCredentials(credentials.server, credentials.username)) {
    return categoryId
      ? mockItems.filter((item) => item.categoryId === categoryId)
      : mockItems;
  }

  xtreamCodesService.setCredentials(credentials);
  const series = await xtreamCodesService.getSeries(categoryId ?? undefined);
  return series.map(mapSeriesItem);
};

export const useSeriesCatalog = (selectedCategory: string | undefined) => {
  const categoriesQuery = useQuery({
    queryKey: ['series-categories'],
    queryFn: fetchSeriesCategories,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 2,
    refetchOnWindowFocus: false,
  });

  const resolvedCategory = selectedCategory === undefined
    ? undefined
    : selectedCategory === '__all__'
      ? null
      : selectedCategory;

  const itemsQuery = useQuery({
    queryKey: ['series-catalog-items', resolvedCategory ?? '__all__'],
    queryFn: () => fetchSeriesItems(resolvedCategory ?? null),
    enabled: resolvedCategory !== undefined,
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 2,
    refetchOnWindowFocus: false,
  });

  return {
    data: {
      categories: categoriesQuery.data ?? [],
      items: itemsQuery.data ?? [],
    } as SeriesCatalogResult,
    isLoading: categoriesQuery.isLoading || itemsQuery.isLoading,
    error: (categoriesQuery.error ?? itemsQuery.error) as Error | null,
    refetch: () => {
      void categoriesQuery.refetch();
      void itemsQuery.refetch();
    },
  };
};
