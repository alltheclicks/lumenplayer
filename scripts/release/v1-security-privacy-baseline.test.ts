import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

interface StorageKeyEntry {
  key: string;
}

interface SecurityBaseline {
  clientStorage: {
    allowedKeys: StorageKeyEntry[];
  };
  controls: Array<{
    id: string;
    status: 'pending' | 'pass' | 'fail';
  }>;
  incidentReadiness: {
    runbookRef: string;
    owner: string;
    responseChannel: string;
  };
  signoff: {
    status: 'pending' | 'pass' | 'fail';
    approvedBy: string;
    approvedAt: string;
  };
}

const runValidator = (args: string[], cwd: string) => (
  spawnSync(process.execPath, ['scripts/release/validate-security-privacy-baseline.mjs', ...args], {
    cwd,
    encoding: 'utf8',
  })
);

const loadTemplate = (): SecurityBaseline => {
  const templatePath = path.resolve(
    process.cwd(),
    'scripts/release/v1-security-privacy-baseline.template.json',
  );

  return JSON.parse(fs.readFileSync(templatePath, 'utf8')) as SecurityBaseline;
};

describe('V1 security/privacy baseline template', () => {
  it('contains all required client-storage key entries', () => {
    const template = loadTemplate();
    const keys = new Set(template.clientStorage.allowedKeys.map((entry) => entry.key));

    const required = [
      'xtream_credentials',
      'app_settings',
      'theme_preference',
      'watch-history',
      'push_subscriptions_v1',
      'push_device_id',
      'xmltv_epg_cache',
    ];

    for (const key of required) {
      expect(keys.has(key), `missing storage key ${key}`).toBe(true);
    }
  });

  it('passes validator in template mode and strict final mode when completed', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-0345-security-'));
    const finalPath = path.join(tmpDir, 'final.json');

    const templateResult = runValidator([
      'scripts/release/v1-security-privacy-baseline.template.json',
    ], repoRoot);
    expect(templateResult.status).toBe(0);

    const finalBaseline = loadTemplate();
    finalBaseline.controls = finalBaseline.controls.map((control) => ({
      ...control,
      status: 'pass',
    }));
    finalBaseline.incidentReadiness.runbookRef = 'ops/security/runbook-v1';
    finalBaseline.incidentReadiness.owner = 'security-oncall';
    finalBaseline.incidentReadiness.responseChannel = '#incident-security';
    finalBaseline.signoff.status = 'pass';
    finalBaseline.signoff.approvedBy = 'release-manager';
    finalBaseline.signoff.approvedAt = '2026-02-16T14:00:00.000Z';

    fs.writeFileSync(finalPath, `${JSON.stringify(finalBaseline, null, 2)}\n`);

    const finalResult = runValidator([finalPath, '--require-final'], repoRoot);
    expect(finalResult.status).toBe(0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails strict final validation when incident metadata is missing', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-0345-security-'));
    const invalidPath = path.join(tmpDir, 'invalid.json');

    const invalidBaseline = loadTemplate();
    invalidBaseline.controls = invalidBaseline.controls.map((control) => ({
      ...control,
      status: 'pass',
    }));
    invalidBaseline.incidentReadiness.runbookRef = '';
    invalidBaseline.incidentReadiness.owner = '';
    invalidBaseline.incidentReadiness.responseChannel = '';
    invalidBaseline.signoff.status = 'pass';
    invalidBaseline.signoff.approvedBy = 'release-manager';
    invalidBaseline.signoff.approvedAt = '2026-02-16T14:00:00.000Z';

    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidBaseline, null, 2)}\n`);

    const result = runValidator([invalidPath, '--require-final'], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('incidentReadiness.runbookRef must be set with --require-final');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails template validation when prohibitedPatterns are missing', () => {
    const repoRoot = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-0345-security-'));
    const invalidPath = path.join(tmpDir, 'invalid-template.json');

    const invalidBaseline = loadTemplate() as SecurityBaseline & {
      clientStorage: SecurityBaseline['clientStorage'] & {
        prohibitedPatterns?: string[];
      };
    };
    invalidBaseline.clientStorage.prohibitedPatterns = [];

    fs.writeFileSync(invalidPath, `${JSON.stringify(invalidBaseline, null, 2)}\n`);

    const result = runValidator([invalidPath], repoRoot);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('clientStorage.prohibitedPatterns must be a non-empty array');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
