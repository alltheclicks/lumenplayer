import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const runValidator = (args: string[] = []) => (
  spawnSync(process.execPath, ['scripts/release/validate-google-cast-readiness.mjs', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
);

describe('Google Cast readiness validator', () => {
  it('passes when production receiver, V1 loadMedia, and MP2 guardrails are documented and tested', () => {
    const result = runValidator();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('[google-cast-readiness] OK');
  });

  it('rejects unexpected arguments', () => {
    const result = runValidator(['--unknown']);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Unknown argument');
  });
});
