# EXYU Player Beta Analytics — implementation brief for Sol

> Status 12.7.2026: implementirano u namenskom `exyu/player-integration`
> worktree-u. EXYU schema/API i `panel-new` dashboard su već live; Lumen kod
> čeka završni commit/deploy i produkcioni signed-in smoke.

## Context

EXYU.tv has opened `https://player.exyu.tv` to every signed-in subscriber with
an active subscription. The product is entering a public beta. The owner needs
an exact operational picture of who uses the player, which UI paths they take,
what they watch, on which device, for how long, and where playback or the app
fails.

This work belongs on the existing `exyu/player-integration` branch and worktree:

```text
/Users/filip/Documents/Lumen Player-exyu
```

Before changing code, read the repository instructions and current handoff:
`CLAUDE.md`, `HANDOFF.md`, `VISION.md`, `SESSION-ARCHITECTURE.md`, `BACKLOG.md`.

Do not modify `/Users/filip/Documents/exyu-tv-nextjs`; Codex owns the EXYU
database, ingestion API, privacy copy, and marketing work. The human-facing
analytics dashboard belongs in the existing production `panel-new` PHP panel at
`/var/www/html/panel-new` on the Main server, not in the public Next.js app.

## Outcome

Ship a first-party Lumen telemetry client and feedback/replay experience that
sends privacy-filtered batches to the EXYU internal ingestion API. Do not add
PostHog, Sentry, another hosted analytics vendor, or a paid service.

At the end, a single player session must be reconstructable from structured
events and, when a crash/problem happens, from a short rrweb recording covering
the moments immediately before the problem.

## Non-negotiable safety boundary

The owner explicitly wants comprehensive product observation. Normal UI text,
channel searches, feedback text, clicks, focus changes, and navigation may be
recorded. Do not globally mask ordinary input just for masking's sake.

The following must still never leave the browser/proxy in plaintext:

- Xtream username or password
- SSO token, API key, bearer token, cookies, local-storage credentials
- provider/live/catch-up/VOD URLs or query strings containing credentials
- request/response headers or bodies from auth/Xtream/media endpoints
- video frames, audio, canvas media output, or screenshots of playback

Apply the existing privacy redactor on the client and again in the proxy before
forwarding. Add tests proving nested objects, arrays, stack traces, URLs, rrweb
custom events, and feedback diagnostics cannot bypass redaction.

## Shared contract supplied by EXYU

Codex will add optional analytics fields to the encrypted `lps1` SSO payload:

```json
{
  "u": "xtream username",
  "p": "xtream password",
  "iat": 0,
  "exp": 0,
  "jti": "single-use id",
  "analytics": {
    "subject": "stable opaque HMAC",
    "sessionId": "UUID",
    "ingestUrl": "https://exyu.tv/api/internal/player-analytics/ingest",
    "replayUrl": "https://exyu.tv/api/internal/player-analytics/replay"
  }
}
```

Extend `apps/proxy/src/sso.ts` so these fields are optional and strictly
validated. Return to the SPA only `subject`, `sessionId`, `ingestUrl`, and
`replayUrl`. EXYU stores the subject-to-user mapping before the redirect, so
neither the Supabase user ID nor the XUI username belongs in analytics batches.
Existing tokens without `analytics` must continue working unchanged.

The proxy forwards batches to EXYU using:

```http
Authorization: Bearer $PLAYER_ANALYTICS_INGEST_SECRET
Content-Type: application/json
```

Environment variables:

```dotenv
PLAYER_ANALYTICS_INGEST_SECRET=<shared random secret>
PLAYER_ANALYTICS_INGEST_URL=https://exyu.tv/api/internal/player-analytics/ingest
PLAYER_ANALYTICS_REPLAY_URL=https://exyu.tv/api/internal/player-analytics/replay
```

Do not expose the shared ingestion secret to Vite/browser code. Browser events
go to the same-origin Lumen proxy; only the proxy calls EXYU server-to-server.

## Required event envelope

Batch browser events in memory and flush at most every 5 seconds, at 25 events,
on `visibilitychange`, and with `sendBeacon` on unload. Telemetry must be
best-effort and must never delay or break playback.

```ts
interface PlayerAnalyticsBatchV1 {
  schemaVersion: 1;
  sentAt: string;
  identity: {
    analyticsSubject: string;
  };
  session: {
    id: string;
    startedAt?: string;
    endedAt?: string;
    lastSeenAt: string;
    status: 'active' | 'ended' | 'crashed';
    playerRelease?: string;
    entrySource?: string;
    device?: Record<string, unknown>;
    metrics?: Record<string, number>;
  };
  events?: PlayerAnalyticsEventV1[];
  crashes?: PlayerCrashV1[];
  feedback?: PlayerFeedbackV1[];
}
```

Every event requires an event UUID, ISO timestamp, name, severity, current
route/screen, renderer, and structured properties. Where applicable include
channel ID/name/category, content kind, playback mode, error code, duration,
position, and interaction target. Never include a media/source URL.

## Required analytics coverage

### Session and device

Capture session started/heartbeat/ended/crashed, foreground/background time,
active UI time, playback time, locale/timezone, screen/viewport, DPR, touch,
PWA/standalone state, browser/version, OS/version, coarse device class,
`navigator.connection` values when available, and player release/commit.

Do not fingerprint with canvas, fonts, audio, installed extensions, or hardware
enumeration.

### Navigation and GUI

Capture screen/route changes, category changes, channel selection, search
started/changed/submitted/cleared (the owner permits search text), favorites,
EPG expansion, catch-up selection, play/pause/seek/live-edge, volume/mute,
fullscreen/PiP, cast connect/disconnect, renderer change, settings, retry,
logout, feedback open/submit/cancel, and dead/unresponsive clicks where
practical.

Use stable semantic control IDs. Avoid CSS selectors as the primary event name.

### Playback quality (QoE)

Capture play requested, source selected, manifest start/success/failure, first
frame, time-to-first-frame, buffering start/end, rebuffer count and total time,
buffer ratio, playing/paused/ended, channel switch latency, retries/fallbacks,
HTTP status/error code, current resolution, dropped/total video frames when the
browser exposes them, bitrate/level changes, audio/video codec incompatibility,
unexpected pause/idle/no-frame, and fatal/non-fatal playback errors.

Keep existing `playback.*`, `catchup.*`, `renderer.*`, and `cast.*` events and
normalize them into this batch contract rather than creating a second competing
event bus.

### Crash collection

Capture `window.error`, `unhandledrejection`, React ErrorBoundary failures,
fatal media/HLS errors, catalog boot failures, and SSO landing failures. Attach
a sanitized stack, release, route, device summary, session ID, last 30 semantic
events, and a deterministic fingerprint based on normalized error type/message
and top application frames.

## Feedback UX

Add a persistent but unobtrusive `Prijavi problem` action in the player shell.
It must work on desktop and mobile and remain reachable after a playback error.

Categories:

- kanal ne radi
- secka ili se dugo učitava
- nema zvuka
- slika i zvuk nisu sinhronizovani
- TV unazad ne radi
- pogrešan program/EPG
- problem sa komandama ili interfejsom
- predlog
- drugo

Allow free-form text and an optional 1–5 experience score. On submit attach the
current safe diagnostics, last 30 semantic events, QoE snapshot, channel
metadata, device summary, release, and replay ID if available. Confirm success
inside the UI and preserve the report locally for retry if the network is down.

## rrweb black-box replay

Use current packages `@rrweb/record` and `@rrweb/replay`/`rrweb-player`; do not
install the deprecated `rrweb` package.

Default behavior:

- maintain a rolling in-memory buffer covering approximately the last 3 minutes
- upload only after a fatal crash, submitted feedback, or explicit diagnostic
  trigger
- optionally sample 10% of full sessions behind an environment flag
- compress before upload and chunk safely
- block the video element and any media/canvas surface (`rr-block`)
- mask password/auth controls and any credential-bearing DOM
- ordinary search/feedback input may remain visible as explicitly requested
- never enable network body/header capture or console argument capture unless
  it passes the same credential redactor

The browser sends replay chunks to the same-origin proxy. The proxy forwards
them to the EXYU replay endpoint with the shared secret and metadata headers.
Failed replay upload must not fail feedback submission.

## Proxy requirements

- keep browser endpoint same-origin and origin-gated
- bind telemetry to the analytics session established by SSO; never trust a
  browser-supplied username, site user ID, or ingestion destination
- strict body/event/chunk limits and per-session/IP rate limits
- queue/buffer outbound batches with bounded memory and short timeouts
- retry only safe idempotent batches by event UUID
- double-redact before forwarding and before any log line
- log only batch counts, session UUID, outcome, latency, and error class
- no credential/media URLs in logs

## Validation and evidence

Add unit tests for SSO backward compatibility, analytics field validation,
identity binding, batching, unload flush, offline retry, redaction, crash
fingerprinting, feedback diagnostics, rrweb blocking, size/rate limits, and
proxy forwarding failures.

Run at minimum:

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm security:audit:prod
pnpm build
```

Perform a real signed-in production smoke only after Codex confirms the EXYU
ingestion endpoints and shared secret are deployed. Verify one normal playback,
one feedback report, one synthetic crash, and one replay upload. Prove that the
EXYU admin dashboard shows the correct user/session/device/timeline while logs
contain no Xtream credentials or media URLs.

Do not deploy a token-contract change ahead of the EXYU side. Coordinate the
final deploy order: EXYU schema/API first, then Lumen, then EXYU SSO analytics
fields/promotion.
