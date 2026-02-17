export const buildCatalogParams = ({
  category,
  search,
  visibleCount,
  allCategory,
  pageSize,
}: {
  category: string | undefined;
  search: string;
  visibleCount: number;
  allCategory: string;
  pageSize: number;
}): URLSearchParams => {
  const params = new URLSearchParams();

  if (category && category !== allCategory) {
    params.set('category', category);
  }

  const trimmedSearch = search.trim();
  if (trimmedSearch.length > 0) {
    params.set('search', trimmedSearch);
  }

  if (visibleCount > pageSize) {
    params.set('visible', String(visibleCount));
  }

  return params;
};
