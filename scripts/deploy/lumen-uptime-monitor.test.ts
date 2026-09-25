import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const monitorScript = readFileSync(
  resolve(process.cwd(), 'scripts/deploy/lumen-uptime-monitor.sh'),
  'utf8',
);

const checkBlock = (name: string): string => {
  const start = monitorScript.indexOf(`check ${name} `);
  const end = monitorScript.indexOf('\n\n#', start);
  if (start < 0 || end < 0) {
    throw new Error(`Missing monitor check block: ${name}`);
  }
  return monitorScript.slice(start, end);
};

describe('Lumen uptime monitor browser probes', () => {
  it.each([
    ['sso', '400'],
    ['analytics', '401'],
  ])('sends the production player origin for the %s probe', (name, expectedStatus) => {
    const block = checkBlock(name);

    expect(block).toContain(`check ${name}`);
    expect(block).toContain(` ${expectedStatus} \\\n`);
    expect(block).toContain("-H 'Origin: https://player.exyu.tv'");
  });
});
