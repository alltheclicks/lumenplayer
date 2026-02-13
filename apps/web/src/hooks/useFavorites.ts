import { useState, useEffect, useCallback } from 'react';
import {
  addFavorite as addFavoriteToList,
  removeFavorite as removeFavoriteFromList,
  toggleFavorite as toggleFavoriteInList,
  isFavorite as isFavoriteInList,
} from '@lumen/storage';
import { loadStoredFavorites, saveStoredFavorites } from '@/services/storage';

export const useFavorites = () => {
  const [favorites, setFavorites] = useState<string[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    const hydrateFavorites = async () => {
      const storedFavorites = await loadStoredFavorites();
      if (isCancelled) {
        return;
      }

      setFavorites(storedFavorites);
      setIsHydrated(true);
    };

    void hydrateFavorites();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    void saveStoredFavorites(favorites);
  }, [favorites, isHydrated]);

  const addFavorite = useCallback((channelId: string) => {
    setFavorites((prev) => addFavoriteToList(prev, channelId));
  }, []);

  const removeFavorite = useCallback((channelId: string) => {
    setFavorites((prev) => removeFavoriteFromList(prev, channelId));
  }, []);

  const toggleFavorite = useCallback((channelId: string) => {
    setFavorites((prev) => toggleFavoriteInList(prev, channelId));
  }, []);

  const isFavorite = useCallback((channelId: string) => {
    return isFavoriteInList(favorites, channelId);
  }, [favorites]);

  const reorderFavorites = useCallback((newOrder: string[]) => {
    setFavorites(newOrder);
  }, []);

  return {
    favorites,
    addFavorite,
    removeFavorite,
    toggleFavorite,
    isFavorite,
    reorderFavorites
  };
};
