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

const fetchVodCatalog = async (): Promise<VodCatalogResult> => {
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

  const [categories, streams] = await Promise.all([
    xtreamCodesService.getVODCategories(),
    xtreamCodesService.getVODStreams(),
  ]);

  return {
    categories: categories.map((category) => ({
      id: category.category_id,
      name: category.category_name,
    })),
    items: streams.map(mapVodItem),
  };
};

export const useVodCatalog = () => {
  return useQuery({
    queryKey: ['vod-catalog'],
    queryFn: fetchVodCatalog,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 2,
    refetchOnWindowFocus: false,
  });
};
