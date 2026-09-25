# Brief za agenta: EXYU.tv kozmetika (ikonice/grafika)

Stanje: `https://player.exyu.tv` je LIVE (beta pilot), main = `c2cd8cb`, brend na produkciji = **EXYU.tv**.
Tvoj posao je SAMO vizuelna kozmetika (ikonice, favicon, splash, eventualno theme boja). Sve ispod je već
postavljeno i NE SME se pokvariti.

## Kako brend radi (NE ZAOBILAZITI)

- Sav brending je **build-time preko env promenljive `VITE_BRAND_NAME`**, centralizovan u
  `apps/web/src/config/brand.ts` (`BRAND_NAME`, `BRAND_SHORT`, `getBrandWordmark()`).
- Default (bez env-a) je **"Lumen Player"** — to očekuju unit testovi (poruke "…niti do Lumen playera").
  **Nikad ne hardkoduj "EXYU" u `src/`** — vraćanje na Lumen posle bete mora ostati jedan red u env fajlu.
- Ko čita brend:
  - `<title>` — vite plugin `lumen-brand-html` u `apps/web/vite.config.ts` (transformIndexHtml)
  - PWA manifest `name`/`short_name` — isto u `vite.config.ts` (`brandName`/`brandShort` iz `loadEnv`)
  - wordmark u sidebaru/headeru — `src/pages/Player.tsx` (`brandWordmark.prefix` + akcent span)
  - Helmet naslovi — Player/Settings/VodDetail/SeriesDetail/M3UImport
  - error copy — `BRAND_SHORT` u catchupCapability/catchupRuntimeCompatibility/sourceBlockingError/VideoPlayer
- `public/offline.html` i `public/receiver.html` su namerno **brend-neutralni** (public/ se ne transformiše
  pri buildu) — ostavi ih tako.
- Prod env: `apps/web/.env.production` (gitignoren, na Filipovom mac-u) sadrži `VITE_BRAND_NAME=EXYU.tv`.
  Dokumentacija promenljive: `.env.production.example`.

## Šta kozmetika sme da dira

Sve u `apps/web/public/` — **imena fajlova i dimenzije ZADRŽATI** (referencirana u `index.html`,
`VitePWA includeAssets` i manifest `icons` u `vite.config.ts`):

- `favicon.svg`
- `apple-touch-icon.png` (180×180)
- `pwa-192x192.png`, `pwa-512x512.png`, `pwa-maskable-512x512.png` (maskable: pazi na safe zone ~80%)
- `apple-splash-1179x2556 / 1290x2796 / 1536x2048 / 1668x2388.png`
- Plava "Play" pločica u sidebaru (logo tile) je JSX u `src/pages/Player.tsx` — ako se menja u pravi logo,
  koristi postojeće tokene (bez hardkodovanih boja — projektni invariant).
- `theme_color` u manifestu je star (`#3B82F6`) — redizajn primary je navy (hsl var `--primary`, 221°).
  Ako usklađuješ: promeni u `vite.config.ts` manifest + `<meta name="theme-color">` u `index.html` (oba!).

## Šta NE dirati

- **VPS/nginx/Cloudflare** — sve je podešeno (CF proxied + LE cert + per-host Full-strict rule;
  zona globalno na Flexible i takva MORA ostati — zonski flip lomi glavni exyu.tv sajt).
- `scripts/design-sync/dist/` (derivat), tokeni u `index.css` / `tailwind.config.js` (kanon je
  claude.ai/design round-trip — /design-push /design-pull, samo glavna sesija).
- Testovi/default poruke ("Lumen playera") — ne menjati default brend.

## Workflow

1. Grana `final-road/<task-id>` sa `main`, izmene, pa `pnpm --filter @lumen/web typecheck && lint`
   + `pnpm test:unit` (380 testova mora proći) + `pnpm --filter @lumen/web build`.
2. Build za prod MORA imati `apps/web/.env.production` (uzmi sa Filipovog mac-a — nije u repou).
3. Deploy: `rsync -az --delete apps/web/dist/ root@151.241.151.105:/var/www/player/`
4. Provera: `https://player.exyu.tv` (title EXYU.tv, manifest, ikonice u DevTools → Application),
   hard refresh zbog SW keša (`sw.js` precache-uje ikonice).
5. Merge: push grane + fast-forward `main` (git push origin HEAD:main) tek kad sve prođe.
