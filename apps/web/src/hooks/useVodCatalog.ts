import { useQuery } from '@tanstack/react-query';
import type { XtreamVOD } from '@lumen/types';
import { loadXtreamCredentials } from '@/services/xtreamCredentials';
import { xtreamCodesService } from '@/services/xtreamService';

export interface VodCategory {
  id: string;
  name: string;
}

export interface VodItem {
  id: string;
  name: string;
  categoryId: string;
  poster: string;
  posterGradient?: string;
  rating?: string;
  added?: string;
  durationMinutes?: number;
  genres?: string[];
}

interface VodCatalogResult {
  categories: VodCategory[];
  items: VodItem[];
}

const mockCategories: VodCategory[] = [
  { id: 'action', name: 'Akcija' },
  { id: 'comedy', name: 'Komedija' },
  { id: 'drama', name: 'Drama' },
  { id: 'thriller', name: 'Triler' },
  { id: 'scifi', name: 'Naučna fantastika' },
  { id: 'horror', name: 'Horor' },
  { id: 'romance', name: 'Romantika' },
  { id: 'animation', name: 'Animirani' },
  { id: 'documentary', name: 'Dokumentarni' },
];

const mockItems: VodItem[] = [
  {
    id: 'mov-1',
    name: 'Poslednji Heroj',
    categoryId: 'action',
    poster: '',
    posterGradient: 'from-blue-500 to-purple-500',
    rating: '8.2',
    added: '1733011200',
    durationMinutes: 142,
    genres: ['Akcija', 'Triler'],
  },
  {
    id: 'mov-2',
    name: 'Ljubav u Beogradu',
    categoryId: 'romance',
    poster: '',
    posterGradient: 'from-green-500 to-teal-500',
    rating: '7.5',
    added: '1701388800',
    durationMinutes: 118,
    genres: ['Romantika', 'Komedija'],
  },
  {
    id: 'mov-3',
    name: 'Mrak',
    categoryId: 'horror',
    poster: '',
    posterGradient: 'from-yellow-500 to-red-500',
    rating: '7.8',
    added: '1733011200',
    durationMinutes: 98,
    genres: ['Horor', 'Triler'],
  },
  {
    id: 'mov-4',
    name: 'Galaksija 7',
    categoryId: 'scifi',
    poster: '',
    posterGradient: 'from-purple-500 to-pink-500',
    rating: '8.5',
    added: '1733011200',
    durationMinutes: 156,
    genres: ['Naučna fantastika', 'Avantura'],
  },
  {
    id: 'mov-5',
    name: 'Smeh do Suza',
    categoryId: 'comedy',
    poster: '',
    posterGradient: 'from-cyan-500 to-blue-500',
    rating: '7.2',
    added: '1701388800',
    durationMinutes: 105,
    genres: ['Komedija'],
  },
  {
    id: 'mov-6',
    name: 'Senke Prošlosti',
    categoryId: 'drama',
    poster: '',
    posterGradient: 'from-emerald-500 to-green-500',
    rating: '8.0',
    added: '1733011200',
    durationMinutes: 135,
    genres: ['Drama', 'Misterija'],
  },
  {
    id: 'mov-7',
    name: 'Robot i Dečak',
    categoryId: 'animation',
    poster: '',
    posterGradient: 'from-orange-500 to-yellow-500',
    rating: '8.8',
    added: '1733011200',
    durationMinutes: 95,
    genres: ['Animirani', 'Porodični'],
  },
  {
    id: 'mov-8',
    name: 'Bitka za Slobodu',
    categoryId: 'action',
    poster: '',
    posterGradient: 'from-red-500 to-orange-500',
    rating: '8.3',
    added: '1701388800',
    durationMinutes: 168,
    genres: ['Istorijski', 'Ratni'],
  },
  {
    id: 'mov-9',
    name: 'Noćni Let',
    categoryId: 'thriller',
    poster: '',
    posterGradient: 'from-blue-500 to-purple-500',
    rating: '7.6',
    added: '1733011200',
    durationMinutes: 112,
    genres: ['Triler', 'Akcija'],
  },
  {
    id: 'mov-10',
    name: 'Priroda Divljine',
    categoryId: 'documentary',
    poster: '',
    posterGradient: 'from-green-500 to-teal-500',
    rating: '8.1',
    added: '1733011200',
    durationMinutes: 88,
    genres: ['Dokumentarni'],
  },
  {
    id: 'mov-11',
    name: 'Porodično Blago',
    categoryId: 'comedy',
    poster: '',
    posterGradient: 'from-yellow-500 to-red-500',
    rating: '7.4',
    added: '1701388800',
    durationMinutes: 122,
    genres: ['Komedija', 'Drama'],
  },
  {
    id: 'mov-12',
    name: 'Crna Voda',
    categoryId: 'drama',
    poster: '',
    posterGradient: 'from-purple-500 to-pink-500',
    rating: '8.4',
    added: '1733011200',
    durationMinutes: 145,
    genres: ['Drama', 'Triler'],
  },
];

const mapVodItem = (vod: XtreamVOD): VodItem => ({
  id: String(vod.stream_id),
  name: vod.name,
  categoryId: vod.category_id,
  poster: vod.stream_icon || '',
  rating: vod.rating || undefined,
  added: vod.added || undefined,
});

const isDemoCredentials = (server: string, username: string): boolean => (
  username === 'demo' || server.includes('your-server.com')
);

const fetchVodCategories = async (): Promise<VodCategory[]> => {
  const credentials = await loadXtreamCredentials();
  if (!credentials ||
      isDemoCredentials(credentials.server, credentials.username)) {
    return mockCategories;
  }

  xtreamCodesService.setCredentials(credentials);
  const categories = await xtreamCodesService.getVODCategories();

  return categories.map((category) => ({
    id: category.category_id,
    name: category.category_name,
  }));
};

const fetchVodItems = async (categoryId: string | null): Promise<VodItem[]> => {
  const credentials = await loadXtreamCredentials();
  if (!credentials ||
      isDemoCredentials(credentials.server, credentials.username)) {
    return categoryId
      ? mockItems.filter((item) => item.categoryId === categoryId)
      : mockItems;
  }

  xtreamCodesService.setCredentials(credentials);
  const streams = categoryId === null
    ? await xtreamCodesService.getAllVODStreams()
    : await xtreamCodesService.getVODStreams(categoryId);
  return streams.map(mapVodItem);
};

export const useVodCatalog = (selectedCategory: string | undefined) => {
  const categoriesQuery = useQuery({
    queryKey: ['vod-categories'],
    queryFn: fetchVodCategories,
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
    queryKey: ['vod-catalog-items', resolvedCategory ?? '__all__'],
    queryFn: () => fetchVodItems(resolvedCategory ?? null),
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
    } as VodCatalogResult,
    isLoading: categoriesQuery.isLoading || itemsQuery.isLoading,
    error: (categoriesQuery.error ?? itemsQuery.error) as Error | null,
    refetch: () => {
      void categoriesQuery.refetch();
      void itemsQuery.refetch();
    },
  };
};
