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
  sourceReadinessArtifact: string;
  noMediaInvariant: {
    trackedScanArtifact: string;
  };
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

  it('fails when the source readiness artifact exists but does not validate', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(repoRoot, '.tmp-beta-closure-'));
    const invalidReadinessPath = path.join(tmpDir, 'invalid-readiness.json');
    const invalidReadinessRef = path.relative(repoRoot, invalidReadinessPath);
    const invalidPlanPath = path.join(tmpDir, 'invalid-readiness-plan.json');
    const invalidPlan = loadPlan();
    const readinessArtifactPath = 'artifacts/release/readiness/qaf035-release-readiness-20260602.json';
    const readinessArtifact = JSON.parse(fs.readFileSync(path.resolve(repoRoot, readinessArtifactPath), 'utf8'));
    readinessArtifact.rollback.maxDecisionMinutes = 0;
    invalidPlan.sourceReadinessArtifact = invalidReadinessRef;

    fs.writeFileSync(invalidReadinessPath, `${JSON.stringify(readinessArtifact, null, 2)}\n`);
    fs.writeFileSync(invalidPlanPath, `${JSON.stringify(invalidPlan, null, 2)}\n`);

    const result = runValidator([invalidPlanPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('sourceReadinessArtifact failed linked validation');
    expect(result.stderr).toContain('rollback.maxDecisionMinutes must be a positive integer');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails when the source readiness artifact uses an absolute local path', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-closure-'));
    const invalidPath = path.join(tmpDir, 'absolute-readiness-plan.json');
    const invalidPlan = loadPlan();
    invalidPlan.sourceReadinessArtifact = path.resolve(repoRoot, 'artifacts/release/readiness/qaf035-release-readiness-20260602.json');

    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidPlan, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('sourceReadinessArtifact must be repo-relative without parent traversal');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails when the source readiness artifact uses parent traversal', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-closure-'));
    const invalidPath = path.join(tmpDir, 'traversal-readiness-plan.json');
    const invalidPlan = loadPlan();
    invalidPlan.sourceReadinessArtifact = 'artifacts/release/readiness/../readiness/qaf035-release-readiness-20260602.json';

    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidPlan, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('sourceReadinessArtifact must be repo-relative without parent traversal');

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
    expect(result.stderr).toContain('validationCommands must not reference ffmpeg/ffprobe');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails when a closure validation command references media tools through a local path', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-closure-'));
    const invalidPath = path.join(tmpDir, 'bad-path-command.json');
    const invalidPlan = loadPlan();
    const item = invalidPlan.closureItems.find((entry) => entry.blockerId === 'RUNTIME-NO-MEDIA-OWNER');
    if (item) {
      item.validationCommands.push('./bin/ffprobe broken-catchup.ts');
    }

    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidPlan, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('validationCommands must not reference ffmpeg/ffprobe');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails when a closure validation command references media tools through environment variables', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-closure-'));
    const invalidPath = path.join(tmpDir, 'bad-env-command.json');
    const invalidPlan = loadPlan();
    const item = invalidPlan.closureItems.find((entry) => entry.blockerId === 'RUNTIME-NO-MEDIA-OWNER');
    if (item) {
      item.validationCommands.push('FFMPEG_BIN=ffmpeg pnpm release:runtime-media:validate');
    }

    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidPlan, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('validationCommands must not reference ffmpeg/ffprobe');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails when a closure validation command enables remux transport flags', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-closure-'));
    const invalidPath = path.join(tmpDir, 'bad-remux-flag-command.json');
    const invalidPlan = loadPlan();
    const item = invalidPlan.closureItems.find((entry) => entry.blockerId === 'RUNTIME-NO-MEDIA-OWNER');
    if (item) {
      item.validationCommands.push('LUMEN_PROXY_REMUX_ENABLED=1 pnpm release:runtime-media:validate');
    }

    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidPlan, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('forbidden media-processing term: LUMEN_PROXY_REMUX_ENABLED');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails when a closure validation command references forbidden remux transport modes', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-closure-'));
    const invalidPath = path.join(tmpDir, 'bad-remux-transport-command.json');
    const invalidPlan = loadPlan();
    const item = invalidPlan.closureItems.find((entry) => entry.blockerId === 'RUNTIME-NO-MEDIA-OWNER');
    if (item) {
      item.validationCommands.push('node scripts/check-provider.mjs --transport remux-hls');
    }

    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidPlan, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('forbidden media-processing term: remux-hls');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails when a closure validation command references XUI-side media processing', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-closure-'));
    const invalidPath = path.join(tmpDir, 'bad-xui-command.json');
    const invalidPlan = loadPlan();
    const item = invalidPlan.closureItems.find((entry) => entry.blockerId === 'PROVIDER-OWNER-SIGNOFF');
    if (item) {
      item.validationCommands.push('XUI_SIDE_TRANSCODE=1 pnpm release:provider-owner:validate');
    }

    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidPlan, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('forbidden media-processing term: XUI-side media processing');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails when a closure validation command references server-side generated HLS', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-closure-'));
    const invalidPath = path.join(tmpDir, 'bad-generated-hls-command.json');
    const invalidPlan = loadPlan();
    const item = invalidPlan.closureItems.find((entry) => entry.blockerId === 'RUNTIME-NO-MEDIA-OWNER');
    if (item) {
      item.validationCommands.push('node scripts/check-provider.mjs --mode server-side-generate-hls');
    }

    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidPlan, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('forbidden media-processing term: generated HLS');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails when an open closure item has no concrete final proof command', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-closure-'));
    const invalidPath = path.join(tmpDir, 'missing-final-proof.json');
    const invalidPlan = loadPlan();
    const item = invalidPlan.closureItems.find((entry) => entry.blockerId === 'PERFORMANCE-RELEASE-RUN');
    if (item) {
      item.validationCommands = item.validationCommands.filter((command) => !command.includes('--require-final'));
    }

    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidPlan, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('validationCommands must include a concrete final proof command');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails when an open closure item spoofs final proof with an arbitrary command', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-closure-'));
    const invalidPath = path.join(tmpDir, 'spoofed-final-proof.json');
    const invalidPlan = loadPlan();
    const item = invalidPlan.closureItems.find((entry) => entry.blockerId === 'PERFORMANCE-RELEASE-RUN');
    if (item) {
      item.validationCommands = ['echo --require-final'];
    }

    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidPlan, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('validationCommands must include a concrete final proof command');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails when a final proof command uses an absolute local artifact path', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-closure-'));
    const invalidPath = path.join(tmpDir, 'absolute-final-artifact.json');
    const invalidPlan = loadPlan();
    const item = invalidPlan.closureItems.find((entry) => entry.blockerId === 'PERFORMANCE-RELEASE-RUN');
    if (item) {
      item.validationCommands = [
        `node scripts/release/validate-performance-evidence.mjs ${path.resolve(repoRoot, 'artifacts/release/performance/qaf035-performance-evidence-20260603.json')} --require-final`,
      ];
    }

    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidPlan, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('validationCommands must include a concrete final proof command');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails when a final proof command uses parent traversal artifact paths', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-closure-'));
    const invalidPath = path.join(tmpDir, 'traversal-final-artifact.json');
    const invalidPlan = loadPlan();
    const item = invalidPlan.closureItems.find((entry) => entry.blockerId === 'PERFORMANCE-RELEASE-RUN');
    if (item) {
      item.validationCommands = [
        'node scripts/release/validate-performance-evidence.mjs artifacts/release/performance/../performance/qaf035-performance-evidence-20260603.json --require-final',
      ];
    }

    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidPlan, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('validationCommands must include a concrete final proof command');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails when a final proof command is shell chained', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-closure-'));
    const invalidPath = path.join(tmpDir, 'chained-final-proof.json');
    const invalidPlan = loadPlan();
    const item = invalidPlan.closureItems.find((entry) => entry.blockerId === 'PERFORMANCE-RELEASE-RUN');
    if (item) {
      item.validationCommands = [
        'node scripts/release/validate-performance-evidence.mjs artifacts/release/performance/qaf035-performance-evidence-20260603.json --require-final && echo passed',
      ];
    }

    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidPlan, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('validationCommands must include a concrete final proof command');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails when any closure gate lacks its direct final proof command', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-closure-'));
    const cases = [
      ['GO-NO-GO-SIGNOFF', 'scripts/release/validate-go-no-go.mjs', 'go/no-go final proof'],
      ['TARGET-MATRIX-DEVICES', 'scripts/release/validate-smoke-regression-matrix.mjs', 'smoke/regression final proof'],
      ['TARGET-MATRIX-DEVICES', 'scripts/release/compatibility-matrix-task.mjs', 'compatibility final matrix with required targets'],
      ['TARGET-MATRIX-DEVICES', 'scripts/release/validate-manual-device-qa.mjs', 'manual device QA final proof'],
      ['TARGET-MATRIX-DEVICES', 'scripts/release/validate-design-parity-evidence.mjs', 'design parity final proof'],
      ['BETA-CAPACITY-OWNER', 'scripts/release/validate-beta-capacity-evidence.mjs', 'beta capacity final proof'],
      ['PROVIDER-OWNER-SIGNOFF', 'scripts/release/validate-provider-owner-signoff.mjs', 'provider owner final proof'],
      ['PERFORMANCE-RELEASE-RUN', 'scripts/release/validate-performance-evidence.mjs', 'performance evidence final proof'],
      ['RUNTIME-NO-MEDIA-OWNER', 'scripts/release/validate-runtime-media-policy.mjs', 'runtime media policy final proof'],
      ['OBSERVABILITY-BASELINE-OWNER', 'scripts/release/validate-observability-baseline.mjs', 'observability baseline final proof'],
      ['BETA-OPS-SIGNOFF', 'scripts/release/validate-beta-ops-signoff.mjs', 'beta ops final proof'],
      ['SECURITY-PRIVACY-OWNER', 'scripts/release/validate-security-privacy-baseline.mjs', 'security/privacy final proof'],
    ] as const;

    for (const [blockerId, commandSnippet, expectedMessage] of cases) {
      const invalidPlan = loadPlan();
      const item = invalidPlan.closureItems.find((entry) => entry.blockerId === blockerId);
      if (!item) {
        throw new Error(`Missing closure item for ${blockerId}`);
      }

      item.validationCommands = item.validationCommands.filter((command) => !(
        command.includes(commandSnippet)
        && command.includes('--require-final')
      ));
      item.validationCommands.push('pnpm release:qaf035:final');

      const invalidPath = path.join(tmpDir, `${blockerId.toLowerCase()}-${path.basename(commandSnippet)}.json`);
      fs.writeFileSync(invalidPath, `${JSON.stringify(invalidPlan, null, 2)}\n`);

      const result = runValidator([invalidPath], repoRoot);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain(`validationCommands must include ${expectedMessage}`);
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
  }, 20000);

  it('fails when a direct final proof command points at the wrong existing artifact', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-closure-'));
    const invalidPath = path.join(tmpDir, 'wrong-final-artifact.json');
    const invalidPlan = loadPlan();
    const item = invalidPlan.closureItems.find((entry) => entry.blockerId === 'PERFORMANCE-RELEASE-RUN');
    if (item) {
      item.validationCommands = item.validationCommands.map((command) => (
        command.includes('scripts/release/validate-performance-evidence.mjs') && command.includes('--require-final')
          ? 'node scripts/release/validate-performance-evidence.mjs artifacts/release/security/qaf035-security-privacy-baseline-20260603.json --require-final'
          : command
      ));
    }

    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidPlan, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('validationCommands must include performance evidence final proof');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails when the compatibility gate lacks a final matrix proof command', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-closure-'));
    const invalidPath = path.join(tmpDir, 'missing-compatibility-final-proof.json');
    const invalidPlan = loadPlan();
    const item = invalidPlan.closureItems.find((entry) => entry.blockerId === 'TARGET-MATRIX-DEVICES');
    if (item) {
      item.validationCommands = item.validationCommands.filter((command) => !(
        command.includes('scripts/release/compatibility-matrix-task.mjs')
        && command.includes('--require-final')
      ));
    }

    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidPlan, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('validationCommands must include compatibility final matrix with required targets');

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

  it('fails when a referenced closure artifact uses an absolute local path', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-closure-'));
    const invalidPath = path.join(tmpDir, 'absolute-artifact.json');
    const invalidPlan = loadPlan();
    const item = invalidPlan.closureItems.find((entry) => entry.blockerId === 'PERFORMANCE-RELEASE-RUN');
    if (item) {
      item.artifactRefs = [path.resolve(repoRoot, 'artifacts/release/performance/qaf035-performance-evidence-20260603.json')];
    }

    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidPlan, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('artifactRef must be repo-relative without parent traversal');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails when a referenced closure artifact uses parent traversal', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-closure-'));
    const invalidPath = path.join(tmpDir, 'traversal-artifact.json');
    const invalidPlan = loadPlan();
    const item = invalidPlan.closureItems.find((entry) => entry.blockerId === 'PERFORMANCE-RELEASE-RUN');
    if (item) {
      item.artifactRefs = ['artifacts/release/performance/../performance/qaf035-performance-evidence-20260603.json'];
    }

    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidPlan, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('artifactRef must be repo-relative without parent traversal');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails when a referenced closure artifact exists but does not validate', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(repoRoot, '.tmp-beta-closure-'));
    const invalidArtifactDir = path.join(tmpDir, 'artifacts', 'release', 'performance');
    fs.mkdirSync(invalidArtifactDir, { recursive: true });
    const invalidArtifactPath = path.join(invalidArtifactDir, 'qaf035-performance-evidence-invalid.json');
    const invalidArtifactRef = path.relative(repoRoot, invalidArtifactPath);
    const invalidPlanPath = path.join(tmpDir, 'invalid-artifact-plan.json');
    const invalidPlan = loadPlan();
    const artifact = JSON.parse(fs.readFileSync(path.resolve(repoRoot, 'artifacts/release/performance/qaf035-performance-evidence-20260603.json'), 'utf8'));
    artifact.dataset.channelCount = 0;
    const item = invalidPlan.closureItems.find((entry) => entry.blockerId === 'PERFORMANCE-RELEASE-RUN');
    if (item) {
      item.artifactRefs = [invalidArtifactRef];
    }

    fs.writeFileSync(invalidArtifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
    fs.writeFileSync(invalidPlanPath, `${JSON.stringify(invalidPlan, null, 2)}\n`);

    const result = runValidator([invalidPlanPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('artifactRef');
    expect(result.stderr).toContain('failed linked validation');
    expect(result.stderr).toContain('dataset.channelCount must be a positive number');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails when the tracked no-media scan artifact exists but does not validate', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(repoRoot, '.tmp-beta-closure-'));
    const invalidScanPath = path.join(tmpDir, 'invalid-no-media-scan.json');
    const invalidScanRef = path.relative(repoRoot, invalidScanPath);
    const invalidPlanPath = path.join(tmpDir, 'invalid-scan-artifact-plan.json');
    const invalidPlan = loadPlan();
    const scanArtifactPath = 'artifacts/release/media-policy/qaf035-no-media-evidence-scan-20260602.json';
    const scanArtifact = JSON.parse(fs.readFileSync(path.resolve(repoRoot, scanArtifactPath), 'utf8'));
    scanArtifact.scan.command = 'cat output/playwright/manual-network-audit/report.json';
    invalidPlan.noMediaInvariant.trackedScanArtifact = invalidScanRef;

    fs.writeFileSync(invalidScanPath, `${JSON.stringify(scanArtifact, null, 2)}\n`);
    fs.writeFileSync(invalidPlanPath, `${JSON.stringify(invalidPlan, null, 2)}\n`);

    const result = runValidator([invalidPlanPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('noMediaInvariant.trackedScanArtifact failed linked validation');
    expect(result.stderr).toContain('scan.command must reference release:no-media-evidence:scan');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails when the tracked no-media scan artifact uses an absolute local path', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-closure-'));
    const invalidPath = path.join(tmpDir, 'absolute-scan-plan.json');
    const invalidPlan = loadPlan();
    invalidPlan.noMediaInvariant.trackedScanArtifact = path.resolve(repoRoot, 'artifacts/release/media-policy/qaf035-no-media-evidence-scan-20260602.json');

    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidPlan, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('noMediaInvariant.trackedScanArtifact must be repo-relative without parent traversal');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails when the tracked no-media scan artifact uses parent traversal', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-beta-closure-'));
    const invalidPath = path.join(tmpDir, 'traversal-scan-plan.json');
    const invalidPlan = loadPlan();
    invalidPlan.noMediaInvariant.trackedScanArtifact = 'artifacts/release/media-policy/../media-policy/qaf035-no-media-evidence-scan-20260602.json';

    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidPlan, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('noMediaInvariant.trackedScanArtifact must be repo-relative without parent traversal');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
