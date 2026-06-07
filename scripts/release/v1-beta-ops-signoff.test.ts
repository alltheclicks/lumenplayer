import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

type OpsStatus = 'pending' | 'pass' | 'fail';

interface BetaOpsSignoffArtifact {
  target: {
    minConcurrentLiveUsers: number;
    maxConcurrentLiveUsers: number;
  };
  observability: {
    status: OpsStatus;
    owner: string;
    alertChannel: string;
    dashboardRef: string;
    evidenceRefs: string[];
    signals: Array<{
      id: string;
      status: OpsStatus;
      evidence: string;
    }>;
  };
  rollbackThrottle: {
    status: OpsStatus;
    owner: string;
    notificationChannel: string;
    decisionAuthority: string;
    triggers: string[];
  };
  checks: Array<{
    id: string;
    status: OpsStatus;
    owner: string;
    evidence: string;
  }>;
  signoff: {
    status: OpsStatus;
    approvedBy: string;
    approvedAt: string;
  };
}

const runValidator = (args: string[], cwd: string) => (
  spawnSync(process.execPath, ['scripts/release/validate-beta-ops-signoff.mjs', ...args], {
    cwd,
    encoding: 'utf8',
  })
);

const loadTemplate = (): BetaOpsSignoffArtifact => {
  const templatePath = path.resolve(
    process.cwd(),
    'scripts/release/v1-beta-ops-signoff.template.json',
  );

  return JSON.parse(fs.readFileSync(templatePath, 'utf8')) as BetaOpsSignoffArtifact;
};

const finalizeArtifact = (): BetaOpsSignoffArtifact => {
  const artifact = structuredClone(loadTemplate());
  artifact.observability.status = 'pass';
  artifact.observability.owner = 'release-ops-owner';
  artifact.observability.alertChannel = '#beta-ops';
  artifact.observability.dashboardRef = 'https://example.invalid/lumen/beta-dashboard';
  artifact.observability.evidenceRefs = ['evidence://ops/dashboard'];
  for (const signal of artifact.observability.signals) {
    signal.status = 'pass';
    signal.evidence = `evidence://ops/signals/${signal.id}`;
    if (signal.id === 'no-media-processing-violation') {
      signal.evidence = 'pnpm release:no-media-evidence:scan -- output/playwright/manual-network-audit/report.json; artifacts/release/media-policy/qaf035-no-media-evidence-scan-20260602.json; artifacts/release/media-policy/qaf035-runtime-media-policy-20260602.json';
    }
  }

  artifact.rollbackThrottle.status = 'pass';
  artifact.rollbackThrottle.owner = 'release-ops-owner';
  artifact.rollbackThrottle.notificationChannel = '#beta-ops';
  artifact.rollbackThrottle.decisionAuthority = 'release-director';

  for (const check of artifact.checks) {
    check.status = 'pass';
    check.owner = 'release-ops-owner';
    check.evidence = `evidence://ops/checks/${check.id}`;
    if (check.id === 'no-media-processing-stop-trigger') {
      check.evidence = 'pnpm release:no-media-evidence:scan -- output/playwright/manual-network-audit/report.json; artifacts/release/media-policy/qaf035-no-media-evidence-scan-20260602.json; artifacts/release/media-policy/qaf035-runtime-media-policy-20260602.json';
    }
  }

  artifact.signoff.status = 'pass';
  artifact.signoff.approvedBy = 'release-director';
  artifact.signoff.approvedAt = '2026-06-03T00:30:00.000Z';
  return artifact;
};

describe('V1 beta ops signoff artifact', () => {
  it('defines 300-500 beta ops coverage and required observability signals', () => {
    const template = loadTemplate();
    const signalIds = new Set(template.observability.signals.map((signal) => signal.id));
    const checkIds = new Set(template.checks.map((check) => check.id));

    expect(template.target.minConcurrentLiveUsers).toBeGreaterThanOrEqual(300);
    expect(template.target.maxConcurrentLiveUsers).toBeGreaterThanOrEqual(500);
    for (const signalId of [
      'startup-health',
      'playback-failure',
      'provider-errors',
      'cast-airplay-failures',
      'no-media-processing-violation',
    ]) {
      expect(signalIds.has(signalId), `missing signal ${signalId}`).toBe(true);
    }
    for (const checkId of [
      'observability-slo-owner',
      'alert-route-ready',
      'rollback-owner-ready',
      'enrollment-throttle-ready',
      'no-media-processing-stop-trigger',
    ]) {
      expect(checkIds.has(checkId), `missing check ${checkId}`).toBe(true);
    }
  });

  it('passes validator in template mode and strict mode for finalized ops signoff', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-ops-'));
    const finalPath = path.join(tmpDir, 'final.json');

    const templateResult = runValidator([
      'scripts/release/v1-beta-ops-signoff.template.json',
    ], repoRoot);
    expect(templateResult.status).toBe(0);

    fs.writeFileSync(finalPath, `${JSON.stringify(finalizeArtifact(), null, 2)}\n`);

    const finalResult = runValidator([finalPath, '--require-final'], repoRoot);
    expect(finalResult.status).toBe(0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('tracks the finalized QAF-035 beta ops artifact', () => {
    const repoRoot = process.cwd();
    const artifactPath = 'artifacts/release/ops/qaf035-beta-ops-signoff-20260603.json';

    const partialResult = runValidator([artifactPath], repoRoot);
    expect(partialResult.status).toBe(0);

    const finalResult = runValidator([artifactPath, '--require-final'], repoRoot);
    expect(finalResult.status).toBe(0);
  });

  it('fails validation when media-processing stop triggers are incomplete', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-ops-'));
    const invalidPath = path.join(tmpDir, 'missing-media-trigger.json');
    const artifact = finalizeArtifact();
    artifact.rollbackThrottle.triggers = ['Provider overload only.'];
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('rollbackThrottle.triggers must include stop coverage');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails strict validation if alert route evidence is missing', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-ops-'));
    const invalidPath = path.join(tmpDir, 'missing-alert-route.json');
    const artifact = finalizeArtifact();
    artifact.observability.alertChannel = '';
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('observability.alertChannel must be set with --require-final');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails validation when passing no-media observability evidence omits the scan artifact', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-ops-'));
    const invalidPath = path.join(tmpDir, 'missing-no-media-scan-artifact.json');
    const artifact = finalizeArtifact();
    const signal = artifact.observability.signals.find((entry) => entry.id === 'no-media-processing-violation');
    if (signal) {
      signal.evidence = 'pnpm release:no-media-evidence:scan -- output/playwright/manual-network-audit/report.json; artifacts/release/media-policy/qaf035-runtime-media-policy-20260602.json';
    }
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('observability signal no-media-processing-violation evidence must reference a tracked no-media scan artifact');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails validation when passing no-media stop-trigger evidence omits runtime media policy', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-ops-'));
    const invalidPath = path.join(tmpDir, 'missing-runtime-media-policy.json');
    const artifact = finalizeArtifact();
    const check = artifact.checks.find((entry) => entry.id === 'no-media-processing-stop-trigger');
    if (check) {
      check.evidence = 'pnpm release:no-media-evidence:scan -- output/playwright/manual-network-audit/report.json; artifacts/release/media-policy/qaf035-no-media-evidence-scan-20260602.json';
    }
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('check no-media-processing-stop-trigger evidence must reference a runtime media policy artifact');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
