import { describe, expect, it } from 'vitest';
import {
  V1_GO_NO_GO_FEATURE_AREAS,
  createV1GoNoGoChecklistTemplate,
  evaluateV1GoNoGoChecklist,
} from './v1-go-no-go';

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
});
