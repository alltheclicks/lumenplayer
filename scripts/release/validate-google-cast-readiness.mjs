#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const args = process.argv.slice(2);

const fail = (message) => {
  console.error(`[google-cast-readiness] ERROR: ${message}`);
  process.exit(2);
};

if (args.length > 0) {
  fail(`Unknown argument(s): ${args.join(', ')}`);
}

const files = {
  guide: 'docs/qa/google-cast-readiness-guide.md',
  envExample: 'apps/web/.env.example',
  sender: 'apps/web/src/hooks/useGoogleCastSender.ts',
  senderTest: 'apps/web/src/hooks/useGoogleCastSender.test.ts',
  receiver: 'apps/web/public/receiver.html',
};

const readText = (filePath) => {
  const absolutePath = path.resolve(repoRoot, filePath);
  if (!fs.existsSync(absolutePath)) {
    fail(`Missing file: ${filePath}`);
  }

  return fs.readFileSync(absolutePath, 'utf8');
};

const requireSnippets = (label, content, snippets) => {
  for (const snippet of snippets) {
    if (!content.includes(snippet)) {
      fail(`${label} must include: ${snippet}`);
    }
  }
};

const guide = readText(files.guide);
const envExample = readText(files.envExample);
const sender = readText(files.sender);
const senderTest = readText(files.senderTest);
const receiver = readText(files.receiver);

requireSnippets(files.guide, guide, [
  'public HTTPS app URL and receiver URL',
  'https://<staging-or-production-host>/receiver.html',
  'Google Cast SDK Developer Console',
  'Register a Custom Receiver application',
  'Register the Chromecast device used for testing',
  'VITE_GOOGLE_CAST_APP_ID=<app_id>',
  'Production builds must use `VITE_GOOGLE_CAST_APP_ID`',
  'default receiver id `CC1AD845` is allowed only as a development fallback',
  'standard sender `loadMedia` flow as the V1 default',
  'custom receiver bridge in `apps/web/public/receiver.html` remains future/custom behavior',
  'unsupportedAudioCodec: "mp2"',
  'Confirm MP2 live source is blocked or warned instead of marked as Cast-supported audio',
  'final Cast signoff still requires a registered custom receiver app id',
]);

requireSnippets(files.envExample, envExample, [
  'VITE_GOOGLE_CAST_APP_ID=',
  'Required outside dev when Cast is in scope',
]);

requireSnippets(files.sender, sender, [
  "const DEV_CAST_RECEIVER_APP_ID = 'CC1AD845';",
  'VITE_GOOGLE_CAST_APP_ID',
  'return env.DEV === true ? DEV_CAST_RECEIVER_APP_ID : null;',
  'resolveCastSourceUnsupportedReason',
  "metadata?.mode === 'live' && metadata.unsupportedAudioCodec === 'mp2'",
  'Google Cast custom receiver is not configured for this environment.',
  'const mediaInfo = new chromeMedia.MediaInfo(',
  'const loadRequest = new chromeMedia.LoadRequest(mediaInfo);',
  'castSession.loadMedia(loadRequest)',
  "name: 'cast.error'",
  "name: 'cast.session-state'",
]);

requireSnippets(files.senderTest, senderTest, [
  'uses the default Cast receiver only as a dev fallback',
  'prefers an explicit Google Cast app id in every environment',
  'blocks MP2 live sources from Cast without blocking normal live sources',
  "VITE_GOOGLE_CAST_APP_ID: ''",
  'DEV: false',
  'unsupportedAudioCodec: \'mp2\'',
]);

requireSnippets(files.receiver, receiver, [
  '<title>Cast Receiver</title>',
  'cast_receiver_framework.js',
  'cast-media-player',
  "var BRIDGE_NAMESPACE = 'urn:x-cast:com.lumenplayer.bridge';",
]);

console.log('[google-cast-readiness] OK');
console.log(`[google-cast-readiness] guide: ${files.guide}`);
console.log(`[google-cast-readiness] sender: ${files.sender}`);
