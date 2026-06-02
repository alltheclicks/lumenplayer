import { writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { createQaNetworkTracker } from './qaNetworkTracker';

type TimelineEntry = {
  step: string;
  status: 'pass' | 'blocked' | 'info';
  code: string;
  url: string;
  note: string;
};

const record = (
  timeline: TimelineEntry[],
  page: Page,
  step: string,
  status: TimelineEntry['status'],
  code: string,
  note: string
) => {
  timeline.push({
    step,
    status,
    code,
    url: page.url(),
    note,
  });
};

const readVideoPaused = async (page: Page): Promise<boolean | null> => {
  return page.evaluate(() => {
    const video = document.querySelector('video') as HTMLVideoElement | null;
    return video ? video.paused : null;
  });
};

const PREFERRED_LIVE_CHANNELS = [
  /^PINK$/i,
  /^RTS\s*1/i,
  /^NOVA\s*S$/i,
  /^PRVA$/i,
  /^OBN$/i,
];

const readChannelButtonName = async (page: Page, index: number): Promise<string> => (
  (await page
    .locator('[data-testid="channel-select"]')
    .nth(index)
    .locator('p.font-medium')
    .first()
    .innerText()
    .catch(() => '')).trim()
);

const pickPreferredLiveChannelButton = async (
  page: Page,
  excludedName?: string,
): Promise<null | { index: number; name: string }> => {
  const buttons = page.locator('[data-testid="channel-select"]');
  await buttons.first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined);
  const count = await buttons.count();
  if (count < 1) {
    return null;
  }

  const active = page.locator('[data-testid="channel-row"][data-active="true"]');
  const activeName = await active.first().locator('p.font-medium').first().innerText().catch(() => '');
  const normalizedExcluded = (excludedName ?? activeName).trim();

  for (const preferred of PREFERRED_LIVE_CHANNELS) {
    for (let i = 0; i < Math.min(count, 30); i += 1) {
      const name = await readChannelButtonName(page, i);
      if (name.length > 0 && name !== normalizedExcluded && preferred.test(name)) {
        return { index: i, name };
      }
    }
  }

  for (let i = 0; i < Math.min(count, 12); i += 1) {
    const name = await readChannelButtonName(page, i);
    if (name.length > 0 && name !== normalizedExcluded) {
      return { index: i, name };
    }
  }

  const fallbackName = await readChannelButtonName(page, 0);
  return fallbackName.length > 0 ? { index: 0, name: fallbackName } : null;
};

const waitForVideoPlaying = async (page: Page, timeoutMs: number): Promise<void> => {
  await page.waitForFunction(() => {
    const video = document.querySelector('video') as HTMLVideoElement | null;
    return Boolean(video && !video.paused);
  }, undefined, { timeout: timeoutMs });
};

test('QAF-006: live startup mode manual vs autoplay', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(10_000);
  page.setDefaultNavigationTimeout(20_000);

  const timeline: TimelineEntry[] = [];
  const blockers: string[] = [];
  const qaNetworkTracker = createQaNetworkTracker(page);

  const withStep = async (
    step: string,
    code: string,
    action: () => Promise<void>,
    timeoutMs = 20_000,
    okNote = 'OK'
  ): Promise<boolean> => {
    try {
      await Promise.race([
        action(),
        new Promise((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Timeout after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      ]);
      record(timeline, page, step, 'pass', code, okNote);
      return true;
    } catch (error) {
      const note = error instanceof Error ? error.message : String(error);
      const blocker = `${code}: ${note}`;
      blockers.push(blocker);
      record(timeline, page, step, 'blocked', code, note.slice(0, 280));
      return false;
    }
  };

  await withStep(
    'Set live startup mode to MANUAL',
    'QAF006_SET_MANUAL_FAILED',
    async () => {
      await page.goto('/settings');
      const startupMode = page.locator('#liveChannelStartMode');
      await startupMode.selectOption('manual');
      await page.getByRole('button', { name: /Save settings/i }).click();
      await expect(page.getByText('Settings saved successfully.')).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath('01-settings-manual.png'),
        fullPage: true,
      });
    }
  );

  await withStep(
    'Manual mode should keep playback paused after channel select',
    'QAF006_MANUAL_EXPECTED_PAUSED',
    async () => {
      await page.goto('/player');
      const selected = await pickPreferredLiveChannelButton(page);
      if (!selected) {
        throw new Error('No channel rows available for manual mode validation.');
      }
      await page.locator('[data-testid="channel-select"]').nth(selected.index).click();
      await page.waitForTimeout(1600);
      const paused = await readVideoPaused(page);
      if (paused !== true) {
        throw new Error(`Expected video.paused=true in manual mode, got ${String(paused)}.`);
      }
      await page.screenshot({
        path: testInfo.outputPath('02-player-manual.png'),
        fullPage: true,
      });
    }
  );

  await withStep(
    'Set live startup mode to AUTOPLAY',
    'QAF006_SET_AUTOPLAY_FAILED',
    async () => {
      await page.goto('/settings');
      const startupMode = page.locator('#liveChannelStartMode');
      await startupMode.selectOption('autoplay');
      await page.getByRole('button', { name: /Save settings/i }).click();
      await expect(page.getByText('Settings saved successfully.')).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath('03-settings-autoplay.png'),
        fullPage: true,
      });
    }
  );

  await withStep(
    'Autoplay mode should start playback after channel select',
    'QAF006_AUTOPLAY_EXPECTED_PLAYING',
    async () => {
      await page.goto('/player');
      const selected = await pickPreferredLiveChannelButton(page);
      if (!selected) {
        throw new Error('No channel rows available for autoplay validation.');
      }
      await page.locator('[data-testid="channel-select"]').nth(selected.index).click();
      await waitForVideoPlaying(page, 20_000);
      const paused = await readVideoPaused(page);
      if (paused !== false) {
        throw new Error(`Expected video.paused=false in autoplay mode, got ${String(paused)}.`);
      }
      await page.screenshot({
        path: testInfo.outputPath('04-player-autoplay.png'),
        fullPage: true,
      });
    },
    30_000
  );

  const summary = {
    scenario: 'Live startup mode manual vs autoplay',
    timeline,
    blockers,
  };

  const timelinePath = testInfo.outputPath('qa-live-autoplay.timeline.json');
  writeFileSync(timelinePath, JSON.stringify(summary, null, 2), 'utf-8');
  await testInfo.attach('qa-timeline', {
    path: timelinePath,
    contentType: 'application/json',
  });

  const networkPath = testInfo.outputPath('qa-live-autoplay.network.json');
  writeFileSync(
    networkPath,
    JSON.stringify({ scenario: summary.scenario, failures: qaNetworkTracker.getFailures() }, null, 2),
    'utf-8'
  );
  await testInfo.attach('qa-network', {
    path: networkPath,
    contentType: 'application/json',
  });
  qaNetworkTracker.dispose();
});
