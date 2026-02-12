import { useState, useEffect, useCallback } from 'react';
import {
  loadFavorites,
  saveFavorites,
  addFavorite as addFavoriteToList,
  removeFavorite as removeFavoriteFromList,
  toggleFavorite as toggleFavoriteInList,
  isFavorite as isFavoriteInList,
} from '@lumen/storage';

export const useFavorites = () => {
  const [favorites, setFavorites] = useState<string[]>(() => loadFavorites());

  useEffect(() => {
    saveFavorites(favorites);
  }, [favorites]);

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
