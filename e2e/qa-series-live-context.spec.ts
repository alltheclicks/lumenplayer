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

type SeriesLinkSelector = {
  id: string;
  locatorFactory: (page: Page) => ReturnType<Page['locator']>;
};

const SERIES_LINK_SELECTORS: SeriesLinkSelector[] = [
  {
    id: 'series-link-prefix',
    locatorFactory: (page) => page.locator('a[href^="/series/"]'),
  },
  {
    id: 'series-grid-link',
    locatorFactory: (page) => page.locator('main .grid a[href*="/series/"]'),
  },
  {
    id: 'series-main-link',
    locatorFactory: (page) => page.locator('main a[href*="/series/"]'),
  },
];

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

const buildSelectorDiagnostics = async (page: Page): Promise<string> => {
  const parts: string[] = [];

  for (const selector of SERIES_LINK_SELECTORS) {
    const locator = selector.locatorFactory(page);
    const total = await locator.count();
    let visible = 0;
    for (let i = 0; i < Math.min(total, 12); i += 1) {
      if (await locator.nth(i).isVisible().catch(() => false)) {
        visible += 1;
      }
    }
    parts.push(`${selector.id}(total=${total},visible=${visible})`);
  }

  const emptyStateVisible = await page.getByText(/Nema rezultata/i).first().isVisible().catch(() => false);
  const loadingVisible = await page.getByText(/Učitavanje serijskog kataloga/i).first().isVisible().catch(() => false);
  parts.push(`emptyState=${emptyStateVisible}`);
  parts.push(`loading=${loadingVisible}`);

  return parts.join('; ');
};

const waitForSeriesCatalogToSettle = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => {
    const links = Array.from(document.querySelectorAll('main a[href^="/series/"]'));
    const hasSeriesLink = links.some((link) => {
      const rect = link.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    const text = document.body.innerText;
    const hasError = /Neuspešno učitavanje serija/i.test(text);
    const hasEmptyState = /Nema rezultata za zadatu pretragu ili kategoriju/i.test(text);
    const isLoading = /Učitavanje serijskog kataloga/i.test(text);
    return hasSeriesLink || hasError || hasEmptyState || !isLoading;
  }, undefined, { timeout: 30_000 });
};

const openFirstSeriesDetail = async (
  page: Page
): Promise<{ selectorUsed: string; diagnostics: string; fallbackUsed: string | null }> => {
  const clickFirstVisible = async (): Promise<null | string> => {
    for (const selector of SERIES_LINK_SELECTORS) {
      const locator = selector.locatorFactory(page);
      const count = await locator.count();
      for (let i = 0; i < Math.min(count, 20); i += 1) {
        const candidate = locator.nth(i);
        if (await candidate.isVisible().catch(() => false)) {
          await candidate.click();
          return selector.id;
        }
      }
    }
    return null;
  };

  const resolveFallbackHref = async (): Promise<string | null> => {
    return page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('main a[href^="/series/"]')) as HTMLAnchorElement[];
      for (const link of links) {
        if (typeof link.href === 'string' && link.href.includes('/series/')) {
          return link.href;
        }
      }
      return null;
    });
  };

  await waitForSeriesCatalogToSettle(page);
  const providerError = await page
    .getByText(/Neuspešno učitavanje serija/i)
    .first()
    .innerText()
    .catch(() => '');
  if (providerError.trim().length > 0) {
    throw new Error(`Series catalog provider error: ${providerError.trim()}`);
  }

  let diagnostics = await buildSelectorDiagnostics(page);
  let selectorUsed = await clickFirstVisible();
  let fallbackUsed: string | null = null;

  if (!selectorUsed) {
    const allSeriesButton = page.getByRole('button', { name: /Sve serije/i }).first();
    if (await allSeriesButton.isVisible().catch(() => false)) {
      fallbackUsed = 'reset-all-category';
      await allSeriesButton.click();
      await page.waitForTimeout(500);
      diagnostics = `${diagnostics}; after-reset: ${await buildSelectorDiagnostics(page)}`;
      selectorUsed = await clickFirstVisible();
    }
  }

  if (!selectorUsed) {
    const fallbackHref = await resolveFallbackHref();
    if (fallbackHref) {
      fallbackUsed = fallbackUsed ? `${fallbackUsed}+direct-href` : 'direct-href';
      await page.goto(fallbackHref);
      selectorUsed = 'direct-href';
    }
  }

  if (!selectorUsed) {
    throw new Error(`No series detail card available. diagnostics=${diagnostics}`);
  }

  return {
    selectorUsed,
    diagnostics,
    fallbackUsed,
  };
};

const openTvUzivoFromOnDemandPlayer = async (page: Page): Promise<void> => {
  const tvUzivoButton = page.getByRole('button', { name: /TV U[žz]ivo/i }).first();
  if (await tvUzivoButton.isVisible().catch(() => false)) {
    await tvUzivoButton.click();
    return;
  }

  const tvUzivoLink = page.getByRole('link', { name: /TV U[žz]ivo/i }).first();
  if (await tvUzivoLink.isVisible().catch(() => false)) {
    await tvUzivoLink.click();
    return;
  }

  throw new Error('TV Uživo navigation is not visible in on-demand player state.');
};

test('QAF-002: Series episode -> TV Uživo -> Live shell', async ({ page }, testInfo) => {
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
      const detailOpenResult = await openFirstSeriesDetail(page);
      if (!/\/series\/[^/?]+/.test(page.url())) {
        throw new Error(
          `Failed to open series detail: ${page.url()} | selector=${detailOpenResult.selectorUsed} | diagnostics=${detailOpenResult.diagnostics}`
        );
      }
      await page.screenshot({
        path: testInfo.outputPath('02-series-detail.png'),
        fullPage: true,
      });
      const fallbackNote = detailOpenResult.fallbackUsed
        ? `, fallback=${detailOpenResult.fallbackUsed}`
        : '';
      record(
        timeline,
        page,
        'Series entry diagnostics',
        'info',
        'QAF008_SERIES_ENTRY_DIAGNOSTICS',
        `selector=${detailOpenResult.selectorUsed}${fallbackNote} | ${detailOpenResult.diagnostics}`
      );
    },
    20_000,
    'Opened series detail with robust selector path.'
  );

  const openedEpisode = openedDetail && await withStep(
    'Play episode and open on-demand player',
    'QAF002_PLAY_EPISODE_FAILED',
    async () => {
      const playEpisodeButton = page.getByRole('button', { name: /Play Episode/i }).first();
      await playEpisodeButton.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined);
      if (!(await playEpisodeButton.isVisible().catch(() => false))) {
        throw new Error('No Play Episode button visible.');
      }
      await playEpisodeButton.click();
      if (!/\/player$/.test(page.url())) {
        throw new Error(`Episode play did not navigate to player: ${page.url()}`);
      }
      const onDemandHeading = page.getByRole('heading', { name: /Episode Playback/i });
      await expect(onDemandHeading).toBeVisible({ timeout: 30_000 });
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
        await openTvUzivoFromOnDemandPlayer(page);
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

  const networkPath = testInfo.outputPath('qa-series-live-context.network.json');
  writeFileSync(
    networkPath,
    JSON.stringify({
      scenario: summary.scenario,
      failures: qaNetworkTracker.getFailures(),
      successes: qaNetworkTracker.getSuccesses(),
    }, null, 2),
    'utf-8'
  );
  await testInfo.attach('qa-network', {
    path: networkPath,
    contentType: 'application/json',
  });
  qaNetworkTracker.dispose();
});
