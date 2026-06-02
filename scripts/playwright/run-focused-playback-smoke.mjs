import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
import {
  findUnknownScenarioIds,
  parseBrowserChannel,
  parseCpuGuardConfig,
  parseHeadless,
  parseIdSet,
  parseSelectedScenarioIds,
  parseViewport,
  resolveCpuLoadDecision,
  resolveXtreamAuthPreflightDecision,
  sumCpuPercentFromPs,
} from './focusedPlaybackSmokeConfig.mjs';

const root = process.cwd();
const outDir = resolve(root, 'output/playwright/focused-playback-smoke');
const defaultStorageStatePath = resolve(root, 'output/playwright/qa-user-sim/storage-state.json');
const storageStatePath = resolve(process.env.E2E_STORAGE_STATE ?? defaultStorageStatePath);
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:8080';
const reportJsonPath = resolve(outDir, 'report.json');
const reportMdPath = resolve(outDir, 'REPORT.md');
const selectedScenarioIds = parseSelectedScenarioIds(process.env.E2E_FOCUSED_PLAYBACK_SCENARIOS);
const selectedScenarioIdSet = new Set(selectedScenarioIds);
const selectedPlayableCatchUpCandidateIds = parseIdSet(process.env.E2E_PLAYABLE_CATCHUP_CANDIDATES);
const viewport = parseViewport(process.env.E2E_PLAYBACK_VIEWPORT);
const headless = parseHeadless(process.env.E2E_HEADLESS);
const browserChannel = parseBrowserChannel(process.env.E2E_BROWSER_CHANNEL);
const cpuGuard = parseCpuGuardConfig(process.env);
const liveSoakChannelMs = Math.max(
  5_000,
  Number(process.env.E2E_LIVE_SOAK_CHANNEL_MS) || 15_000
);
const liveSoakTransientRecoveryMs = Math.max(
  2_000,
  Number(process.env.E2E_LIVE_SOAK_TRANSIENT_RECOVERY_MS) || 12_000
);
const catchUpCatalogChannelIds = parseIdSet(process.env.E2E_CATCHUP_CATALOG_IDS);
const catchUpCatalogStartIndex = Math.max(
  0,
  Number.parseInt(process.env.E2E_CATCHUP_CATALOG_START_INDEX ?? '0', 10) || 0
);
const catchUpCatalogLimit = Math.max(
  0,
  Number.parseInt(process.env.E2E_CATCHUP_CATALOG_LIMIT ?? '0', 10) || 0
);
const catchUpCatalogPreSeekMs = Math.max(
  3_000,
  Number(process.env.E2E_CATCHUP_CATALOG_PRE_SEEK_MS) || 3_000
);
const catchUpCatalogStabilityMs = Math.max(
  5_000,
  Number(process.env.E2E_CATCHUP_CATALOG_STABILITY_MS) || 70_000
);
const catchUpCatalogSeekFraction = Math.max(
  0.1,
  Math.min(0.9, Number(process.env.E2E_CATCHUP_CATALOG_SEEK_FRACTION) || 0.45)
);
const catchUpCatalogNoProgressTimeoutMs = Math.max(
  6_000,
  Number(process.env.E2E_CATCHUP_CATALOG_NO_PROGRESS_TIMEOUT_MS) || 12_000
);
let lastCpuGuardCheckAt = 0;

mkdirSync(outDir, { recursive: true });

const loadStoredCredentials = () => {
  if (!existsSync(storageStatePath)) {
    throw new Error(
      `Missing Playwright storage state: ${storageStatePath}. Run e2e:qa:simulate or set E2E_STORAGE_STATE.`
    );
  }

  const state = JSON.parse(readFileSync(storageStatePath, 'utf-8'));
  const item = (state.origins ?? [])
    .flatMap((origin) => origin.localStorage ?? [])
    .find((entry) => entry.name === 'lumen-web:v1:xtream_credentials');
  if (!item?.value) {
    throw new Error(`Missing Xtream credentials in storage state: ${storageStatePath}`);
  }

  return JSON.parse(item.value);
};

const credentials = loadStoredCredentials();
const secrets = [credentials.username, credentials.password]
  .filter((value) => typeof value === 'string' && value.length > 0);

const redact = (value) => {
  if (typeof value === 'string') {
    let redacted = value;
    for (const secret of secrets) {
      redacted = redacted.split(secret).join('<redacted>');
    }
    redacted = redacted.replace(/(\/live\/)[^/\s]+\/[^/\s]+\//g, '$1<redacted>/<redacted>/');
    redacted = redacted.replace(/(\/timeshift_hls\/)[^/\s]+\/[^/\s]+\//g, '$1<redacted>/<redacted>/');
    redacted = redacted.replace(/(\/timeshift\/)[^/\s]+\/[^/\s]+\//g, '$1<redacted>/<redacted>/');
    redacted = redacted.replace(/(username=)[^&\s]+/g, '$1<redacted>');
    redacted = redacted.replace(/(password=)[^&\s]+/g, '$1<redacted>');
    redacted = redacted.replace(/token=[A-Za-z0-9+/%=_-]+/g, 'token=<redacted>');
    return redacted;
  }

  if (Array.isArray(value)) {
    return value.map(redact);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, redact(entryValue)])
    );
  }

  return value;
};

const sleep = (ms) => new Promise((resolveSleep) => {
  setTimeout(resolveSleep, ms);
});

const validateXtreamAuthPreflight = async () => {
  const url = new URL(`${credentials.server}/player_api.php`);
  url.searchParams.set('username', credentials.username);
  url.searchParams.set('password', credentials.password);

  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    throw new Error(
      `Focused playback smoke preflight failed: unable to reach Xtream auth endpoint (${redact(error.message)}).`
    );
  }

  if (!response.ok) {
    throw new Error(`Focused playback smoke preflight failed: Xtream auth endpoint HTTP ${response.status}.`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Focused playback smoke preflight failed: Xtream auth endpoint returned invalid JSON.');
  }

  const decision = resolveXtreamAuthPreflightDecision(payload);
  if (!decision.ok) {
    throw new Error(
      `Focused playback smoke preflight failed: Xtream credentials were rejected by the provider (${decision.reason}).`
    );
  }
};

class CpuGuardBlockedError extends Error {
  constructor({ phase, currentTotalPercent, maxTotalPercent }) {
    super(
      `CPU guard blocked focused playback smoke during ${phase}: ` +
      `total CPU ${currentTotalPercent.toFixed(1)}% is above ${maxTotalPercent}%. ` +
      'Close other desktop/browser work or set E2E_CPU_GUARD=false to override.'
    );
    this.name = 'CpuGuardBlockedError';
    this.phase = phase;
    this.currentTotalPercent = currentTotalPercent;
    this.maxTotalPercent = maxTotalPercent;
  }
}

const readCurrentCpuTotalPercent = () => {
  try {
    return sumCpuPercentFromPs(execFileSync('ps', ['-Ao', 'pcpu'], {
      encoding: 'utf-8',
    }));
  } catch {
    return null;
  }
};

const assertCpuLoadAllowsBrowserSmoke = (phase, options = {}) => {
  if (!cpuGuard.enabled) {
    return;
  }

  const now = Date.now();
  if (!options.force && now - lastCpuGuardCheckAt < cpuGuard.pollMs) {
    return;
  }
  lastCpuGuardCheckAt = now;

  const currentTotalPercent = readCurrentCpuTotalPercent();
  const decision = resolveCpuLoadDecision({
    enabled: cpuGuard.enabled,
    currentTotalPercent,
    maxTotalPercent: cpuGuard.maxTotalPercent,
  });

  if (!decision.ok) {
    throw new CpuGuardBlockedError({
      phase,
      currentTotalPercent,
      maxTotalPercent: cpuGuard.maxTotalPercent,
    });
  }
};

const isServerReachable = async () => {
  try {
    const response = await fetch(baseURL, { signal: AbortSignal.timeout(1_500) });
    return response.ok;
  } catch {
    return false;
  }
};

const ensureDevServer = async () => {
  if (await isServerReachable()) {
    return async () => {};
  }

  const url = new URL(baseURL);
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  const server = spawn(
    'pnpm',
    ['--filter', '@lumen/web', 'dev', '--host', url.hostname, '--port', port],
    {
      cwd: root,
      env: {
        ...process.env,
        VITE_XTREAM_SERVER: process.env.VITE_XTREAM_SERVER ?? credentials.server,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  const serverLogPath = resolve(outDir, 'dev-server.log');
  const serverLogs = [];
  const appendLog = (chunk) => {
    serverLogs.push(redact(chunk.toString()));
    writeFileSync(serverLogPath, serverLogs.join(''), 'utf-8');
  };
  server.stdout.on('data', appendLog);
  server.stderr.on('data', appendLog);

  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await isServerReachable()) {
      return async () => {
        server.kill('SIGTERM');
      };
    }
    await sleep(500);
  }

  server.kill('SIGTERM');
  throw new Error(`Timed out waiting for dev server at ${baseURL}`);
};

const attachObservability = (page, events) => {
  page.on('console', async (message) => {
    if (!message.text().includes('[lumen-observe]')) {
      return;
    }

    const values = [];
    for (const arg of message.args()) {
      try {
        values.push(redact(await arg.jsonValue()));
      } catch {
        values.push(redact(arg.toString()));
      }
    }
    events.push({
      type: message.type(),
      text: redact(message.text()),
      values,
    });
  });
};

const mediaSnapshot = async (page) => page.evaluate(() => {
  const video = document.querySelector('video');
  const text = document.body.innerText;
  const sessionState = (() => {
    try {
      return JSON.parse(window.localStorage.getItem('lumen:session-core:state') ?? 'null');
    } catch {
      return null;
    }
  })();
  const sourceMetadata = sessionState?.source?.metadata ?? {};

  return {
    sessionMode: sourceMetadata.mode ?? null,
    sessionTitle: sessionState?.source?.title ?? null,
    sessionPositionMs: typeof sessionState?.positionMs === 'number' ? sessionState.positionMs : null,
    catchUpDurationSeconds: typeof sourceMetadata.durationSeconds === 'number'
      ? sourceMetadata.durationSeconds
      : null,
    hasFrame: Boolean(video && video.readyState >= 2 && video.videoWidth > 0),
    readyState: video ? video.readyState : null,
    networkState: video ? video.networkState : null,
    paused: video ? video.paused : null,
    currentTime: video ? video.currentTime : null,
    videoWidth: video ? video.videoWidth : null,
    videoHeight: video ? video.videoHeight : null,
    videoErrorCode: video?.error?.code ?? null,
    providerIssueReasonCode: typeof sourceMetadata.catchUpWebProviderIssue?.reasonCode === 'string'
      ? sourceMetadata.catchUpWebProviderIssue.reasonCode
      : null,
    providerIssueSummary: typeof sourceMetadata.catchUpWebProviderIssue?.summary === 'string'
      ? sourceMetadata.catchUpWebProviderIssue.summary
      : null,
    providerIssueEvidence: typeof sourceMetadata.catchUpWebProviderIssue?.evidence === 'string'
      ? sourceMetadata.catchUpWebProviderIssue.evidence
      : null,
    unavailableReasonCode: typeof sourceMetadata.catchUpUnavailable?.reasonCode === 'string'
      ? sourceMetadata.catchUpUnavailable.reasonCode
      : null,
    catchUpOverlay: (
      text.includes('Snimak za TV unazad trenutno nije dostupan') ||
      text.includes('TV unazad trenutno nije dostupna')
    ),
    liveFailureOverlay: text.includes('Live kanal trenutno nije dostupan'),
    switchLiveAction: text.includes('Gledaj kanal uživo') || /Gledaj .* uživo/.test(text),
    reportAction: text.includes('Prijavi problem'),
    reportToast: text.includes('Problem prijavljen'),
    credentialLeakInText: /\/live\/[^/\s]+\/[^/\s]+\//.test(text) ||
      /username=[^&\s]+/.test(text) ||
      /password=[^&\s]+/.test(text),
  };
});

const waitForOutcome = async (page, predicate, timeoutMs) => {
  const startedAt = Date.now();
  let lastSnapshot = null;

  while (Date.now() - startedAt < timeoutMs) {
    assertCpuLoadAllowsBrowserSmoke('waiting for playback outcome');
    lastSnapshot = await mediaSnapshot(page);
    if (predicate(lastSnapshot)) {
      return { ...lastSnapshot, timeout: false, ms: Date.now() - startedAt };
    }
    await sleep(500);
  }

  lastSnapshot = await mediaSnapshot(page);
  return { ...lastSnapshot, timeout: true, ms: Date.now() - startedAt };
};

const clickChannel = async (page, pattern) => {
  const buttons = page.locator('[data-testid="channel-select"]');
  await buttons.first().waitFor({ state: 'visible', timeout: 30_000 });
  const count = await buttons.count();

  for (let index = 0; index < count; index += 1) {
    const name = (await buttons.nth(index).innerText().catch(() => '')).trim();
    if (pattern.test(name)) {
      await buttons.nth(index).click();
      return name;
    }
  }

  throw new Error(`Channel not found for pattern ${pattern.toString()}`);
};

const normalizeVisibleText = (value) => value.replace(/\s+/g, ' ').trim();

const normalizeChannelCandidateText = (value) => (
  normalizeVisibleText(value)
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .trim()
);

const candidateMatchesChannelName = (candidateText, channelName) => {
  if (candidateText === channelName) {
    return true;
  }

  if (!candidateText.startsWith(channelName)) {
    return false;
  }

  const nextCharacter = candidateText.charAt(channelName.length);
  if (!nextCharacter) {
    return true;
  }

  return /\s|[-(:]/.test(nextCharacter);
};

const selectChannelBySearch = async (page, channel) => {
  const searchInput = page.locator('input[placeholder="Pretraži kanale..."]:visible').first();
  await searchInput.waitFor({ state: 'visible', timeout: 30_000 });
  await searchInput.fill(channel.name);
  await sleep(350);

  const buttons = page.locator('[data-testid="channel-select"]:visible');
  await buttons.first().waitFor({ state: 'visible', timeout: 20_000 });
  const count = await buttons.count();
  const candidates = [];

  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    const rawText = await button.innerText().catch(() => '');
    const text = normalizeVisibleText(rawText);
    candidates.push(text);
    const firstLine = normalizeChannelCandidateText(rawText.split('\n')[0] ?? rawText);
    const candidateText = normalizeChannelCandidateText(rawText);
    if (
      candidateMatchesChannelName(firstLine, channel.name) ||
      candidateMatchesChannelName(candidateText, channel.name)
    ) {
      await button.click();
      return {
        ok: true,
        selectedText: text,
      };
    }
  }

  throw new Error(
    `Channel not found after search: ${channel.name} (${channel.streamId}). ` +
    `Visible candidates: ${JSON.stringify(candidates.slice(0, 8))}`
  );
};

const fetchXtreamLiveStreams = async () => {
  const url = new URL(`${credentials.server}/player_api.php`);
  url.searchParams.set('username', credentials.username);
  url.searchParams.set('password', credentials.password);
  url.searchParams.set('action', 'get_live_streams');

  const response = await fetch(url, { signal: AbortSignal.timeout(45_000) });
  if (!response.ok) {
    throw new Error(`Failed to fetch live streams for catch-up catalog: HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error('Failed to fetch live streams for catch-up catalog: unexpected payload');
  }

  return payload;
};

const getCatchUpCatalogChannels = async () => {
  const streams = await fetchXtreamLiveStreams();
  const channels = streams
    .filter((stream) => (
      Number(stream.tv_archive) === 1 &&
      Number(stream.tv_archive_duration) > 0 &&
      Number.isFinite(Number(stream.stream_id))
    ))
    .map((stream) => ({
      number: Number(stream.num) || 0,
      streamId: Number(stream.stream_id),
      name: String(stream.name ?? '').trim(),
      archiveDays: Number(stream.tv_archive_duration) || 0,
      epgChannelId: typeof stream.epg_channel_id === 'string'
        ? stream.epg_channel_id
        : null,
    }))
    .filter((channel) => channel.name.length > 0)
    .filter((channel) => (
      catchUpCatalogChannelIds.size === 0 ||
      catchUpCatalogChannelIds.has(String(channel.streamId)) ||
      catchUpCatalogChannelIds.has(channel.name)
    ))
    .sort((a, b) => (a.number || a.streamId) - (b.number || b.streamId));

  const windowed = channels.slice(catchUpCatalogStartIndex);
  return catchUpCatalogLimit > 0
    ? windowed.slice(0, catchUpCatalogLimit)
    : windowed;
};

const startTimeshiftFromLiveBar = async (page, fraction = 0.25) => {
  await revealPlayerSurface(page);
  const control = page.locator('[aria-label="Pokreni TV unazad sa ove pozicije"]').first();
  await control.waitFor({ state: 'visible', timeout: 15_000 });
  const box = await control.boundingBox();
  if (!box || box.width <= 0 || box.height <= 0) {
    await control.focus();
    await page.keyboard.press('Enter');
    return;
  }

  await page.mouse.click(
    box.x + (box.width * Math.max(0, Math.min(1, fraction))),
    box.y + (box.height / 2)
  );
};

const revealPlayerSurface = async (page) => {
  const videoBox = await page.locator('video').first().boundingBox().catch(() => null);
  if (!videoBox || videoBox.width <= 0 || videoBox.height <= 0) {
    return;
  }

  await page.mouse.move(
    videoBox.x + (videoBox.width / 2),
    videoBox.y + (videoBox.height / 2)
  );
};

const ensureCatchUpArchivePanelOpen = async (page) => {
  const programs = page.locator('[data-testid="catchup-program"]:visible');
  if (await programs.first().isVisible().catch(() => false)) {
    return;
  }

  await revealPlayerSurface(page);
  const openArchiveButton = page.locator('[aria-label="Otvori TV unazad"]:visible').first();
  if (await openArchiveButton.isVisible().catch(() => false)) {
    await openArchiveButton.click();
  }
};

const clickFirstCatchUpProgram = async (page, timeoutMs) => {
  const programs = page.locator('[data-testid="catchup-program"]:visible');
  await ensureCatchUpArchivePanelOpen(page);
  await programs.first().waitFor({ state: 'visible', timeout: timeoutMs });
  const count = await programs.count();
  const now = Date.now();
  const candidates = [];

  for (let index = 0; index < count; index += 1) {
    const program = programs.nth(index);
    const metadata = await program.evaluate((element, currentTimeMs) => {
      const startMs = Number(element.getAttribute('data-catchup-start-ms'));
      const endMs = Number(element.getAttribute('data-catchup-end-ms'));
      const durationMs = endMs - startMs;
      const endedAgoMs = currentTimeMs - endMs;

      return {
        startMs,
        endMs,
        durationMs,
        endedAgoMs,
        title: element.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      };
    }, now).catch(() => null);

    candidates.push({
      index,
      program,
      metadata,
      stable: Boolean(
        metadata &&
        Number.isFinite(metadata.durationMs) &&
        Number.isFinite(metadata.endedAgoMs) &&
        metadata.durationMs >= 20 * 60_000 &&
        metadata.endedAgoMs >= 20 * 60_000
      ),
    });
  }

  const candidate = candidates.find((entry) => entry.stable) ?? candidates[0];
  if (!candidate) {
    throw new Error('No visible catch-up programs found.');
  }

  await candidate.program.scrollIntoViewIfNeeded().catch(() => undefined);
  await candidate.program.click();
  return candidate.metadata;
};

const startCatchUpFromArchivePanel = async (page) => {
  return clickFirstCatchUpProgram(page, 30_000);
};

const revealPlaybackControls = async (page, clickToToggle = false) => {
  const videoBox = await page.locator('video').first().boundingBox().catch(() => null);
  if (!videoBox || videoBox.width <= 0 || videoBox.height <= 0) {
    return;
  }

  const x = videoBox.x + (videoBox.width / 2);
  const y = videoBox.y + (videoBox.height / 2);
  await page.mouse.move(x, y);
  if (clickToToggle) {
    await page.mouse.click(x, y);
  }
  await sleep(250);
};

const clickCatchUpControl = async (page, testId) => {
  const clickableCandidates = [];

  const clickVisibleControl = async () => {
    const controls = page.locator(`[data-testid="${testId}"]:visible`);
    await controls.first().waitFor({ state: 'visible', timeout: 5_000 });
    const count = await controls.count();

    for (let index = 0; index < count; index += 1) {
      const control = controls.nth(index);
      const candidate = await control.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const clientX = rect.left + (rect.width / 2);
        const clientY = rect.top + (rect.height / 2);
        const topElement = document.elementFromPoint(clientX, clientY);
        let node = element;
        let pointerAllowed = true;
        let rendered = rect.width > 0 && rect.height > 0;

        while (node instanceof Element) {
          const style = window.getComputedStyle(node);
          if (
            style.pointerEvents === 'none' ||
            style.visibility === 'hidden' ||
            style.display === 'none' ||
            Number(style.opacity) === 0
          ) {
            pointerAllowed = false;
          }
          node = node.parentElement;
        }

        if (clientX < 0 || clientY < 0 || clientX > window.innerWidth || clientY > window.innerHeight) {
          rendered = false;
        }

        return {
          box: {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
          },
          clickPoint: {
            x: clientX,
            y: clientY,
          },
          pointerAllowed,
          rendered,
          receivesPointer: topElement === element || element.contains(topElement),
          topElementTag: topElement?.tagName ?? null,
          topElementTestId: topElement?.getAttribute?.('data-testid') ?? null,
        };
      });
      clickableCandidates.push({
        index,
        box: candidate.box,
        pointerAllowed: candidate.pointerAllowed,
        rendered: candidate.rendered,
        receivesPointer: candidate.receivesPointer,
        topElementTag: candidate.topElementTag,
        topElementTestId: candidate.topElementTestId,
      });
      if (
        !candidate.rendered ||
        !candidate.pointerAllowed ||
        candidate.box.width <= 0 ||
        candidate.box.height <= 0
      ) {
        continue;
      }

      const receivesPointer = await control.click({
        trial: true,
        timeout: 1_000,
      }).then(() => true).catch(() => false);
      if (receivesPointer) {
        await control.click({ timeout: 5_000 });
        return true;
      }

      if (candidate.receivesPointer) {
        await page.mouse.click(candidate.clickPoint.x, candidate.clickPoint.y);
        return true;
      }
    }

    return false;
  };

  await revealPlaybackControls(page, false);
  if (await clickVisibleControl().catch(() => false)) {
    return;
  }

  await revealPlaybackControls(page, true);
  if (await clickVisibleControl().catch(() => false)) {
    return;
  }

  await sleep(1_100);
  await revealPlaybackControls(page, false);
  if (await clickVisibleControl().catch(() => false)) {
    return;
  }

  throw new Error(`Visible catch-up control is not clickable: ${testId}. ${JSON.stringify(clickableCandidates.slice(-4))}`);
};

const exerciseMediaControls = async (page) => page.evaluate(async () => {
  const video = document.querySelector('video');
  if (!video) {
    return { ok: false, reason: 'no_video' };
  }

  const before = video.currentTime;
  video.pause();
  await new Promise((resolveWait) => {
    setTimeout(resolveWait, 300);
  });
  const paused = video.paused;

  await video.play().catch(() => undefined);
  await new Promise((resolveWait) => {
    setTimeout(resolveWait, 600);
  });
  const resumed = !video.paused;

  video.currentTime = before + 10;
  await new Promise((resolveWait) => {
    setTimeout(resolveWait, 600);
  });
  const seekForward = video.currentTime >= before + 5;

  video.currentTime = Math.max(0, video.currentTime - 10);
  await new Promise((resolveWait) => {
    setTimeout(resolveWait, 600);
  });
  const stillFrame = video.readyState >= 2 && video.videoWidth > 0;

  return {
    ok: paused && resumed && seekForward && stillFrame,
    paused,
    resumed,
    seekForward,
    stillFrame,
    before,
    after: video.currentTime,
  };
});

const clickCatchUpTimelineAtFraction = async (page, fraction) => {
  const clampedFraction = Math.max(0, Math.min(1, fraction));
  const clickableCandidates = [];

  const resolveClickableTimeline = async () => {
    const timelines = page.locator('[data-testid="catchup-timeline"]:visible');
    await timelines.first().waitFor({ state: 'visible', timeout: 10_000 });
    const count = await timelines.count();

    for (let index = 0; index < count; index += 1) {
      const timeline = timelines.nth(index);
      const candidate = await timeline.evaluate((element, clickFraction) => {
        const rect = element.getBoundingClientRect();
        const position = {
          x: rect.width * clickFraction,
          y: rect.height / 2,
        };
        const clientX = rect.left + position.x;
        const clientY = rect.top + position.y;
        const topElement = document.elementFromPoint(clientX, clientY);
        let node = element;
        let pointerAllowed = true;
        let rendered = rect.width > 0 && rect.height > 0;

        while (node instanceof Element) {
          const style = window.getComputedStyle(node);
          if (
            style.pointerEvents === 'none' ||
            style.visibility === 'hidden' ||
            style.display === 'none' ||
            Number(style.opacity) === 0
          ) {
            pointerAllowed = false;
          }
          node = node.parentElement;
        }

        if (clientX < 0 || clientY < 0 || clientX > window.innerWidth || clientY > window.innerHeight) {
          rendered = false;
        }

        return {
          box: {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
          },
          position,
          pointerAllowed,
          rendered,
          receivesPointer: topElement === element || element.contains(topElement),
          topElementTag: topElement?.tagName ?? null,
          topElementTestId: topElement?.getAttribute?.('data-testid') ?? null,
        };
      }, clampedFraction);

      clickableCandidates.push({
        index,
        box: candidate.box,
        pointerAllowed: candidate.pointerAllowed,
        rendered: candidate.rendered,
        receivesPointer: candidate.receivesPointer,
        topElementTag: candidate.topElementTag,
        topElementTestId: candidate.topElementTestId,
      });

      if (
        !candidate.rendered ||
        !candidate.pointerAllowed ||
        candidate.box.width <= 0 ||
        candidate.box.height <= 0
      ) {
        continue;
      }

      const receivesPointer = await timeline.click({
        position: candidate.position,
        trial: true,
        timeout: 1_000,
      }).then(() => true).catch(() => false);
      if (receivesPointer) {
        return { timeline, position: candidate.position };
      }

      if (candidate.receivesPointer) {
        return {
          timeline: null,
          pagePosition: {
            x: candidate.box.x + candidate.position.x,
            y: candidate.box.y + candidate.position.y,
          },
        };
      }
    }

    return null;
  };

  await revealPlaybackControls(page, false);
  let clickableTimeline = await resolveClickableTimeline();
  if (!clickableTimeline) {
    await revealPlaybackControls(page, true);
    clickableTimeline = await resolveClickableTimeline();
  }
  if (!clickableTimeline) {
    await sleep(1_100);
    await revealPlaybackControls(page, false);
    clickableTimeline = await resolveClickableTimeline();
  }

  if (!clickableTimeline) {
    throw new Error(`Visible catch-up timeline has no clickable box. ${JSON.stringify(clickableCandidates.slice(-4))}`);
  }

  if (clickableTimeline.timeline) {
    await clickableTimeline.timeline.click({
      position: clickableTimeline.position,
      timeout: 5_000,
    });
    return;
  }

  await page.mouse.click(clickableTimeline.pagePosition.x, clickableTimeline.pagePosition.y);
};

const exerciseCatchUpMouseSeek = async (page) => {
  const initial = await mediaSnapshot(page);
  const durationSeconds = initial.catchUpDurationSeconds;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return {
      ok: false,
      reason: 'missing_catchup_duration',
      initial: redact(initial),
    };
  }

  const seekFractions = [0.35, 0.7];
  const outcomes = [];
  for (const fraction of seekFractions) {
    assertCpuLoadAllowsBrowserSmoke('before catch-up mouse timeline seek');
    await clickCatchUpTimelineAtFraction(page, fraction);
    const expectedPositionSeconds = durationSeconds * fraction;
    const toleranceSeconds = Math.max(8, durationSeconds * 0.03);
    const isTargetFrame = (snapshot) => (
      snapshot.sessionMode === 'catchup' &&
      snapshot.hasFrame &&
      typeof snapshot.sessionPositionMs === 'number' &&
      Math.abs((snapshot.sessionPositionMs / 1000) - expectedPositionSeconds) <= toleranceSeconds
    );
    const isProviderOverlay = (snapshot) => (
      snapshot.sessionMode === 'catchup' &&
      snapshot.catchUpOverlay &&
      snapshot.switchLiveAction &&
      !snapshot.credentialLeakInText
    );
    const outcome = await waitForOutcome(
      page,
      (snapshot) => isTargetFrame(snapshot) || isProviderOverlay(snapshot),
      15_000
    );
    const targetFrame = isTargetFrame(outcome);
    const handledByOverlay = isProviderOverlay(outcome);
    outcomes.push({
      fraction,
      expectedPositionSeconds,
      toleranceSeconds,
      targetFrame,
      handledByOverlay,
      ok: !outcome.timeout && (targetFrame || handledByOverlay),
      ...redact(outcome),
    });
    if (handledByOverlay) {
      break;
    }
  }

  return {
    ok: outcomes.every((outcome) => outcome.ok),
    outcomes,
  };
};

const isCatchUpProviderOverlaySnapshot = (snapshot) => (
  snapshot.sessionMode === 'catchup' &&
  snapshot.catchUpOverlay &&
  snapshot.switchLiveAction &&
  !snapshot.credentialLeakInText
);

const switchToLiveFromCatchUpProviderOverlay = async (page, sourceStep, sourceSnapshot) => {
  await page.getByRole('button', { name: /Gledaj .*uživo|Gledaj kanal uživo/i }).click();
  const liveAfterAction = await waitForOutcome(
    page,
    (snapshot) => snapshot.sessionMode === 'live' && snapshot.hasFrame && !snapshot.catchUpOverlay,
    20_000
  );

  return {
    ok: liveAfterAction.hasFrame && !liveAfterAction.catchUpOverlay,
    handledByOverlay: true,
    sourceStep,
    sourceSnapshot: redact(sourceSnapshot),
    liveAfterAction: redact(liveAfterAction),
  };
};

const resolveSnapshotProgressSeconds = (snapshot) => {
  if (
    snapshot.sessionMode === 'catchup' &&
    typeof snapshot.sessionPositionMs === 'number' &&
    Number.isFinite(snapshot.sessionPositionMs)
  ) {
    return snapshot.sessionPositionMs / 1000;
  }

  if (typeof snapshot.currentTime === 'number' && Number.isFinite(snapshot.currentTime)) {
    return snapshot.currentTime;
  }

  if (typeof snapshot.sessionPositionMs === 'number' && Number.isFinite(snapshot.sessionPositionMs)) {
    return snapshot.sessionPositionMs / 1000;
  }

  return null;
};

const waitForCatchUpPlaybackStability = async (page, durationMs, phase) => {
  const startedAt = Date.now();
  let lastSnapshot = await mediaSnapshot(page);
  let firstProgressSeconds = resolveSnapshotProgressSeconds(lastSnapshot);
  let lastProgressSeconds = firstProgressSeconds;
  let lastProgressAt = Date.now();
  let maxNoProgressMs = 0;
  let stalledNear59 = false;
  let lastSavedSampleAt = 0;
  const samples = [];

  const saveSample = (snapshot, elapsedMs, force = false) => {
    if (!force && elapsedMs - lastSavedSampleAt < 5_000 && samples.length > 0) {
      return;
    }

    lastSavedSampleAt = elapsedMs;
    samples.push(redact({
      elapsedMs,
      sessionMode: snapshot.sessionMode,
      hasFrame: snapshot.hasFrame,
      paused: snapshot.paused,
      readyState: snapshot.readyState,
      networkState: snapshot.networkState,
      currentTime: snapshot.currentTime,
      sessionPositionMs: snapshot.sessionPositionMs,
      catchUpOverlay: snapshot.catchUpOverlay,
      providerIssueReasonCode: snapshot.providerIssueReasonCode,
      videoErrorCode: snapshot.videoErrorCode,
    }));
  };

  while (Date.now() - startedAt < durationMs) {
    assertCpuLoadAllowsBrowserSmoke(`catch-up catalog ${phase}`);
    lastSnapshot = await mediaSnapshot(page);
    const elapsedMs = Date.now() - startedAt;
    saveSample(lastSnapshot, elapsedMs);

    if (lastSnapshot.credentialLeakInText) {
      saveSample(lastSnapshot, elapsedMs, true);
      return {
        ok: false,
        reason: 'credential_leak_in_text',
        elapsedMs,
        maxNoProgressMs,
        stalledNear59,
        samples,
        ...redact(lastSnapshot),
      };
    }

    if (isCatalogControlledCatchUpOverlay(lastSnapshot)) {
      saveSample(lastSnapshot, elapsedMs, true);
      return {
        ok: true,
        reason: 'controlled_overlay_during_playback',
        handledByOverlay: true,
        elapsedMs,
        maxNoProgressMs,
        stalledNear59,
        samples,
        ...redact(lastSnapshot),
      };
    }

    const progressSeconds = resolveSnapshotProgressSeconds(lastSnapshot);
    const hasProgressSample = typeof progressSeconds === 'number';
    if (
      lastSnapshot.sessionMode === 'catchup' &&
      lastSnapshot.hasFrame &&
      hasProgressSample
    ) {
      if (
        lastProgressSeconds === null ||
        progressSeconds > lastProgressSeconds + 0.45 ||
        progressSeconds < lastProgressSeconds - 2
      ) {
        lastProgressAt = Date.now();
        lastProgressSeconds = progressSeconds;
        if (firstProgressSeconds === null) {
          firstProgressSeconds = progressSeconds;
        }
      }
    }

    const noProgressMs = Date.now() - lastProgressAt;
    maxNoProgressMs = Math.max(maxNoProgressMs, noProgressMs);
    if (
      hasProgressSample &&
      progressSeconds >= 55 &&
      progressSeconds <= 65 &&
      noProgressMs >= catchUpCatalogNoProgressTimeoutMs
    ) {
      stalledNear59 = true;
    }

    if (noProgressMs >= catchUpCatalogNoProgressTimeoutMs) {
      saveSample(lastSnapshot, elapsedMs, true);
      return {
        ok: false,
        reason: stalledNear59 ? 'stalled_near_59_seconds' : 'no_playback_progress',
        elapsedMs,
        maxNoProgressMs,
        stalledNear59,
        firstProgressSeconds,
        lastProgressSeconds,
        samples,
        ...redact(lastSnapshot),
      };
    }

    await sleep(1_000);
  }

  lastSnapshot = await mediaSnapshot(page);
  const finalProgressSeconds = resolveSnapshotProgressSeconds(lastSnapshot);
  const progressDeltaSeconds = (
    typeof firstProgressSeconds === 'number' &&
    typeof finalProgressSeconds === 'number'
  )
    ? Math.max(0, finalProgressSeconds - firstProgressSeconds)
    : null;
  const minimumExpectedProgressSeconds = Math.max(1, (durationMs / 1000) * 0.45);
  const ok = (
    lastSnapshot.sessionMode === 'catchup' &&
    lastSnapshot.hasFrame &&
    !lastSnapshot.catchUpOverlay &&
    !lastSnapshot.credentialLeakInText &&
    (
      progressDeltaSeconds === null ||
      progressDeltaSeconds >= minimumExpectedProgressSeconds
    )
  );

  saveSample(lastSnapshot, Date.now() - startedAt, true);
  return {
    ok,
    reason: ok ? null : 'insufficient_stable_progress',
    elapsedMs: Date.now() - startedAt,
    maxNoProgressMs,
    stalledNear59,
    firstProgressSeconds,
    finalProgressSeconds,
    progressDeltaSeconds,
    minimumExpectedProgressSeconds,
    samples,
    ...redact(lastSnapshot),
  };
};

const startCatalogCatchUp = async (page) => {
  try {
    const program = await startCatchUpFromArchivePanel(page);
    return {
      method: 'archive-panel',
      program: redact(program),
    };
  } catch (error) {
    if (!isMissingCatchUpProgramError(error)) {
      throw error;
    }

    await startTimeshiftFromLiveBar(page, 0.25);
    return {
      method: 'live-timeshift-bar',
      program: null,
      archivePanelError: redact(error instanceof Error ? error.message : String(error)),
    };
  }
};

const isCatalogControlledCatchUpOverlay = (snapshot) => (
  snapshot.sessionMode === 'catchup' &&
  snapshot.catchUpOverlay &&
  snapshot.switchLiveAction &&
  !snapshot.credentialLeakInText
);

const isCatalogProviderOverlayExpected = (snapshot) => (
  isCatalogControlledCatchUpOverlay(snapshot) &&
  (
    typeof snapshot.providerIssueReasonCode === 'string' ||
    typeof snapshot.unavailableReasonCode === 'string'
  )
);

const resolveCatalogOverlayStatus = (snapshot, suffix = '') => (
  isCatalogProviderOverlayExpected(snapshot)
    ? `provider-overlay${suffix}`
    : `runtime-overlay${suffix}`
);

const runCatchUpCatalogChannel = async (browser, channel, index, total) => {
  console.log(`[catchup-catalog] ${index + 1}/${total} ${channel.name} (#${channel.streamId})`);
  const { context, page, events } = await newSmokePage(browser);
  await context.addInitScript(() => {
    window.localStorage.removeItem('lumen:session-core:state');
    window.localStorage.removeItem('lumen-web:v1:watch-history');
  });
  const steps = [];
  let finalStatus = 'failed';

  const finish = async (status, ok, extra = {}) => {
    finalStatus = status;
    if (!ok) {
      await safePageScreenshot(page, {
        path: resolve(outDir, `catchup-catalog-${channel.streamId}.png`),
        fullPage: true,
      });
    }

    return {
      streamId: channel.streamId,
      number: channel.number,
      name: channel.name,
      archiveDays: channel.archiveDays,
      epgChannelId: channel.epgChannelId,
      ok,
      status,
      steps: redact(steps),
      events: redact(events),
      ...redact(extra),
    };
  };

  try {
    await page.goto('/player', { waitUntil: 'domcontentloaded' });
    const selection = await selectChannelBySearch(page, channel);
    steps.push({
      step: 'select channel via visible search',
      ok: selection.ok,
      selectedText: selection.selectedText,
    });

    const liveStart = await waitForOutcome(
      page,
      (snapshot) => snapshot.sessionMode === 'live' && snapshot.hasFrame && !snapshot.liveFailureOverlay,
      25_000
    );
    steps.push({
      step: 'live starts before opening catch-up',
      ok: liveStart.sessionMode === 'live' && liveStart.hasFrame && !liveStart.liveFailureOverlay,
      ...redact(liveStart),
    });
    await sleep(3_000);

    let startAction;
    try {
      startAction = await startCatalogCatchUp(page);
    } catch (error) {
      steps.push({
        step: 'start catch-up unavailable',
        ok: false,
        error: redact(error instanceof Error ? error.message : String(error)),
      });
      return finish(steps.at(-2)?.ok ? 'catchup-ui-unavailable' : 'live-and-catchup-start-failed', false);
    }
    steps.push({
      step: `start catch-up via ${startAction.method}`,
      ok: true,
      program: startAction.program,
      archivePanelError: startAction.archivePanelError,
    });

    const catchUpStart = await waitForOutcome(
      page,
      (snapshot) => (
        snapshot.sessionMode === 'catchup' &&
        (snapshot.hasFrame || isCatalogControlledCatchUpOverlay(snapshot))
      ),
      95_000
    );
    const catchUpHasFrame = catchUpStart.sessionMode === 'catchup' && catchUpStart.hasFrame;
    const catchUpHasExpectedOverlay = isCatalogControlledCatchUpOverlay(catchUpStart);
    steps.push({
      step: 'catch-up initial outcome',
      ok: catchUpHasFrame || catchUpHasExpectedOverlay,
      handledByOverlay: catchUpHasExpectedOverlay,
      ...redact(catchUpStart),
    });

    if (catchUpHasExpectedOverlay) {
      const liveAction = await switchToLiveFromCatchUpProviderOverlay(
        page,
        'catalog initial provider overlay',
        catchUpStart
      );
      steps.push({ step: 'catch-up overlay live action returns to live', ...liveAction });
      return finish(resolveCatalogOverlayStatus(catchUpStart), Boolean(liveAction.ok), {
        providerIssueReasonCode: catchUpStart.providerIssueReasonCode,
        providerIssueSummary: catchUpStart.providerIssueSummary,
        providerIssueEvidence: catchUpStart.providerIssueEvidence,
      });
    }

    if (!catchUpHasFrame) {
      return finish('catchup-start-failed', false);
    }

    const preSeek = await waitForCatchUpPlaybackStability(
      page,
      catchUpCatalogPreSeekMs,
      'pre-seek human wait'
    );
    steps.push({
      step: `play ${Math.round(catchUpCatalogPreSeekMs / 1000)}s before timeline seek`,
      ...redact(preSeek),
    });
    if (!preSeek.ok) {
      return finish(preSeek.reason ?? 'pre-seek-unstable', false);
    }

    await clickCatchUpTimelineAtFraction(page, catchUpCatalogSeekFraction);
    const durationSeconds = catchUpStart.catchUpDurationSeconds;
    const expectedPositionSeconds = Number.isFinite(durationSeconds)
      ? durationSeconds * catchUpCatalogSeekFraction
      : null;
    const toleranceSeconds = Number.isFinite(durationSeconds)
      ? Math.max(12, durationSeconds * 0.05)
      : null;
    const seekOutcome = await waitForOutcome(
      page,
      (snapshot) => {
        if (isCatalogControlledCatchUpOverlay(snapshot)) {
          return true;
        }

        if (snapshot.sessionMode !== 'catchup' || !snapshot.hasFrame) {
          return false;
        }

        if (
          typeof expectedPositionSeconds !== 'number' ||
          typeof toleranceSeconds !== 'number' ||
          typeof snapshot.sessionPositionMs !== 'number'
        ) {
          return true;
        }

        return Math.abs((snapshot.sessionPositionMs / 1000) - expectedPositionSeconds) <= toleranceSeconds;
      },
      75_000
    );
    const seekHandledByOverlay = isCatalogControlledCatchUpOverlay(seekOutcome);
    const seekHasFrame = seekOutcome.sessionMode === 'catchup' && seekOutcome.hasFrame;
    steps.push({
      step: `timeline seek to ${Math.round(catchUpCatalogSeekFraction * 100)}% settles`,
      ok: seekHasFrame || seekHandledByOverlay,
      handledByOverlay: seekHandledByOverlay,
      expectedPositionSeconds,
      toleranceSeconds,
      ...redact(seekOutcome),
    });
    if (seekHandledByOverlay) {
      return finish(resolveCatalogOverlayStatus(seekOutcome, '-after-seek'), true, {
        providerIssueReasonCode: seekOutcome.providerIssueReasonCode,
        providerIssueSummary: seekOutcome.providerIssueSummary,
        providerIssueEvidence: seekOutcome.providerIssueEvidence,
      });
    }
    if (!seekHasFrame) {
      return finish('timeline-seek-failed', false);
    }

    const postSeek = await waitForCatchUpPlaybackStability(
      page,
      catchUpCatalogStabilityMs,
      'post-seek stability'
    );
    steps.push({
      step: `post-seek playback stable ${Math.round(catchUpCatalogStabilityMs / 1000)}s`,
      ...redact(postSeek),
    });
    if (postSeek.handledByOverlay) {
      return finish(resolveCatalogOverlayStatus(postSeek, '-during-playback'), true, {
        providerIssueReasonCode: postSeek.providerIssueReasonCode,
        providerIssueSummary: postSeek.providerIssueSummary,
        providerIssueEvidence: postSeek.providerIssueEvidence,
      });
    }
    if (!postSeek.ok) {
      return finish(postSeek.reason ?? 'post-seek-unstable', false);
    }

    return finish('playable-stable', true, {
      progressDeltaSeconds: postSeek.progressDeltaSeconds,
      maxNoProgressMs: postSeek.maxNoProgressMs,
      stalledNear59: postSeek.stalledNear59,
    });
  } catch (error) {
    steps.push({
      step: 'catalog channel exception',
      ok: false,
      finalStatus,
      error: redact(error instanceof Error ? error.stack ?? error.message : String(error)),
    });
    return finish('exception', false);
  } finally {
    await closeContext(context);
  }
};

const runCatchUpCatalogSmokeScenario = async (browser) => {
  const channels = await getCatchUpCatalogChannels();
  const channelResults = [];

  if (channels.length === 0) {
    return {
      id: 'catchup-catalog-smoke',
      steps: [
        {
          step: 'load catch-up channel catalog',
          ok: false,
          selectedIds: Array.from(catchUpCatalogChannelIds),
        },
      ],
      channels: channelResults,
    };
  }

  for (let index = 0; index < channels.length; index += 1) {
    assertCpuLoadAllowsBrowserSmoke('before catch-up catalog channel', { force: true });
    channelResults.push(await runCatchUpCatalogChannel(browser, channels[index], index, channels.length));
  }

  const counts = channelResults.reduce((accumulator, result) => {
    accumulator[result.status] = (accumulator[result.status] ?? 0) + 1;
    return accumulator;
  }, {});
  const failed = channelResults.filter((result) => !result.ok);

  return {
    id: 'catchup-catalog-smoke',
    steps: [
      {
        step: `catch-up catalog user-flow over ${channels.length} channel(s)`,
        ok: failed.length === 0,
        total: channels.length,
        passed: channelResults.length - failed.length,
        failed: failed.length,
        counts,
        startIndex: catchUpCatalogStartIndex,
        limit: catchUpCatalogLimit,
        preSeekMs: catchUpCatalogPreSeekMs,
        postSeekStabilityMs: catchUpCatalogStabilityMs,
        seekFraction: catchUpCatalogSeekFraction,
        noProgressTimeoutMs: catchUpCatalogNoProgressTimeoutMs,
      },
    ],
    channels: redact(channelResults),
  };
};

const exerciseCatchUpEdgeStress = async (page) => {
  const steps = [];
  const start = await mediaSnapshot(page);
  if (start.sessionMode !== 'catchup' || !start.hasFrame) {
    return {
      ok: false,
      reason: 'catchup_not_rendering_at_stress_start',
      start: redact(start),
    };
  }

  const pauseOrOverlay = await (async () => {
    await clickCatchUpControl(page, 'catchup-play-toggle');
    return waitForOutcome(
      page,
      (snapshot) => (
        (snapshot.sessionMode === 'catchup' && snapshot.paused) ||
        isCatchUpProviderOverlaySnapshot(snapshot)
      ),
      8_000
    );
  })();
  const pausedOk = !pauseOrOverlay.timeout && pauseOrOverlay.sessionMode === 'catchup' && pauseOrOverlay.paused;
  const pauseHandledByOverlay = isCatchUpProviderOverlaySnapshot(pauseOrOverlay);
  steps.push({
    step: 'pause via visible UI control',
    ok: pausedOk || pauseHandledByOverlay,
    handledByOverlay: pauseHandledByOverlay,
    ...redact(pauseOrOverlay),
  });
  if (pauseHandledByOverlay) {
    const overlayAction = await switchToLiveFromCatchUpProviderOverlay(page, 'pause via visible UI control', pauseOrOverlay);
    steps.push({ step: 'provider overlay live action after pause', ...overlayAction });
    return { ok: steps.every((step) => step.ok), handledByOverlay: true, steps };
  }

  if (!pausedOk) {
    return { ok: false, steps };
  }

  const resumeOrOverlay = await (async () => {
    await clickCatchUpControl(page, 'catchup-play-toggle');
    return waitForOutcome(
      page,
      (snapshot) => (
        (snapshot.sessionMode === 'catchup' && snapshot.hasFrame && !snapshot.paused) ||
        isCatchUpProviderOverlaySnapshot(snapshot)
      ),
      12_000
    );
  })();
  const resumedOk = !resumeOrOverlay.timeout &&
    resumeOrOverlay.sessionMode === 'catchup' &&
    resumeOrOverlay.hasFrame &&
    !resumeOrOverlay.paused;
  const resumeHandledByOverlay = isCatchUpProviderOverlaySnapshot(resumeOrOverlay);
  steps.push({
    step: 'resume via visible UI control',
    ok: resumedOk || resumeHandledByOverlay,
    handledByOverlay: resumeHandledByOverlay,
    ...redact(resumeOrOverlay),
  });
  if (resumeHandledByOverlay) {
    const overlayAction = await switchToLiveFromCatchUpProviderOverlay(page, 'resume via visible UI control', resumeOrOverlay);
    steps.push({ step: 'provider overlay live action after resume', ...overlayAction });
    return { ok: steps.every((step) => step.ok), handledByOverlay: true, steps };
  }

  if (!resumedOk) {
    return { ok: false, steps };
  }

  const buttonActions = [
    { id: 'catchup-seek-forward-10', label: 'skip forward 10s', direction: 'forward', minDeltaMs: 4_000 },
    { id: 'catchup-seek-backward-10', label: 'skip backward 10s', direction: 'backward', minDeltaMs: 4_000 },
    { id: 'catchup-seek-forward-10', label: 'skip forward 10s again', direction: 'forward', minDeltaMs: 4_000 },
    { id: 'catchup-seek-backward-10', label: 'skip backward 10s again', direction: 'backward', minDeltaMs: 4_000 },
  ];

  for (const action of buttonActions) {
    const before = await mediaSnapshot(page);
    const beforePositionMs = typeof before.sessionPositionMs === 'number' ? before.sessionPositionMs : null;
    await clickCatchUpControl(page, action.id);
    const outcome = await waitForOutcome(
      page,
      (snapshot) => {
        if (isCatchUpProviderOverlaySnapshot(snapshot)) {
          return true;
        }

        if (
          snapshot.sessionMode !== 'catchup' ||
          !snapshot.hasFrame ||
          beforePositionMs === null ||
          typeof snapshot.sessionPositionMs !== 'number'
        ) {
          return false;
        }

        const deltaMs = snapshot.sessionPositionMs - beforePositionMs;
        return action.direction === 'forward'
          ? deltaMs >= action.minDeltaMs
          : deltaMs <= -action.minDeltaMs;
      },
      15_000
    );
    const shiftedOk = !outcome.timeout &&
      outcome.sessionMode === 'catchup' &&
      outcome.hasFrame &&
      beforePositionMs !== null &&
      typeof outcome.sessionPositionMs === 'number' &&
      (
        action.direction === 'forward'
          ? outcome.sessionPositionMs - beforePositionMs >= action.minDeltaMs
          : outcome.sessionPositionMs - beforePositionMs <= -action.minDeltaMs
      );
    const actionHandledByOverlay = isCatchUpProviderOverlaySnapshot(outcome);
    steps.push({
      step: action.label,
      ok: shiftedOk || actionHandledByOverlay,
      handledByOverlay: actionHandledByOverlay,
      before: redact(before),
      ...redact(outcome),
    });
    if (actionHandledByOverlay) {
      const overlayAction = await switchToLiveFromCatchUpProviderOverlay(page, action.label, outcome);
      steps.push({ step: `provider overlay live action after ${action.label}`, ...overlayAction });
      return { ok: steps.every((step) => step.ok), handledByOverlay: true, steps };
    }

    if (!shiftedOk) {
      return { ok: false, steps };
    }
  }

  const beforeRapidSeek = await mediaSnapshot(page);
  const durationSeconds = beforeRapidSeek.catchUpDurationSeconds;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    steps.push({ step: 'rapid timeline seek setup', ok: false, ...redact(beforeRapidSeek) });
    return { ok: false, steps };
  }

  const rapidFractions = [0.22, 0.58, 0.31, 0.66, 0.44];
  for (const fraction of rapidFractions) {
    assertCpuLoadAllowsBrowserSmoke('before rapid catch-up timeline seek');
    await clickCatchUpTimelineAtFraction(page, fraction);
    await sleep(220);
  }

  const finalFraction = rapidFractions.at(-1) ?? 0.44;
  const expectedPositionSeconds = durationSeconds * finalFraction;
  const toleranceSeconds = Math.max(8, durationSeconds * 0.035);
  const rapidOutcome = await waitForOutcome(
    page,
    (snapshot) => {
      if (isCatchUpProviderOverlaySnapshot(snapshot)) {
        return true;
      }

      return (
        snapshot.sessionMode === 'catchup' &&
        snapshot.hasFrame &&
        typeof snapshot.sessionPositionMs === 'number' &&
        Math.abs((snapshot.sessionPositionMs / 1000) - expectedPositionSeconds) <= toleranceSeconds
      );
    },
    20_000
  );
  const rapidOk = !rapidOutcome.timeout &&
    rapidOutcome.sessionMode === 'catchup' &&
    rapidOutcome.hasFrame &&
    typeof rapidOutcome.sessionPositionMs === 'number' &&
    Math.abs((rapidOutcome.sessionPositionMs / 1000) - expectedPositionSeconds) <= toleranceSeconds;
  const rapidHandledByOverlay = isCatchUpProviderOverlaySnapshot(rapidOutcome);
  steps.push({
    step: 'rapid mouse timeline seek burst settles',
    ok: rapidOk || rapidHandledByOverlay,
    handledByOverlay: rapidHandledByOverlay,
    rapidFractions,
    expectedPositionSeconds,
    toleranceSeconds,
    ...redact(rapidOutcome),
  });
  if (rapidHandledByOverlay) {
    const overlayAction = await switchToLiveFromCatchUpProviderOverlay(page, 'rapid mouse timeline seek burst settles', rapidOutcome);
    steps.push({ step: 'provider overlay live action after rapid timeline seeks', ...overlayAction });
    return { ok: steps.every((step) => step.ok), handledByOverlay: true, steps };
  }

  if (!rapidOk) {
    return { ok: false, steps };
  }

  await clickCatchUpControl(page, 'catchup-go-live');
  const liveAfterCatchUp = await waitForOutcome(
    page,
    (snapshot) => snapshot.sessionMode === 'live' && snapshot.hasFrame && !snapshot.catchUpOverlay,
    20_000
  );
  steps.push({
    step: 'visible catch-up live button returns to live',
    ok: liveAfterCatchUp.sessionMode === 'live' && liveAfterCatchUp.hasFrame && !liveAfterCatchUp.catchUpOverlay,
    ...redact(liveAfterCatchUp),
  });

  return {
    ok: steps.every((step) => step.ok),
    handledByOverlay: false,
    steps,
  };
};

const newSmokePage = async (browser) => {
  const context = await browser.newContext({
    baseURL,
    storageState: storageStatePath,
    serviceWorkers: 'block',
    viewport,
  });
  const page = await context.newPage();
  const events = [];
  attachObservability(page, events);
  return { context, page, events };
};

const closeContext = async (context) => {
  await context.close().catch(() => undefined);
};

const isMissingCatchUpProgramError = (error) => (
  (
    error instanceof Error ? error.message : String(error)
  ).includes('[data-testid="catchup-program"]') ||
  (
    error instanceof Error ? error.message : String(error)
  ).includes('No visible catch-up programs found.')
);

const safePageScreenshot = async (page, options) => {
  try {
    await page.screenshot({
      timeout: 5_000,
      ...options,
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: redact(error instanceof Error ? error.message : String(error)),
    };
  }
};

const runCatchUpScenario = async (browser, scenario) => {
  const { context, page, events } = await newSmokePage(browser);
  const steps = [];

  try {
    await page.goto('/player', { waitUntil: 'domcontentloaded' });
    await clickChannel(page, scenario.pattern);

    const liveStart = await waitForOutcome(
      page,
      (snapshot) => snapshot.sessionMode === 'live' && snapshot.hasFrame,
      20_000
    );
    steps.push({ step: `${scenario.id}: live start`, ok: liveStart.hasFrame, ...redact(liveStart) });

    if (scenario.archiveProgram) {
      await startCatchUpFromArchivePanel(page);
    } else {
      await startTimeshiftFromLiveBar(page);
    }
    const catchUpStart = await waitForOutcome(
      page,
      (snapshot) => (
        snapshot.sessionMode === 'catchup' &&
        (snapshot.hasFrame || (snapshot.catchUpOverlay && snapshot.switchLiveAction))
      ),
      scenario.catchUpTimeoutMs
    );
    const catchUpHasFrame = catchUpStart.sessionMode === 'catchup' && catchUpStart.hasFrame;
    const catchUpHasOverlay = (
      catchUpStart.sessionMode === 'catchup' &&
      catchUpStart.catchUpOverlay &&
      catchUpStart.switchLiveAction
    );
    const catchUpOk = scenario.allowProviderOverlay
      ? catchUpHasFrame || catchUpHasOverlay
      : catchUpHasFrame;
    steps.push({ step: `${scenario.id}: catch-up start`, ok: catchUpOk, ...redact(catchUpStart) });

    if (scenario.exerciseControls && catchUpHasFrame) {
      const controls = await exerciseMediaControls(page);
      steps.push({ step: `${scenario.id}: pause/resume/seek`, ...redact(controls) });
    }

    if (scenario.exerciseMouseSeek && catchUpHasFrame) {
      const mouseSeek = await exerciseCatchUpMouseSeek(page);
      steps.push({ step: `${scenario.id}: mouse timeline seek`, ...redact(mouseSeek) });
    }

    if (scenario.exerciseEdgeStress && catchUpHasFrame) {
      const edgeStress = await exerciseCatchUpEdgeStress(page);
      steps.push({ step: `${scenario.id}: catch-up edge stress`, ...redact(edgeStress) });
    }

    if (catchUpHasOverlay) {
      await page.getByRole('button', { name: /Gledaj .*uživo|Gledaj kanal uživo/i }).click();
      const liveAfterAction = await waitForOutcome(
        page,
        (snapshot) => snapshot.sessionMode === 'live' && snapshot.hasFrame && !snapshot.catchUpOverlay,
        20_000
      );
      steps.push({
        step: `${scenario.id}: catch-up live action`,
        ok: liveAfterAction.hasFrame && !liveAfterAction.catchUpOverlay,
        ...redact(liveAfterAction),
      });
    }

    const screenshot = await safePageScreenshot(page, {
      path: resolve(outDir, `${scenario.id}.png`),
      fullPage: true,
    });
    if (!screenshot.ok) {
      steps.push({
        step: `${scenario.id}: screenshot artifact`,
        ok: true,
        screenshotOk: false,
        error: screenshot.error,
      });
    }

    return {
      id: scenario.id,
      steps,
      events: redact(events),
    };
  } finally {
    await closeContext(context);
  }
};

const runPlayableCatchUpControlsScenario = async (browser) => {
  const allCandidates = [
    { id: 'pink', pattern: /\bPINK\b/i },
    { id: 'rts1', pattern: /\bRTS 1\b/i },
    { id: 'hrt1', pattern: /\bHRT 1\b/i },
    { id: 'prva', pattern: /\bPRVA\b/i },
    { id: 'obn', pattern: /\bOBN\b/i },
    { id: 'bht1', pattern: /\bBHT 1\b/i },
  ];
  const candidates = selectedPlayableCatchUpCandidateIds.size > 0
    ? allCandidates.filter((candidate) => selectedPlayableCatchUpCandidateIds.has(candidate.id))
    : allCandidates;
  const attempts = [];

  if (candidates.length === 0) {
    return {
      id: 'playable-catchup-controls',
      steps: [
        {
          step: 'select playable catch-up candidates',
          ok: false,
          requestedCandidates: Array.from(selectedPlayableCatchUpCandidateIds),
          validCandidates: allCandidates.map((candidate) => candidate.id),
        },
      ],
      attempts,
    };
  }

  for (const candidate of candidates) {
    const maxAttempts = 2;
    for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
      try {
        const attempt = await runCatchUpScenario(browser, {
          id: `playable-catchup-${candidate.id}${attemptIndex > 0 ? `-retry-${attemptIndex}` : ''}`,
          pattern: candidate.pattern,
          catchUpTimeoutMs: 45_000,
          exerciseControls: true,
          allowProviderOverlay: true,
          archiveProgram: true,
        });
        attempts.push(attempt);

        const catchUpStart = attempt.steps.find((step) => step.step.includes('catch-up start'));
        const controls = attempt.steps.find((step) => step.step.includes('pause/resume/seek'));
        if (catchUpStart?.hasFrame && controls?.ok) {
          return {
            id: 'playable-catchup-controls',
            steps: [
              {
                step: `playable catch-up controls candidate ${candidate.id}`,
                ok: true,
                candidate: candidate.id,
                catchUpMs: catchUpStart.ms,
                controlsOk: controls.ok,
                hasFrame: catchUpStart.hasFrame,
                attemptsUsed: attemptIndex + 1,
              },
            ],
            attempts: redact(attempts),
          };
        }
      } catch (error) {
        const missingCatchUpProgram = isMissingCatchUpProgramError(error);
        attempts.push({
          id: `playable-catchup-${candidate.id}${attemptIndex > 0 ? `-retry-${attemptIndex}` : ''}`,
          steps: [
            {
              step: `candidate ${candidate.id} failed before outcome`,
              ok: false,
              retryable: missingCatchUpProgram && attemptIndex + 1 < maxAttempts,
              error: redact(error instanceof Error ? error.message : String(error)),
            },
          ],
          events: [],
        });
        if (!missingCatchUpProgram) {
          break;
        }
      }
    }
  }

  return {
    id: 'playable-catchup-controls',
    steps: [
      {
        step: 'find one playable catch-up channel and exercise controls',
        ok: false,
        candidateCount: candidates.length,
      },
    ],
    attempts: redact(attempts),
  };
};

const runPlayableCatchUpMouseSeekScenario = async (browser) => {
  const allCandidates = [
    { id: 'pink', pattern: /\bPINK\b/i },
    { id: 'rts1', pattern: /\bRTS 1\b/i },
    { id: 'hrt1', pattern: /\bHRT 1\b/i },
    { id: 'prva', pattern: /\bPRVA\b/i },
    { id: 'obn', pattern: /\bOBN\b/i },
    { id: 'bht1', pattern: /\bBHT 1\b/i },
  ];
  const candidates = selectedPlayableCatchUpCandidateIds.size > 0
    ? allCandidates.filter((candidate) => selectedPlayableCatchUpCandidateIds.has(candidate.id))
    : allCandidates;
  const attempts = [];

  if (candidates.length === 0) {
    return {
      id: 'playable-catchup-mouse-seek',
      steps: [
        {
          step: 'select playable catch-up mouse-seek candidates',
          ok: false,
          requestedCandidates: Array.from(selectedPlayableCatchUpCandidateIds),
          validCandidates: allCandidates.map((candidate) => candidate.id),
        },
      ],
      attempts,
    };
  }

  for (const candidate of candidates) {
    try {
      const attempt = await runCatchUpScenario(browser, {
        id: `playable-catchup-mouse-seek-${candidate.id}`,
        pattern: candidate.pattern,
        catchUpTimeoutMs: 45_000,
        exerciseMouseSeek: true,
        allowProviderOverlay: true,
        archiveProgram: true,
      });
      attempts.push(attempt);

      const catchUpStart = attempt.steps.find((step) => step.step.includes('catch-up start'));
      const mouseSeek = attempt.steps.find((step) => step.step.includes('mouse timeline seek'));
      if (catchUpStart?.hasFrame && mouseSeek?.ok) {
        return {
          id: 'playable-catchup-mouse-seek',
          steps: [
            {
              step: `playable catch-up mouse seek candidate ${candidate.id}`,
              ok: true,
              candidate: candidate.id,
              catchUpMs: catchUpStart.ms,
              mouseSeekOk: mouseSeek.ok,
              hasFrame: catchUpStart.hasFrame,
            },
          ],
          attempts: redact(attempts),
        };
      }
    } catch (error) {
      attempts.push({
        id: `playable-catchup-mouse-seek-${candidate.id}`,
        steps: [
          {
            step: `candidate ${candidate.id} failed before mouse-seek outcome`,
            ok: false,
            error: redact(error instanceof Error ? error.message : String(error)),
          },
        ],
        events: [],
      });
    }
  }

  return {
    id: 'playable-catchup-mouse-seek',
    steps: [
      {
        step: 'find one playable catch-up channel and seek with mouse timeline',
        ok: false,
        candidateCount: candidates.length,
      },
    ],
    attempts: redact(attempts),
  };
};

const runCatchUpEdgeStressScenario = async (browser) => {
  const allCandidates = [
    { id: 'pink', pattern: /\bPINK\b/i },
    { id: 'rts1', pattern: /\bRTS 1\b/i },
    { id: 'hrt1', pattern: /\bHRT 1\b/i },
    { id: 'prva', pattern: /\bPRVA\b/i },
    { id: 'obn', pattern: /\bOBN\b/i },
    { id: 'bht1', pattern: /\bBHT 1\b/i },
  ];
  const candidates = selectedPlayableCatchUpCandidateIds.size > 0
    ? allCandidates.filter((candidate) => selectedPlayableCatchUpCandidateIds.has(candidate.id))
    : allCandidates;
  const attempts = [];

  if (candidates.length === 0) {
    return {
      id: 'catchup-edge-stress',
      steps: [
        {
          step: 'select catch-up edge-stress candidates',
          ok: false,
          requestedCandidates: Array.from(selectedPlayableCatchUpCandidateIds),
          validCandidates: allCandidates.map((candidate) => candidate.id),
        },
      ],
      attempts,
    };
  }

  for (const candidate of candidates) {
    try {
      const attempt = await runCatchUpScenario(browser, {
        id: `catchup-edge-stress-${candidate.id}`,
        pattern: candidate.pattern,
        catchUpTimeoutMs: 45_000,
        exerciseEdgeStress: true,
        allowProviderOverlay: true,
        archiveProgram: true,
      });
      attempts.push(attempt);

      const catchUpStart = attempt.steps.find((step) => step.step.includes('catch-up start'));
      const edgeStress = attempt.steps.find((step) => step.step.includes('catch-up edge stress'));
      if (catchUpStart?.hasFrame && edgeStress?.ok) {
        return {
          id: 'catchup-edge-stress',
          steps: [
            {
              step: `catch-up edge stress candidate ${candidate.id}`,
              ok: true,
              candidate: candidate.id,
              catchUpMs: catchUpStart.ms,
              edgeStressOk: edgeStress.ok,
              handledByOverlay: Boolean(edgeStress.handledByOverlay),
              hasFrame: catchUpStart.hasFrame,
            },
          ],
          attempts: redact(attempts),
        };
      }
    } catch (error) {
      attempts.push({
        id: `catchup-edge-stress-${candidate.id}`,
        steps: [
          {
            step: `candidate ${candidate.id} failed before edge-stress outcome`,
            ok: false,
            error: redact(error instanceof Error ? error.message : String(error)),
          },
        ],
        events: [],
      });
    }
  }

  return {
    id: 'catchup-edge-stress',
    steps: [
      {
        step: 'find one playable catch-up channel and survive edge stress',
        ok: false,
        candidateCount: candidates.length,
      },
    ],
    attempts: redact(attempts),
  };
};

const runCatchUpLiveSwitchStressAttempt = async (browser, candidate, target) => {
  const { context, page, events } = await newSmokePage(browser);
  const steps = [];

  try {
    await page.goto('/player', { waitUntil: 'domcontentloaded' });
    await clickChannel(page, candidate.pattern);
    const liveStart = await waitForOutcome(
      page,
      (snapshot) => snapshot.sessionMode === 'live' && snapshot.hasFrame && !snapshot.liveFailureOverlay,
      25_000
    );
    steps.push({
      step: `${candidate.id}: original live start`,
      ok: liveStart.sessionMode === 'live' && liveStart.hasFrame && !liveStart.liveFailureOverlay,
      ...redact(liveStart),
    });

    if (!steps.at(-1)?.ok) {
      return {
        id: `catchup-live-switch-stress-${candidate.id}`,
        steps,
        events: redact(events),
      };
    }

    await startCatchUpFromArchivePanel(page);
    const catchUpStart = await waitForOutcome(
      page,
      (snapshot) => (
        snapshot.sessionMode === 'catchup' &&
        (snapshot.hasFrame || (snapshot.catchUpOverlay && snapshot.switchLiveAction))
      ),
      45_000
    );
    const catchUpHasFrame = catchUpStart.sessionMode === 'catchup' && catchUpStart.hasFrame;
    const catchUpHasOverlay = (
      catchUpStart.sessionMode === 'catchup' &&
      catchUpStart.catchUpOverlay &&
      catchUpStart.switchLiveAction
    );
    steps.push({
      step: `${candidate.id}: catch-up before live switch`,
      ok: catchUpHasFrame || catchUpHasOverlay,
      ...redact(catchUpStart),
    });

    if (catchUpHasOverlay) {
      await page.getByRole('button', { name: /Gledaj .*uživo|Gledaj kanal uživo/i }).click();
      const liveAfterOverlay = await waitForOutcome(
        page,
        (snapshot) => snapshot.sessionMode === 'live' && snapshot.hasFrame && !snapshot.catchUpOverlay,
        20_000
      );
      steps.push({
        step: `${candidate.id}: provider-overlay live action before switch`,
        ok: liveAfterOverlay.hasFrame && !liveAfterOverlay.catchUpOverlay,
        ...redact(liveAfterOverlay),
      });
      return {
        id: `catchup-live-switch-stress-${candidate.id}`,
        steps,
        events: redact(events),
      };
    }

    if (!catchUpHasFrame) {
      return {
        id: `catchup-live-switch-stress-${candidate.id}`,
        steps,
        events: redact(events),
      };
    }

    await clickChannel(page, target.pattern);
    const targetLive = await waitForOutcome(
      page,
      (snapshot) => snapshot.sessionMode === 'live' && snapshot.hasFrame && !snapshot.catchUpOverlay,
      25_000
    );
    steps.push({
      step: `${candidate.id}: switch from catch-up to ${target.id} live`,
      ok: targetLive.sessionMode === 'live' && targetLive.hasFrame && !targetLive.catchUpOverlay,
      target: target.id,
      ...redact(targetLive),
    });

    await clickChannel(page, candidate.pattern);
    const originalLiveAgain = await waitForOutcome(
      page,
      (snapshot) => snapshot.sessionMode === 'live' && snapshot.hasFrame && !snapshot.catchUpOverlay,
      25_000
    );
    steps.push({
      step: `${candidate.id}: return to original live`,
      ok: originalLiveAgain.sessionMode === 'live' && originalLiveAgain.hasFrame && !originalLiveAgain.catchUpOverlay,
      ...redact(originalLiveAgain),
    });

    await startCatchUpFromArchivePanel(page);
    const catchUpAgain = await waitForOutcome(
      page,
      (snapshot) => (
        snapshot.sessionMode === 'catchup' &&
        (snapshot.hasFrame || (snapshot.catchUpOverlay && snapshot.switchLiveAction))
      ),
      45_000
    );
    steps.push({
      step: `${candidate.id}: catch-up after live switch`,
      ok: catchUpAgain.sessionMode === 'catchup' && catchUpAgain.hasFrame,
      ...redact(catchUpAgain),
    });

    if (catchUpAgain.sessionMode === 'catchup' && catchUpAgain.hasFrame) {
      const mouseSeek = await exerciseCatchUpMouseSeek(page);
      steps.push({
        step: `${candidate.id}: mouse seek after switch-back catch-up`,
        ...redact(mouseSeek),
      });
    }

    await safePageScreenshot(page, {
      path: resolve(outDir, `catchup-live-switch-stress-${candidate.id}.png`),
      fullPage: true,
    });

    return {
      id: `catchup-live-switch-stress-${candidate.id}`,
      steps,
      events: redact(events),
    };
  } finally {
    await closeContext(context);
  }
};

const runCatchUpLiveSwitchStressScenario = async (browser) => {
  const allCandidates = [
    { id: 'pink', pattern: /\bPINK\b/i },
    { id: 'rts1', pattern: /\bRTS 1\b/i },
    { id: 'hrt1', pattern: /\bHRT 1\b/i },
    { id: 'prva', pattern: /\bPRVA\b/i },
    { id: 'obn', pattern: /\bOBN\b/i },
    { id: 'bht1', pattern: /\bBHT 1\b/i },
  ];
  const switchTargets = [
    { id: 'nova-s', pattern: /\bNOVA S\b/i },
    { id: 'pink', pattern: /\bPINK\b/i },
    { id: 'hrt1', pattern: /\bHRT 1\b/i },
    { id: 'prva', pattern: /\bPRVA\b/i },
    { id: 'rts1', pattern: /\bRTS 1\b/i },
  ];
  const candidates = selectedPlayableCatchUpCandidateIds.size > 0
    ? allCandidates.filter((candidate) => selectedPlayableCatchUpCandidateIds.has(candidate.id))
    : allCandidates;
  const attempts = [];

  if (candidates.length === 0) {
    return {
      id: 'catchup-live-switch-stress',
      steps: [
        {
          step: 'select catch-up live-switch candidates',
          ok: false,
          requestedCandidates: Array.from(selectedPlayableCatchUpCandidateIds),
          validCandidates: allCandidates.map((candidate) => candidate.id),
        },
      ],
      attempts,
    };
  }

  for (const candidate of candidates) {
    const target = switchTargets.find((entry) => entry.id !== candidate.id) ?? switchTargets[0];
    try {
      const attempt = await runCatchUpLiveSwitchStressAttempt(browser, candidate, target);
      attempts.push(attempt);

      const targetLive = attempt.steps.find((step) => step.step.includes('switch from catch-up'));
      const originalLive = attempt.steps.find((step) => step.step.includes('return to original live'));
      const catchUpAgain = attempt.steps.find((step) => step.step.includes('catch-up after live switch'));
      const mouseSeek = attempt.steps.find((step) => step.step.includes('mouse seek after switch-back'));
      if (
        targetLive?.ok &&
        originalLive?.ok &&
        catchUpAgain?.hasFrame &&
        mouseSeek?.ok
      ) {
        return {
          id: 'catchup-live-switch-stress',
          steps: [
            {
              step: `catch-up/live switch stress candidate ${candidate.id}`,
              ok: true,
              candidate: candidate.id,
              target: target.id,
              targetLiveOk: targetLive.ok,
              originalLiveOk: originalLive.ok,
              catchUpAfterSwitchOk: Boolean(catchUpAgain.hasFrame),
              mouseSeekAfterSwitchOk: mouseSeek.ok,
            },
          ],
          attempts: redact(attempts),
        };
      }
    } catch (error) {
      attempts.push({
        id: `catchup-live-switch-stress-${candidate.id}`,
        steps: [
          {
            step: `candidate ${candidate.id} failed before live-switch outcome`,
            ok: false,
            error: redact(error instanceof Error ? error.message : String(error)),
          },
        ],
        events: [],
      });
    }
  }

  return {
    id: 'catchup-live-switch-stress',
    steps: [
      {
        step: 'find one playable catch-up channel and survive live switch stress',
        ok: false,
        candidateCount: candidates.length,
      },
    ],
    attempts: redact(attempts),
  };
};

const runRapidZapScenario = async (browser) => {
  const { context, page, events } = await newSmokePage(browser);
  const patterns = [/\bRTS 1\b/i, /\bHRT 1\b/i, /\bPRVA\b/i, /\bPINK\b/i, /\bNOVA S\b/i];
  const clicked = [];

  await page.goto('/player', { waitUntil: 'domcontentloaded' });
  for (const pattern of patterns) {
    clicked.push(await clickChannel(page, pattern));
    await sleep(180);
  }

  const finalLive = await waitForOutcome(
    page,
    (snapshot) => snapshot.sessionMode === 'live' && snapshot.hasFrame,
    25_000
  );
  await safePageScreenshot(page, {
    path: resolve(outDir, 'rapid-live-zap.png'),
    fullPage: true,
  });
  await closeContext(context);

  return {
    id: 'rapid-live-zap',
    steps: [
      {
        step: 'rapid live zap settles on final channel',
        ok: finalLive.hasFrame && !finalLive.liveFailureOverlay,
        clicked,
        ...redact(finalLive),
      },
    ],
    events: redact(events),
  };
};

const waitForStableLivePlayback = async (page, durationMs) => {
  const startedAt = Date.now();
  let lastSnapshot = null;

  while (Date.now() - startedAt < durationMs) {
    assertCpuLoadAllowsBrowserSmoke('live multi-channel soak');
    lastSnapshot = await mediaSnapshot(page);
    if (
      lastSnapshot.sessionMode === 'live' &&
      !lastSnapshot.hasFrame &&
      !lastSnapshot.liveFailureOverlay &&
      !lastSnapshot.credentialLeakInText
    ) {
      lastSnapshot = await waitForOutcome(
        page,
        (snapshot) => (
          snapshot.sessionMode !== 'live' ||
          snapshot.hasFrame ||
          snapshot.liveFailureOverlay ||
          snapshot.credentialLeakInText
        ),
        liveSoakTransientRecoveryMs
      );
      if (
        lastSnapshot.sessionMode === 'live' &&
        lastSnapshot.hasFrame &&
        !lastSnapshot.liveFailureOverlay &&
        !lastSnapshot.credentialLeakInText
      ) {
        await sleep(2_000);
        continue;
      }
    }

    if (
      lastSnapshot.sessionMode !== 'live' ||
      !lastSnapshot.hasFrame ||
      lastSnapshot.liveFailureOverlay ||
      lastSnapshot.credentialLeakInText
    ) {
      return {
        ok: false,
        elapsedMs: Date.now() - startedAt,
        ...redact(lastSnapshot),
      };
    }
    await sleep(2_000);
  }

  lastSnapshot = await mediaSnapshot(page);
  return {
    ok: (
      lastSnapshot.sessionMode === 'live' &&
      lastSnapshot.hasFrame &&
      !lastSnapshot.liveFailureOverlay &&
      !lastSnapshot.credentialLeakInText
    ),
    elapsedMs: Date.now() - startedAt,
    ...redact(lastSnapshot),
  };
};

const runLiveMultiChannelSoakScenario = async (browser) => {
  const { context, page, events } = await newSmokePage(browser);
  const channels = [
    { id: 'rts1', pattern: /\bRTS 1\b/i },
    { id: 'hrt1', pattern: /\bHRT 1\b/i },
    { id: 'prva', pattern: /\bPRVA\b/i },
    { id: 'pink', pattern: /\bPINK\b/i },
    { id: 'nova-s', pattern: /\bNOVA S\b/i },
  ];
  const steps = [];

  try {
    await page.goto('/player', { waitUntil: 'domcontentloaded' });

    for (const channel of channels) {
      const clicked = await clickChannel(page, channel.pattern);
      const liveStart = await waitForOutcome(
        page,
        (snapshot) => snapshot.sessionMode === 'live' && snapshot.hasFrame && !snapshot.liveFailureOverlay,
        25_000
      );
      steps.push({
        step: `live soak ${channel.id}: start`,
        ok: liveStart.sessionMode === 'live' && liveStart.hasFrame && !liveStart.liveFailureOverlay,
        clicked,
        ...redact(liveStart),
      });

      if (!steps.at(-1)?.ok) {
        break;
      }

      const stableLive = await waitForStableLivePlayback(page, liveSoakChannelMs);
      steps.push({
        step: `live soak ${channel.id}: stable ${Math.round(liveSoakChannelMs / 1000)}s`,
        ok: stableLive.ok,
        clicked,
        ...redact(stableLive),
      });

      if (!stableLive.ok) {
        break;
      }
    }

    await safePageScreenshot(page, {
      path: resolve(outDir, 'live-multichannel-soak.png'),
      fullPage: true,
    });

    return {
      id: 'live-multichannel-soak',
      steps,
      events: redact(events),
    };
  } finally {
    await closeContext(context);
  }
};

const runLiveFailureScenario = async (browser) => {
  const context = await browser.newContext({
    baseURL,
    storageState: storageStatePath,
    serviceWorkers: 'block',
    viewport,
  });
  const page = await context.newPage();
  const events = [];
  const aborted = [];
  let blockLiveStream = false;

  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (blockLiveStream && url.includes('/xui-api/') && (url.includes('%2Flive%2F') || url.includes('/live/'))) {
      aborted.push(redact(url));
      await route.abort('failed');
      return;
    }

    await route.continue();
  });

  attachObservability(page, events);
  await page.goto('/player', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="channel-select"]').first().waitFor({ state: 'visible', timeout: 30_000 });
  blockLiveStream = true;
  await clickChannel(page, /\bN1 SRB\b/i);

  const beforeClick = await waitForOutcome(
    page,
    (snapshot) => snapshot.sessionMode === 'live' && snapshot.liveFailureOverlay && snapshot.reportAction,
    18_000
  );
  if (beforeClick.liveFailureOverlay && beforeClick.reportAction) {
    await safePageScreenshot(page, {
      path: resolve(outDir, 'live-failure-before-report.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: /Prijavi problem/i }).click();
  }

  const afterClick = await waitForOutcome(
    page,
    (snapshot) => snapshot.reportToast,
    5_000
  );
  const reportEvent = events.find((entry) => entry.values?.[1]?.event === 'playback.problem_reported') ?? null;
  const reportEventText = JSON.stringify(reportEvent ?? {});
  const reportEventHasCredentialLeak = secrets.some((secret) => reportEventText.includes(secret)) ||
    /\/live\/[^/\s]+\/[^/\s]+\//.test(reportEventText) ||
    /username=[^&\s]+/.test(reportEventText) ||
    /password=[^&\s]+/.test(reportEventText);

  await safePageScreenshot(page, {
    path: resolve(outDir, 'live-failure-after-report.png'),
    fullPage: true,
  });
  await closeContext(context);

  return {
    id: 'live-failure-report',
    steps: [
      {
        step: 'live failure shows report action',
        ok: beforeClick.liveFailureOverlay && beforeClick.reportAction && !beforeClick.credentialLeakInText,
        ...redact(beforeClick),
      },
      {
        step: 'report action records sanitized problem event',
        ok: Boolean(reportEvent) && afterClick.reportToast && !afterClick.credentialLeakInText && !reportEventHasCredentialLeak,
        hasReportEvent: Boolean(reportEvent),
        reportEventHasCredentialLeak,
        abortedCount: aborted.length,
        ...redact(afterClick),
      },
    ],
    reportEvent: redact(reportEvent),
    events: redact(events),
  };
};

const runCatchUpFailureScenario = async (browser) => {
  const candidates = [
    { id: 'pink', pattern: /\bPINK\b/i },
    { id: 'rts1', pattern: /\bRTS 1\b/i },
    { id: 'hrt1', pattern: /\bHRT 1\b/i },
    { id: 'prva', pattern: /\bPRVA\b/i },
  ];
  const attempts = [];

  for (const candidate of candidates) {
    const context = await browser.newContext({
      baseURL,
      storageState: storageStatePath,
      serviceWorkers: 'block',
      viewport,
    });
    const page = await context.newPage();
    const events = [];
    const aborted = [];
    let blockCatchUpStream = false;

    await page.route('**/*', async (route) => {
      const url = route.request().url();
      const isCatchUpRequest = (
        url.includes('/xui-api/') &&
        (
          url.includes('timeshift') ||
          url.includes('streaming%2Ftimeshift') ||
          url.includes('timeshift_hls')
        )
      );
      if (blockCatchUpStream && isCatchUpRequest) {
        aborted.push(redact(url));
        await route.abort('failed');
        return;
      }

      await route.continue();
    });

    attachObservability(page, events);

    try {
      await page.goto('/player', { waitUntil: 'domcontentloaded' });
      await clickChannel(page, candidate.pattern);
      const liveStart = await waitForOutcome(
        page,
        (snapshot) => snapshot.sessionMode === 'live' && snapshot.hasFrame,
        20_000
      );
      if (!liveStart.hasFrame) {
        attempts.push({
          id: candidate.id,
          ok: false,
          reason: 'live_start_failed',
          liveStart: redact(liveStart),
        });
        await closeContext(context);
        continue;
      }

      const control = page.locator('[aria-label="Pokreni TV unazad sa ove pozicije"]').first();
      await control.waitFor({ state: 'visible', timeout: 12_000 });
      blockCatchUpStream = true;
      await control.focus();
      await page.keyboard.press('Enter');

      const beforeAction = await waitForOutcome(
        page,
        (snapshot) => snapshot.sessionMode === 'catchup' && snapshot.catchUpOverlay && snapshot.switchLiveAction,
        35_000
      );
      if (!(beforeAction.catchUpOverlay && beforeAction.switchLiveAction)) {
        attempts.push({
          id: candidate.id,
          ok: false,
          reason: 'catchup_overlay_missing',
          beforeAction: redact(beforeAction),
          abortedCount: aborted.length,
        });
        await closeContext(context);
        continue;
      }

      await page.getByRole('button', { name: /Gledaj .*uživo|Gledaj kanal uživo/i }).click();
      blockCatchUpStream = false;
      const afterAction = await waitForOutcome(
        page,
        (snapshot) => snapshot.sessionMode === 'live' && snapshot.hasFrame && !snapshot.catchUpOverlay,
        20_000
      );
      await safePageScreenshot(page, {
        path: resolve(outDir, `catchup-failure-${candidate.id}.png`),
        fullPage: true,
      });
      await closeContext(context);

      return {
        id: 'catchup-failure-live-action',
        steps: [
          {
            step: `catch-up failure overlay candidate ${candidate.id}`,
            ok: beforeAction.catchUpOverlay && beforeAction.switchLiveAction && !beforeAction.credentialLeakInText,
            candidate: candidate.id,
            abortedCount: aborted.length,
            ...redact(beforeAction),
          },
          {
            step: `catch-up failure live action candidate ${candidate.id}`,
            ok: afterAction.hasFrame && !afterAction.catchUpOverlay,
            candidate: candidate.id,
            ...redact(afterAction),
          },
        ],
        events: redact(events),
      };
    } catch (error) {
      attempts.push({
        id: candidate.id,
        ok: false,
        reason: 'exception',
        error: redact(error instanceof Error ? error.message : String(error)),
      });
      await closeContext(context);
    }
  }

  return {
    id: 'catchup-failure-live-action',
    steps: [
      {
        step: 'find one catch-up channel and verify forced failure live action',
        ok: false,
        candidateCount: candidates.length,
      },
    ],
    attempts: redact(attempts),
  };
};

const writeReports = (results) => {
  const redactedResults = redact(results);
  const failures = redactedResults.flatMap((result) => (
    result.steps
      .filter((step) => step.ok === false)
      .map((step) => `${result.id}: ${step.step}`)
  ));
  const report = {
    timestamp: new Date().toISOString(),
    baseURL,
    storageState: storageStatePath,
    viewport,
    headless,
    browserChannel: browserChannel ?? null,
    scenarios: redactedResults.map((result) => result.id),
    status: failures.length === 0 ? 'passed' : 'failed',
    failures,
    results: redactedResults,
  };

  writeFileSync(reportJsonPath, JSON.stringify(report, null, 2), 'utf-8');

  const lines = [
    '# Focused Playback Smoke Report',
    '',
    `- Timestamp: \`${report.timestamp}\``,
    `- Base URL: \`${baseURL}\``,
    `- Viewport: \`${report.viewport.width}x${report.viewport.height}\``,
    `- Browser: \`${report.browserChannel ?? 'bundled chromium'}${report.headless ? ' headless' : ' headful'}\``,
    `- Scenarios: \`${report.scenarios.join(', ')}\``,
    `- Status: \`${report.status}\``,
    `- JSON: \`${reportJsonPath}\``,
    '',
    '## Results',
    ...redactedResults.flatMap((result) => [
      `### ${result.id}`,
      ...result.steps.map((step) => (
        `- [${step.ok === false ? 'FAIL' : 'PASS'}] ${step.step} | frame=${Boolean(step.hasFrame)} overlay=${Boolean(step.catchUpOverlay || step.liveFailureOverlay)} ms=${step.ms ?? 'n/a'}`
      )),
      ...(Array.isArray(result.channels)
        ? [
          '',
          '| # | Stream | Channel | Status | Result | Reason |',
          '| ---: | ---: | --- | --- | --- | --- |',
          ...result.channels.map((channel) => (
            `| ${channel.number ?? ''} | ${channel.streamId ?? ''} | ${String(channel.name ?? '').replace(/\|/g, '\\|')} | ${channel.status ?? 'unknown'} | ${channel.ok ? 'PASS' : 'FAIL'} | ${channel.providerIssueReasonCode ?? channel.steps?.find?.((step) => step.ok === false)?.reason ?? ''} |`
          )),
        ]
        : []),
      '',
    ]),
    '## Failures',
    ...(failures.length > 0 ? failures.map((failure) => `- ${failure}`) : ['- None']),
    '',
  ];

  writeFileSync(reportMdPath, lines.join('\n'), 'utf-8');
  return report;
};

const writeFailureReport = (error) => {
  const isCpuGuardBlock = error?.name === 'CpuGuardBlockedError';
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  const report = {
    timestamp: new Date().toISOString(),
    baseURL,
    storageState: storageStatePath,
    viewport,
    headless,
    browserChannel: browserChannel ?? null,
    scenarios: selectedScenarioIds,
    status: isCpuGuardBlock ? 'blocked-cpu' : 'failed',
    error: redact(message),
    cpuGuard: {
      enabled: cpuGuard.enabled,
      maxTotalPercent: cpuGuard.maxTotalPercent,
      pollMs: cpuGuard.pollMs,
      currentTotalPercent: typeof error?.currentTotalPercent === 'number'
        ? error.currentTotalPercent
        : null,
      phase: typeof error?.phase === 'string' ? error.phase : null,
    },
  };
  writeFileSync(reportJsonPath, JSON.stringify(report, null, 2), 'utf-8');
  writeFileSync(reportMdPath, [
    '# Focused Playback Smoke Report',
    '',
    `- Status: \`${report.status}\``,
    `- Error: \`${report.error}\``,
    `- CPU guard: \`${report.cpuGuard.enabled ? 'enabled' : 'disabled'}\``,
    `- CPU total: \`${report.cpuGuard.currentTotalPercent ?? 'unknown'}\``,
    `- CPU max: \`${report.cpuGuard.maxTotalPercent}\``,
    '',
  ].join('\n'), 'utf-8');
  return report;
};

const scenarioRunners = [
  ['live-failure-report', runLiveFailureScenario],
  ['catchup-failure-live-action', runCatchUpFailureScenario],
  ['playable-catchup-controls', runPlayableCatchUpControlsScenario],
  ['playable-catchup-mouse-seek', runPlayableCatchUpMouseSeekScenario],
  ['catchup-edge-stress', runCatchUpEdgeStressScenario],
  ['catchup-live-switch-stress', runCatchUpLiveSwitchStressScenario],
  ['catchup-catalog-smoke', runCatchUpCatalogSmokeScenario],
  ['rapid-live-zap', runRapidZapScenario],
  ['live-multichannel-soak', runLiveMultiChannelSoakScenario],
];
const validScenarioIds = scenarioRunners.map(([id]) => id);

let cleanupServer = async () => {};
let browser;
try {
  const unknownScenarioIds = findUnknownScenarioIds(
    selectedScenarioIds,
    validScenarioIds
  );
  if (unknownScenarioIds.length > 0) {
    throw new Error(
      `No focused playback smoke runner for scenario(s): ${unknownScenarioIds.join(', ')}. ` +
      `Valid scenarios: ${validScenarioIds.join(', ')}`
    );
  }

  assertCpuLoadAllowsBrowserSmoke('preflight', { force: true });
  await validateXtreamAuthPreflight();
  cleanupServer = await ensureDevServer();
  assertCpuLoadAllowsBrowserSmoke('before browser launch', { force: true });
  browser = await chromium.launch({
    headless,
    channel: browserChannel,
    args: ['--mute-audio'],
  });
  const selectedRunners = scenarioRunners.filter(([id]) => selectedScenarioIdSet.has(id));
  if (selectedRunners.length === 0) {
    throw new Error(
      `No focused playback smoke scenarios selected. Valid scenarios: ${validScenarioIds.join(', ')}`
    );
  }

  const results = [];
  for (const [, runScenario] of selectedRunners) {
    assertCpuLoadAllowsBrowserSmoke('before scenario', { force: true });
    results.push(await runScenario(browser));
  }
  const report = writeReports(results);
  console.log(`[focused-playback-smoke] Report generated at ${reportMdPath}`);
  if (report.status !== 'passed') {
    process.exitCode = 1;
  }
} catch (error) {
  const report = writeFailureReport(error);
  console.error(`[focused-playback-smoke] ${report.error}`);
  process.exitCode = 1;
} finally {
  if (browser) {
    await browser.close();
  }
  await cleanupServer();
}
