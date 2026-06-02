import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const runTask = (args: string[], cwd: string) => (
  spawnSync(process.execPath, ['scripts/release/compatibility-matrix-task.mjs', ...args], {
    cwd,
    encoding: 'utf8',
  })
);

describe('compatibility-matrix-task', () => {
  it('initializes run artifacts using matrix + target profiles', () => {
    const repoRoot = process.cwd();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-0342-compat-'));
    const outPath = path.join(tempDir, 'run.json');

    const init = runTask([
      'init',
      '--matrix', 'scripts/release/v1-smoke-regression-matrix.template.json',
      '--targets', 'scripts/release/v1-compatibility-targets.template.json',
      '--out', outPath,
      '--run-id', 'compat-test-run',
      '--operator', 'ci-test',
    ], repoRoot);

    expect(init.status).toBe(0);
    expect(fs.existsSync(outPath)).toBe(true);

    const run = JSON.parse(fs.readFileSync(outPath, 'utf8')) as {
      targets: Array<{ id: string }>;
      results: Array<{ caseId: string; targetId: string; status: string }>;
    };

    expect(run.targets.length).toBeGreaterThanOrEqual(4);
    expect(run.results.length).toBeGreaterThan(13);
    expect(run.results.every((result) => result.status === 'pending')).toBe(true);
    expect(run.targets.some((target) => target.id === 'provider-qa-account')).toBe(true);
    expect(run.targets.some((target) => target.id === 'no-media-processing-audit')).toBe(true);
    expect(run.targets.some((target) => target.id === 'web-gateway-vitest')).toBe(true);
    expect(run.targets.some((target) => target.id === 'desktop-chromium-local')).toBe(true);
    expect(run.results.some((result) => result.targetId === 'cast-chromecast')).toBe(true);
    expect(run.results.some((result) => (
      result.caseId === 'SMK-PROVIDER-AUTH-LIVE-CATALOG'
      && result.targetId === 'desktop-chrome-windows'
    ))).toBe(false);
    expect(run.results.some((result) => (
      result.caseId === 'REG-WEB-GATEWAY-REJECTS-REMUX'
      && result.targetId === 'provider-qa-account'
    ))).toBe(false);
    expect(run.results.some((result) => (
      result.caseId === 'REG-DESKTOP-LOCAL-PLAYER-STATE'
      && result.targetId === 'desktop-chrome-windows'
    ))).toBe(true);
    expect(run.results.some((result) => (
      result.caseId === 'SMK-DESKTOP-CHROME-LIVE'
      && result.targetId === 'desktop-chromium-local'
    ))).toBe(true);
    expect(run.results.some((result) => (
      result.caseId === 'REG-DESKTOP-LOCAL-PLAYER-STATE'
      && result.targetId === 'desktop-chromium-local'
    ))).toBe(true);
    expect(run.results.some((result) => (
      result.caseId === 'SMK-DESKTOP-SAFARI-VOD'
      && result.targetId === 'desktop-chrome-windows'
    ))).toBe(false);
    expect(run.results.some((result) => (
      result.caseId === 'SMK-DESKTOP-CHROME-LIVE'
      && result.targetId === 'desktop-safari-macos'
    ))).toBe(false);
    expect(run.results.some((result) => (
      result.caseId === 'SMK-DESKTOP-SAFARI-VOD'
      && result.targetId === 'desktop-chromium-local'
    ))).toBe(false);
    expect(run.results.some((result) => (
      result.caseId === 'REG-CAST-RENDERER-SWITCH'
      && result.targetId === 'desktop-chrome-windows'
    ))).toBe(false);
    expect(run.results.some((result) => (
      result.caseId === 'REG-AIRPLAY-RETURN-LOCAL'
      && result.targetId === 'desktop-safari-macos'
    ))).toBe(false);
  });

  it('requires --target when a case exists for multiple targets', () => {
    const repoRoot = process.cwd();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-0342-compat-'));
    const outPath = path.join(tempDir, 'run.json');

    const init = runTask([
      'init',
      '--matrix', 'scripts/release/v1-smoke-regression-matrix.template.json',
      '--targets', 'scripts/release/v1-compatibility-targets.template.json',
      '--out', outPath,
      '--run-id', 'compat-test-run-2',
    ], repoRoot);
    expect(init.status).toBe(0);

    const ambiguousSet = runTask([
      'set',
      '--run', outPath,
      '--case', 'SMK-DESKTOP-CHROME-LIVE',
      '--status', 'pass',
      '--executor', 'ci-test',
    ], repoRoot);
    expect(ambiguousSet.status).toBe(2);
    expect(ambiguousSet.stderr).toContain('matches multiple targets');

    const targetedSet = runTask([
      'set',
      '--run', outPath,
      '--case', 'SMK-DESKTOP-CHROME-LIVE',
      '--target', 'desktop-chrome-windows',
      '--status', 'pass',
      '--executor', 'ci-test',
      '--evidence', 'manual-run-1',
    ], repoRoot);
    expect(targetedSet.status).toBe(0);

    const run = JSON.parse(fs.readFileSync(outPath, 'utf8')) as {
      results: Array<{ caseId: string; targetId: string; status: string; evidence: string; executor: string }>;
    };
    const updated = run.results.find((result) => (
      result.caseId === 'SMK-DESKTOP-CHROME-LIVE'
      && result.targetId === 'desktop-chrome-windows'
    ));

    expect(updated?.status).toBe('pass');
    expect(updated?.evidence).toBe('manual-run-1');
    expect(updated?.executor).toBe('ci-test');
  });

  it('does not duplicate case-target rows when multiple tags match the same target', () => {
    const repoRoot = process.cwd();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-0342-compat-'));
    const matrixPath = path.join(tempDir, 'matrix.json');
    const targetsPath = path.join(tempDir, 'targets.json');
    const outPath = path.join(tempDir, 'run.json');

    fs.writeFileSync(matrixPath, JSON.stringify({
      release: 'V1',
      templateVersion: 1,
      cases: [
        {
          id: 'CASE-MULTI-TAG',
          suite: 'smoke',
          title: 'case with two matching tags',
          platform: 'mobile',
          device: 'Android',
          browser: 'Chrome',
          tags: ['mobile-browser', 'pwa-install'],
          releaseBlocker: true,
        },
      ],
    }, null, 2));

    fs.writeFileSync(targetsPath, JSON.stringify({
      targets: [
        {
          id: 'target-mobile',
          name: 'Target mobile',
          platform: 'mobile',
          device: 'Android',
          browser: 'Chrome',
          requiredTags: ['mobile-browser', 'pwa-install'],
        },
      ],
    }, null, 2));

    const init = runTask([
      'init',
      '--matrix', matrixPath,
      '--targets', targetsPath,
      '--out', outPath,
      '--run-id', 'compat-test-run-3',
    ], repoRoot);
    expect(init.status).toBe(0);

    const run = JSON.parse(fs.readFileSync(outPath, 'utf8')) as {
      results: Array<{ caseId: string; targetId: string }>;
    };

    const matched = run.results.filter((result) => (
      result.caseId === 'CASE-MULTI-TAG' && result.targetId === 'target-mobile'
    ));
    expect(matched).toHaveLength(1);
  });

  it('supports strict tag matching with target matchMode=all', () => {
    const repoRoot = process.cwd();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-0342-compat-'));
    const matrixPath = path.join(tempDir, 'matrix.json');
    const targetsPath = path.join(tempDir, 'targets.json');
    const outPath = path.join(tempDir, 'run.json');

    fs.writeFileSync(matrixPath, JSON.stringify({
      release: 'V1',
      templateVersion: 1,
      cases: [
        {
          id: 'CASE-ONE-TAG',
          suite: 'smoke',
          title: 'one tag only',
          platform: 'mobile',
          device: 'Android',
          browser: 'Chrome',
          tags: ['mobile-browser'],
          releaseBlocker: true,
        },
        {
          id: 'CASE-TWO-TAGS',
          suite: 'smoke',
          title: 'two required tags',
          platform: 'mobile',
          device: 'Android',
          browser: 'Chrome',
          tags: ['mobile-browser', 'pwa-install'],
          releaseBlocker: true,
        },
      ],
    }, null, 2));

    fs.writeFileSync(targetsPath, JSON.stringify({
      targets: [
        {
          id: 'target-strict-mobile',
          name: 'Target strict mobile',
          platform: 'mobile',
          device: 'Android',
          browser: 'Chrome',
          matchMode: 'all',
          requiredTags: ['mobile-browser', 'pwa-install'],
        },
      ],
    }, null, 2));

    const init = runTask([
      'init',
      '--matrix', matrixPath,
      '--targets', targetsPath,
      '--out', outPath,
      '--run-id', 'compat-test-run-4',
    ], repoRoot);
    expect(init.status).toBe(0);

    const run = JSON.parse(fs.readFileSync(outPath, 'utf8')) as {
      results: Array<{ caseId: string; targetId: string }>;
    };

    expect(run.results).toHaveLength(1);
    expect(run.results[0]?.caseId).toBe('CASE-TWO-TAGS');
    expect(run.results[0]?.targetId).toBe('target-strict-mobile');
  });

  it('requires evidence before finalizing a compatibility run', () => {
    const repoRoot = process.cwd();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-0342-compat-'));
    const matrixPath = path.join(tempDir, 'matrix.json');
    const outPath = path.join(tempDir, 'run.json');

    fs.writeFileSync(matrixPath, JSON.stringify({
      release: 'V1',
      templateVersion: 1,
      cases: [
        {
          id: 'CASE-NEEDS-EVIDENCE',
          suite: 'smoke',
          title: 'case needs evidence',
          platform: 'desktop',
          device: 'Desktop',
          browser: 'Chrome',
          tags: ['desktop-browser'],
          releaseBlocker: true,
        },
      ],
    }, null, 2));

    const init = runTask([
      'init',
      '--matrix', matrixPath,
      '--out', outPath,
      '--run-id', 'compat-test-run-5',
    ], repoRoot);
    expect(init.status).toBe(0);

    const setWithoutEvidence = runTask([
      'set',
      '--run', outPath,
      '--case', 'CASE-NEEDS-EVIDENCE',
      '--status', 'pass',
      '--executor', 'ci-test',
    ], repoRoot);
    expect(setWithoutEvidence.status).toBe(0);

    const finalizeMissingEvidence = runTask([
      'finalize',
      '--run', outPath,
      '--signoff', 'pass',
      '--approved-by', 'release-owner',
    ], repoRoot);
    expect(finalizeMissingEvidence.status).toBe(2);
    expect(finalizeMissingEvidence.stderr).toContain('missing evidence');

    const setWithEvidence = runTask([
      'set',
      '--run', outPath,
      '--case', 'CASE-NEEDS-EVIDENCE',
      '--status', 'pass',
      '--executor', 'ci-test',
      '--evidence', 'output/playwright/manual-network-audit/REPORT.md',
    ], repoRoot);
    expect(setWithEvidence.status).toBe(0);

    const finalizeWithEvidence = runTask([
      'finalize',
      '--run', outPath,
      '--signoff', 'pass',
      '--approved-by', 'release-owner',
    ], repoRoot);
    expect(finalizeWithEvidence.status).toBe(0);
  });
});
