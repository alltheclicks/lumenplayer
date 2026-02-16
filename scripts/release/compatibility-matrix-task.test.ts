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
    expect(run.results.some((result) => result.targetId === 'cast-chromecast')).toBe(true);
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
});
