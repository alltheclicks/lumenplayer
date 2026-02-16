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
      status: MetricStatus;
    };
    memory: {
      peakRssMb: number | null;
      p95RssMb: number | null;
      thresholdPeakMb: number;
      status: MetricStatus;
    };
    failureRate: {
      ratePercent: number | null;
      thresholdPercent: number;
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
    finalArtifact.metrics.startup.status = 'pass';

    finalArtifact.metrics.memory.peakRssMb = 176;
    finalArtifact.metrics.memory.p95RssMb = 168;
    finalArtifact.metrics.memory.status = 'pass';

    finalArtifact.metrics.failureRate.ratePercent = 0;
    finalArtifact.metrics.failureRate.status = 'pass';

    finalArtifact.signoff.status = 'pass';
    finalArtifact.signoff.approvedBy = 'qa-release-owner';
    finalArtifact.signoff.approvedAt = '2026-02-16T12:00:00.000Z';

    fs.writeFileSync(finalPath, `${JSON.stringify(finalArtifact, null, 2)}\n`);

    const finalResult = runValidator([finalPath, '--require-final'], repoRoot);
    expect(finalResult.status).toBe(0);
  });

  it('fails strict validation when metric values exceed declared thresholds', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-0343-perf-evidence-'));
    const invalidPath = path.join(tmpDir, 'invalid.json');

    const invalidArtifact = loadTemplate();
    invalidArtifact.metrics.startup.p95 = 3200;
    invalidArtifact.metrics.startup.p99 = 3600;
    invalidArtifact.metrics.startup.status = 'pass';

    invalidArtifact.metrics.memory.peakRssMb = 250;
    invalidArtifact.metrics.memory.p95RssMb = 230;
    invalidArtifact.metrics.memory.status = 'pass';

    invalidArtifact.metrics.failureRate.ratePercent = 2;
    invalidArtifact.metrics.failureRate.status = 'pass';

    invalidArtifact.signoff.status = 'pass';
    invalidArtifact.signoff.approvedBy = 'qa-release-owner';
    invalidArtifact.signoff.approvedAt = '2026-02-16T12:00:00.000Z';

    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidArtifact, null, 2)}\n`);

    const result = runValidator([invalidPath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('exceeds threshold');
  });
});
