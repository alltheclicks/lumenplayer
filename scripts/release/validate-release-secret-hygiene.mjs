#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const usage = () => {
  console.error('Usage: node scripts/release/validate-release-secret-hygiene.mjs [file-or-directory ...]');
};

const repoRoot = process.cwd();
const args = process.argv.slice(2);

const fail = (message) => {
  console.error(`[release-secret-hygiene] ERROR: ${message}`);
  process.exit(2);
};

const isAllowedRedaction = (value) => {
  const normalized = decodeURIComponent(value).trim();
  return (
    normalized === '...' ||
    normalized === '<redacted>' ||
    normalized === '<token>' ||
    normalized === '<username>' ||
    normalized === '<password>' ||
    normalized === 'redacted' ||
    normalized === 'REDACTED' ||
    /^\*+$/.test(normalized) ||
    /^x+$/i.test(normalized)
  );
};

const isTextFile = (filePath) => (
  /\.(json|md|mjs|ts|js|tsx|jsx|yml|yaml|txt)$/.test(filePath) ||
  path.basename(filePath) === 'package.json'
);

const listTrackedDefaultFiles = () => {
  const result = spawnSync('git', ['ls-files', '-z'], {
    cwd: repoRoot,
    encoding: 'buffer',
  });

  if (result.status !== 0) {
    fail('Unable to list tracked files with git ls-files.');
  }

  return result.stdout
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .filter((filePath) => (
      filePath.startsWith('artifacts/release/') ||
      filePath.startsWith('docs/release/') ||
      /^scripts\/release\/v1-.*\.template\.json$/.test(filePath) ||
      filePath === 'docs/V3-QA-FIX-BACKLOG.md' ||
      filePath === 'package.json'
    ));
};

const collectFiles = (inputPaths) => {
  const files = [];
  for (const inputPath of inputPaths) {
    const absolutePath = path.resolve(repoRoot, inputPath);
    if (!fs.existsSync(absolutePath)) {
      fail(`scan target does not exist: ${inputPath}`);
    }

    const stat = fs.statSync(absolutePath);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(absolutePath, { withFileTypes: true });
      for (const entry of entries) {
        files.push(...collectFiles([path.join(inputPath, entry.name)]));
      }
      continue;
    }

    if (stat.isFile() && isTextFile(absolutePath)) {
      files.push(path.relative(repoRoot, absolutePath));
    }
  }

  return files;
};

const scanFiles = args.length > 0 ? collectFiles(args) : listTrackedDefaultFiles();
if (scanFiles.length === 0) {
  fail('no files selected for secret hygiene scan.');
}

const findings = [];
const querySecretPattern = /[?&](username|user|password|pass|token|api_key|apikey|secret)=([^&#\s`"')]+)/gi;
const jsonSecretPattern = /"(username|password|token|secret|apiKey|api_key|apikey)"\s*:\s*"([^"]+)"/gi;
const envSecretPattern = /\b([A-Z0-9_]*(?:USERNAME|PASSWORD|TOKEN|SECRET|API_KEY|APIKEY)[A-Z0-9_]*)\s*=\s*([^\s"'`]+)/g;
const basicAuthUrlPattern = /\bhttps?:\/\/[^/\s:@]+:[^@\s/]+@/gi;

for (const filePath of scanFiles) {
  const absolutePath = path.resolve(repoRoot, filePath);
  const content = fs.readFileSync(absolutePath, 'utf8');

  for (const match of content.matchAll(querySecretPattern)) {
    const value = match[2];
    if (!isAllowedRedaction(value)) {
      findings.push(`${filePath}: query parameter ${match[1]} contains a non-redacted value`);
    }
  }

  for (const match of content.matchAll(jsonSecretPattern)) {
    const value = match[2];
    if (value.trim() !== '' && !isAllowedRedaction(value)) {
      findings.push(`${filePath}: JSON field ${match[1]} contains a non-redacted value`);
    }
  }

  for (const match of content.matchAll(envSecretPattern)) {
    const value = match[2];
    if (value.trim() !== '' && !isAllowedRedaction(value)) {
      findings.push(`${filePath}: env assignment ${match[1]} contains a non-redacted value`);
    }
  }

  if (basicAuthUrlPattern.test(content)) {
    findings.push(`${filePath}: URL contains basic-auth credentials`);
  }
}

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(`[release-secret-hygiene] ${finding}`);
  }
  fail(`${findings.length} potential secret exposure(s) found.`);
}

console.log(`[release-secret-hygiene] OK: ${scanFiles.length} file(s) scanned`);
