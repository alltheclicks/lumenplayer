import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

type Status = 'pending' | 'pass' | 'fail';

interface DesignParityScreen {
  id: string;
  desktop: {
    referenceRef: string;
    lumenRef: string;
    status: Status;
  };
  mobile: {
    referenceRef: string;
    lumenRef: string;
    status: Status;
  };
  parityReview: {
    status: Status;
    reviewedBy: string;
    reviewedAt: string;
  };
}

interface DesignParityEvidence {
  sourceOfTruth: {
    repoPath: string;
    referenceManifest: string;
    referenceCommit: string;
  };
  reviewIntake: {
    status: Status;
    owner: string;
    captureReportRef: string;
    reviewGuideRef: string;
    requiredScreenIds: string[];
    requiredViewportModes: string[];
    requiredReviewFields: string[];
    finalRules: string[];
    notes: string;
  };
  screens: DesignParityScreen[];
  signoff: {
    status: Status;
    approvedBy: string;
    approvedAt: string;
  };
}

const runValidator = (args: string[], cwd: string) => (
  spawnSync(process.execPath, ['scripts/release/validate-design-parity-evidence.mjs', ...args], {
    cwd,
    encoding: 'utf8',
  })
);

const loadTemplate = (): DesignParityEvidence => {
  const templatePath = path.resolve(
    process.cwd(),
    'scripts/release/v1-design-parity-evidence.template.json',
  );

  return JSON.parse(fs.readFileSync(templatePath, 'utf8')) as DesignParityEvidence;
};

const writeEvidenceFile = (tmpDir: string, fileName: string) => {
  const filePath = path.join(tmpDir, fileName);
  fs.writeFileSync(filePath, 'rendered evidence placeholder\n');
  return filePath;
};

const finalizeArtifact = (tmpDir: string): DesignParityEvidence => {
  const finalArtifact = structuredClone(loadTemplate());
  finalArtifact.reviewIntake.status = 'pass';
  finalArtifact.reviewIntake.owner = 'design-qa';
  finalArtifact.reviewIntake.notes = 'Design owner parity review is complete for every required screen.';
  for (const screen of finalArtifact.screens) {
    screen.desktop.status = 'pass';
    screen.desktop.referenceRef = writeEvidenceFile(tmpDir, `${screen.id}-desktop-reference.png`);
    screen.desktop.lumenRef = writeEvidenceFile(tmpDir, `${screen.id}-desktop-lumen.png`);
    screen.mobile.status = 'pass';
    screen.mobile.referenceRef = writeEvidenceFile(tmpDir, `${screen.id}-mobile-reference.png`);
    screen.mobile.lumenRef = writeEvidenceFile(tmpDir, `${screen.id}-mobile-lumen.png`);
    screen.parityReview.status = 'pass';
    screen.parityReview.reviewedBy = 'design-qa';
    screen.parityReview.reviewedAt = '2026-02-18T16:00:00.000Z';
  }

  finalArtifact.signoff.status = 'pass';
  finalArtifact.signoff.approvedBy = 'release-manager';
  finalArtifact.signoff.approvedAt = '2026-02-18T16:05:00.000Z';

  return finalArtifact;
};

describe('V1 design parity evidence artifact', () => {
  it('contains required screen entries and Balkan Stream source-of-truth', () => {
    const template = loadTemplate();
    const screenIds = new Set(template.screens.map((screen) => screen.id));

    expect(template.sourceOfTruth.repoPath).toContain('/balkan-stream');
    expect(template.sourceOfTruth.referenceManifest).toContain('reference-manifest.json');
    expect(template.reviewIntake.captureReportRef).toBe('output/playwright/lp-0373/CAPTURE-REPORT.md');
    expect(template.reviewIntake.requiredViewportModes).toEqual(expect.arrayContaining(['desktop', 'mobile']));
    expect(template.reviewIntake.requiredReviewFields).toEqual(expect.arrayContaining([
      'reviewedBy',
      'reviewedAt',
      'notes',
    ]));
    expect(template.reviewIntake.finalRules.join('\n')).toContain('Rendered capture status pass is not final owner approval.');

    const required = ['login', 'player', 'movies', 'series', 'epg'];
    for (const screenId of required) {
      expect(screenIds.has(screenId), `missing screen ${screenId}`).toBe(true);
    }
  });

  it('passes validator in template mode and strict mode for finalized artifact', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-0373-design-parity-'));
    const finalPath = path.join(tmpDir, 'final.json');

    const templateResult = runValidator([
      'scripts/release/v1-design-parity-evidence.template.json',
    ], repoRoot);
    expect(templateResult.status).toBe(0);

    const finalArtifact = finalizeArtifact(tmpDir);
    fs.writeFileSync(finalPath, `${JSON.stringify(finalArtifact, null, 2)}\n`);

    const finalResult = runValidator([finalPath, '--require-final'], repoRoot);
    expect(finalResult.status).toBe(0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails strict validation when a required screen entry is missing', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-0373-design-parity-'));
    const invalidPath = path.join(tmpDir, 'missing-screen.json');

    const invalidArtifact = structuredClone(loadTemplate());
    invalidArtifact.screens = invalidArtifact.screens.filter((screen) => screen.id !== 'series');
    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidArtifact, null, 2)}\n`);

    const result = runValidator([invalidPath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('required screen is missing');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('tracks the QAF-035 partial design artifact without allowing final signoff', () => {
    const repoRoot = process.cwd();
    const artifactPath = 'artifacts/release/design/qaf035-design-parity-20260603.json';
    const partialResult = runValidator([artifactPath], repoRoot);
    expect(partialResult.status).toBe(0);
    const partialArtifact = JSON.parse(fs.readFileSync(path.resolve(repoRoot, artifactPath), 'utf8')) as DesignParityEvidence;
    expect(partialArtifact.reviewIntake.status).toBe('pending');
    expect(partialArtifact.reviewIntake.requiredScreenIds).toContain('player');
    expect(partialArtifact.reviewIntake.finalRules.join('\n')).toContain('not final owner approval');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-0373-design-parity-'));
    const strictArtifact = structuredClone(partialArtifact);
    for (const screen of strictArtifact.screens) {
      screen.desktop.referenceRef = writeEvidenceFile(tmpDir, `${screen.id}-desktop-reference.png`);
      screen.desktop.lumenRef = writeEvidenceFile(tmpDir, `${screen.id}-desktop-lumen.png`);
      screen.mobile.referenceRef = writeEvidenceFile(tmpDir, `${screen.id}-mobile-reference.png`);
      screen.mobile.lumenRef = writeEvidenceFile(tmpDir, `${screen.id}-mobile-lumen.png`);
    }
    const strictArtifactPath = path.join(tmpDir, 'partial-with-rendered-evidence.json');
    fs.writeFileSync(strictArtifactPath, `${JSON.stringify(strictArtifact, null, 2)}\n`);

    const finalResult = runValidator([strictArtifactPath, '--require-final'], repoRoot);
    expect(finalResult.status).toBe(2);
    expect(finalResult.stderr).toContain('parityReview.status cannot be pending with --require-final');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails validation when review intake omits the owner-approval guardrail', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-0373-design-parity-'));
    const invalidPath = path.join(tmpDir, 'weak-review-intake.json');

    const invalidArtifact = structuredClone(loadTemplate());
    invalidArtifact.reviewIntake.finalRules = invalidArtifact.reviewIntake.finalRules.filter((rule) => (
      !rule.includes('not final owner approval')
    ));
    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidArtifact, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('reviewIntake.finalRules must include not final owner approval');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails strict validation when rendered evidence files are missing', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-0373-design-parity-'));
    const invalidPath = path.join(tmpDir, 'missing-rendered-evidence.json');
    const invalidArtifact = finalizeArtifact(tmpDir);
    const loginScreen = invalidArtifact.screens.find((screen) => screen.id === 'login');
    if (loginScreen) {
      loginScreen.desktop.lumenRef = path.join(tmpDir, 'missing-lumen-login.png');
    }
    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidArtifact, null, 2)}\n`);

    const result = runValidator([invalidPath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('desktop.lumenRef must reference an existing file');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails strict validation when signoff is pass but one screen is not pass', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-0373-design-parity-'));
    const invalidPath = path.join(tmpDir, 'signoff-pass-with-fail-screen.json');

    const invalidArtifact = finalizeArtifact(tmpDir);

    const epgScreen = invalidArtifact.screens.find((screen) => screen.id === 'epg');
    if (epgScreen) {
      epgScreen.mobile.status = 'fail';
    }

    invalidArtifact.signoff.status = 'pass';
    invalidArtifact.signoff.approvedBy = 'release-manager';
    invalidArtifact.signoff.approvedAt = '2026-02-18T16:05:00.000Z';

    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidArtifact, null, 2)}\n`);

    const result = runValidator([invalidPath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('signoff.status cannot be pass');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
