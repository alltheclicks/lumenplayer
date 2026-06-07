import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const runValidator = (args: string[] = []) => (
  spawnSync(process.execPath, ['scripts/release/validate-pwa-readiness.mjs', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
);

describe('PWA readiness validator', () => {
  it('passes when manifest, offline fallback, install UX, and source guardrails are present', () => {
    const result = runValidator();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('[pwa-readiness] OK');
  });

  it('rejects unexpected arguments', () => {
    const result = runValidator(['--unknown']);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Unknown argument');
  });
});
