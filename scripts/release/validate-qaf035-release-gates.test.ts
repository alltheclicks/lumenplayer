import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const runValidator = (args: string[] = []) => (
  spawnSync(process.execPath, ['scripts/release/validate-qaf035-release-gates.mjs', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
);

describe('QAF-035 release gate aggregate validator', () => {
  it('keeps closure final-proof guidance gate-specific instead of aggregate-only', () => {
    const runbook = fs.readFileSync(path.resolve(process.cwd(), 'docs/release/qaf035-beta-signoff-runbook.md'), 'utf8');

    expect(runbook).toContain('direct, gate-specific final proof command');
    expect(runbook).toContain('not a substitute for the concrete artifact validator with `--require-final`');
    expect(runbook).toContain('must also be listed in that closure item');
    expect(runbook).not.toContain('either the aggregate `pnpm release:qaf035:final` or a concrete artifact validator');
  });

  it('passes current QAF-035 artifacts while preserving explicit final blockers', () => {
    const result = runValidator();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('mode: current-open-blockers');
    expect(result.stdout).toContain('expected final validation failures');
    expect(result.stdout).toContain('final go/no-go checklist');
    expect(result.stdout).toContain('final smoke/regression matrix');
    expect(result.stdout).toContain('final compatibility matrix');
    expect(result.stdout).toContain('final design parity evidence');
    expect(result.stdout).toContain('final provider owner signoff');
    expect(result.stdout).toContain('final manual device QA');
    expect(result.stdout).toContain('pr-quality-gate-workflow');
    expect(result.stdout).toContain('package-scripts');
    expect(result.stdout).toContain('qaf035-beta-signoff-runbook');
    expect(result.stdout).toContain('no-media scan artifact');
    expect(result.stdout).toContain('performance evidence');
    expect(result.stdout).toContain('observability baseline');
    expect(result.stdout).toContain('security/privacy baseline');
    expect(result.stdout).toContain('beta blocker closure plan');
    expect(result.stdout).toContain('checks passed: 13');
  });

  it('fails final mode until concrete owner and device evidence is complete', () => {
    const result = runValidator(['--require-final']);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('final go/no-go checklist failed');
    expect(result.stderr).toContain('final smoke/regression matrix failed');
    expect(result.stderr).toContain('final compatibility matrix failed');
    expect(result.stderr).toContain('final design parity evidence failed');
    expect(result.stderr).toContain('final release readiness failed');
    expect(result.stderr).toContain('final provider owner signoff failed');
    expect(result.stderr).toContain('final performance evidence failed');
    expect(result.stderr).toContain('final observability baseline failed');
    expect(result.stderr).toContain('final manual device QA failed');
    expect(result.stderr).toContain('final security/privacy baseline failed');
  });

  it('rejects unknown flags', () => {
    const result = runValidator(['--unknown']);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Unknown flag');
  });
});
