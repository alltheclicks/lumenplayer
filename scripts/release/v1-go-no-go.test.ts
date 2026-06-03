import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  V1_GO_NO_GO_FEATURE_AREAS,
  createV1GoNoGoChecklistTemplate,
  evaluateV1GoNoGoChecklist,
} from './v1-go-no-go';

const runJsonValidator = (args: string[], cwd: string) => (
  spawnSync(process.execPath, ['scripts/release/validate-go-no-go.mjs', ...args], {
    cwd,
    encoding: 'utf8',
  })
);

const loadJsonTemplate = () => JSON.parse(fs.readFileSync(
  path.resolve(process.cwd(), 'scripts/release/v1-go-no-go.template.json'),
  'utf8',
));

const finalizeJsonTemplate = () => {
  const template = loadJsonTemplate();
  for (const area of template.featureAreas) {
    for (const check of area.checks) {
      check.status = 'pass';
      check.evidence = `evidence://${area.id}/${check.id}`;
      if (check.id === 'catchup-no-transcode-remux') {
        check.evidence = 'pnpm release:no-media-evidence:scan -- evidence/network.har; artifacts/release/media-policy/qaf035-no-media-evidence-scan-20260602.json';
      }
    }
  }
  template.decision.status = 'pass';
  template.decision.approvedBy = 'release-director';
  template.decision.approvedAt = '2026-06-02T14:30:00.000Z';
  return template;
};

describe('V1 go/no-go checklist definition', () => {
  it('defines explicit pass/fail criteria for each feature area', () => {
    expect(V1_GO_NO_GO_FEATURE_AREAS.length).toBeGreaterThanOrEqual(5);

    for (const area of V1_GO_NO_GO_FEATURE_AREAS) {
      expect(area.id).toMatch(/^[a-z-]+$/);
      expect(area.label.length).toBeGreaterThan(0);
      expect(area.criteria.length).toBeGreaterThanOrEqual(3);

      for (const criterion of area.criteria) {
        expect(criterion.required).toBe(true);
        expect(criterion.passCondition.length).toBeGreaterThan(25);
        expect(criterion.failCondition.length).toBeGreaterThan(25);
      }
    }
  });

  it('requires provider QA, no-media-processing, and beta capacity checks in release criteria', () => {
    const criteriaIds = V1_GO_NO_GO_FEATURE_AREAS
      .flatMap((area) => area.criteria)
      .map((criterion) => criterion.id);

    expect(criteriaIds).toContain('content-provider-auth-live-catalog');
    expect(criteriaIds).toContain('content-provider-focused-playback');
    expect(criteriaIds).toContain('content-catchup-no-transcode-remux');
    expect(criteriaIds).toContain('perf-beta-capacity-300-500');

    const templateCheckIds = loadJsonTemplate()
      .featureAreas
      .flatMap((area: { checks: Array<{ id: string }> }) => area.checks)
      .map((check: { id: string }) => check.id);

    expect(templateCheckIds).toContain('provider-auth-live-catalog');
    expect(templateCheckIds).toContain('provider-focused-playback');
    expect(templateCheckIds).toContain('catchup-no-transcode-remux');
    expect(templateCheckIds).toContain('beta-capacity-300-500');
  });

  it('creates a pending template with unresolved required criteria', () => {
    const checklist = createV1GoNoGoChecklistTemplate('2026-02-16T00:00:00.000Z');
    const totalCriteria = checklist.areas.flatMap((area) => area.criteria).length;

    expect(checklist.releaseVersion).toBe('v1');
    expect(checklist.createdAt).toBe('2026-02-16T00:00:00.000Z');
    expect(checklist.decision).toBe('pending');
    expect(checklist.unresolvedRequiredCriteria.length).toBe(totalCriteria);
  });

  it('resolves to go only when all required criteria are pass or waived', () => {
    const checklist = createV1GoNoGoChecklistTemplate();
    let index = 0;
    for (const area of checklist.areas) {
      for (const criterion of area.criteria) {
        criterion.status = index % 2 === 0 ? 'pass' : 'waived';
        index += 1;
      }
    }

    const evaluated = evaluateV1GoNoGoChecklist(checklist);
    expect(evaluated.decision).toBe('go');
    expect(evaluated.unresolvedRequiredCriteria).toEqual([]);
    expect(evaluated.failedRequiredCriteria).toEqual([]);
  });

  it('resolves to no-go if any required criterion fails', () => {
    const checklist = createV1GoNoGoChecklistTemplate();
    checklist.areas[0].criteria[0].status = 'fail';

    const evaluated = evaluateV1GoNoGoChecklist(checklist);
    expect(evaluated.decision).toBe('no-go');
    expect(evaluated.failedRequiredCriteria).toContain('content-live-playback');
  });

  it('fails strict JSON validation when final decision is pass but a check failed', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-go-no-go-'));
    const invalidPath = path.join(tmpDir, 'pass-with-failed-check.json');
    const invalidArtifact = finalizeJsonTemplate();
    invalidArtifact.featureAreas[0].checks[0].status = 'fail';
    invalidArtifact.featureAreas[0].checks[0].evidence = 'evidence://failed-live';
    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidArtifact, null, 2)}\n`);

    const result = runJsonValidator([invalidPath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('decision.status cannot be pass while one or more checks are fail');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes strict JSON validation when final checks all pass with evidence', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-go-no-go-'));
    const finalPath = path.join(tmpDir, 'final-go.json');
    const finalArtifact = finalizeJsonTemplate();
    fs.writeFileSync(finalPath, `${JSON.stringify(finalArtifact, null, 2)}\n`);

    const result = runJsonValidator([finalPath, '--require-final'], repoRoot);
    expect(result.status).toBe(0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails strict JSON validation when final check evidence is missing', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-go-no-go-'));
    const invalidPath = path.join(tmpDir, 'missing-check-evidence.json');
    const invalidArtifact = finalizeJsonTemplate();
    invalidArtifact.featureAreas[0].checks[0].evidence = '';
    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidArtifact, null, 2)}\n`);

    const result = runJsonValidator([invalidPath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('evidence must be set with --require-final');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails validation when catch-up no-media pass omits the scanner artifact', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-go-no-go-'));
    const invalidPath = path.join(tmpDir, 'missing-no-media-scan.json');
    const invalidArtifact = finalizeJsonTemplate();
    const check = invalidArtifact.featureAreas
      .flatMap((area: { checks: Array<{ id: string; evidence: string }> }) => area.checks)
      .find((entry: { id: string }) => entry.id === 'catchup-no-transcode-remux');
    if (check) {
      check.evidence = 'output/playwright/manual-network-audit/REPORT.md';
    }
    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidArtifact, null, 2)}\n`);

    const result = runJsonValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('release:no-media-evidence:scan');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
