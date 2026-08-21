import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const runValidator = (args: string[], cwd: string) => (
  spawnSync(process.execPath, ['scripts/release/validate-release-secret-hygiene.mjs', ...args], {
    cwd,
    encoding: 'utf8',
  })
);

const writeFixture = (tmpDir: string, name: string, content: string) => {
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, content);
  return filePath;
};

describe('release secret hygiene scan', () => {
  it('passes against current release-facing evidence surfaces', () => {
    const result = runValidator([], process.cwd());

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('file(s) scanned');
  });

  it('includes current handoff, backlog, vision, and catch-up evidence surfaces in the default scan', () => {
    const result = runValidator(['--list-files'], process.cwd());

    expect(result.status).toBe(0);
    const scannedFiles = result.stdout.trim().split(/\r?\n/);
    expect(scannedFiles).toEqual(expect.arrayContaining([
      'BACKLOG.md',
      'HANDOFF.md',
      'VISION.md',
      'docs/catchup-timeshift-hls-evidence.md',
      'docs/V3-QA-FIX-BACKLOG.md',
    ]));
  });

  it('allows redacted query parameters in docs', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-secret-hygiene-'));
    const filePath = writeFixture(
      tmpDir,
      'redacted.md',
      'Provider example: https://edge.example/streaming/timeshift.php?username=...&password=<redacted>&token=***\n',
    );

    const result = runValidator([filePath], repoRoot);
    expect(result.status).toBe(0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('allows an explicitly redacted inline login pair', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-secret-hygiene-'));
    const filePath = writeFixture(
      tmpDir,
      'redacted-login.md',
      'QA login `[REDACTED]`/`[REDACTED]` is intentionally unavailable.\n',
    );

    const result = runValidator([filePath], repoRoot);
    expect(result.status).toBe(0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails on a concrete inline login pair in documentation', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-secret-hygiene-'));
    const filePath = writeFixture(
      tmpDir,
      'leaky-login.md',
      'QA login `demo-user`/`demo-password` must not be committed.\n',
    );

    const result = runValidator([filePath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('inline login pair contains non-redacted credentials');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails on non-redacted credential query parameters', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-secret-hygiene-'));
    const filePath = writeFixture(
      tmpDir,
      'leaky.md',
      'Provider example: https://edge.example/streaming/timeshift.php?username=real-user&password=real-password\n',
    );

    const result = runValidator([filePath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('query parameter username contains a non-redacted value');
    expect(result.stderr).toContain('query parameter password contains a non-redacted value');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails on JSON secret fields with concrete values', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-secret-hygiene-'));
    const filePath = writeFixture(
      tmpDir,
      'leaky.json',
      '{ "username": "real-user", "token": "abc123" }\n',
    );

    const result = runValidator([filePath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('JSON field username contains a non-redacted value');
    expect(result.stderr).toContain('JSON field token contains a non-redacted value');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails on env-style secret assignments', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-secret-hygiene-'));
    const filePath = writeFixture(
      tmpDir,
      'leaky.txt',
      'XTREAM_PASSWORD=real-password\nPROVIDER_API_KEY=abc123\n',
    );

    const result = runValidator([filePath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('env assignment XTREAM_PASSWORD contains a non-redacted value');
    expect(result.stderr).toContain('env assignment PROVIDER_API_KEY contains a non-redacted value');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails on basic-auth URLs', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-secret-hygiene-'));
    const filePath = writeFixture(
      tmpDir,
      'basic-auth.md',
      'Do not publish https://user:password@example.invalid/stream\n',
    );

    const result = runValidator([filePath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('URL contains basic-auth credentials');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails on basic-auth URLs in each scanned file', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-secret-hygiene-'));
    const firstFilePath = writeFixture(
      tmpDir,
      'first-basic-auth.md',
      'Do not publish https://user:password@example.invalid/stream\n',
    );
    const secondFilePath = writeFixture(
      tmpDir,
      'second-basic-auth.md',
      'https://admin:secret@example.invalid/stream\n',
    );

    const result = runValidator([firstFilePath, secondFilePath], repoRoot);
    expect(result.status).toBe(2);
    const findingCount = result.stderr.match(/URL contains basic-auth credentials/g)?.length ?? 0;
    expect(findingCount).toBe(2);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
