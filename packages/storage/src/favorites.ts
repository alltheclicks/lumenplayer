const FAVORITES_KEY = "iptv-player-favorites";

export const loadFavorites = (): string[] => {
  if (typeof window === "undefined") return [];
  const stored = localStorage.getItem(FAVORITES_KEY);
  return stored ? (JSON.parse(stored) as string[]) : [];
};

export const saveFavorites = (favorites: string[]): void => {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
};

export const addFavorite = (
  favorites: string[],
  channelId: string,
): string[] => {
  if (favorites.includes(channelId)) return favorites;
  return [...favorites, channelId];
};

export const removeFavorite = (
  favorites: string[],
  channelId: string,
): string[] => {
  return favorites.filter((id) => id !== channelId);
};

export const toggleFavorite = (
  favorites: string[],
  channelId: string,
): string[] => {
  if (favorites.includes(channelId)) {
    return removeFavorite(favorites, channelId);
  }
  return addFavorite(favorites, channelId);
};

export const isFavorite = (
  favorites: string[],
  channelId: string,
): boolean => {
  return favorites.includes(channelId);
};
