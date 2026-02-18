const SERIES_PLURAL_RULES = new Intl.PluralRules('sr-RS');

export const formatSeriesCountLabel = (count: number): string => {
  const category = SERIES_PLURAL_RULES.select(Math.abs(count));

  if (category === 'few') {
    return 'serije';
  }

  return 'serija';
};

