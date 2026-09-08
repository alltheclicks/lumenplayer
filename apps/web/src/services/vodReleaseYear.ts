/** A catalog's `added` timestamp is not the film's release date. */
export const resolveVodReleaseYear = (item: {
  name: string;
  year?: unknown;
  release_date?: unknown;
  releaseDate?: unknown;
  releasedate?: unknown;
}): string | undefined => {
  for (const value of [item.year, item.release_date, item.releaseDate, item.releasedate]) {
    const match = String(value ?? '').trim().match(/^((?:18|19|20)\d{2})(?:$|[-/])/);
    if (match) return match[1];
  }
  // Do not interpret a number in a title such as "1917" as its release year.
  return item.name.match(/[([]((?:18|19|20)\d{2})[)\]]\s*$/)?.[1];
};
