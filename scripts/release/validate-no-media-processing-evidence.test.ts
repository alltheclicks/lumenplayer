import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const runValidator = (args: string[], cwd = process.cwd()) => (
  spawnSync(process.execPath, ['scripts/release/validate-no-media-processing-evidence.mjs', ...args], {
    cwd,
    encoding: 'utf8',
  })
);

const writeFixture = (tmpDir: string, name: string, content: string) => {
  const filePath = path.join(tmpDir, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
};

describe('no media-processing evidence scanner', () => {
  it('passes clean network evidence', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-no-media-evidence-'));
    const filePath = writeFixture(
      tmpDir,
      'network.json',
      JSON.stringify({
        requests: [
          { url: 'https://edge.example/live/<redacted>/<redacted>/112.m3u8' },
          { url: 'https://edge.example/streaming/timeshift.php?token=<redacted>&seg=1.ts' },
        ],
        disallowedHits: [],
      }, null, 2),
    );

    const result = runValidator([filePath]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('OK: 1 file');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('accepts pnpm argument separator before evidence paths', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-no-media-evidence-'));
    const filePath = writeFixture(
      tmpDir,
      'network.json',
      '{"requests":[{"url":"https://edge.example/archive/112.ts"}]}\n',
    );

    const result = runValidator(['--', filePath]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('OK: 1 file');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails on remux/transcode transport evidence', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-no-media-evidence-'));
    const filePath = writeFixture(
      tmpDir,
      'leaky.har',
      JSON.stringify({
        log: {
          entries: [
            { request: { url: 'http://localhost/xui-api/provider/timeshift.ts?__lumenTransport=remux-hls' } },
            { response: { content: { text: 'transportMode=proxy-remuxed' } } },
            { response: { content: { text: 'archive fallback attempted a remux' } } },
          ],
        },
      }, null, 2),
    );

    const result = runValidator([filePath]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('__lumenTransport=remux-hls');
    expect(result.stderr).toContain('proxy-remuxed');
    expect(result.stderr).toContain('remux');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails on process or provider-side media-processing evidence', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-no-media-evidence-'));
    const filePath = writeFixture(
      tmpDir,
      'process.log',
      [
        '123 ffmpeg -i provider.ts out.m3u8',
        'owner says XUI-side transcode is enabled for broken archive',
        'generated HLS fallback created',
      ].join('\n'),
    );

    const result = runValidator([filePath]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('ffmpeg');
    expect(result.stderr).toContain('XUI-side media processing');
    expect(result.stderr).toContain('generated HLS');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('recursively scans directories and ignores binary screenshots', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-no-media-evidence-'));
    writeFixture(tmpDir, 'nested/evidence.json', '{"url":"https://edge.example/live/ok.m3u8"}\n');
    writeFixture(tmpDir, 'nested/screenshot.png', 'ffmpeg text inside ignored binary fixture\n');

    const result = runValidator([tmpDir]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('OK: 1 file');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('requires at least one evidence path', () => {
    const result = runValidator([]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Usage:');
  });
});
