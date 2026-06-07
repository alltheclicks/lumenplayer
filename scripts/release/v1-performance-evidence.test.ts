import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

type MetricStatus = 'pending' | 'pass' | 'fail';

interface PerformanceEvidenceArtifact {
  metrics: {
    startup: {
      p95: number | null;
      p99: number | null;
      thresholdP95: number;
      thresholdP99: number;
      evidence: string;
      status: MetricStatus;
    };
    memory: {
      peakRssMb: number | null;
      p95RssMb: number | null;
      thresholdPeakMb: number;
      evidence: string;
      status: MetricStatus;
    };
    failureRate: {
      totalRuns: number;
      failedRuns: number;
      ratePercent: number | null;
      thresholdPercent: number;
      evidence: string;
      status: MetricStatus;
    };
  };
  signoff: {
    status: MetricStatus;
    approvedBy: string;
    approvedAt: string;
  };
}

const runValidator = (args: string[], cwd: string) => (
  spawnSync(process.execPath, ['scripts/release/validate-performance-evidence.mjs', ...args], {
    cwd,
    encoding: 'utf8',
  })
);

const loadTemplate = (): PerformanceEvidenceArtifact => {
  const templatePath = path.resolve(
    process.cwd(),
    'scripts/release/v1-performance-evidence.template.json',
  );

  return JSON.parse(fs.readFileSync(templatePath, 'utf8')) as PerformanceEvidenceArtifact;
};

describe('V1 performance evidence artifact', () => {
  it('defines required metrics for startup, memory, and failure rate', () => {
    const template = loadTemplate();

    expect(template.metrics.startup.thresholdP95).toBe(3000);
    expect(template.metrics.startup.thresholdP99).toBeGreaterThanOrEqual(template.metrics.startup.thresholdP95);

    expect(template.metrics.memory.thresholdPeakMb).toBe(200);
    expect(template.metrics.failureRate.thresholdPercent).toBeLessThanOrEqual(1);

    expect(template.metrics.startup.status).toBe('pending');
    expect(template.metrics.memory.status).toBe('pending');
    expect(template.metrics.failureRate.status).toBe('pending');
  });

  it('passes validator in template mode and strict final mode when fully populated', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-0343-perf-evidence-'));
    const finalPath = path.join(tmpDir, 'final.json');

    const templateResult = runValidator([
      'scripts/release/v1-performance-evidence.template.json',
    ], repoRoot);

    expect(templateResult.status).toBe(0);

    const finalArtifact = loadTemplate();
    finalArtifact.metrics.startup.p95 = 1820;
    finalArtifact.metrics.startup.p99 = 2470;
    finalArtifact.metrics.startup.evidence = 'pnpm perf:ttfc PASS';
    finalArtifact.metrics.startup.status = 'pass';

    finalArtifact.metrics.memory.peakRssMb = 176;
    finalArtifact.metrics.memory.p95RssMb = 168;
    finalArtifact.metrics.memory.evidence = 'pnpm perf:rss PASS';
    finalArtifact.metrics.memory.status = 'pass';

    finalArtifact.metrics.failureRate.ratePercent = 0;
    finalArtifact.metrics.failureRate.totalRuns = 2;
    finalArtifact.metrics.failureRate.failedRuns = 0;
    finalArtifact.metrics.failureRate.evidence = 'pnpm perf:ttfc PASS; pnpm perf:rss PASS';
    finalArtifact.metrics.failureRate.status = 'pass';

    finalArtifact.signoff.status = 'pass';
    finalArtifact.signoff.approvedBy = 'qa-release-owner';
    finalArtifact.signoff.approvedAt = '2026-02-16T12:00:00.000Z';

    fs.writeFileSync(finalPath, `${JSON.stringify(finalArtifact, null, 2)}\n`);

    const finalResult = runValidator([finalPath, '--require-final'], repoRoot);
    expect(finalResult.status).toBe(0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails strict validation when metric values exceed declared thresholds', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-0343-perf-evidence-'));
    const invalidPath = path.join(tmpDir, 'invalid.json');

    const invalidArtifact = loadTemplate();
    invalidArtifact.metrics.startup.p95 = 3200;
    invalidArtifact.metrics.startup.p99 = 3600;
    invalidArtifact.metrics.startup.evidence = 'pnpm perf:ttfc FAIL';
    invalidArtifact.metrics.startup.status = 'pass';

    invalidArtifact.metrics.memory.peakRssMb = 250;
    invalidArtifact.metrics.memory.p95RssMb = 230;
    invalidArtifact.metrics.memory.evidence = 'pnpm perf:rss FAIL';
    invalidArtifact.metrics.memory.status = 'pass';

    invalidArtifact.metrics.failureRate.ratePercent = 2;
    invalidArtifact.metrics.failureRate.totalRuns = 100;
    invalidArtifact.metrics.failureRate.failedRuns = 2;
    invalidArtifact.metrics.failureRate.evidence = 'pnpm perf:ttfc FAIL; pnpm perf:rss FAIL';
    invalidArtifact.metrics.failureRate.status = 'pass';

    invalidArtifact.signoff.status = 'pass';
    invalidArtifact.signoff.approvedBy = 'qa-release-owner';
    invalidArtifact.signoff.approvedAt = '2026-02-16T12:00:00.000Z';

    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidArtifact, null, 2)}\n`);

    const result = runValidator([invalidPath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('exceeds threshold');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails strict validation when required metric fields are missing from artifact JSON', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-0343-perf-evidence-'));
    const missingFieldPath = path.join(tmpDir, 'missing-field.json');

    const artifactWithMissingField = loadTemplate() as PerformanceEvidenceArtifact & {
      metrics: {
        startup: {
          p95?: number | null;
        };
      };
    };

    delete artifactWithMissingField.metrics.startup.p95;
    artifactWithMissingField.metrics.startup.p99 = 2300;
    artifactWithMissingField.metrics.startup.evidence = 'pnpm perf:ttfc PASS';
    artifactWithMissingField.metrics.startup.status = 'pass';
    artifactWithMissingField.metrics.memory.peakRssMb = 180;
    artifactWithMissingField.metrics.memory.p95RssMb = 170;
    artifactWithMissingField.metrics.memory.evidence = 'pnpm perf:rss PASS';
    artifactWithMissingField.metrics.memory.status = 'pass';
    artifactWithMissingField.metrics.failureRate.ratePercent = 0;
    artifactWithMissingField.metrics.failureRate.totalRuns = 2;
    artifactWithMissingField.metrics.failureRate.failedRuns = 0;
    artifactWithMissingField.metrics.failureRate.evidence = 'pnpm perf:ttfc PASS; pnpm perf:rss PASS';
    artifactWithMissingField.metrics.failureRate.status = 'pass';
    artifactWithMissingField.signoff.status = 'pass';
    artifactWithMissingField.signoff.approvedBy = 'qa-release-owner';
    artifactWithMissingField.signoff.approvedAt = '2026-02-16T12:00:00.000Z';

    fs.writeFileSync(missingFieldPath, `${JSON.stringify(artifactWithMissingField, null, 2)}\n`);

    const result = runValidator([missingFieldPath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('p95/p99 must be set when startup.status is pass/fail');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails strict validation when metric values are non-numeric types', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-0343-perf-evidence-'));
    const invalidTypePath = path.join(tmpDir, 'invalid-type.json');

    const invalidTypeArtifact = loadTemplate() as PerformanceEvidenceArtifact & {
      metrics: {
        startup: {
          p95: number | string | null;
          p99: number | string | null;
        };
      };
    };

    invalidTypeArtifact.metrics.startup.p95 = 'fast';
    invalidTypeArtifact.metrics.startup.p99 = 2300;
    invalidTypeArtifact.metrics.startup.evidence = 'pnpm perf:ttfc PASS';
    invalidTypeArtifact.metrics.startup.status = 'pass';
    invalidTypeArtifact.metrics.memory.peakRssMb = 180;
    invalidTypeArtifact.metrics.memory.p95RssMb = 170;
    invalidTypeArtifact.metrics.memory.evidence = 'pnpm perf:rss PASS';
    invalidTypeArtifact.metrics.memory.status = 'pass';
    invalidTypeArtifact.metrics.failureRate.ratePercent = 0;
    invalidTypeArtifact.metrics.failureRate.totalRuns = 2;
    invalidTypeArtifact.metrics.failureRate.failedRuns = 0;
    invalidTypeArtifact.metrics.failureRate.evidence = 'pnpm perf:ttfc PASS; pnpm perf:rss PASS';
    invalidTypeArtifact.metrics.failureRate.status = 'pass';
    invalidTypeArtifact.signoff.status = 'pass';
    invalidTypeArtifact.signoff.approvedBy = 'qa-release-owner';
    invalidTypeArtifact.signoff.approvedAt = '2026-02-16T12:00:00.000Z';

    fs.writeFileSync(invalidTypePath, `${JSON.stringify(invalidTypeArtifact, null, 2)}\n`);

    const result = runValidator([invalidTypePath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('must be finite numbers');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('tracks the finalized QAF-035 performance artifact', () => {
    const repoRoot = process.cwd();
    const artifactPath = 'artifacts/release/performance/qaf035-performance-evidence-20260603.json';

    const partialResult = runValidator([artifactPath], repoRoot);
    expect(partialResult.status).toBe(0);

    const finalResult = runValidator([artifactPath, '--require-final'], repoRoot);
    expect(finalResult.status).toBe(0);
  });

  it('fails validation when failure rate does not match failed run counts', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-0343-perf-evidence-'));
    const invalidPath = path.join(tmpDir, 'invalid-failure-rate.json');
    const invalidArtifact = loadTemplate();
    invalidArtifact.metrics.failureRate.totalRuns = 10;
    invalidArtifact.metrics.failureRate.failedRuns = 1;
    invalidArtifact.metrics.failureRate.ratePercent = 25;
    invalidArtifact.metrics.failureRate.evidence = 'pnpm perf:ttfc FAIL';
    invalidArtifact.metrics.failureRate.status = 'fail';
    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidArtifact, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('ratePercent must match failedRuns / totalRuns');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
