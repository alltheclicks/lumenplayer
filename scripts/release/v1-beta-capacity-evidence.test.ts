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
  deployedEdgeLoadEvidence: {
    status: CapacityStatus;
    owner: string;
    environment: string;
    deploymentRef: string;
    testedAt: string;
    targetConcurrentUsers: number;
    durationMinutes: number;
    appUrl: string;
    proxyUrl: string;
    loadReportRef: string;
    capacityPlanRef: string;
    noProviderMediaStreams: boolean;
    endpoints: Array<{
      id: string;
      url: string;
      requests: number;
      concurrency: number;
      ok: number;
      failed: number;
      p95Ms: number;
      p99Ms: number;
      maxMs: number;
    }>;
    scope: string;
    notes: string;
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
  artifact.mediaPath.evidence = 'output/playwright/manual-network-audit/REPORT.md; pnpm release:no-media-evidence:scan -- output/playwright/manual-network-audit/report.json; artifacts/release/media-policy/qaf035-no-media-evidence-scan-20260602.json; provider/XUI owner capacity statement';
  artifact.deployedEdgeLoadEvidence = {
    status: 'pass',
    owner: 'capacity-owner',
    environment: 'deployed-beta-edge',
    deploymentRef: 'deploy://lumen/qaf035-beta-edge',
    testedAt: '2026-06-02T15:20:00.000Z',
    targetConcurrentUsers: 500,
    durationMinutes: 15,
    appUrl: 'https://app.lumen.example',
    proxyUrl: 'https://proxy.lumen.example',
    loadReportRef: 'artifacts/release/capacity/qaf035-deployed-edge-load-redacted.json',
    capacityPlanRef: 'docs/release/qaf035-beta-capacity-plan.md',
    noProviderMediaStreams: true,
    endpoints: [
      {
        id: 'web-player',
        url: 'https://app.lumen.example/player',
        requests: 500,
        concurrency: 500,
        ok: 500,
        failed: 0,
        p95Ms: 180,
        p99Ms: 220,
        maxMs: 250,
      },
      {
        id: 'web-manifest',
        url: 'https://app.lumen.example/manifest.webmanifest',
        requests: 500,
        concurrency: 500,
        ok: 500,
        failed: 0,
        p95Ms: 90,
        p99Ms: 120,
        maxMs: 140,
      },
      {
        id: 'cast-receiver',
        url: 'https://app.lumen.example/receiver.html',
        requests: 500,
        concurrency: 500,
        ok: 500,
        failed: 0,
        p95Ms: 95,
        p99Ms: 130,
        maxMs: 160,
      },
      {
        id: 'proxy-health',
        url: 'https://proxy.lumen.example/health',
        requests: 500,
        concurrency: 500,
        ok: 500,
        failed: 0,
        p95Ms: 80,
        p99Ms: 110,
        maxMs: 150,
      },
    ],
    scope: 'Deployed Lumen web/proxy edge load proof for 300-500 beta users with no provider media streams.',
    notes: 'Final deployed capacity evidence covers the 500-user beta edge target and does not request provider media streams.',
  };
  for (const check of artifact.checks) {
    check.status = 'pass';
    check.owner = 'release-owner';
    check.evidence = `evidence://${check.id}`;
    if (check.id === 'lumen-edge-capacity') {
      check.evidence = `deployedEdgeLoadEvidence; ${artifact.deployedEdgeLoadEvidence.loadReportRef}`;
    }
    if (check.id === 'no-media-processing-verification') {
      check.evidence = 'pnpm release:no-media-evidence:scan -- output/playwright/manual-network-audit/report.json; artifacts/release/media-policy/qaf035-no-media-evidence-scan-20260602.json';
    }
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
    expect(finalResult.stderr).toContain('deployedEdgeLoadEvidence.status must be pass with --require-final');
  });

  it('records QAF-035 HTTPS staging edge smoke without treating it as final capacity proof', () => {
    const artifactPath = path.resolve(
      process.cwd(),
      'artifacts/release/capacity/qaf035-beta-capacity-20260602.json',
    );
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

    expect(artifact.httpsStagingEdgeSmoke.status).toBe('pass');
    expect(artifact.httpsStagingEdgeSmoke.appUrl).toMatch(/^https:\/\//);
    expect(artifact.httpsStagingEdgeSmoke.proxyUrl).toMatch(/^https:\/\//);
    expect(artifact.httpsStagingEdgeSmoke.command).toContain('pnpm perf:staging-capacity');
    expect(artifact.httpsStagingEdgeSmoke.reportRef).toBe('output/perf/staging-capacity-smoke/REPORT.md');
    expect(artifact.httpsStagingEdgeSmoke.endpoints.every((endpoint) => endpoint.failed === 0)).toBe(true);

    const edgeCapacityCheck = artifact.checks.find((check) => check.id === 'lumen-edge-capacity');
    expect(edgeCapacityCheck.status).toBe('pending');
    expect(edgeCapacityCheck.evidence).toContain('httpsStagingEdgeSmoke');

    expect(artifact.deployedEdgeLoadEvidence.status).toBe('pending');
    expect(artifact.deployedEdgeLoadEvidence.targetConcurrentUsers).toBe(500);
    expect(artifact.deployedEdgeLoadEvidence.noProviderMediaStreams).toBe(true);
    expect(edgeCapacityCheck.evidence).toContain('deployedEdgeLoadEvidence');
  });

  it('fails validation if HTTPS staging smoke omits the replay command guardrails', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-capacity-'));
    const invalidPath = path.join(tmpDir, 'weak-staging-smoke.json');
    const artifactPath = path.resolve(
      process.cwd(),
      'artifacts/release/capacity/qaf035-beta-capacity-20260602.json',
    );
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    artifact.httpsStagingEdgeSmoke.command = 'pnpm perf:staging-capacity';
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('httpsStagingEdgeSmoke.command must include: E2E_CAPACITY_APP_URL');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails final validation if deployed edge/load evidence remains pending', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-capacity-'));
    const invalidPath = path.join(tmpDir, 'pending-deployed-load.json');
    const artifact = finalizeArtifact();
    artifact.deployedEdgeLoadEvidence.status = 'pending';
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('deployedEdgeLoadEvidence.status must be pass with --require-final');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails final validation if deployed load evidence does not cover the 500-user beta target', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-capacity-'));
    const invalidPath = path.join(tmpDir, 'weak-deployed-load.json');
    const artifact = finalizeArtifact();
    artifact.deployedEdgeLoadEvidence.targetConcurrentUsers = 300;
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('deployedEdgeLoadEvidence.targetConcurrentUsers must be >= target.maxConcurrentLiveUsers');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails final validation if deployed endpoint evidence requests provider media/API URLs', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-capacity-'));
    const invalidPath = path.join(tmpDir, 'provider-media-load.json');
    const artifact = finalizeArtifact();
    artifact.deployedEdgeLoadEvidence.endpoints[0].url = 'https://app.lumen.example/live/user/pass/1.ts';
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('deployedEdgeLoadEvidence endpoint web-player must not request provider media/API URLs');

    fs.rmSync(tmpDir, { recursive: true, force: true });
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

  it('fails final validation if media path evidence omits the no-media scan command', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-capacity-'));
    const invalidPath = path.join(tmpDir, 'weak-media-path.json');
    const artifact = finalizeArtifact();
    artifact.mediaPath.evidence = 'output/playwright/manual-network-audit/REPORT.md';
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('mediaPath.evidence must reference release:no-media-evidence:scan');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails final validation if media path evidence omits the tracked no-media scan artifact', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-capacity-'));
    const invalidPath = path.join(tmpDir, 'missing-media-path-artifact.json');
    const artifact = finalizeArtifact();
    artifact.mediaPath.evidence = 'pnpm release:no-media-evidence:scan -- output/playwright/manual-network-audit/report.json';
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('mediaPath.evidence must reference a tracked no-media scan artifact');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails validation if passing no-media verification omits the tracked scan artifact', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-capacity-'));
    const invalidPath = path.join(tmpDir, 'missing-check-artifact.json');
    const artifact = finalizeArtifact();
    const check = artifact.checks.find((entry) => entry.id === 'no-media-processing-verification');
    if (check) {
      check.evidence = 'pnpm release:no-media-evidence:scan -- output/playwright/manual-network-audit/report.json';
    }
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('check no-media-processing-verification evidence must reference a tracked no-media scan artifact');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
