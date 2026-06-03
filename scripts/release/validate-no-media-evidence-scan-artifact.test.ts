import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

interface NoMediaEvidenceScanArtifact {
  source: {
    evidenceRef: string;
    reportRef: string;
    rawEvidenceTracked: boolean;
    rawEvidenceIgnored: boolean;
    evidenceSha256: string;
    reportSha256: string;
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

  it('fails validation when raw evidence is not marked ignored', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-no-media-scan-artifact-'));
    const invalidPath = path.join(tmpDir, 'raw-not-ignored-flag.json');
    const artifact = loadArtifact();
    artifact.source.rawEvidenceIgnored = false;
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('source.rawEvidenceIgnored must be true');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails validation when a source ref is tracked by git', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-no-media-scan-artifact-'));
    const invalidPath = path.join(tmpDir, 'source-ref-tracked.json');
    const artifact = loadArtifact();
    artifact.source.evidenceRef = 'package.json';
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('source.evidenceRef must not be tracked by git');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails validation when a source ref is not ignored by git', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(repoRoot, '.tmp-no-media-scan-artifact-'));
    const sourcePath = path.join(tmpDir, 'report.json');
    const invalidPath = path.join(tmpDir, 'source-ref-not-ignored.json');
    const artifact = loadArtifact();
    fs.writeFileSync(sourcePath, '{ "status": "ignored-policy-missing" }\n');
    artifact.source.evidenceRef = path.relative(repoRoot, sourcePath);
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('source.evidenceRef must be ignored by git');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails validation when an existing source hash differs from the artifact digest', () => {
    const repoRoot = process.cwd();
    const ignoredParent = path.join(repoRoot, 'output/playwright/manual-network-audit');
    fs.mkdirSync(ignoredParent, { recursive: true });
    const tmpDir = fs.mkdtempSync(path.join(ignoredParent, 'hash-mismatch-'));
    const sourcePath = path.join(tmpDir, 'report.json');
    const invalidPath = path.join(tmpDir, 'hash-mismatch.json');
    const artifact = loadArtifact();
    fs.writeFileSync(sourcePath, '{ "status": "changed" }\n');
    artifact.source.evidenceRef = path.relative(repoRoot, sourcePath);
    artifact.source.evidenceSha256 = '0'.repeat(64);
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('source.evidenceSha256 does not match current');

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
