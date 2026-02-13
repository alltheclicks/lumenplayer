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

const fetchSeriesCatalog = async (): Promise<SeriesCatalogResult> => {
  const credentials = await loadXtreamCredentials();
  if (!credentials ||
      credentials.username === 'demo' ||
      credentials.server.includes('your-server.com')) {
    return {
      categories: mockCategories,
      items: mockItems,
    };
  }

  xtreamCodesService.setCredentials(credentials);

  const [categories, series] = await Promise.all([
    xtreamCodesService.getSeriesCategories(),
    xtreamCodesService.getSeries(),
  ]);

  return {
    categories: categories.map((category) => ({
      id: category.category_id,
      name: category.category_name,
    })),
    items: series.map(mapSeriesItem),
  };
};

export const useSeriesCatalog = () => {
  return useQuery({
    queryKey: ['series-catalog'],
    queryFn: fetchSeriesCatalog,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 2,
    refetchOnWindowFocus: false,
  });
};

