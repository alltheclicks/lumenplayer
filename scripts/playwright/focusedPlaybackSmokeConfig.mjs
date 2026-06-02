export const DEFAULT_PLAYBACK_SMOKE_SCENARIO_IDS = [
  'live-failure-report',
  'catchup-failure-live-action',
  'playable-catchup-controls',
  'playable-catchup-mouse-seek',
  'catchup-edge-stress',
  'catchup-live-switch-stress',
  'rapid-live-zap',
];

export const parseCommaSeparatedList = (value) => (
  (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
);

export const parseSelectedScenarioIds = (value) => {
  const selected = parseCommaSeparatedList(value);
  return selected.length > 0 ? selected : DEFAULT_PLAYBACK_SMOKE_SCENARIO_IDS;
};

export const parseIdSet = (value) => new Set(parseCommaSeparatedList(value));

export const parseViewport = (value) => {
  const match = /^(\d+)x(\d+)$/i.exec(value ?? '');
  if (!match) {
    return { width: 1280, height: 720 };
  }

  return {
    width: Math.max(320, Number(match[1])),
    height: Math.max(240, Number(match[2])),
  };
};

export const parseHeadless = (value) => value !== 'false';

export const parseBrowserChannel = (value) => value?.trim() || undefined;

const parsePositiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const parseCpuGuardConfig = (env) => ({
  enabled: env.E2E_CPU_GUARD !== 'false',
  maxTotalPercent: parsePositiveNumber(env.E2E_CPU_GUARD_MAX_TOTAL, 180),
  pollMs: Math.max(1_000, parsePositiveNumber(env.E2E_CPU_GUARD_POLL_MS, 5_000)),
});

export const sumCpuPercentFromPs = (output) => (
  output
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((value) => Number.isFinite(value))
    .reduce((sum, value) => sum + value, 0)
);

export const resolveCpuLoadDecision = ({
  enabled,
  currentTotalPercent,
  maxTotalPercent,
}) => {
  if (
    !enabled ||
    !Number.isFinite(currentTotalPercent) ||
    !Number.isFinite(maxTotalPercent) ||
    maxTotalPercent <= 0
  ) {
    return {
      ok: true,
      reason: null,
    };
  }

  return currentTotalPercent > maxTotalPercent
    ? { ok: false, reason: 'cpu_load_high' }
    : { ok: true, reason: null };
};

export const findUnknownScenarioIds = (selectedIds, validIds) => {
  const validIdSet = new Set(validIds);
  return selectedIds.filter((id) => !validIdSet.has(id));
};

export const resolveXtreamAuthPreflightDecision = (payload) => {
  const authValue = payload?.user_info?.auth;
  const authNumber = typeof authValue === 'number' ? authValue : Number(authValue);

  if (authNumber === 1) {
    return {
      ok: true,
      reason: null,
    };
  }

  return {
    ok: false,
    reason: authValue === undefined ? 'missing_auth' : `auth_${String(authValue)}`,
  };
};
