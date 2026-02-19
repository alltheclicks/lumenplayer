import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium, type FullConfig } from '@playwright/test';

const STORAGE_STATE_PATH = resolve(
  process.cwd(),
  'output/playwright/qa-user-sim/storage-state.json'
);

async function globalSetup(config: FullConfig): Promise<void> {
  const username = process.env.E2E_XUI_USERNAME;
  const password = process.env.E2E_XUI_PASSWORD;

  if (!username || !password) {
    throw new Error(
      'Missing E2E_XUI_USERNAME / E2E_XUI_PASSWORD env vars. Set them before running QA simulation.'
    );
  }

  const baseURL = config.projects[0]?.use?.baseURL;
  if (!baseURL || typeof baseURL !== 'string') {
    throw new Error('Playwright baseURL is not configured.');
  }

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${baseURL}/login`);
  await page.getByLabel('Korisničko ime').fill(username);
  await page.getByLabel('Lozinka').fill(password);
  await page.getByRole('button', { name: /^Prijavi se$/ }).click();
  await page.waitForURL('**/player', { timeout: 30_000 });

  mkdirSync(dirname(STORAGE_STATE_PATH), { recursive: true });
  await context.storageState({ path: STORAGE_STATE_PATH });

  await context.close();
  await browser.close();
}

export default globalSetup;
