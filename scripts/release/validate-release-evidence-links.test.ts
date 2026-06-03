import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

interface ReleaseGate {
  id: string;
  status: 'pending' | 'pass' | 'fail';
  evidenceRef: string;
}

interface ReleaseReadinessArtifact {
  gates: ReleaseGate[];
  blockerTriage: {
    totalOpen: number;
    items: Array<{
      status: 'open' | 'mitigated' | 'closed';
    }>;
  };
  signoff: {
    status: 'pending' | 'pass' | 'fail';
  };
}

const runValidator = (args: string[], cwd: string) => (
  spawnSync(process.execPath, ['scripts/release/validate-release-evidence-links.mjs', ...args], {
    cwd,
    encoding: 'utf8',
  })
);

const loadReadiness = (): ReleaseReadinessArtifact => {
  const readinessPath = path.resolve(
    process.cwd(),
    'artifacts/release/readiness/qaf035-release-readiness-20260602.json',
  );

  return JSON.parse(fs.readFileSync(readinessPath, 'utf8')) as ReleaseReadinessArtifact;
};

describe('release evidence link audit', () => {
  it('validates the QAF-035 readiness rollup links and expected open-blocker state', () => {
    const result = runValidator([
      'artifacts/release/readiness/qaf035-release-readiness-20260602.json',
      '--expect-open-blockers',
    ], process.cwd());

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('gates: 12');
  });

  it('fails when a readiness gate points at missing evidence', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-evidence-links-'));
    const invalidPath = path.join(tmpDir, 'missing-evidence.json');
    const artifact = loadReadiness();
    artifact.gates[0].evidenceRef = 'artifacts/release/missing/not-found.json';
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('evidenceRef does not exist');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails when a readiness gate still uses a placeholder run id', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-evidence-links-'));
    const invalidPath = path.join(tmpDir, 'placeholder-evidence.json');
    const artifact = loadReadiness();
    artifact.gates.find((gate) => gate.id === 'provider-owner-signoff')!.evidenceRef = 'artifacts/release/provider/<run-id>.json';
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('placeholder evidenceRef');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails when a linked artifact does not pass its own validator', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-evidence-links-'));
    const readinessPath = path.join(tmpDir, 'invalid-linked-artifact.json');
    const invalidProviderRef = `artifacts/release/provider/__invalid-provider-test-${path.basename(tmpDir)}.json`;
    const invalidProviderPath = path.resolve(repoRoot, invalidProviderRef);
    const artifact = loadReadiness();
    artifact.gates.find((gate) => gate.id === 'provider-owner-signoff')!.evidenceRef = invalidProviderRef;
    fs.writeFileSync(invalidProviderPath, '{}\n');
    fs.writeFileSync(readinessPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([readinessPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('evidence validation for provider-owner-signoff failed');

    fs.rmSync(invalidProviderPath, { force: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails when the linked observability baseline artifact does not validate', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-evidence-links-'));
    const readinessPath = path.join(tmpDir, 'invalid-linked-observability.json');
    const invalidObservabilityRef = `artifacts/release/observability/__invalid-observability-test-${path.basename(tmpDir)}.json`;
    const invalidObservabilityPath = path.resolve(repoRoot, invalidObservabilityRef);
    const artifact = loadReadiness();
    artifact.gates.find((gate) => gate.id === 'observability-baseline')!.evidenceRef = invalidObservabilityRef;
    fs.writeFileSync(invalidObservabilityPath, '{}\n');
    fs.writeFileSync(readinessPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([readinessPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('evidence validation for observability-baseline failed');

    fs.rmSync(invalidObservabilityPath, { force: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails when the linked performance artifact does not validate', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-evidence-links-'));
    const readinessPath = path.join(tmpDir, 'invalid-linked-performance.json');
    const invalidPerformanceRef = `artifacts/release/performance/__invalid-performance-test-${path.basename(tmpDir)}.json`;
    const invalidPerformancePath = path.resolve(repoRoot, invalidPerformanceRef);
    const artifact = loadReadiness();
    artifact.gates.find((gate) => gate.id === 'performance-evidence')!.evidenceRef = invalidPerformanceRef;
    fs.writeFileSync(invalidPerformancePath, '{}\n');
    fs.writeFileSync(readinessPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([readinessPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('evidence validation for performance-evidence failed');

    fs.rmSync(invalidPerformancePath, { force: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails when the linked security/privacy artifact does not validate', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-evidence-links-'));
    const readinessPath = path.join(tmpDir, 'invalid-linked-security.json');
    const invalidSecurityRef = `artifacts/release/security/__invalid-security-test-${path.basename(tmpDir)}.json`;
    const invalidSecurityPath = path.resolve(repoRoot, invalidSecurityRef);
    const artifact = loadReadiness();
    artifact.gates.find((gate) => gate.id === 'security-privacy-baseline')!.evidenceRef = invalidSecurityRef;
    fs.writeFileSync(invalidSecurityPath, '{}\n');
    fs.writeFileSync(readinessPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([readinessPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('evidence validation for security-privacy-baseline failed');

    fs.rmSync(invalidSecurityPath, { force: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails expected-open-blocker mode when the rollup has no open blockers', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-evidence-links-'));
    const invalidPath = path.join(tmpDir, 'no-open-blockers.json');
    const artifact = loadReadiness();
    artifact.gates = artifact.gates.map((gate) => ({
      ...gate,
      status: 'pass',
    }));
    artifact.blockerTriage.totalOpen = 0;
    artifact.blockerTriage.items = artifact.blockerTriage.items.map((item) => ({
      ...item,
      status: 'closed',
    }));
    fs.writeFileSync(invalidPath, `${JSON.stringify(artifact, null, 2)}\n`);

    const result = runValidator([invalidPath, '--expect-open-blockers'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('blockerTriage.totalOpen must be greater than zero');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
