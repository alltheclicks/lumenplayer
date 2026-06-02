export const CRITICAL_XTREAM_ACTIONS = new Set([
  'authenticate',
  'get_live_categories',
  'get_live_streams',
  'get_vod_categories',
  'get_vod_streams',
  'get_vod_info',
  'get_series',
  'get_series_info',
  'live-stream',
  'vod-stream',
  'series-stream',
]);

export const NON_CRITICAL_XTREAM_ACTIONS = new Set([
  'get_short_epg',
  'get_simple_data_table',
  'get_series_categories',
  'xmltv',
]);

export const summarizeXtreamActionFailures = (networkFailures) => {
  const grouped = new Map();

  for (const failure of networkFailures) {
    const action = typeof failure?.action === 'string' && failure.action.trim().length > 0
      ? failure.action.trim()
      : null;
    if (!action) {
      continue;
    }

    if (!grouped.has(action)) {
      grouped.set(action, {
        total: 0,
        responseFailures: 0,
        requestFailed: 0,
        statuses: new Map(),
      });
    }

    const entry = grouped.get(action);
    entry.total += 1;

    if (failure.kind === 'requestfailed') {
      entry.requestFailed += 1;
    } else {
      entry.responseFailures += 1;
    }

    if (typeof failure.status === 'number' && Number.isFinite(failure.status)) {
      entry.statuses.set(failure.status, (entry.statuses.get(failure.status) ?? 0) + 1);
    }
  }

  return grouped;
};

export const summarizeXtreamActionSuccesses = (networkSuccesses) => {
  const grouped = new Map();

  for (const success of networkSuccesses) {
    const action = typeof success?.action === 'string' && success.action.trim().length > 0
      ? success.action.trim()
      : null;
    if (!action) {
      continue;
    }

    if (!grouped.has(action)) {
      grouped.set(action, {
        total: 0,
        statuses: new Map(),
      });
    }

    const entry = grouped.get(action);
    entry.total += 1;

    if (typeof success.status === 'number' && Number.isFinite(success.status)) {
      entry.statuses.set(success.status, (entry.statuses.get(success.status) ?? 0) + 1);
    }
  }

  return grouped;
};

export const buildXtreamActionSuccessCounts = (networkSuccesses) => {
  const counts = new Map();

  for (const success of networkSuccesses) {
    const action = typeof success?.action === 'string' ? success.action.trim() : '';
    if (!action) {
      continue;
    }

    counts.set(action, (counts.get(action) ?? 0) + 1);
  }

  return counts;
};

export const classifyXtreamFailureSeverity = (failure, actionSuccessCounts = new Map()) => {
  const action = typeof failure?.action === 'string' ? failure.action.trim() : '';
  const status = typeof failure?.status === 'number' ? failure.status : null;
  const recoveredAfterRateLimit = status === 429 && (actionSuccessCounts.get(action) ?? 0) > 0;

  if (recoveredAfterRateLimit) {
    return 'non-critical';
  }

  if (status !== null && status >= 500) {
    return 'critical';
  }

  if (CRITICAL_XTREAM_ACTIONS.has(action)) {
    return 'critical';
  }

  if (NON_CRITICAL_XTREAM_ACTIONS.has(action)) {
    return 'non-critical';
  }

  if (failure?.kind === 'requestfailed') {
    return 'critical';
  }

  return 'non-critical';
};

export const formatActionBreakdownLines = (breakdown, emptyMessage) => {
  if (breakdown.size === 0) {
    return [`- [INFO] ${emptyMessage}`];
  }

  return Array.from(breakdown.entries())
    .sort(([, left], [, right]) => right.total - left.total)
    .map(([action, summary]) => {
      const statusBreakdown = summary.statuses.size > 0
        ? Array.from(summary.statuses.entries())
          .sort((left, right) => left[0] - right[0])
          .map(([status, count]) => `${status}:${count}`)
          .join(', ')
        : 'n/a';
      return `- \`${action}\`: total=${summary.total}, response=${summary.responseFailures}, requestfailed=${summary.requestFailed}, statuses={${statusBreakdown}}`;
    });
};

export const formatSuccessBreakdownLines = (breakdown, emptyMessage) => {
  if (breakdown.size === 0) {
    return [`- [INFO] ${emptyMessage}`];
  }

  return Array.from(breakdown.entries())
    .sort(([, left], [, right]) => right.total - left.total)
    .map(([action, summary]) => {
      const statusBreakdown = summary.statuses.size > 0
        ? Array.from(summary.statuses.entries())
          .sort((left, right) => left[0] - right[0])
          .map(([status, count]) => `${status}:${count}`)
          .join(', ')
        : 'n/a';
      return `- \`${action}\`: total=${summary.total}, statuses={${statusBreakdown}}`;
    });
};
