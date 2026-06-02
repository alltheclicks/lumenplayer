import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

type ProviderOwnerStatus = 'pending' | 'pass' | 'fail';

interface ProviderOwnerSignoffArtifact {
  target: {
    minConcurrentLiveUsers: number;
    maxConcurrentLiveUsers: number;
  };
  provider: {
    name: string;
    accountScope: string;
    xuiHostRef: string;
    ownerName: string;
    ownerRole: string;
    contact: string;
    approvedAt: string;
    evidenceRefs: string[];
  };
  mediaProcessingCommitment: {
    status: ProviderOwnerStatus;
    owner: string;
    allowedTransportModes: string[];
    usesServerSideTranscode: boolean;
    usesServerSideRemux: boolean;
    usesGeneratedHls: boolean;
    usesXuiSideTranscode: boolean;
    usesXuiSideRemux: boolean;
    forbiddenResolutionPaths: string[];
    evidenceRefs: string[];
  };
  capacityCommitment: {
    status: ProviderOwnerStatus;
    owner: string;
    approvedConcurrentLiveUsers: number;
    accountLimitEvidence: string;
    upstreamCapacityEvidence: string;
    rateLimitPolicy: string;
    rollbackContact: string;
    evidenceRefs: string[];
  };
  checks: Array<{
    id: string;
    status: ProviderOwnerStatus;
    owner: string;
    evidence: string;
  }>;
  signoff: {
    status: ProviderOwnerStatus;
    approvedBy: string;
    approvedAt: string;
  };
}

const runValidator = (args: string[], cwd: string) => (
  spawnSync(process.execPath, ['scripts/release/validate-provider-owner-signoff.mjs', ...args], {
    cwd,
    encoding: 'utf8',
  })
);

const loadTemplate = (): ProviderOwnerSignoffArtifact => {
  const templatePath = path.resolve(
    process.cwd(),
    'scripts/release/v1-provider-owner-signoff.template.json',
  );

  return JSON.parse(fs.readFileSync(templatePath, 'utf8')) as ProviderOwnerSignoffArtifact;
};

const finalizeArtifact = (): ProviderOwnerSignoffArtifact => {
  const artifact = structuredClone(loadTemplate());
  artifact.provider.name = 'QAF-035 beta provider';
  artifact.provider.accountScope = 'QA/beta Xtream provider account';
  artifact.provider.xuiHostRef = 'provider-host.example.invalid';
  artifact.provider.ownerName = 'provider-owner';
  artifact.provider.ownerRole = 'xui-operator';
  artifact.provider.contact = 'provider-owner@example.invalid';
  artifact.provider.approvedAt = '2026-06-03T01:00:00.000Z';
  artifact.provider.evidenceRefs = ['evidence://provider/owner'];

  artifact.mediaProcessingCommitment.status = 'pass';
  artifact.mediaProcessingCommitment.owner = 'provider-owner';
  artifact.mediaProcessingCommitment.evidenceRefs = ['evidence://provider/no-media-processing'];

  artifact.capacityCommitment.status = 'pass';
  artifact.capacityCommitment.owner = 'provider-owner';
  artifact.capacityCommitment.approvedConcurrentLiveUsers = 500;
  artifact.capacityCommitment.accountLimitEvidence = 'evidence://provider/account-limit';
  artifact.capacityCommitment.upstreamCapacityEvidence = 'evidence://provider/upstream-capacity';
  artifact.capacityCommitment.rateLimitPolicy = 'Stop enrollment on provider 429/5xx escalation.';
  artifact.capacityCommitment.rollbackContact = 'provider-owner@example.invalid';
  artifact.capacityCommitment.evidenceRefs = ['evidence://provider/capacity'];

  for (const check of artifact.checks) {
    check.status = 'pass';
    check.owner = 'provider-owner';
    check.evidence = `evidence://provider/checks/${check.id}`;
  }

  artifact.signoff.status = 'pass';
  artifact.signoff.approvedBy = 'release-director';
  artifact.signoff.approvedAt = '2026-06-03T01:05:00.000Z';
  return artifact;
};

describe('V1 provider owner signoff artifact', () => {
  it('defines provider capacity and no-media-processing owner checks', () => {
    const template = loadTemplate();
    const checkIds = new Set(template.checks.map((check) => check.id));

    expect(template.target.minConcurrentLiveUsers).toBeGreaterThanOrEqual(300);
    expect(template.target.maxConcurrentLiveUsers).toBeGreaterThanOrEqual(500);
    expect(template.mediaProcessingCommitment.allowedTransportModes).toEqual([
      'provider-direct',
      'proxy-normalized',
    ]);
    expect(template.mediaProcessingCommitment.usesServerSideTranscode).toBe(false);
    expect(template.mediaProcessingCommitment.usesServerSideRemux).toBe(false);
    expect(template.mediaProcessingCommitment.usesGeneratedHls).toBe(false);
    expect(template.mediaProcessingCommitment.usesXuiSideTranscode).toBe(false);
    expect(template.mediaProcessingCommitment.usesXuiSideRemux).toBe(false);

    for (const checkId of [
      'provider-owner-identity',
      'provider-account-capacity',
      'xui-no-transcode-remux',
      'catchup-no-generated-hls',
      'rate-limit-rollback-contact',
    ]) {
      expect(checkIds.has(checkId), `missing check ${checkId}`).toBe(true);
    }
  });

  it('passes validator in template mode and strict mode for finalized owner signoff', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-provider-owner-'));
    const finalPath = path.join(tmpDir, 'final.json');

    const templateResult = runValidator([
      'scripts/release/v1-provider-owner-signoff.template.json',
    ], repoRoot);
    expect(templateResult.status).toBe(0);

    fs.writeFileSync(finalPath, `${JSON.stringify(finalizeArtifact(), null, 2)}\n`);

    const finalResult = runValidator([finalPath, '--require-final'], repoRoot);
    expect(finalResult.status).toBe(0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('tracks the QAF-035 partial provider owner artifact without allowing final signoff', () => {
    const repoRoot = process.cwd();
    const artifactPath = 'artifacts/release/provider/qaf035-provider-owner-signoff-20260603.json';

    const partialResult = runValidator([artifactPath], repoRoot);
    expect(partialResult.status).toBe(0);

    const finalResult = runValidator([artifactPath, '--require-final'], repoRoot);
    expect(finalResult.status).toBe(2);
    expect(finalResult.stderr).toContain('provider.ownerName must be set with --require-final');
  });

  it('fails validation when XUI-side transcode is enabled', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-provider-owner-'));
    const invalidPath = path.join(tmpDir, 'xui-transcode-enabled.json');
    const artifact = finalizeArtifact();
    artifact.mediaProcessingCommitment.usesXuiSideTranscode = true;
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('mediaProcessingCommitment.usesXuiSideTranscode must be false');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails strict validation when approved capacity is below target', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-provider-owner-'));
    const invalidPath = path.join(tmpDir, 'capacity-too-low.json');
    const artifact = finalizeArtifact();
    artifact.capacityCommitment.approvedConcurrentLiveUsers = 499;
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('capacityCommitment.approvedConcurrentLiveUsers must cover target.maxConcurrentLiveUsers');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails validation when forbidden media-processing paths are incomplete', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-provider-owner-'));
    const invalidPath = path.join(tmpDir, 'missing-forbidden-paths.json');
    const artifact = finalizeArtifact();
    artifact.mediaProcessingCommitment.forbiddenResolutionPaths = [
      'Do not use local ffmpeg.',
    ];
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('mediaProcessingCommitment.forbiddenResolutionPaths must include');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
