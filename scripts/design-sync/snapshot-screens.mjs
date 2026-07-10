#!/usr/bin/env node
/**
 * Screen snapshotter for the design-sync bundle.
 *
 * Captures REAL app screens (served by the Vite dev server) as self-contained,
 * per-resolution HTML files under scripts/design-sync/dist/screens/ so they show
 * up as "Screens" cards in the claude.ai/design project.
 *
 * Per-resolution fidelity: responsive media queries are FROZEN for the captured
 * viewport (min/max-width blocks are promoted or stripped), so each card renders
 * as that resolution regardless of how wide the design pane shows it.
 *
 * Usage:
 *   E2E_XUI_USERNAME=... E2E_XUI_PASSWORD=... node scripts/design-sync/snapshot-screens.mjs
 *   DESIGN_SNAPSHOT_STORAGE_STATE=path/to/storage-state.json node scripts/design-sync/snapshot-screens.mjs
 *   (without credentials or a storage state only the Login screen is captured)
 *
 * Reuses the e2e login flow (e2e/global-setup.ts selectors). Starts the dev
 * server on :8080 if it is not already running.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const DIST = path.join(HERE, "dist");
const SCREENS_DIR = path.join(DIST, "screens");
const BASE_URL = process.env.DESIGN_SNAPSHOT_URL ?? "http://localhost:8080";
const USERNAME = process.env.E2E_XUI_USERNAME;
const PASSWORD = process.env.E2E_XUI_PASSWORD;
// Alternative to env credentials: a Playwright storage state whose localStorage
// already carries the app's saved login (e.g. an e2e qa-user-sim artifact).
const STORAGE_STATE = process.env.DESIGN_SNAPSHOT_STORAGE_STATE;

const sha1 = (s) => createHash("sha1").update(s).digest("hex").slice(0, 12);

const SCREENS = [
  // fresh: captured in a NEW unauthenticated context — an authed session redirects /login to /player.
  { route: "/login", name: "Login", auth: false, fresh: true, settle: 3000 },
  { route: "/player", name: "Player", auth: true, settle: 8000 },
  {
    route: "/player",
    name: "Player Playback",
    auth: true,
    settle: 3000,
    interact: async (page) => {
      await page.getByText("RTS 1", { exact: true }).first().click({ timeout: 8000 });
      await page.waitForTimeout(12000);
    },
  },
  { route: "/epg", name: "EPG Guide", auth: true, settle: 8000 },
  { route: "/settings", name: "Settings", auth: true, settle: 3000 },
];

const VIEWPORTS = [
  { key: "desktop", width: 1440, height: 900, label: "Desktop 1440" },
  { key: "mobile", width: 390, height: 844, label: "Mobile 390" },
  { key: "tv", width: 1920, height: 1080, label: "TV 1920", routes: ["/player", "/login"] },
];

// ---------------------------------------------------------------------------
// Media-query freezing
// ---------------------------------------------------------------------------

function evalCondition(cond, width) {
  const mins = [...cond.matchAll(/\(min-width:\s*([\d.]+)px\)/g)].map((m) => Number(m[1]));
  const maxs = [...cond.matchAll(/\(max-width:\s*([\d.]+)px\)/g)].map((m) => Number(m[1]));
  const leftover = cond
    .replace(/\((min|max)-width:\s*[\d.]+px\)/g, "")
    .replace(/\b(screen|all|only|and)\b/g, "")
    .replace(/[\s,()]/g, "");
  if (leftover) return "keep"; // prefers-*, orientation, print... — leave untouched
  if (!mins.length && !maxs.length) return "keep";
  const matches = mins.every((v) => width >= v) && maxs.every((v) => width <= v);
  return matches ? "promote" : "strip";
}

/** Promote (unwrap) width MQs that match `width`, strip those that don't. */
function freezeMediaQueries(html, width) {
  let out = html;
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    let result = "";
    let pos = 0;
    let i = out.indexOf("@media", pos);
    while (i !== -1) {
      const braceOpen = out.indexOf("{", i);
      if (braceOpen === -1) break;
      const cond = out.slice(i + 6, braceOpen);
      let depth = 1;
      let j = braceOpen + 1;
      while (j < out.length && depth > 0) {
        const ch = out[j];
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        j++;
      }
      const inner = out.slice(braceOpen + 1, j - 1);
      const decision = evalCondition(cond, width);
      if (decision === "keep") {
        result += out.slice(pos, j);
      } else {
        changed = true;
        result += out.slice(pos, i);
        if (decision === "promote") result += inner;
      }
      pos = j;
      i = out.indexOf("@media", pos);
    }
    result += out.slice(pos);
    out = result;
    if (!changed) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dev server management
// ---------------------------------------------------------------------------

async function isUp(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await isUp(BASE_URL)) return null;
  console.log(`dev server not running — starting on ${BASE_URL} ...`);
  const child = spawn("pnpm", ["--filter", "@lumen/web", "dev", "--host", "localhost", "--port", "8080"], {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (await isUp(BASE_URL)) return child;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("dev server did not become reachable within 90s");
}

function stopServer(child) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    /* already gone */
  }
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

async function sanitizePage(page) {
  await page.evaluate(async () => {
    document
      .querySelectorAll('script, link[rel="modulepreload"], link[rel="preload"], link[rel="prefetch"]')
      .forEach((e) => e.remove());
    document.querySelectorAll("video").forEach((v) => {
      const d = document.createElement("div");
      d.className = v.className;
      d.style.cssText =
        "position:absolute;inset:0;width:100%;height:100%;background:#000;display:flex;align-items:center;justify-content:center;color:#444;font:600 14px system-ui;letter-spacing:.2em;";
      d.textContent = "VIDEO";
      v.replaceWith(d);
    });
    for (const img of Array.from(document.images)) {
      try {
        if (!img.naturalWidth) throw new Error("not loaded");
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext("2d").drawImage(img, 0, 0);
        const uri = c.toDataURL("image/png");
        img.removeAttribute("srcset");
        img.src = uri;
      } catch {
        const w = img.width || 48;
        const h = img.height || 48;
        img.removeAttribute("srcset");
        img.src = `data:image/svg+xml,${encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#27272a"/></svg>`,
        )}`;
      }
    }
  });
}

function postProcess(html, screen, vp) {
  let out = freezeMediaQueries(html, vp.width);
  const frame =
    vp.width < 800
      ? `body{min-width:${vp.width}px;max-width:${vp.width}px;min-height:${vp.height}px;margin:0 auto;box-shadow:0 0 0 1px #333}html{background:#000}`
      : `body{min-width:${vp.width}px;min-height:${vp.height}px}`;
  out = out.replace("</head>", `<style id="__ds_frame">${frame}</style></head>`);
  const marker = `<!-- @dsCard group="Screens" name="${screen.name} — ${vp.label}" -->\n`;
  const note = `<!-- Live snapshot of ${BASE_URL}${screen.route} at ${vp.width}x${vp.height}. Media queries frozen for this width. Derived — edit intent here, /design-pull translates it to apps/web sources. -->\n`;
  return marker + note + out;
}

async function main() {
  const server = await ensureServer();
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const captured = [];
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      ...(STORAGE_STATE ? { storageState: STORAGE_STATE } : {}),
    });
    let authed = false;

    if (STORAGE_STATE) {
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/player`);
      try {
        await page.waitForURL("**/player", { timeout: 30_000 });
        authed = true;
        console.log("storage state accepted — capturing authenticated screens");
      } catch {
        console.warn("storage state rejected (redirected away from /player) — capturing only public screens");
      }
      await page.close();
    } else if (USERNAME && PASSWORD) {
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/login`);
      await page.getByLabel("Korisničko ime").fill(USERNAME);
      await page.getByLabel("Lozinka").fill(PASSWORD);
      await page.getByRole("button", { name: /^Prijavi se$/ }).click();
      try {
        await page.waitForURL("**/player", { timeout: 30_000 });
        authed = true;
        console.log("login OK — capturing authenticated screens");
      } catch {
        console.warn("login FAILED — capturing only public screens");
      }
      await page.close();
    } else {
      console.log("no E2E_XUI_USERNAME/PASSWORD — capturing only the Login screen");
    }

    fs.mkdirSync(SCREENS_DIR, { recursive: true });

    for (const screen of SCREENS) {
      if (screen.auth && !authed) continue;
      for (const vp of VIEWPORTS) {
        if (vp.routes && !vp.routes.includes(screen.route)) continue;
        const ctx = screen.fresh ? await browser.newContext({ viewport: { width: vp.width, height: vp.height } }) : context;
        const page = await ctx.newPage();
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(`${BASE_URL}${screen.route}`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(screen.settle);
        if (screen.interact) {
          try {
            await screen.interact(page);
          } catch (err) {
            console.warn(`  interact failed on ${screen.name} (${vp.key}): ${String(err).split("\n")[0]}`);
          }
        }
        await sanitizePage(page);
        const html = postProcess(await page.content(), screen, vp);
        const file = `screens/${screen.name.toLowerCase().replace(/\s+/g, "-")}-${vp.key}.html`;
        fs.writeFileSync(path.join(DIST, file), html);
        captured.push({ path: file, sources: [`live snapshot ${screen.route} @ ${vp.width}x${vp.height}`], hash: sha1(html) });
        console.log(`  captured ${file} (${Math.round(html.length / 1024)}KB)`);
        await page.close();
        if (screen.fresh) await ctx.close();
      }
    }
  } finally {
    await browser.close();
    stopServer(server);
  }

  // Merge into bundle.json (screens section owned by this script).
  const manifestPath = path.join(DIST, "bundle.json");
  if (!fs.existsSync(manifestPath)) throw new Error("dist/bundle.json missing — run build-bundle.mjs first");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  // Rebuild the screens section from ALL files on disk (a partial rerun — e.g. unauthed
  // login-only — must not drop manifest entries for screens captured earlier).
  const allScreens = fs
    .readdirSync(SCREENS_DIR)
    .filter((f) => f.endsWith(".html"))
    .map((f) => ({
      path: `screens/${f}`,
      sources: ["live snapshot (snapshot-screens.mjs)"],
      hash: sha1(fs.readFileSync(path.join(SCREENS_DIR, f), "utf8")),
    }));
  manifest.cards = [...manifest.cards.filter((c) => !c.path.startsWith("screens/")), ...allScreens];
  manifest.screensCapturedAt = new Date().toISOString();
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Screens OK — ${captured.length} captured, manifest updated`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
