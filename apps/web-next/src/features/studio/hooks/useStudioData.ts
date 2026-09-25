import { useQuery } from '@tanstack/react-query';
import { mockLumenStudioGateway } from '@/features/studio/data/mockLumenStudioGateway';
import type { CatalogKind } from '@/features/studio/data/lumenStudioGateway';

export const useStudioOverview = () => (
  useQuery({
    queryKey: ['studio-overview'],
    queryFn: () => mockLumenStudioGateway.getOverview(),
  })
);

export const useLiveShellSnapshot = () => (
  useQuery({
    queryKey: ['live-shell'],
    queryFn: () => mockLumenStudioGateway.getLiveShellSnapshot(),
  })
);

export const useCatalogDataset = (kind: CatalogKind) => (
  useQuery({
    queryKey: ['catalog-preview', kind],
    queryFn: () => mockLumenStudioGateway.getCatalogDataset(kind),
  })
);
