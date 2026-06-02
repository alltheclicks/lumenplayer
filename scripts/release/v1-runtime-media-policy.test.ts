import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

type RuntimeMediaPolicyStatus = 'pending' | 'pass' | 'fail';

interface RuntimeMediaPolicyArtifact {
  policy: {
    allowedTransportModes: string[];
    disallowedTransportModes: string[];
    usesLocalFfmpeg: boolean;
    usesServerSideTranscode: boolean;
    usesServerSideRemux: boolean;
    usesGeneratedHls: boolean;
    usesXuiSideTranscode: boolean;
    usesXuiSideRemux: boolean;
    forbiddenRuntimeFlags: Array<{
      name: string;
      disallowedValues: string[];
    }>;
    forbiddenProcesses: string[];
  };
  checks: Array<{
    id: string;
    status: RuntimeMediaPolicyStatus;
    owner: string;
    evidence: string;
  }>;
  signoff: {
    status: RuntimeMediaPolicyStatus;
    approvedBy: string;
    approvedAt: string;
  };
}

const runValidator = (args: string[], cwd: string) => (
  spawnSync(process.execPath, ['scripts/release/validate-runtime-media-policy.mjs', ...args], {
    cwd,
    encoding: 'utf8',
  })
);

const loadTemplate = (): RuntimeMediaPolicyArtifact => {
  const templatePath = path.resolve(
    process.cwd(),
    'scripts/release/v1-runtime-media-policy.template.json',
  );

  return JSON.parse(fs.readFileSync(templatePath, 'utf8')) as RuntimeMediaPolicyArtifact;
};

const finalizeArtifact = (): RuntimeMediaPolicyArtifact => {
  const artifact = loadTemplate();
  for (const check of artifact.checks) {
    check.status = 'pass';
    check.owner = 'release-owner';
    check.evidence = `evidence://${check.id}`;
    if (check.id === 'no-media-evidence-scan') {
      check.evidence = 'pnpm release:no-media-evidence:scan -- evidence/manual-network-audit/report.json';
    }
  }
  artifact.signoff.status = 'pass';
  artifact.signoff.approvedBy = 'release-director';
  artifact.signoff.approvedAt = '2026-06-02T21:00:00.000Z';
  return artifact;
};

describe('V1 runtime media policy artifact', () => {
  it('defines no-transcode/no-remux beta transport and runtime guardrails', () => {
    const template = loadTemplate();

    expect(template.policy.allowedTransportModes).toEqual(['provider-direct', 'proxy-normalized']);
    expect(template.policy.disallowedTransportModes).toContain('proxy-remuxed');
    expect(template.policy.disallowedTransportModes).toContain('remux-hls');
    expect(template.policy.usesLocalFfmpeg).toBe(false);
    expect(template.policy.usesServerSideTranscode).toBe(false);
    expect(template.policy.usesServerSideRemux).toBe(false);
    expect(template.policy.usesGeneratedHls).toBe(false);
    expect(template.policy.usesXuiSideTranscode).toBe(false);
    expect(template.policy.usesXuiSideRemux).toBe(false);
    expect(template.policy.forbiddenRuntimeFlags).toContainEqual(expect.objectContaining({
      name: 'LUMEN_PROXY_REMUX_ENABLED',
      disallowedValues: expect.arrayContaining(['1']),
    }));
    expect(template.policy.forbiddenProcesses).toEqual(expect.arrayContaining(['ffmpeg', 'ffprobe']));
    expect(template.checks.map((check) => check.id)).toContain('gateway-default-disallows-remux');
    expect(template.checks.map((check) => check.id)).toContain('no-media-evidence-scan');
  });

  it('passes validator in template mode and strict mode for finalized artifact', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-runtime-media-'));
    const finalPath = path.join(tmpDir, 'final.json');

    const templateResult = runValidator([
      'scripts/release/v1-runtime-media-policy.template.json',
    ], repoRoot);
    expect(templateResult.status).toBe(0);

    fs.writeFileSync(finalPath, `${JSON.stringify(finalizeArtifact(), null, 2)}\n`);

    const finalResult = runValidator([finalPath, '--require-final'], repoRoot);
    expect(finalResult.status).toBe(0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('tracks the QAF-035 partial runtime media policy artifact without allowing final signoff', () => {
    const repoRoot = process.cwd();
    const artifactPath = 'artifacts/release/media-policy/qaf035-runtime-media-policy-20260602.json';

    const partialResult = runValidator([artifactPath], repoRoot);
    expect(partialResult.status).toBe(0);

    const finalResult = runValidator([artifactPath, '--require-final'], repoRoot);
    expect(finalResult.status).toBe(2);
    expect(finalResult.stderr).toContain('check provider-xui-no-transcode-owner is pending with --require-final');
  });

  it('fails if proxy-remuxed is allowed', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-runtime-media-'));
    const invalidPath = path.join(tmpDir, 'remux-allowed.json');
    const artifact = finalizeArtifact();
    artifact.policy.allowedTransportModes.push('proxy-remuxed');
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('policy.allowedTransportModes must not include proxy-remuxed');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails if XUI-side remux is enabled', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-runtime-media-'));
    const invalidPath = path.join(tmpDir, 'xui-remux.json');
    const artifact = finalizeArtifact();
    artifact.policy.usesXuiSideRemux = true;
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('policy.usesXuiSideRemux must be false');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails if the remux feature flag is not explicitly forbidden', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-runtime-media-'));
    const invalidPath = path.join(tmpDir, 'remux-flag-missing.json');
    const artifact = finalizeArtifact();
    artifact.policy.forbiddenRuntimeFlags = [{
      name: 'OTHER_RUNTIME_FLAG',
      disallowedValues: ['1'],
    }];
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('policy.forbiddenRuntimeFlags must include LUMEN_PROXY_REMUX_ENABLED');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails if passing no-media evidence scan does not cite the scanner command', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-runtime-media-'));
    const invalidPath = path.join(tmpDir, 'no-media-scan-weak-evidence.json');
    const artifact = finalizeArtifact();
    const check = artifact.checks.find((entry) => entry.id === 'no-media-evidence-scan');
    if (check) {
      check.evidence = 'output/playwright/manual-network-audit/REPORT.md';
    }
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('check no-media-evidence-scan evidence must reference release:no-media-evidence:scan');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
