import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface MatrixCase {
  id: string;
  suite: 'smoke' | 'regression';
  tags: string[];
  releaseBlocker: boolean;
}

interface MatrixTemplate {
  requiredCoverageTags: string[];
  cases: MatrixCase[];
}

const loadTemplate = (): MatrixTemplate => {
  const templatePath = path.resolve(
    process.cwd(),
    'scripts/release/v1-smoke-regression-matrix.template.json',
  );

  return JSON.parse(fs.readFileSync(templatePath, 'utf8')) as MatrixTemplate;
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
});
