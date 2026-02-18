import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

type Status = 'pending' | 'pass' | 'fail';

interface DesignParityScreen {
  id: string;
  desktop: {
    status: Status;
  };
  mobile: {
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

describe('V1 design parity evidence artifact', () => {
  it('contains required screen entries and Balkan Stream source-of-truth', () => {
    const template = loadTemplate();
    const screenIds = new Set(template.screens.map((screen) => screen.id));

    expect(template.sourceOfTruth.repoPath).toContain('/balkan-stream');
    expect(template.sourceOfTruth.referenceManifest).toContain('reference-manifest.json');

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

    const finalArtifact = structuredClone(loadTemplate());
    for (const screen of finalArtifact.screens) {
      screen.desktop.status = 'pass';
      screen.mobile.status = 'pass';
      screen.parityReview.status = 'pass';
      screen.parityReview.reviewedBy = 'design-qa';
      screen.parityReview.reviewedAt = '2026-02-18T16:00:00.000Z';
    }

    finalArtifact.signoff.status = 'pass';
    finalArtifact.signoff.approvedBy = 'release-manager';
    finalArtifact.signoff.approvedAt = '2026-02-18T16:05:00.000Z';

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

  it('fails strict validation when signoff is pass but one screen is not pass', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-0373-design-parity-'));
    const invalidPath = path.join(tmpDir, 'signoff-pass-with-fail-screen.json');

    const invalidArtifact = structuredClone(loadTemplate());
    for (const screen of invalidArtifact.screens) {
      screen.desktop.status = 'pass';
      screen.mobile.status = 'pass';
      screen.parityReview.status = 'pass';
      screen.parityReview.reviewedBy = 'design-qa';
      screen.parityReview.reviewedAt = '2026-02-18T16:00:00.000Z';
    }

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
