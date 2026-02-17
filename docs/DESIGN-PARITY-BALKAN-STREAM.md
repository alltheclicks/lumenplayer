# Design Parity Spec — Balkan Stream (Narodna TV) for Lumen V1

> Date: 2026-02-17  
> Status: Mandatory for V1 release acceptance  
> Design source-of-truth: Balkan Stream app ([alltheclicks/narodna.tv](https://github.com/alltheclicks/narodna.tv)) checked out locally at `/Users/filip/Documents/narodna.tv/balkan-stream` (not `player-standalone`)

## 1. Scope

This spec defines the visual parity target for:
- `/login`
- `/player`
- `/vod` (mapped to Balkan Stream `/movies`)
- `/series`
- EPG sections inside player layout

## 2. Hard Rules

1. Functional parity without visual parity does not close V1 UI.
2. Source-of-truth for design is Balkan Stream codebase + runtime output.
3. Session-centric architecture remains required, but it must not alter approved UX shape.
4. Every design task delivery must include desktop + mobile evidence.

## 3. Screen-Level Acceptance Criteria

### 3.1 Login (`/login`)
- Card hierarchy, icon block, title/subtitle, server info strip, and input rhythm match Balkan Stream.
- Error/feedback state does not visually drift (alert/spacing/typography).
- Password visibility and submit loading UX stay parity-consistent.

### 3.2 Player Desktop (`/player`)
- 3-pane composition: category rail + channel list panel + media/EPG panel.
- Category rail parity: active/inactive states, count badges, VOD CTA style, account block, bottom actions.
- Channel list parity: row density, selected row treatment, logo slot rhythm, favorite affordance, search/header structure.
- Video surface parity: overlay gradient, info stack, controls cluster, fullscreen treatment.
- EPG parity: "Sada na programu", "Sledi", "TV Unazad" visual hierarchy and CTA rhythm.

### 3.3 Player Mobile (`/player`)
- Bottom/sheet pattern, quick actions, category/channel discoverability, and spacing follow Balkan Stream mobile UX.
- No usability regression when switching live/VOD/series contexts.

### 3.4 Movies/Series (`/vod`, `/series`)
- Sticky header + filter pills + grid rhythm + detail transition behavior aligned to reference.
- Mobile bottom navigation/CTA treatment aligned to reference.
- Back/context behavior remains deterministic with no layout jumps.

## 4. Frozen Baseline (LP-0361)

Reference baseline is locked to:
- Repo: `/Users/filip/Documents/narodna.tv/balkan-stream`
- Commit: `e7013011d81b384b3a1cd658e77d9a4ffb8f7c64`
- Capture timestamp (UTC): `2026-02-17T17:15:09Z`
- Manifest: `docs/design-parity/balkan-stream/reference-manifest.json`
- Screenshots: `docs/design-parity/balkan-stream/reference/*.png`
- Privacy note: login screenshots intentionally use sanitized server label (`demo.invalid`).

If reference is intentionally updated later, LP task must explicitly state a new commit SHA and replace manifest hashes.

## 5. Evidence Gate (Mandatory)

To close any design parity task, include:
- Desktop screenshot pairs (reference vs lumen): login/player/movies/series/epg
- Mobile screenshot pairs for same screens
- Short diff note describing what changed and why parity is reached

Without this gate, task remains incomplete and cannot be part of final V1 sign-off.
