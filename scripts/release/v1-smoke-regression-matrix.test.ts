import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

interface MatrixCase {
  id: string;
  suite: 'smoke' | 'regression';
  tags: string[];
  releaseBlocker: boolean;
  status?: 'pending' | 'pass' | 'fail';
  evidence?: string;
}

interface EvidenceIntake {
  status: 'pending' | 'pass' | 'fail';
  owner: string;
  completedBy?: string;
  completedAt?: string;
  requiredCaseIds: string[];
  requiredEvidenceRefs: string[];
  finalRules: string[];
}

interface MatrixTemplate {
  requiredCoverageTags: string[];
  evidenceIntake?: EvidenceIntake;
  cases: MatrixCase[];
  signoff?: {
    status: 'pending' | 'pass' | 'fail';
    approvedBy: string;
    approvedAt: string;
    notes?: string;
  };
}

const loadTemplate = (): MatrixTemplate => {
  const templatePath = path.resolve(
    process.cwd(),
    'scripts/release/v1-smoke-regression-matrix.template.json',
  );

  return JSON.parse(fs.readFileSync(templatePath, 'utf8')) as MatrixTemplate;
};

const runValidator = (args: string[], cwd: string) => (
  spawnSync(process.execPath, ['scripts/release/validate-smoke-regression-matrix.mjs', ...args], {
    cwd,
    encoding: 'utf8',
  })
);

const loadQafArtifact = (): MatrixTemplate => {
  const artifactPath = path.resolve(
    process.cwd(),
    'artifacts/release/smoke/qaf035-smoke-regression-matrix-20260603.json',
  );

  return JSON.parse(fs.readFileSync(artifactPath, 'utf8')) as MatrixTemplate;
};

describe('V1 smoke/regression matrix template', () => {
  it('covers required release tags with both smoke and regression suites', () => {
    const template = loadTemplate();

    expect(template.requiredCoverageTags.length).toBeGreaterThanOrEqual(6);
    expect(template.cases.length).toBeGreaterThanOrEqual(10);

    for (const tag of template.requiredCoverageTags) {
      const taggedCases = template.cases.filter((testCase) => testCase.tags.includes(tag));
      expect(taggedCases.length, `missing coverage for tag ${tag}`).toBeGreaterThan(0);
      expect(taggedCases.some((testCase) => testCase.suite === 'smoke'), `missing smoke for tag ${tag}`).toBe(true);
      expect(taggedCases.some((testCase) => testCase.suite === 'regression'), `missing regression for tag ${tag}`).toBe(true);
    }
  });

  it('keeps smoke suite release-blocking for core release flows', () => {
    const template = loadTemplate();

    const smokeCases = template.cases.filter((testCase) => testCase.suite === 'smoke');
    expect(smokeCases.length).toBeGreaterThanOrEqual(6);

    for (const smokeCase of smokeCases) {
      expect(smokeCase.releaseBlocker).toBe(true);
    }
  });

  it('requires provider-backed QA coverage before release signoff', () => {
    const template = loadTemplate();
    const providerCases = template.cases.filter((testCase) => testCase.tags.includes('provider-qa'));

    expect(template.requiredCoverageTags).toContain('provider-qa');
    expect(providerCases.some((testCase) => testCase.suite === 'smoke')).toBe(true);
    expect(providerCases.some((testCase) => testCase.suite === 'regression')).toBe(true);
    expect(providerCases.every((testCase) => testCase.releaseBlocker)).toBe(true);
    expect(providerCases.every((testCase) => !testCase.tags.includes('desktop-browser'))).toBe(true);
  });

  it('requires no-media-processing coverage before release signoff', () => {
    const template = loadTemplate();
    const noMediaProcessingCases = template.cases.filter((testCase) => (
      testCase.tags.includes('no-media-processing')
    ));

    expect(template.requiredCoverageTags).toContain('no-media-processing');
    expect(noMediaProcessingCases.some((testCase) => testCase.suite === 'smoke')).toBe(true);
    expect(noMediaProcessingCases.some((testCase) => testCase.suite === 'regression')).toBe(true);
    expect(noMediaProcessingCases.every((testCase) => testCase.releaseBlocker)).toBe(true);
  });

  it('tracks the QAF-035 smoke artifact and requires scanner evidence for passing provider no-media smoke', () => {
    const repoRoot = process.cwd();
    const artifactPath = 'artifacts/release/smoke/qaf035-smoke-regression-matrix-20260603.json';
    const result = runValidator([artifactPath], repoRoot);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('cases: 18');

    const artifact = loadQafArtifact();
    expect(artifact.evidenceIntake?.requiredEvidenceRefs).toEqual(expect.arrayContaining([
      'manualDeviceTargetRef',
      'networkEvidenceRef',
      'noMediaScanArtifactRef',
      'perCaseEvidenceRef',
    ]));
    expect(artifact.evidenceIntake?.requiredCaseIds).toEqual(expect.arrayContaining([
      'SMK-DESKTOP-CHROME-LIVE',
      'SMK-MOBILE-IOS-SAFARI-LIVE',
      'SMK-CAST-CONNECT-PLAY',
      'REG-PWA-OFFLINE-RECOVERY',
    ]));

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-smoke-matrix-'));
    const invalidPath = path.join(tmpDir, 'missing-no-media-scan.json');
    const invalidArtifact = artifact;
    const noMediaCase = invalidArtifact.cases.find((testCase) => (
      testCase.id === 'SMK-PROVIDER-CATCHUP-NO-MEDIA-PROCESSING'
    ));
    if (noMediaCase) {
      noMediaCase.status = 'pass';
      noMediaCase.evidence = 'output/playwright/manual-network-audit/REPORT.md';
    }
    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidArtifact, null, 2)}\n`);

    const invalidResult = runValidator([invalidPath], repoRoot);
    expect(invalidResult.status).toBe(2);
    expect(invalidResult.stderr).toContain('release:no-media-evidence:scan');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('accepts a finalized matrix only when intake and signoff are complete', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-smoke-matrix-'));
    const finalPath = path.join(tmpDir, 'finalized-smoke-matrix.json');
    const finalizedArtifact = loadQafArtifact();

    finalizedArtifact.cases = finalizedArtifact.cases.map((testCase) => ({
      ...testCase,
      status: 'pass',
      evidence: testCase.evidence || 'artifacts/release/manual-device-qa/qaf035-manual-device-qa-20260603.json',
    }));
    finalizedArtifact.evidenceIntake = {
      ...finalizedArtifact.evidenceIntake!,
      status: 'pass',
      completedBy: 'release-qa-owner',
      completedAt: '2026-06-05T12:00:00Z',
    };
    finalizedArtifact.signoff = {
      status: 'pass',
      approvedBy: 'release-qa-owner',
      approvedAt: '2026-06-05T12:05:00Z',
      notes: 'Synthetic finalized artifact for validator coverage.',
    };

    fs.writeFileSync(finalPath, `${JSON.stringify(finalizedArtifact, null, 2)}\n`);

    const result = runValidator([finalPath, '--require-final'], repoRoot);
    expect(result.status).toBe(0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails when evidence intake drops a pending case from the required case list', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-smoke-matrix-'));
    const invalidPath = path.join(tmpDir, 'missing-pending-case-intake.json');
    const invalidArtifact = loadQafArtifact();

    invalidArtifact.evidenceIntake!.requiredCaseIds = invalidArtifact.evidenceIntake!.requiredCaseIds.filter(
      (caseId) => caseId !== 'SMK-MOBILE-IOS-SAFARI-LIVE',
    );

    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidArtifact, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Pending case SMK-MOBILE-IOS-SAFARI-LIVE must be listed');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails when evidence intake drops no-media scan requirements', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-smoke-matrix-'));
    const invalidPath = path.join(tmpDir, 'missing-no-media-intake.json');
    const invalidArtifact = loadQafArtifact();

    invalidArtifact.evidenceIntake!.requiredEvidenceRefs = invalidArtifact.evidenceIntake!.requiredEvidenceRefs.filter(
      (ref) => ref !== 'noMediaScanArtifactRef',
    );

    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidArtifact, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('requiredEvidenceRefs must include noMediaScanArtifactRef');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('keeps the web gateway remux guard scoped to unit coverage, not provider account coverage', () => {
    const template = loadTemplate();
    const gatewayCase = template.cases.find((testCase) => testCase.id === 'REG-WEB-GATEWAY-REJECTS-REMUX');

    expect(gatewayCase?.tags).toContain('web-gateway');
    expect(gatewayCase?.tags).toContain('no-media-processing');
    expect(gatewayCase?.tags).not.toContain('provider-qa');
    expect(gatewayCase?.tags).not.toContain('desktop-browser');
  });

  it('keeps Cast and AirPlay target coverage separate from plain desktop browser coverage', () => {
    const template = loadTemplate();
    const desktopRegression = template.cases.find((testCase) => (
      testCase.id === 'REG-DESKTOP-LOCAL-PLAYER-STATE'
    ));
    const castCase = template.cases.find((testCase) => testCase.id === 'REG-CAST-RENDERER-SWITCH');
    const airplayCase = template.cases.find((testCase) => testCase.id === 'REG-AIRPLAY-RETURN-LOCAL');

    expect(desktopRegression?.tags).toContain('desktop-browser');
    expect(desktopRegression?.tags).toContain('desktop-chrome');
    expect(desktopRegression?.tags).toContain('desktop-chromium-local');
    expect(desktopRegression?.tags).not.toContain('cast-flow');
    expect(desktopRegression?.tags).not.toContain('airplay-flow');
    expect(castCase?.tags).toEqual(['cast-flow']);
    expect(airplayCase?.tags).toEqual(['airplay-flow']);
  });

  it('separates Chrome, Safari, and local Chromium desktop evidence tags', () => {
    const template = loadTemplate();
    const chromeCase = template.cases.find((testCase) => testCase.id === 'SMK-DESKTOP-CHROME-LIVE');
    const safariCase = template.cases.find((testCase) => testCase.id === 'SMK-DESKTOP-SAFARI-VOD');

    expect(chromeCase?.tags).toEqual(expect.arrayContaining([
      'desktop-browser',
      'desktop-chrome',
      'desktop-chromium-local',
    ]));
    expect(chromeCase?.tags).not.toContain('desktop-safari');
    expect(safariCase?.tags).toEqual(expect.arrayContaining([
      'desktop-browser',
      'desktop-safari',
    ]));
    expect(safariCase?.tags).not.toContain('desktop-chrome');
    expect(safariCase?.tags).not.toContain('desktop-chromium-local');
  });
});
