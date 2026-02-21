import { useQuery } from '@tanstack/react-query';
import type { XtreamSeries } from '@lumen/types';
import { loadXtreamCredentials } from '@/services/xtreamCredentials';
import { xtreamCodesService } from '@/services/xtreamService';
import { resolveSeriesArtworkUrl } from '@/pages/seriesArtwork';

export interface SeriesCategory {
  id: string;
  name: string;
}

export interface SeriesItem {
  id: string;
  name: string;
  categoryId: string;
  cover: string;
  posterGradient?: string;
  rating?: string;
  releaseDate?: string;
  yearRange?: string;
  statusLabel?: string;
  seasonsLabel?: string;
  episodeCount?: number;
  genres?: string[];
}

interface SeriesCatalogResult {
  categories: SeriesCategory[];
  items: SeriesItem[];
}

const mockCategories: SeriesCategory[] = [
  { id: 'drama', name: 'Drama' },
  { id: 'comedy', name: 'Komedija' },
  { id: 'action', name: 'Akcija' },
  { id: 'thriller', name: 'Triler' },
  { id: 'scifi', name: 'Naučna fantastika' },
  { id: 'crime', name: 'Kriminalistička' },
  { id: 'animation', name: 'Animirana' },
];

const mockItems: SeriesItem[] = [
  {
    id: 'ser-1',
    name: 'Senke nad Balkanom',
    categoryId: 'drama',
    cover: '',
    posterGradient: 'from-blue-500 to-violet-500',
    rating: '9.1',
    yearRange: '2017-2020',
    statusLabel: 'Završena',
    seasonsLabel: '3 sezone',
    episodeCount: 28,
    genres: ['Drama', 'Istorijski'],
  },
  {
    id: 'ser-2',
    name: 'Močvara',
    categoryId: 'crime',
    cover: '',
    posterGradient: 'from-emerald-500 to-teal-500',
    rating: '8.7',
    yearRange: '2020-',
    statusLabel: 'U toku',
    seasonsLabel: '2 sezone',
    episodeCount: 16,
    genres: ['Kriminalistička', 'Triler'],
  },
  {
    id: 'ser-3',
    name: 'Klan',
    categoryId: 'drama',
    cover: '',
    posterGradient: 'from-amber-500 to-orange-500',
    rating: '8.5',
    yearRange: '2022-',
    statusLabel: 'U toku',
    seasonsLabel: '2 sezone',
    episodeCount: 22,
    genres: ['Drama', 'Kriminalistička'],
  },
  {
    id: 'ser-4',
    name: 'Besa',
    categoryId: 'thriller',
    cover: '',
    posterGradient: 'from-fuchsia-500 to-pink-500',
    rating: '8.3',
    yearRange: '2018-2021',
    statusLabel: 'Završena',
    seasonsLabel: '2 sezone',
    episodeCount: 18,
    genres: ['Triler', 'Drama'],
  },
  {
    id: 'ser-5',
    name: 'Porodica',
    categoryId: 'comedy',
    cover: '',
    posterGradient: 'from-sky-500 to-blue-500',
    rating: '7.9',
    yearRange: '2023-',
    statusLabel: 'U toku',
    seasonsLabel: '1 sezona',
    episodeCount: 20,
    genres: ['Komedija', 'Drama'],
  },
  {
    id: 'ser-6',
    name: 'Inspektor',
    categoryId: 'crime',
    cover: '',
    posterGradient: 'from-emerald-500 to-green-500',
    rating: '8.1',
    yearRange: '2021-',
    statusLabel: 'U toku',
    seasonsLabel: '3 sezone',
    episodeCount: 30,
    genres: ['Kriminalistička', 'Drama'],
  },
  {
    id: 'ser-7',
    name: 'Svemir',
    categoryId: 'scifi',
    cover: '',
    posterGradient: 'from-orange-500 to-amber-500',
    rating: '8.6',
    yearRange: '2024-',
    statusLabel: 'U toku',
    seasonsLabel: '1 sezona',
    episodeCount: 8,
    genres: ['Naučna fantastika', 'Drama'],
  },
  {
    id: 'ser-8',
    name: 'Deca Noći',
    categoryId: 'animation',
    cover: '',
    posterGradient: 'from-red-500 to-orange-500',
    rating: '7.8',
    yearRange: '2022-',
    statusLabel: 'U toku',
    seasonsLabel: '2 sezone',
    episodeCount: 24,
    genres: ['Animirana', 'Fantazija'],
  },
];

const parseReleaseYear = (value?: string): string | undefined => {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (/^\d{4}$/.test(trimmed)) {
    return trimmed;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return String(parsed.getUTCFullYear());
  }

  return trimmed.slice(0, 4);
};

const mapSeriesItem = (series: XtreamSeries): SeriesItem => ({
  id: String(series.series_id),
  name: series.name,
  categoryId: series.category_id,
  cover: resolveSeriesArtworkUrl(series as unknown as Record<string, unknown>),
  rating: series.rating || undefined,
  releaseDate: series.release_date || undefined,
  yearRange: parseReleaseYear(series.release_date),
  genres: series.genre
    ? series.genre.split(',').map((genre) => genre.trim()).filter(Boolean)
    : undefined,
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
