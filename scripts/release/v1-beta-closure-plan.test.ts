import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

interface ClosureItem {
  id: string;
  blockerId: string;
  gateIds: string[];
  artifactRefs: string[];
  validationCommands: string[];
}

interface BetaClosurePlan {
  closureItems: ClosureItem[];
}

const runValidator = (args: string[], cwd: string) => (
  spawnSync(process.execPath, ['scripts/release/validate-beta-closure-plan.mjs', ...args], {
    cwd,
    encoding: 'utf8',
  })
);

const planPath = 'artifacts/release/readiness/qaf035-beta-closure-plan-20260603.json';

const loadPlan = (): BetaClosurePlan => (
  JSON.parse(fs.readFileSync(path.resolve(process.cwd(), planPath), 'utf8')) as BetaClosurePlan
);

describe('QAF-035 beta closure plan', () => {
  it('validates the current closure plan against the readiness blocker triage', () => {
    const repoRoot = process.cwd();
    const result = runValidator([planPath], repoRoot);
    const plan = loadPlan();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('open blockers covered: 9');
    expect(plan.closureItems).toHaveLength(9);
  });

  it('fails when an open blocker has no closure item', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-closure-'));
    const invalidPath = path.join(tmpDir, 'missing-blocker.json');
    const invalidPlan = loadPlan();
    invalidPlan.closureItems = invalidPlan.closureItems.filter((item) => item.blockerId !== 'SECURITY-PRIVACY-OWNER');

    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidPlan, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('open blocker SECURITY-PRIVACY-OWNER must have a closure item');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails when closure item gates drift from the source blocker mapping', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-closure-'));
    const invalidPath = path.join(tmpDir, 'bad-gates.json');
    const invalidPlan = loadPlan();
    const item = invalidPlan.closureItems.find((entry) => entry.blockerId === 'BETA-CAPACITY-OWNER');
    if (item) {
      item.gateIds = ['provider-owner-signoff'];
    }

    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidPlan, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('gateIds must match source blocker BETA-CAPACITY-OWNER');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails when a closure validation command invokes local media tools', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-closure-'));
    const invalidPath = path.join(tmpDir, 'bad-command.json');
    const invalidPlan = loadPlan();
    const item = invalidPlan.closureItems.find((entry) => entry.blockerId === 'RUNTIME-NO-MEDIA-OWNER');
    if (item) {
      item.validationCommands.push('ffmpeg -i broken-catchup.ts out.m3u8');
    }

    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidPlan, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('validationCommands must not invoke ffmpeg/ffprobe');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails when a referenced closure artifact is missing', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-closure-'));
    const invalidPath = path.join(tmpDir, 'missing-artifact.json');
    const invalidPlan = loadPlan();
    const item = invalidPlan.closureItems.find((entry) => entry.blockerId === 'PERFORMANCE-RELEASE-RUN');
    if (item) {
      item.artifactRefs = ['artifacts/release/performance/__missing-performance-artifact.json'];
    }

    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidPlan, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('artifactRef does not exist');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
