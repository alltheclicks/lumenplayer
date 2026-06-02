import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAYBACK_SMOKE_SCENARIO_IDS,
  findUnknownScenarioIds,
  parseBrowserChannel,
  parseCpuGuardConfig,
  parseCommaSeparatedList,
  parseHeadless,
  parseIdSet,
  parseSelectedScenarioIds,
  parseViewport,
  resolveCpuLoadDecision,
  resolveXtreamAuthPreflightDecision,
  sumCpuPercentFromPs,
} from './focusedPlaybackSmokeConfig.mjs';

describe('focused playback smoke config', () => {
  it('defaults to every focused playback scenario when none is selected', () => {
    expect(DEFAULT_PLAYBACK_SMOKE_SCENARIO_IDS).toContain('playable-catchup-mouse-seek');
    expect(DEFAULT_PLAYBACK_SMOKE_SCENARIO_IDS).toContain('catchup-edge-stress');
    expect(DEFAULT_PLAYBACK_SMOKE_SCENARIO_IDS).toContain('catchup-live-switch-stress');
    expect(parseSelectedScenarioIds(undefined)).toEqual(DEFAULT_PLAYBACK_SMOKE_SCENARIO_IDS);
    expect(parseSelectedScenarioIds(' , ')).toEqual(DEFAULT_PLAYBACK_SMOKE_SCENARIO_IDS);
  });

  it('parses comma separated scenario and candidate lists', () => {
    expect(parseCommaSeparatedList(' live-failure-report, playable-catchup-controls ,, ')).toEqual([
      'live-failure-report',
      'playable-catchup-controls',
    ]);
    expect(Array.from(parseIdSet('pink, rts1, pink'))).toEqual(['pink', 'rts1']);
  });

  it('parses and clamps viewport values', () => {
    expect(parseViewport(undefined)).toEqual({ width: 1280, height: 720 });
    expect(parseViewport('960x540')).toEqual({ width: 960, height: 540 });
    expect(parseViewport('100x120')).toEqual({ width: 320, height: 240 });
    expect(parseViewport('bad')).toEqual({ width: 1280, height: 720 });
  });

  it('parses browser launch overrides', () => {
    expect(parseHeadless(undefined)).toBe(true);
    expect(parseHeadless('true')).toBe(true);
    expect(parseHeadless('false')).toBe(false);
    expect(parseBrowserChannel(undefined)).toBeUndefined();
    expect(parseBrowserChannel(' chrome ')).toBe('chrome');
  });

  it('parses the CPU guard config with a conservative default', () => {
    expect(parseCpuGuardConfig({})).toEqual({
      enabled: true,
      maxTotalPercent: 180,
      pollMs: 5_000,
    });
    expect(parseCpuGuardConfig({
      E2E_CPU_GUARD: 'false',
      E2E_CPU_GUARD_MAX_TOTAL: '250',
      E2E_CPU_GUARD_POLL_MS: '800',
    })).toEqual({
      enabled: false,
      maxTotalPercent: 250,
      pollMs: 1_000,
    });
  });

  it('sums CPU percentages from ps output and ignores invalid rows', () => {
    expect(sumCpuPercentFromPs('%CPU\n 12.5\nbad\n 8\n')).toBe(20.5);
  });

  it('blocks browser smoke when the preflight CPU load is already too high', () => {
    expect(resolveCpuLoadDecision({
      enabled: true,
      currentTotalPercent: 220,
      maxTotalPercent: 180,
    })).toEqual({
      ok: false,
      reason: 'cpu_load_high',
    });
    expect(resolveCpuLoadDecision({
      enabled: true,
      currentTotalPercent: 120,
      maxTotalPercent: 180,
    })).toEqual({
      ok: true,
      reason: null,
    });
  });

  it('detects selected smoke scenarios that have no runner', () => {
    expect(findUnknownScenarioIds(['live-failure-report', 'missing'], ['live-failure-report'])).toEqual(['missing']);
    expect(findUnknownScenarioIds(['live-failure-report'], ['live-failure-report'])).toEqual([]);
  });

  it('classifies Xtream auth preflight payloads before browser smoke', () => {
    expect(resolveXtreamAuthPreflightDecision({ user_info: { auth: 1 } })).toEqual({
      ok: true,
      reason: null,
    });
    expect(resolveXtreamAuthPreflightDecision({ user_info: { auth: '1' } })).toEqual({
      ok: true,
      reason: null,
    });
    expect(resolveXtreamAuthPreflightDecision({ user_info: { auth: 0 } })).toEqual({
      ok: false,
      reason: 'auth_0',
    });
    expect(resolveXtreamAuthPreflightDecision({ user_info: {} })).toEqual({
      ok: false,
      reason: 'missing_auth',
    });
  });
});
