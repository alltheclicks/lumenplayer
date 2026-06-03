import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

interface NoMediaEvidenceScanArtifact {
  source: {
    rawEvidenceTracked: boolean;
  };
  scan: {
    status: 'pending' | 'pass' | 'fail';
    command: string;
    forbiddenHits: string[];
    forbiddenPatterns: string[];
  };
  summary: {
    disallowedMediaProcessingUrlHits: number;
    mediaProcessingProcessesObserved: number;
  };
}

const artifactPath = 'artifacts/release/media-policy/qaf035-no-media-evidence-scan-20260602.json';

const runValidator = (args: string[], cwd: string) => (
  spawnSync(process.execPath, ['scripts/release/validate-no-media-evidence-scan-artifact.mjs', ...args], {
    cwd,
    encoding: 'utf8',
  })
);

const loadArtifact = (): NoMediaEvidenceScanArtifact => (
  JSON.parse(fs.readFileSync(path.resolve(process.cwd(), artifactPath), 'utf8')) as NoMediaEvidenceScanArtifact
);

describe('no-media evidence scan artifact', () => {
  it('validates the tracked QAF-035 redacted scan result', () => {
    const result = runValidator([artifactPath], process.cwd());

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('status: pass');
  });

  it('fails final validation when forbidden hits are present', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-no-media-scan-artifact-'));
    const invalidPath = path.join(tmpDir, 'forbidden-hit.json');
    const artifact = loadArtifact();
    artifact.scan.forbiddenHits = ['ffmpeg'];
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('scan.forbiddenHits must be empty');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails validation when raw evidence is marked tracked', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-no-media-scan-artifact-'));
    const invalidPath = path.join(tmpDir, 'raw-tracked.json');
    const artifact = loadArtifact();
    artifact.source.rawEvidenceTracked = true;
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('source.rawEvidenceTracked must be false');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails validation when the scanner command is missing', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-no-media-scan-artifact-'));
    const invalidPath = path.join(tmpDir, 'missing-command.json');
    const artifact = loadArtifact();
    artifact.scan.command = 'cat output/playwright/manual-network-audit/report.json';
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('scan.command must reference release:no-media-evidence:scan');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
