repo: alltheclicks/lumenplayer
path: apps/web/src

## Poreklo
Preneto 3. 10. 2026 iz projekta „EXYU Player redizajn“ (stranica „1d Kolone“). Isti dizajn za oba brenda:
prop **Brend** (Klaro Player / EXYU.tv) menja samo logo i ime — u kodu to radi `VITE_BRAND_NAME`.
Boje i tokeni dolaze iz design systema „Klaro Player Design System“ (`_ds/…/foundations/tokens.css` + `theme-tuning.css`).

## Screen map
| Screen | Repo files |
|---|---|
| KlaroPlayer.dc.html (player, bez kanala) | apps/web/src/pages/Player.tsx, components/player/ChannelList.tsx, components/player/PlayerControls.tsx |
| KlaroPlayer.dc.html (Filmovi/Serije) | apps/web/src/pages/VodCategories.tsx, pages/SeriesCategories.tsx |
| KlaroPlayer.dc.html (navigacija) | apps/web/src/components/layout/AppShell.tsx |
| ChannelRow.dc.html | apps/web/src/components/player/ChannelList.tsx, components/player/ChannelLogo.tsx |
| TV Vodic.dc.html | apps/web/src/pages/EpgGuide.tsx |
| Brend (logo, ime) | apps/web/src/config/brand.ts, config/productIdentity.ts |
| Aktivacija.dc.html (A1–A13: kod za uparivanje, vaučer, prijava, stanja licence) | još nije u kodu — specifikacija `docs/KLARO-NALOZI-I-PANEL.md` |
