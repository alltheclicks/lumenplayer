// Screenshot every frame of the Klaro motion drivers. Usage: NODE_PATH=<playwright> node motion_frames.mjs jobs.json
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve("playwright", { paths: [process.env.NODE_PATH] }));
const jobs = JSON.parse(readFileSync(process.argv[2], "utf8"));

const browser = await chromium.launch({ channel: "chrome" });
for (const job of jobs) {
  mkdirSync(job.out, { recursive: true });
  const page = await browser.newPage({ viewport: { width: job.w, height: job.h }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(job.html).href);
  for (let i = 0; i < job.frames; i++) {
    await page.evaluate((t) => window.frame(t), i / job.fps);
    await page.screenshot({ path: `${job.out}/f${String(i).padStart(4, "0")}.png`, clip: { x: 0, y: 0, width: job.w, height: job.h } });
  }
  await page.close();
  console.log(`${job.name}: ${job.frames} frames`);
}
await browser.close();
