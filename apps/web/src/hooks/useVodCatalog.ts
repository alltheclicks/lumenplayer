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
  rating?: string;
}

interface VodCatalogResult {
  categories: VodCategory[];
  items: VodItem[];
}

const mockCategories: VodCategory[] = [
  { id: 'action', name: 'Action' },
  { id: 'drama', name: 'Drama' },
  { id: 'comedy', name: 'Comedy' },
];

const mockItems: VodItem[] = [
  { id: '1001', name: 'Demo Action Movie', categoryId: 'action', poster: '', rating: '7.2' },
  { id: '1002', name: 'Demo Drama Story', categoryId: 'drama', poster: '', rating: '8.0' },
  { id: '1003', name: 'Demo Comedy Night', categoryId: 'comedy', poster: '', rating: '6.9' },
];

const mapVodItem = (vod: XtreamVOD): VodItem => ({
  id: String(vod.stream_id),
  name: vod.name,
  categoryId: vod.category_id,
  poster: vod.stream_icon || '',
  rating: vod.rating || undefined,
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
  const streams = await xtreamCodesService.getVODStreams(categoryId ?? undefined);
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
