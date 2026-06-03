import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

type ReleaseStatus = 'pending' | 'pass' | 'fail';

interface ObservabilityBaselineArtifact {
  sourceCoverage: {
    status: ReleaseStatus;
    events: Array<{
      id: string;
      eventName: string;
      status: ReleaseStatus;
      sourceRef: string;
      evidence: string;
    }>;
  };
  alertRules: Array<{
    id: string;
    status: ReleaseStatus;
    evidence: string;
  }>;
  betaRouting: {
    status: ReleaseStatus;
    owner: string;
    alertChannel: string;
    dashboardRef: string;
    responseSlo: string;
    evidence: string;
  };
  stopTriggers: Array<{
    id: string;
    status: ReleaseStatus;
    owner: string;
    evidence: string;
  }>;
  signoff: {
    status: ReleaseStatus;
    approvedBy: string;
    approvedAt: string;
  };
}

const artifactPath = 'artifacts/release/observability/qaf035-observability-baseline-20260603.json';

const runValidator = (args: string[], cwd: string) => (
  spawnSync(process.execPath, ['scripts/release/validate-observability-baseline.mjs', ...args], {
    cwd,
    encoding: 'utf8',
  })
);

const loadArtifact = (): ObservabilityBaselineArtifact => (
  JSON.parse(fs.readFileSync(path.resolve(process.cwd(), artifactPath), 'utf8')) as ObservabilityBaselineArtifact
);

const finalizeArtifact = (): ObservabilityBaselineArtifact => {
  const artifact = structuredClone(loadArtifact());
  artifact.sourceCoverage.status = 'pass';
  for (const event of artifact.sourceCoverage.events) {
    event.status = 'pass';
    event.evidence = `${event.sourceRef}; pnpm release:observability:test`;
  }
  for (const rule of artifact.alertRules) {
    rule.status = 'pass';
    rule.evidence = 'apps/web/src/services/observability.ts; apps/web/src/services/observability.test.ts; pnpm release:observability:test';
  }
  artifact.betaRouting.status = 'pass';
  artifact.betaRouting.owner = 'release-ops-owner';
  artifact.betaRouting.alertChannel = '#beta-ops';
  artifact.betaRouting.dashboardRef = 'https://example.invalid/lumen/beta-dashboard';
  artifact.betaRouting.responseSlo = 'Owner acknowledges release-blocker alerts within 15 minutes during beta ramp.';
  artifact.betaRouting.evidence = 'artifacts/release/ops/qaf035-beta-ops-signoff-20260603.json';
  for (const trigger of artifact.stopTriggers) {
    trigger.status = 'pass';
    trigger.owner = 'release-ops-owner';
    trigger.evidence = `artifacts/release/ops/qaf035-beta-ops-signoff-20260603.json; evidence://ops/triggers/${trigger.id}`;
    if (trigger.id === 'no-media-processing-violation') {
      trigger.evidence = 'pnpm release:no-media-evidence:scan -- output/playwright/manual-network-audit/report.json; artifacts/release/media-policy/qaf035-no-media-evidence-scan-20260602.json; artifacts/release/media-policy/qaf035-runtime-media-policy-20260602.json';
    }
  }
  artifact.signoff.status = 'pass';
  artifact.signoff.approvedBy = 'release-director';
  artifact.signoff.approvedAt = '2026-06-03T09:30:00.000Z';
  return artifact;
};

describe('V1 observability baseline artifact', () => {
  it('validates current QAF-035 observability baseline without final signoff', () => {
    const result = runValidator([artifactPath], process.cwd());

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('events: 5');
    expect(result.stdout).toContain('alert rules: 2');
    expect(result.stdout).toContain('stop triggers: 5');
  });

  it('passes strict validation for a finalized observability baseline', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-observability-'));
    const finalPath = path.join(tmpDir, 'final.json');
    fs.writeFileSync(finalPath, `${JSON.stringify(finalizeArtifact(), null, 2)}\n`);

    const result = runValidator([finalPath, '--require-final'], repoRoot);
    expect(result.status).toBe(0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails strict validation while beta routing is not owner-approved', () => {
    const result = runValidator([artifactPath, '--require-final'], process.cwd());

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('betaRouting.status is pending with --require-final');
  });

  it('fails when a passing event source does not contain the declared event name', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-observability-'));
    const invalidPath = path.join(tmpDir, 'invalid-event-source.json');
    const artifact = finalizeArtifact();
    const event = artifact.sourceCoverage.events.find((entry) => entry.id === 'playback-started');
    if (event) {
      event.sourceRef = 'apps/web/src/hooks/useGoogleCastSender.ts';
    }
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('sourceRef must contain eventName playback.started');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails when passing no-media stop evidence omits the tracked scan artifact', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-observability-'));
    const invalidPath = path.join(tmpDir, 'missing-no-media-scan.json');
    const artifact = finalizeArtifact();
    const trigger = artifact.stopTriggers.find((entry) => entry.id === 'no-media-processing-violation');
    if (trigger) {
      trigger.evidence = 'pnpm release:no-media-evidence:scan -- output/playwright/manual-network-audit/report.json; artifacts/release/media-policy/qaf035-runtime-media-policy-20260602.json';
    }
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('must reference a tracked no-media scan artifact');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
