import type { Channel } from "@lumen/types";
import { getAppStorage } from "@/services/storage";

const M3U_PLAYLIST_KEY = "m3u_playlist";

export type M3UPlaylistSourceType = "url" | "file";

export interface ImportedM3UPlaylist {
  sourceType: M3UPlaylistSourceType;
  sourceLabel: string;
  importedAt: string;
  channels: Channel[];
}

export const saveImportedM3UPlaylist = async (
  playlist: ImportedM3UPlaylist,
): Promise<void> => {
  const adapter = getAppStorage();
  if (!adapter) {
    return;
  }
  await adapter.set(M3U_PLAYLIST_KEY, playlist);
};

export const loadImportedM3UPlaylist = async (): Promise<ImportedM3UPlaylist | null> => {
  const adapter = getAppStorage();
  if (!adapter) {
    return null;
  }
  return adapter.get<ImportedM3UPlaylist>(M3U_PLAYLIST_KEY);
};

export const clearImportedM3UPlaylist = async (): Promise<void> => {
  const adapter = getAppStorage();
  if (!adapter) {
    return;
  }
  await adapter.remove(M3U_PLAYLIST_KEY);
};
