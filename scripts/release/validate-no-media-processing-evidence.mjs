#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const inputPaths = process.argv.slice(2).filter((arg) => arg !== '--');

const usage = () => {
  console.error('Usage: node scripts/release/validate-no-media-processing-evidence.mjs <evidence-file-or-directory> [...]');
};

const fail = (message) => {
  console.error(`[no-media-processing-evidence] ERROR: ${message}`);
  process.exit(2);
};

if (inputPaths.length === 0) {
  usage();
  process.exit(1);
}

const textFilePattern = /\.(har|json|log|md|txt|csv|tsv)$/i;
const forbiddenPatterns = [
  ['__remux__', /__remux__/i],
  ['__lumenTransport=remux-hls', /__lumenTransport\s*=\s*remux-hls/i],
  ['proxy-remuxed', /proxy-remuxed/i],
  ['remux-hls', /remux-hls/i],
  ['remux', /\bremux(?:ed|es|ing)?\b/i],
  ['ffmpeg', /\bffmpeg\b/i],
  ['ffprobe', /\bffprobe\b/i],
  ['transcode', /\btranscod(?:e|ed|es|ing)\b/i],
  ['server-side remux', /\bserver[-\s]?side\b[^\n\r]{0,80}\bremux(?:ed|es|ing)?\b/i],
  ['generated HLS', /\bgenerated[-\s]?hls\b|\bgenerated\s+HLS\b/i],
  ['XUI-side media processing', /\bxui[-\s]?side\b[^\n\r]{0,80}\b(?:media\s+processing|transcod(?:e|ed|es|ing)|remux(?:ed|es|ing)?)\b/i],
];

const isTextFile = (filePath) => textFilePattern.test(filePath);

const collectFiles = (inputPath) => {
  const absolutePath = path.resolve(repoRoot, inputPath);
  if (!fs.existsSync(absolutePath)) {
    fail(`evidence path does not exist: ${inputPath}`);
  }

  const stat = fs.statSync(absolutePath);
  if (stat.isDirectory()) {
    return fs.readdirSync(absolutePath, { withFileTypes: true })
      .flatMap((entry) => collectFiles(path.join(inputPath, entry.name)));
  }

  if (!stat.isFile()) {
    return [];
  }

  return isTextFile(absolutePath) ? [path.relative(repoRoot, absolutePath)] : [];
};

const files = [...new Set(inputPaths.flatMap(collectFiles))].sort();
if (files.length === 0) {
  fail('no text evidence files selected.');
}

const findings = [];
for (const filePath of files) {
  const absolutePath = path.resolve(repoRoot, filePath);
  const content = fs.readFileSync(absolutePath, 'utf8');
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    for (const [label, pattern] of forbiddenPatterns) {
      if (pattern.test(line)) {
        findings.push(`${filePath}:${index + 1}: forbidden media-processing evidence: ${label}`);
      }
    }
  });
}

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(`[no-media-processing-evidence] ${finding}`);
  }
  fail(`${findings.length} forbidden media-processing evidence hit(s) found.`);
}

console.log(`[no-media-processing-evidence] OK: ${files.length} file(s) scanned`);
