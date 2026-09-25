export const STUDIO_WORKTREE_PATH = '/Users/filip/Documents/Lumen-Player-ui-next';
export const STUDIO_BRANCH = 'codex/ui-next';
export const STUDIO_PORT = 8081;

export type CatalogKind = 'movies' | 'series';

export interface StudioLane {
  title: string;
  route: string;
  ownerHint: string;
  objective: string;
  deliverable: string;
}

export interface StudioOverview {
  headline: string;
  summary: string;
  designPrinciples: string[];
  guardrails: string[];
  commands: string[];
  lanes: StudioLane[];
  mergePhases: string[];
}

export interface ShellCategory {
  id: string;
  label: string;
  count: number;
  tone?: 'default' | 'accent';
}

export interface ChannelProgramRow {
  id: string;
  title: string;
  timeLabel: string;
  badge?: 'UŽIVO' | 'SLEDI';
  progressPercent?: number;
}

export interface LiveChannelCard {
  id: string;
  number: number;
  name: string;
  logo: string;
  categoryId: string;
  categoryLabel: string;
  subtitle: string;
  hasCatchUp: boolean;
  isFavorite: boolean;
  programs: ChannelProgramRow[];
}

export interface LiveShellSnapshot {
  categories: ShellCategory[];
  channels: LiveChannelCard[];
  selectedChannelId: string;
  alertTitle: string;
  alertMessage: string;
  accountLabel: string;
  accountMeta: string;
}

export interface CatalogCard {
  id: string;
  title: string;
  categoryId: string;
  yearLabel: string;
  durationLabel: string;
  ratingLabel: string;
  summary: string;
  gradientClassName: string;
  genreLabels: string[];
  statusLabel?: string;
}

export interface CatalogDataset {
  kind: CatalogKind;
  title: string;
  searchPlaceholder: string;
  countLabel: string;
  categories: Array<{
    id: string;
    label: string;
  }>;
  items: CatalogCard[];
}

export interface LumenStudioGateway {
  getOverview(): Promise<StudioOverview>;
  getLiveShellSnapshot(): Promise<LiveShellSnapshot>;
  getCatalogDataset(kind: CatalogKind): Promise<CatalogDataset>;
}
