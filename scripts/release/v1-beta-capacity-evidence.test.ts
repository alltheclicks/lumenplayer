import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

type CapacityStatus = 'pending' | 'pass' | 'fail';

interface CapacityCheck {
  id: string;
  status: CapacityStatus;
  owner: string;
  evidence: string;
}

interface BetaCapacityEvidenceArtifact {
  target: {
    minConcurrentLiveUsers: number;
    maxConcurrentLiveUsers: number;
  };
  mediaPath: {
    allowedTransportModes: string[];
    disallowedTransportModes: string[];
    usesLocalFfmpeg: boolean;
    usesServerSideTranscode: boolean;
    usesServerSideRemux: boolean;
    usesGeneratedHls: boolean;
    usesXuiSideTranscode: boolean;
    usesXuiSideRemux: boolean;
    evidence: string;
  };
  checks: CapacityCheck[];
  signoff: {
    status: CapacityStatus;
    approvedBy: string;
    approvedAt: string;
  };
}

const runValidator = (args: string[], cwd: string) => (
  spawnSync(process.execPath, ['scripts/release/validate-beta-capacity-evidence.mjs', ...args], {
    cwd,
    encoding: 'utf8',
  })
);

const loadTemplate = (): BetaCapacityEvidenceArtifact => {
  const templatePath = path.resolve(
    process.cwd(),
    'scripts/release/v1-beta-capacity-evidence.template.json',
  );

  return JSON.parse(fs.readFileSync(templatePath, 'utf8')) as BetaCapacityEvidenceArtifact;
};

const finalizeArtifact = (): BetaCapacityEvidenceArtifact => {
  const artifact = loadTemplate();
  artifact.mediaPath.evidence = 'output/playwright/manual-network-audit/REPORT.md plus provider/XUI owner capacity statement';
  for (const check of artifact.checks) {
    check.status = 'pass';
    check.owner = 'release-owner';
    check.evidence = `evidence://${check.id}`;
  }
  artifact.signoff.status = 'pass';
  artifact.signoff.approvedBy = 'release-director';
  artifact.signoff.approvedAt = '2026-06-02T15:30:00.000Z';
  return artifact;
};

describe('V1 beta capacity evidence artifact', () => {
  it('defines a 300-500 user beta target and forbids media processing paths', () => {
    const template = loadTemplate();

    expect(template.target.minConcurrentLiveUsers).toBeGreaterThanOrEqual(300);
    expect(template.target.maxConcurrentLiveUsers).toBeGreaterThanOrEqual(500);
    expect(template.mediaPath.allowedTransportModes).toEqual(['provider-direct', 'proxy-normalized']);
    expect(template.mediaPath.disallowedTransportModes).toContain('proxy-remuxed');
    expect(template.mediaPath.disallowedTransportModes).toContain('remux-hls');
    expect(template.mediaPath.usesLocalFfmpeg).toBe(false);
    expect(template.mediaPath.usesServerSideTranscode).toBe(false);
    expect(template.mediaPath.usesServerSideRemux).toBe(false);
    expect(template.mediaPath.usesGeneratedHls).toBe(false);
    expect(template.mediaPath.usesXuiSideTranscode).toBe(false);
    expect(template.mediaPath.usesXuiSideRemux).toBe(false);
  });

  it('passes validator in template mode and strict mode for finalized artifact', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-capacity-'));
    const finalPath = path.join(tmpDir, 'final.json');

    const templateResult = runValidator([
      'scripts/release/v1-beta-capacity-evidence.template.json',
    ], repoRoot);
    expect(templateResult.status).toBe(0);

    fs.writeFileSync(finalPath, `${JSON.stringify(finalizeArtifact(), null, 2)}\n`);

    const finalResult = runValidator([finalPath, '--require-final'], repoRoot);
    expect(finalResult.status).toBe(0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('tracks the QAF-035 partial beta capacity artifact without allowing final signoff', () => {
    const repoRoot = process.cwd();
    const artifactPath = 'artifacts/release/capacity/qaf035-beta-capacity-20260602.json';

    const partialResult = runValidator([artifactPath], repoRoot);
    expect(partialResult.status).toBe(0);

    const finalResult = runValidator([artifactPath, '--require-final'], repoRoot);
    expect(finalResult.status).toBe(2);
    expect(finalResult.stderr).toContain('check provider-capacity-owner is pending with --require-final');
  });

  it('fails strict validation if proxy-remuxed is allowed', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-capacity-'));
    const invalidPath = path.join(tmpDir, 'remux-allowed.json');
    const artifact = finalizeArtifact();
    artifact.mediaPath.allowedTransportModes.push('proxy-remuxed');
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('allowedTransportModes must not include proxy-remuxed');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails strict validation if XUI-side transcode is enabled', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-capacity-'));
    const invalidPath = path.join(tmpDir, 'xui-transcode.json');
    const artifact = finalizeArtifact();
    artifact.mediaPath.usesXuiSideTranscode = true;
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('mediaPath.usesXuiSideTranscode must be false');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails strict validation if XUI-side remux is enabled', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-capacity-'));
    const invalidPath = path.join(tmpDir, 'xui-remux.json');
    const artifact = finalizeArtifact();
    artifact.mediaPath.usesXuiSideRemux = true;
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('mediaPath.usesXuiSideRemux must be false');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails strict validation if signoff is pass while a required capacity check failed', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-capacity-'));
    const invalidPath = path.join(tmpDir, 'failed-check.json');
    const artifact = finalizeArtifact();
    artifact.checks[0].status = 'fail';
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('signoff.status cannot be pass while any capacity check is fail');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
