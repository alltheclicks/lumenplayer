import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

interface ReleaseGate {
  id: string;
  status: 'pending' | 'pass' | 'fail';
  evidenceRef: string;
  checkedAt: string;
}

interface ReleaseReadinessReview {
  gates: ReleaseGate[];
  blockerTriage: {
    totalOpen: number;
    triagedAt: string;
    owner: string;
    items: Array<{
      id: string;
      summary: string;
      status: 'open' | 'mitigated' | 'closed';
      disposition: string;
      owner: string;
      issueRef: string;
    }>;
  };
  rollback: {
    owner: string;
    notificationChannel: string;
    steps: string[];
  };
  signoff: {
    status: 'pending' | 'pass' | 'fail';
    approvedBy: string;
    approvedAt: string;
  };
}

const runValidator = (args: string[], cwd: string) => (
  spawnSync(process.execPath, ['scripts/release/validate-release-readiness.mjs', ...args], {
    cwd,
    encoding: 'utf8',
  })
);

const loadTemplate = (): ReleaseReadinessReview => {
  const templatePath = path.resolve(
    process.cwd(),
    'scripts/release/v1-release-readiness-review.template.json',
  );

  return JSON.parse(fs.readFileSync(templatePath, 'utf8')) as ReleaseReadinessReview;
};

const finalizeReview = (review: ReleaseReadinessReview): ReleaseReadinessReview => {
  const finalized = structuredClone(review);
  for (const gate of finalized.gates) {
    gate.status = 'pass';
    gate.checkedAt = '2026-02-16T18:00:00.000Z';
  }

  finalized.blockerTriage.totalOpen = 0;
  finalized.blockerTriage.triagedAt = '2026-02-16T18:10:00.000Z';
  finalized.blockerTriage.owner = 'release-manager';
  finalized.blockerTriage.items = [
    {
      id: 'BLK-101',
      summary: 'Cast reconnect jitter observed during dry run',
      status: 'closed',
      disposition: 'fixed',
      owner: 'cast-oncall',
      issueRef: 'https://example.invalid/issues/BLK-101',
    },
  ];

  finalized.rollback.owner = 'release-manager';
  finalized.rollback.notificationChannel = '#release-war-room';

  finalized.signoff.status = 'pass';
  finalized.signoff.approvedBy = 'release-director';
  finalized.signoff.approvedAt = '2026-02-16T18:15:00.000Z';

  return finalized;
};

describe('V1 final release readiness review template', () => {
  it('contains all required release gates', () => {
    const template = loadTemplate();
    const gateIds = new Set(template.gates.map((gate) => gate.id));

    const required = [
      'go-no-go-checklist',
      'smoke-regression-matrix',
      'compatibility-matrix',
      'manual-device-qa-evidence',
      'design-parity-evidence',
      'performance-evidence',
      'provider-owner-signoff',
      'beta-capacity-evidence',
      'runtime-media-policy',
      'observability-baseline',
      'beta-ops-signoff',
      'security-privacy-baseline',
    ];

    for (const gateId of required) {
      expect(gateIds.has(gateId), `missing release gate ${gateId}`).toBe(true);
    }
  });

  it('points compatibility and beta capacity gates at concrete run artifacts', () => {
    const template = loadTemplate();
    const gatesById = new Map(template.gates.map((gate) => [gate.id, gate]));

    expect(gatesById.get('compatibility-matrix')?.evidenceRef).toBe(
      'artifacts/release/compatibility/<run-id>.json',
    );
    expect(gatesById.get('beta-capacity-evidence')?.evidenceRef).toBe(
      'artifacts/release/capacity/<run-id>.json',
    );
    expect(gatesById.get('runtime-media-policy')?.evidenceRef).toBe(
      'artifacts/release/media-policy/<run-id>.json',
    );
    expect(gatesById.get('manual-device-qa-evidence')?.evidenceRef).toBe(
      'artifacts/release/manual-device-qa/<run-id>.json',
    );
    expect(gatesById.get('provider-owner-signoff')?.evidenceRef).toBe(
      'artifacts/release/provider/<run-id>.json',
    );
    expect(gatesById.get('beta-ops-signoff')?.evidenceRef).toBe(
      'artifacts/release/ops/<run-id>.json',
    );
  });

  it('passes validator in template mode and strict mode for finalized artifact', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-0346-readiness-'));
    const finalPath = path.join(tmpDir, 'final.json');

    const templateResult = runValidator([
      'scripts/release/v1-release-readiness-review.template.json',
    ], repoRoot);
    expect(templateResult.status).toBe(0);

    const finalArtifact = finalizeReview(loadTemplate());
    fs.writeFileSync(finalPath, `${JSON.stringify(finalArtifact, null, 2)}\n`);

    const finalResult = runValidator([finalPath, '--require-final'], repoRoot);
    expect(finalResult.status).toBe(0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('tracks the QAF-035 partial release readiness artifact without allowing final signoff', () => {
    const repoRoot = process.cwd();
    const artifactPath = 'artifacts/release/readiness/qaf035-release-readiness-20260602.json';

    const partialResult = runValidator([artifactPath], repoRoot);
    expect(partialResult.status).toBe(0);

    const finalResult = runValidator([artifactPath, '--require-final'], repoRoot);
    expect(finalResult.status).toBe(2);
    expect(finalResult.stderr).toContain('gate go-no-go-checklist is pending with --require-final');
  });

  it('fails strict validation when a required gate is missing', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-0346-readiness-'));
    const invalidPath = path.join(tmpDir, 'missing-gate.json');

    const invalidArtifact = finalizeReview(loadTemplate());
    invalidArtifact.gates = invalidArtifact.gates.filter((gate) => gate.id !== 'performance-evidence');
    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidArtifact, null, 2)}\n`);

    const result = runValidator([invalidPath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('required gate is missing');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails strict validation when smoke/regression matrix evidence is missing', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-0346-readiness-'));
    const invalidPath = path.join(tmpDir, 'missing-smoke-regression-matrix.json');

    const invalidArtifact = finalizeReview(loadTemplate());
    invalidArtifact.gates = invalidArtifact.gates.filter((gate) => gate.id !== 'smoke-regression-matrix');
    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidArtifact, null, 2)}\n`);

    const result = runValidator([invalidPath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('required gate is missing: smoke-regression-matrix');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails strict validation when signoff is pass but blockers remain open', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-0346-readiness-'));
    const invalidPath = path.join(tmpDir, 'open-blockers.json');

    const invalidArtifact = finalizeReview(loadTemplate());
    invalidArtifact.blockerTriage.totalOpen = 1;
    invalidArtifact.blockerTriage.items = [
      {
        id: 'BLK-202',
        summary: 'AirPlay route disconnect under seek',
        status: 'open',
        disposition: 'investigating',
        owner: 'airplay-oncall',
        issueRef: 'https://example.invalid/issues/BLK-202',
      },
    ];

    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidArtifact, null, 2)}\n`);

    const result = runValidator([invalidPath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('signoff.status cannot be pass while blockerTriage.totalOpen is greater than zero');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails strict validation when rollback steps are empty', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-0346-readiness-'));
    const invalidPath = path.join(tmpDir, 'rollback-steps-empty.json');

    const invalidArtifact = finalizeReview(loadTemplate());
    invalidArtifact.rollback.steps = [];
    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidArtifact, null, 2)}\n`);

    const result = runValidator([invalidPath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('rollback.steps must be a non-empty array');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
