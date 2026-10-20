# Klaro design mirror (read-only)

Byte-exact copies of the owner's claude.ai/design projects, so agents can align code with the
approved design without access to Claude Design. **Source of truth is claude.ai/design** — never
edit files here; changes made here are lost on the next pull.

Pulled: 2026-10-20 via DesignSync (`list_files` + `get_file`).

Mockups show screens and states; they do not approve business rules. Product scope, accepted
decisions and the conflict register live in `GRAND_PLAN.md` (repo root). Where design and plan
disagree, follow `GRAND_PLAN.md` and raise the conflict instead of editing the export.

| Folder | Claude Design project | Project ID | What it covers |
|---|---|---|---|
| `klaro-redizajn/` | „Klaro Player redesign“ | `2bc32c0c-6f81-41d1-b300-325325c67fae` | Player UI (web/TV/tablet/phone), TV guide, device activation A1–A13 |
| `klaro-panel/` | „Klaro Player - Panel“ | `bdc8c4b7-93f1-4666-88f1-eaa40b7a9d61` | `panel.klaroplayer.com`: user K0–K5, provider P1–P9, genadmin G1–G7 |

Both are built on the „Klaro Player Design System“ (`0163f186-10a6-4b66-9271-90a3ee964bf7`),
copied into each folder under `_ds/…`.

## Where to start

- Player: `klaro-redizajn/1d Kolone.dc.html` → `PlayerViewer` → `KlaroPlayer.dc.html` (+ `ChannelRow`, `TV Vodic`).
  Props: Brand (Klaro/EXYU swaps logo + name only), theme, palette (Klaro/Standard), device, screen.
- Activation (TV side): `klaro-redizajn/Aktivacija.dc.html`.
- Panel: `klaro-panel/Klaro Panel.dc.html` (shell) importing `PanelPrijava` (K0), `PanelPoveziTV` (K2),
  `PanelPlan` (K4), `PanelKorisnik` (K1/K3/K5), `PanelProvajder` (P1–P9), `PanelGenadmin` (G1–G7).
- Account rules and open product questions: `klaro-panel/README.md`; exploration canvases
  `Klaro nalozi.dc.html`, `Prijava predlozi.dc.html` (archive, not final screens).
- Screen → repo file map: `github.md` in each folder.

## Rules for implementing from this design

- `.dc.html` files are interactive mockups (template + `DCLogic` class), not production code. Port the
  intent (layout, tokens, states, copy) into `apps/web` / future `apps/panel` React components; do not
  copy markup verbatim.
- `_ds/…/foundations/tokens.css` is a verbatim copy of the token blocks in `apps/web/src/index.css`
  (matches as of this pull). `theme-tuning.css` and `assets/klaro-palette.css` (Klaro palette,
  enabled by `data-a2="1"`) exist **only in design** — they are not in app tokens yet. Adding them to
  `index.css` is a separate, explicit task.
- Brand names come from `apps/web/src/config/productIdentity.ts` + `brand.ts`; never hardcode them.
- Copy (UI text) in the mockups is Serbian Latin and is the intended product copy.
- Demo data is fictional (provider „Orbita TV“, user Ana Petrović, TV codes `KLR-7Q4`, `TQ5-9HN`, …).

## Known gaps in this mirror

- `klaro-redizajn/uploads/` (4 owner screenshots) is not mirrored: each file is over DesignSync's
  256 KiB read limit and arrives truncated.
- `klaro-panel/_ds/…` and `klaro-panel/assets/klaro-icon.svg`, `klaro-live.svg` were copied from
  `klaro-redizajn/` (same design system and brand kit), not fetched separately.
  `klaro-palette.css` and `support.js` were fetched from both projects and are identical.
- Design is ahead of written spec: the panel uses the owner's 2026-10-06 model (Free / Premium €10
  per year, 30-day trial, 15-minute single-use 6-char TV code). `Aktivacija.dc.html` and proposal #3
  in `klaro-panel/README.md` (€14,99/€39,99 per device) predate that and are not yet aligned.
  `docs/KLARO-NALOZI-I-PANEL.md` referenced by `github.md` is not on this branch yet.

## Viewing locally

Serve a folder over HTTP (file:// blocks the `dc-import` fetches) and open a `.dc.html` page:

```sh
cd design/klaro-panel && python3 -m http.server 8090   # then open "Klaro Panel.dc.html"
```

`support.js` loads React 18 from unpkg.com and fonts from Google Fonts, so the browser needs
internet access. Stop the server when done.

## Refreshing

Ask a Claude session in this repo to „povuci dizajn“ (pull the design). Only the main Claude
session has the DesignSync tool (sub-agents do not). Overwrite these folders, then review
`git diff design/` to see what the owner changed.
