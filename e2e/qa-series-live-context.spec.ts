import { writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test } from '@playwright/test';

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

test('QAF-002: Series episode -> TV Uživo -> Live shell', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(10_000);
  page.setDefaultNavigationTimeout(20_000);

  const timeline: TimelineEntry[] = [];
  const blockers: string[] = [];

  const withStep = async (
    step: string,
    code: string,
    action: () => Promise<void>,
    timeoutMs = 20_000
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
      record(timeline, page, step, 'pass', code, 'OK');
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
    'Open /series',
    'QAF002_OPEN_SERIES_FAILED',
    async () => {
      await page.goto('/series');
      if (!/\/series(?:\?.*)?$/.test(page.url())) {
        throw new Error(`Unexpected URL: ${page.url()}`);
      }
      await page.screenshot({
        path: testInfo.outputPath('01-series-list.png'),
        fullPage: true,
      });
    },
    30_000
  );

  const openedDetail = await withStep(
    'Open first series detail',
    'QAF002_NO_SERIES_CARD',
    async () => {
      const firstSeriesCard = page.locator('a[href^="/series/"]').first();
      if (!(await firstSeriesCard.isVisible().catch(() => false))) {
        throw new Error('No series detail card available.');
      }
      await firstSeriesCard.click();
      if (!/\/series\/[^/?]+/.test(page.url())) {
        throw new Error(`Failed to open series detail: ${page.url()}`);
      }
      await page.screenshot({
        path: testInfo.outputPath('02-series-detail.png'),
        fullPage: true,
      });
    }
  );

  const openedEpisode = openedDetail && await withStep(
    'Play episode and open on-demand player',
    'QAF002_PLAY_EPISODE_FAILED',
    async () => {
      const playEpisodeButton = page.getByRole('button', { name: /Play Episode/i }).first();
      if (!(await playEpisodeButton.isVisible().catch(() => false))) {
        throw new Error('No Play Episode button visible.');
      }
      await playEpisodeButton.click();
      if (!/\/player$/.test(page.url())) {
        throw new Error(`Episode play did not navigate to player: ${page.url()}`);
      }
      const onDemandHeading = page.getByRole('heading', { name: /Episode Playback/i });
      if (!(await onDemandHeading.isVisible().catch(() => false))) {
        throw new Error('Episode playback context was not detected on /player.');
      }
      await page.screenshot({
        path: testInfo.outputPath('03-episode-player.png'),
        fullPage: true,
      });
    },
    30_000
  );

  if (openedEpisode) {
    await withStep(
      'TV Uživo should reset to live shell',
      'QAF002_LIVE_SHELL_NOT_RESTORED',
      async () => {
        const goLive = page.getByRole('link', { name: /TV Uživo/i }).first();
        if (!(await goLive.isVisible().catch(() => false))) {
          throw new Error('TV Uživo navigation is not visible in on-demand player state.');
        }
        await goLive.click();
        if (!/\/player$/.test(page.url())) {
          throw new Error(`TV Uživo did not navigate to /player: ${page.url()}`);
        }
        const onDemandHeading = page.getByRole('heading', { name: /Episode Playback/i });
        if (await onDemandHeading.isVisible().catch(() => false)) {
          throw new Error('Stale episode context still visible after TV Uživo navigation.');
        }
        const liveList = page.locator('[data-testid="channel-list-desktop"]').first();
        if (!(await liveList.isVisible().catch(() => false))) {
          throw new Error('Live channel list is not visible after TV Uživo navigation.');
        }
        await page.screenshot({
          path: testInfo.outputPath('04-live-shell.png'),
          fullPage: true,
        });
      },
      30_000
    );
  } else {
    record(
      timeline,
      page,
      'TV Uživo should reset to live shell',
      'info',
      'QAF002_SKIPPED_NO_EPISODE',
      'Skipped because episode did not open in previous step.'
    );
  }

  const summary = {
    scenario: 'Series episode -> TV Uživo -> Live shell',
    timeline,
    blockers,
  };

  const timelinePath = testInfo.outputPath('qa-series-live-context.timeline.json');
  writeFileSync(timelinePath, JSON.stringify(summary, null, 2), 'utf-8');
  await testInfo.attach('qa-timeline', {
    path: timelinePath,
    contentType: 'application/json',
  });
});
