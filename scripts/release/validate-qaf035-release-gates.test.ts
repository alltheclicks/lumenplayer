import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const runValidator = (args: string[] = []) => (
  spawnSync(process.execPath, ['scripts/release/validate-qaf035-release-gates.mjs', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
);

describe('QAF-035 release gate aggregate validator', () => {
  it('passes current QAF-035 artifacts while preserving explicit final blockers', () => {
    const result = runValidator();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('mode: current-open-blockers');
    expect(result.stdout).toContain('expected final blockers');
    expect(result.stdout).toContain('final provider owner signoff');
    expect(result.stdout).toContain('final manual device QA');
    expect(result.stdout).toContain('pr-quality-gate-workflow');
    expect(result.stdout).toContain('package-scripts');
    expect(result.stdout).toContain('qaf035-beta-signoff-runbook');
    expect(result.stdout).toContain('no-media scan artifact');
    expect(result.stdout).toContain('performance evidence');
    expect(result.stdout).toContain('observability baseline');
  });

  it('fails final mode until concrete owner and device evidence is complete', () => {
    const result = runValidator(['--require-final']);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('final release readiness failed');
    expect(result.stderr).toContain('final provider owner signoff failed');
    expect(result.stderr).toContain('final performance evidence failed');
    expect(result.stderr).toContain('final observability baseline failed');
    expect(result.stderr).toContain('final manual device QA failed');
  });

  it('rejects unknown flags', () => {
    const result = runValidator(['--unknown']);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Unknown flag');
  });
});
