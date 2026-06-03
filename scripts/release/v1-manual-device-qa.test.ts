import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

type ManualDeviceQaStatus = 'pending' | 'pass' | 'fail';

interface ManualDeviceQaArtifact {
  policy: {
    requiresRealDeviceEvidence: boolean;
    localChromiumIsNotRealDeviceSignoff: boolean;
    noMediaProcessingRequired: boolean;
    allowedTransportModes: string[];
    disallowedTransportModes: string[];
  };
  targets: Array<{
    id: string;
    status: ManualDeviceQaStatus;
    owner: string;
    actualDevice: string;
    osVersion: string;
    browserVersion: string;
    evidenceRefs: string[];
    mediaProcessingAudit: {
      status: ManualDeviceQaStatus;
      evidenceRef: string;
      forbiddenHits: string[];
    };
    checks: Array<{
      id: string;
      releaseBlocker: boolean;
      status: ManualDeviceQaStatus;
      evidence: string;
    }>;
  }>;
  signoff: {
    status: ManualDeviceQaStatus;
    approvedBy: string;
    approvedAt: string;
  };
}

const runValidator = (args: string[], cwd: string) => (
  spawnSync(process.execPath, ['scripts/release/validate-manual-device-qa.mjs', ...args], {
    cwd,
    encoding: 'utf8',
  })
);

const loadTemplate = (): ManualDeviceQaArtifact => {
  const templatePath = path.resolve(
    process.cwd(),
    'scripts/release/v1-manual-device-qa.template.json',
  );

  return JSON.parse(fs.readFileSync(templatePath, 'utf8')) as ManualDeviceQaArtifact;
};

const finalizeArtifact = (): ManualDeviceQaArtifact => {
  const artifact = structuredClone(loadTemplate());
  for (const target of artifact.targets) {
    target.status = 'pass';
    target.owner = 'release-qa-owner';
    target.actualDevice = `${target.id} real device`;
    target.osVersion = 'release-lab-os';
    target.browserVersion = 'release-lab-browser';
    target.evidenceRefs = [`evidence://${target.id}/report.md`];
    target.mediaProcessingAudit.status = 'pass';
    target.mediaProcessingAudit.evidenceRef = `pnpm release:no-media-evidence:scan -- evidence/${target.id}/network.har; artifacts/release/media-policy/qaf035-no-media-evidence-scan-20260602.json`;
    target.mediaProcessingAudit.forbiddenHits = [];
    for (const check of target.checks) {
      check.status = 'pass';
      check.evidence = `evidence://${target.id}/${check.id}`;
    }
  }
  artifact.signoff.status = 'pass';
  artifact.signoff.approvedBy = 'release-director';
  artifact.signoff.approvedAt = '2026-06-03T00:15:00.000Z';
  return artifact;
};

describe('V1 manual device QA artifact', () => {
  it('defines required real-device targets and no-media-processing policy', () => {
    const template = loadTemplate();
    const targetIds = new Set(template.targets.map((target) => target.id));

    expect(template.policy.requiresRealDeviceEvidence).toBe(true);
    expect(template.policy.localChromiumIsNotRealDeviceSignoff).toBe(true);
    expect(template.policy.noMediaProcessingRequired).toBe(true);
    expect(template.policy.allowedTransportModes).toEqual(['provider-direct', 'proxy-normalized']);
    expect(template.policy.disallowedTransportModes).toEqual(expect.arrayContaining([
      'proxy-remuxed',
      'remux-hls',
    ]));
    for (const targetId of [
      'desktop-chrome-windows',
      'desktop-safari-macos',
      'mobile-chrome-android',
      'mobile-safari-ios',
      'cast-chromecast',
      'airplay-appletv',
      'pwa-install-offline',
    ]) {
      expect(targetIds.has(targetId), `missing target ${targetId}`).toBe(true);
    }
  });

  it('passes validator in template mode and strict mode for finalized manual evidence', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-manual-device-qa-'));
    const finalPath = path.join(tmpDir, 'final.json');

    const templateResult = runValidator([
      'scripts/release/v1-manual-device-qa.template.json',
    ], repoRoot);
    expect(templateResult.status).toBe(0);

    fs.writeFileSync(finalPath, `${JSON.stringify(finalizeArtifact(), null, 2)}\n`);

    const finalResult = runValidator([finalPath, '--require-final'], repoRoot);
    expect(finalResult.status).toBe(0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('tracks the QAF-035 partial manual device QA artifact without allowing final signoff', () => {
    const repoRoot = process.cwd();
    const artifactPath = 'artifacts/release/manual-device-qa/qaf035-manual-device-qa-20260603.json';

    const partialResult = runValidator([artifactPath], repoRoot);
    expect(partialResult.status).toBe(0);

    const finalResult = runValidator([artifactPath, '--require-final'], repoRoot);
    expect(finalResult.status).toBe(2);
    expect(finalResult.stderr).toContain('target desktop-chrome-windows owner must be set with --require-final');
  });

  it('fails strict validation if real-device signoff uses Playwright/headless evidence', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-manual-device-qa-'));
    const invalidPath = path.join(tmpDir, 'headless.json');
    const artifact = finalizeArtifact();
    artifact.targets[0].actualDevice = 'Local Playwright desktop';
    artifact.targets[0].browserVersion = 'Chromium headless';
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('cannot use Playwright/headless evidence');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails strict validation when forbidden media-processing hits are recorded', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-manual-device-qa-'));
    const invalidPath = path.join(tmpDir, 'forbidden-hit.json');
    const artifact = finalizeArtifact();
    artifact.targets[0].mediaProcessingAudit.forbiddenHits = ['remux-hls'];
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('forbiddenHits must be empty');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails strict validation when media audit evidence omits the scanner command', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-manual-device-qa-'));
    const invalidPath = path.join(tmpDir, 'weak-media-audit.json');
    const artifact = finalizeArtifact();
    artifact.targets[0].mediaProcessingAudit.evidenceRef = 'evidence/desktop-chrome-windows/network.har';
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('mediaProcessingAudit.evidenceRef must reference release:no-media-evidence:scan');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails strict validation when passing media audit evidence omits the tracked scan artifact', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-manual-device-qa-'));
    const invalidPath = path.join(tmpDir, 'missing-scan-artifact.json');
    const artifact = finalizeArtifact();
    artifact.targets[0].mediaProcessingAudit.evidenceRef = 'pnpm release:no-media-evidence:scan -- evidence/desktop-chrome-windows/network.har';
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('mediaProcessingAudit.evidenceRef must reference a tracked no-media scan artifact');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails strict validation when media audit status is fail', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-manual-device-qa-'));
    const invalidPath = path.join(tmpDir, 'failed-media-audit.json');
    const artifact = finalizeArtifact();
    artifact.targets[0].mediaProcessingAudit.status = 'fail';
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('mediaProcessingAudit must pass with --require-final');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
