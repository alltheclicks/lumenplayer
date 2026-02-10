// Re-export from @lumen/types for backward compatibility
export type { PlayerChannel, PlayerCategory } from "@lumen/types";

// React-specific type — stays in app
export interface UseXtreamChannelsResult {
  channels: import("@lumen/types").PlayerChannel[];
  categories: import("@lumen/types").PlayerCategory[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}
