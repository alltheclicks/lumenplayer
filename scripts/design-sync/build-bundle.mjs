#!/usr/bin/env node
/**
 * Design-sync bundle generator.
 *
 * Builds a self-contained HTML preview gallery of the CURRENT web design
 * (tokens + shadcn UI primitives + representative compositions) for a
 * claude.ai/design design-system project.
 *
 * Fidelity strategy:
 *  - tokens are copied VERBATIM from apps/web/src/index.css (round-trip source of truth)
 *  - component classes are EXTRACTED from the real source files at build time
 *    (cva() variants and cn("...") literals), so previews cannot drift from code
 *  - compositions under templates/ are hand-authored fragments using the same
 *    semantic classes; they are representative, not pixel-ports of the React tree
 *
 * Output: scripts/design-sync/dist/  (upload bundle, gitignored)
 * Usage:  node scripts/design-sync/build-bundle.mjs
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const WEB = path.join(ROOT, "apps/web");
const SRC = path.join(WEB, "src");
const UI = path.join(SRC, "components/ui");
const TEMPLATES = path.join(HERE, "templates");
const DIST = path.join(HERE, "dist");
const BUILD = path.join(HERE, ".build");

const read = (p) => fs.readFileSync(p, "utf8");
const sha1 = (s) => createHash("sha1").update(s).digest("hex").slice(0, 12);
const rel = (p) => path.relative(ROOT, p);

// ---------------------------------------------------------------------------
// Source extraction helpers
// ---------------------------------------------------------------------------

/** Extract a top-level `selector { ... }` block body from CSS (2-space indented file). */
function findCssBlock(css, selector) {
  const re = new RegExp(`(^|\\n)\\s*${selector.replace(".", "\\.")}\\s*\\{([\\s\\S]*?)\\n  \\}`);
  const m = css.match(re);
  if (!m) throw new Error(`Token block not found: ${selector}`);
  return m[2];
}

/** Parse `--name: value;` pairs, preserving order. */
function parseVars(blockBody) {
  const vars = [];
  const re = /--([\w-]+):\s*([^;]+);/g;
  let m;
  while ((m = re.exec(blockBody))) vars.push({ name: m[1], value: m[2].trim() });
  return vars;
}

/** Extract cva(base, { variants: { group: { key: "classes" } } }) from a source file. */
function extractCva(source, cvaName) {
  const start = source.indexOf(`${cvaName} = cva(`);
  if (start === -1) throw new Error(`cva not found: ${cvaName}`);
  const slice = source.slice(start, start + 4000);
  const base = slice.match(/cva\(\s*(?:\/\/[^\n]*\n\s*)*"([^"]*)"/)?.[1];
  if (base === undefined) throw new Error(`cva base not found: ${cvaName}`);
  const variants = {};
  const groupRe = /(\w+):\s*\{([^}]*)\}/g;
  const variantsBlock = slice.match(/variants:\s*\{([\s\S]*?)\n\s*\}\s*,\s*\n\s*defaultVariants/)?.[1] ?? "";
  let g;
  while ((g = groupRe.exec(variantsBlock))) {
    const entries = {};
    const entryRe = /(\w+):\s*"([^"]*)"/g;
    let e;
    while ((e = entryRe.exec(g[2]))) entries[e[1]] = e[2];
    if (Object.keys(entries).length) variants[g[1]] = entries;
  }
  return { base, variants };
}

/** Ordered list of cn("...") first-literal class strings in a file. */
function extractCnLiterals(source) {
  const out = [];
  const re = /cn\(\s*\n?\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(source))) out.push(m[1]);
  return out;
}

// ---------------------------------------------------------------------------
// Load sources
// ---------------------------------------------------------------------------

const indexCssPath = path.join(SRC, "index.css");
const indexCss = read(indexCssPath);
const rootVarsBody = findCssBlock(indexCss, ":root");
const darkVarsBody = findCssBlock(indexCss, ".dark");
const lightVarsBody = findCssBlock(indexCss, ".light");

const buttonSrc = read(path.join(UI, "button-variants.ts"));
const alertSrc = read(path.join(UI, "alert.tsx"));
const toastSrc = read(path.join(UI, "toast.tsx"));
const inputSrc = read(path.join(UI, "input.tsx"));
const cardSrc = read(path.join(UI, "card.tsx"));
const labelSrc = read(path.join(UI, "label.tsx"));

const button = extractCva(buttonSrc, "buttonVariants");
const alert = extractCva(alertSrc, "alertVariants");
const toast = extractCva(toastSrc, "toastVariants");
const inputClasses = extractCnLiterals(inputSrc)[0];
const cardClasses = extractCnLiterals(cardSrc); // Card, Header, Title, Description, Content, Footer
const labelClasses = labelSrc.match(/cva\("([^"]+)"/)?.[1] ?? "text-sm font-medium leading-none";

// ---------------------------------------------------------------------------
// Preview assembly
// ---------------------------------------------------------------------------

const CSS_PLACEHOLDER = "/*__PREVIEW_CSS__*/";

function page({ title, group, sources, body, note }) {
  const sourceList = sources.map((s) => `<code>${s}</code>`).join(", ");
  return `<!-- @dsCard group="${group}" name="${title}" -->
<!doctype html>
<html class="dark" lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} — Lumen Player</title>
<style>${CSS_PLACEHOLDER}</style>
</head>
<body class="bg-background text-foreground antialiased">
<main class="mx-auto max-w-3xl space-y-6 p-6">
  <header class="space-y-1 border-b border-border pb-3">
    <h1 class="text-lg font-semibold">${title}</h1>
    <p class="text-xs text-muted-foreground">source: ${sourceList}${note ? ` · ${note}` : ""}</p>
  </header>
${body}
</main>
</body>
</html>
`;
}

const esc = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;");

// --- Foundations: tokens ----------------------------------------------------

const HSL_RE = /^\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%$/;

function swatchGrid(vars, themeLabel) {
  const cells = vars
    .map(({ name, value }) => {
      if (name === "radius") return "";
      const isColor = HSL_RE.test(value);
      const chip = isColor
        ? `<div class="h-10 rounded-md border border-border" style="background:hsl(${value})"></div>`
        : `<div class="flex h-10 items-center rounded-md border border-dashed border-border px-2 text-[10px] text-muted-foreground">${esc(value)}</div>`;
      return `<div class="space-y-1">${chip}<div class="text-[11px] font-medium leading-tight">--${name}</div><div class="text-[10px] text-muted-foreground">${esc(value)}</div></div>`;
    })
    .join("\n");
  return `<section class="space-y-3"><h2 class="text-sm font-semibold text-muted-foreground">${themeLabel}</h2><div class="grid grid-cols-3 gap-3 sm:grid-cols-4">${cells}</div></section>`;
}

const radius = parseVars(rootVarsBody).find((v) => v.name === "radius")?.value ?? "0.75rem";

const tokensHtml = page({
  title: "Design tokens",
  group: "Foundations",
  sources: ["apps/web/src/index.css"],
  note: "edit values in foundations/tokens.css — it round-trips back to the codebase verbatim",
  body: [
    swatchGrid(parseVars(rootVarsBody), ":root (dark — default theme)"),
    swatchGrid(parseVars(lightVarsBody), ".light (light theme overrides)"),
    `<section class="space-y-3"><h2 class="text-sm font-semibold text-muted-foreground">Radius (--radius: ${radius})</h2>
<div class="flex items-end gap-4">
  <div class="h-16 w-24 rounded-sm border border-border bg-card p-2 text-[10px] text-muted-foreground">rounded-sm</div>
  <div class="h-16 w-24 rounded-md border border-border bg-card p-2 text-[10px] text-muted-foreground">rounded-md</div>
  <div class="h-16 w-24 rounded-lg border border-border bg-card p-2 text-[10px] text-muted-foreground">rounded-lg</div>
</div></section>`,
  ].join("\n"),
});

const typographyHtml = page({
  title: "Typography scale",
  group: "Foundations",
  sources: ["apps/web (Tailwind defaults — no brand font token yet)"],
  body: `
<div class="space-y-4">
  <div class="text-4xl font-bold">Lumen Player 4xl/bold</div>
  <div class="text-2xl font-semibold leading-none tracking-tight">Card title 2xl/semibold</div>
  <div class="text-lg font-semibold">Section 18/semibold</div>
  <div class="text-base">Body 16/regular — Gledaj live TV, catch-up i video na svim uređajima.</div>
  <div class="text-sm text-muted-foreground">Muted 14 — EPG opis programa, sekundarne informacije.</div>
  <div class="text-xs text-muted-foreground">Caption 12 — vreme, metapodaci.</div>
</div>`,
});

const surfacesHtml = page({
  title: "Surfaces & elevation",
  group: "Foundations",
  sources: ["apps/web/src/index.css (--background/--card/--secondary/--muted, --surface-*)"],
  body: `
<div class="space-y-3">
  <div class="rounded-lg bg-background p-4 ring-1 ring-border">background — app canvas
    <div class="mt-3 rounded-lg border border-border bg-card p-4">card — panels, dialogs
      <div class="mt-3 rounded-md bg-secondary p-3 text-secondary-foreground">secondary — hover/selected
        <div class="mt-3 rounded-md bg-muted p-3 text-muted-foreground">muted — disabled, meta</div>
      </div>
    </div>
  </div>
</div>`,
});

// --- Components ---------------------------------------------------------------

function buttonRow(sizeKey, sizeClasses) {
  const cells = Object.entries(button.variants.variant)
    .map(
      ([name, cls]) =>
        `<button class="${button.base} ${cls} ${sizeClasses}">${name === "icon" ? "▶" : name}</button>`,
    )
    .join("\n");
  return `<section class="space-y-2"><h2 class="text-sm font-semibold text-muted-foreground">size: ${sizeKey}</h2><div class="flex flex-wrap items-center gap-3">${cells}</div></section>`;
}

const buttonsHtml = page({
  title: "Buttons",
  group: "Components",
  sources: ["apps/web/src/components/ui/button-variants.ts"],
  body: [
    ...Object.entries(button.variants.size).map(([k, v]) => buttonRow(k, v)),
    `<section class="space-y-2"><h2 class="text-sm font-semibold text-muted-foreground">disabled / focus ring</h2>
<div class="flex flex-wrap items-center gap-3">
  <button class="${button.base} ${button.variants.variant.default} ${button.variants.size.default}" disabled>disabled</button>
  <button class="${button.base} ${button.variants.variant.default} ${button.variants.size.default} ring-2 ring-ring ring-offset-2 ring-offset-background">focused (TV D-pad)</button>
</div></section>`,
  ].join("\n"),
});

const formHtml = page({
  title: "Form: input + label",
  group: "Components",
  sources: ["apps/web/src/components/ui/input.tsx", "apps/web/src/components/ui/label.tsx"],
  body: `
<div class="max-w-sm space-y-6">
  <div class="space-y-2"><label class="${labelClasses}">Server URL</label><input class="${inputClasses}" placeholder="http://example.com:8080" /></div>
  <div class="space-y-2"><label class="${labelClasses}">Korisničko ime</label><input class="${inputClasses}" value="fica" /></div>
  <div class="space-y-2"><label class="${labelClasses}">Lozinka (disabled)</label><input class="${inputClasses}" disabled placeholder="••••••••" /></div>
  <div class="space-y-2"><label class="${labelClasses}">Focused</label><input class="${inputClasses} ring-2 ring-ring ring-offset-2 ring-offset-background" value="fokusirano polje" /></div>
</div>`,
});

const [cardCls, cardHeaderCls, cardTitleCls, cardDescCls, cardContentCls, cardFooterCls] = cardClasses;
const cardHtml = page({
  title: "Card",
  group: "Components",
  sources: ["apps/web/src/components/ui/card.tsx"],
  body: `
<div class="${cardCls} max-w-sm">
  <div class="${cardHeaderCls}"><h3 class="${cardTitleCls}">RTS 1</h3><p class="${cardDescCls}">Dnevnik · 19:30 – 20:05</p></div>
  <div class="${cardContentCls}"><p class="text-sm">Centralna informativna emisija Radio-televizije Srbije.</p></div>
  <div class="${cardFooterCls} gap-2">
    <button class="${button.base} ${button.variants.variant.default} ${button.variants.size.sm}">Gledaj</button>
    <button class="${button.base} ${button.variants.variant.outline} ${button.variants.size.sm}">Catch-up</button>
  </div>
</div>`,
});

const alertsHtml = page({
  title: "Alerts & toast",
  group: "Components",
  sources: ["apps/web/src/components/ui/alert.tsx", "apps/web/src/components/ui/toast.tsx"],
  body: `
<div class="space-y-4 max-w-xl">
  <div class="${alert.base} ${alert.variants.variant.default}"><h5 class="mb-1 font-medium leading-none tracking-tight">Napomena</h5><div class="text-sm [&_p]:leading-relaxed">Catch-up prozor za ovaj kanal je 7 dana.</div></div>
  <div class="${alert.base} ${alert.variants.variant.destructive}"><h5 class="mb-1 font-medium leading-none tracking-tight">Kanal nedostupan</h5><div class="text-sm [&_p]:leading-relaxed">Live strim trenutno nije dostupan. Pokušaj ponovo.</div></div>
  <div class="${toast.base} ${toast.variants.variant.default}" data-state="open" style="animation:none"><div class="grid gap-1"><div class="text-sm font-semibold">Nastavljam reprodukciju</div><div class="text-sm opacity-90">RTS 1 · Dnevnik od 12:34</div></div></div>
</div>`,
});

const badgesHtml = page({
  title: "Playback badges (live / catch-up / success)",
  group: "Components",
  sources: ["apps/web/src/index.css (--live, --catchup, --success)"],
  note: "domain tokens — not yet mapped in tailwind.config.js, used via arbitrary values",
  body: `
<div class="flex flex-wrap items-center gap-3">
  <span class="inline-flex items-center gap-1.5 rounded-md bg-[hsl(var(--live))] px-2.5 py-1 text-xs font-semibold text-[hsl(var(--live-foreground))]"><span class="h-1.5 w-1.5 rounded-full bg-current"></span>UŽIVO</span>
  <span class="inline-flex items-center gap-1.5 rounded-md bg-[hsl(var(--catchup))] px-2.5 py-1 text-xs font-semibold text-[hsl(var(--catchup-foreground))]">CATCH-UP</span>
  <span class="inline-flex items-center gap-1.5 rounded-md bg-[hsl(var(--success))] px-2.5 py-1 text-xs font-semibold text-[hsl(var(--success-foreground))]">POVEZANO</span>
  <span class="inline-flex items-center gap-1.5 rounded-md bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground">HD</span>
</div>`,
});

// --- Compositions (hand-authored templates) -----------------------------------

function template(name) {
  return read(path.join(TEMPLATES, name));
}

const compositions = [
  {
    file: "compositions/player-controls.html",
    html: page({
      title: "Player controls (representative)",
      group: "Compositions",
      sources: ["apps/web/src/components/player/PlayerControls.tsx (representative, not a pixel port)"],
      body: template("player-controls.html"),
    }),
    sources: ["apps/web/src/components/player/PlayerControls.tsx"],
  },
  {
    file: "compositions/login.html",
    html: page({
      title: "Login (representative)",
      group: "Compositions",
      sources: ["apps/web/src/pages/Login.tsx (representative, not a pixel port)"],
      body: template("login.html"),
    }),
    sources: ["apps/web/src/pages/Login.tsx"],
  },
  {
    file: "compositions/channel-list.html",
    html: page({
      title: "Channel list (representative)",
      group: "Compositions",
      sources: ["apps/web/src/components (representative, not a pixel port)"],
      body: template("channel-list.html"),
    }),
    sources: ["apps/web/src/pages/Player.tsx"],
  },
];

// ---------------------------------------------------------------------------
// Write bundle, compile Tailwind, inline CSS
// ---------------------------------------------------------------------------

// Preserve dist/screens (owned by snapshot-screens.mjs); regenerate everything else.
for (const owned of ["foundations", "components", "compositions"]) {
  fs.rmSync(path.join(DIST, owned), { recursive: true, force: true });
}
fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(BUILD, { recursive: true });

const files = [
  { file: "foundations/tokens.html", html: tokensHtml, sources: ["apps/web/src/index.css"] },
  { file: "foundations/typography.html", html: typographyHtml, sources: ["apps/web/src/index.css"] },
  { file: "foundations/surfaces.html", html: surfacesHtml, sources: ["apps/web/src/index.css"] },
  { file: "components/buttons.html", html: buttonsHtml, sources: ["apps/web/src/components/ui/button-variants.ts", "apps/web/src/components/ui/button.tsx"] },
  { file: "components/form.html", html: formHtml, sources: ["apps/web/src/components/ui/input.tsx", "apps/web/src/components/ui/label.tsx"] },
  { file: "components/card.html", html: cardHtml, sources: ["apps/web/src/components/ui/card.tsx"] },
  { file: "components/alerts-toast.html", html: alertsHtml, sources: ["apps/web/src/components/ui/alert.tsx", "apps/web/src/components/ui/toast.tsx"] },
  { file: "components/badges.html", html: badgesHtml, sources: ["apps/web/src/index.css"] },
  ...compositions,
];

for (const f of files) {
  const out = path.join(DIST, f.file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, f.html);
}

// Verbatim token block — the machine-readable round-trip file.
// Conditional token overrides (e.g. the @supports linear() spring easing) ride
// along verbatim so the round-trip file carries every token definition.
const supportsBlocks = [...indexCss.matchAll(/@supports[^{]+\{[\s\S]*?\n {2}\}/g)]
  .map((m) => m[0].replace(/\n {2}/g, "\n"))
  .join("\n\n");
const tokensCss = `/* VERBATIM copy of the token blocks in apps/web/src/index.css.
 * /design-pull applies edits to this file back to the codebase 1:1.
 * Keep the structure: :root { } .dark { } .light { } */
:root {${rootVarsBody}
}

.dark {${darkVarsBody}
}

.light {${lightVarsBody}
}
${supportsBlocks ? `\n${supportsBlocks}\n` : ""}`;
fs.writeFileSync(path.join(DIST, "foundations/tokens.css"), tokensCss);

// Compile Tailwind against the generated HTML, then inline into every page.
const previewCssPath = path.join(BUILD, "preview.css");
execFileSync(
  "npx",
  ["tailwindcss", "-c", "tailwind.config.js", "-i", "src/index.css", "-o", previewCssPath, "--content", `${DIST}/foundations/*.html,${DIST}/components/*.html,${DIST}/compositions/*.html`, "--minify"],
  { cwd: WEB, stdio: ["ignore", "inherit", "inherit"] },
);
const previewCss = read(previewCssPath);
for (const f of files) {
  const out = path.join(DIST, f.file);
  fs.writeFileSync(out, read(out).replace(CSS_PLACEHOLDER, () => previewCss));
}

// Screens are owned by snapshot-screens.mjs but must survive gallery regeneration.
const screensDir = path.join(DIST, "screens");
const screenCards = fs.existsSync(screensDir)
  ? fs
      .readdirSync(screensDir)
      .filter((f) => f.endsWith(".html"))
      .map((f) => ({
        path: `screens/${f}`,
        sources: ["live snapshot (see snapshot-screens.mjs)"],
        hash: sha1(read(path.join(screensDir, f))),
      }))
  : [];

// Manifest: preview → source mapping + hashes (used by /design-pull to detect remote edits).
const manifest = {
  generatedAt: new Date().toISOString(),
  note: "Generated by scripts/design-sync/build-bundle.mjs — do not hand-edit in the codebase. Remote edits in claude.ai/design are pulled back via /design-pull.",
  tokensRoundTrip: "foundations/tokens.css",
  cards: [
    ...files.map((f) => ({
      path: f.file,
      sources: f.sources,
      hash: sha1(read(path.join(DIST, f.file))),
    })),
    ...screenCards,
  ],
  sourceHashes: Object.fromEntries(
    ["apps/web/src/index.css", "apps/web/src/components/ui/button-variants.ts"].map((p) => [p, sha1(read(path.join(ROOT, p)))]),
  ),
};
fs.writeFileSync(path.join(DIST, "bundle.json"), JSON.stringify(manifest, null, 2) + "\n");

console.log(`Bundle OK → ${rel(DIST)}`);
for (const c of manifest.cards) console.log(`  ${c.hash}  ${c.path}`);
console.log(`  tokens.css (${tokensCss.length}B), preview.css inlined (${previewCss.length}B/page)`);
