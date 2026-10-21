# Klaro Player — GRAND PLAN

> Updated: 2026-10-21
> Purpose: product-wide navigation and continuity for the owner and AI agents.  
> Status: consolidated working plan. Accepted decisions, proposals, existing code and unknowns are explicitly separated below.  
> Current execution priority: first installable Samsung, LG and Android TV applications, extracting the shared core as needed.

## 0. Agent entry point

Operational work is coordinated exclusively through `TASKS.md`. Resolve its live path with `git config --local --get klaro.taskRegistry`; linked worktree copies are snapshots. Follow its atomic claim, session ownership, path reservations and evidence-based completion protocol. On general work requests agents select eligible ready tasks without requiring the owner to name an ID. Current priority is the shortest path to installable and device-verified TV builds. This document remains the product authority; historical backlogs are not separate live queues.

Read this document before choosing a task. Read project instructions and the latest relevant handoff before editing code. This document connects the whole product; it does not authorize implementation, infrastructure changes, purchases, merges, deployment or store submission by itself.

In five minutes an agent should know:

1. Klaro is a multiplatform player **and** the account/device/licensing/provider-management system around it.
2. Dedicated TV apps are the immediate delivery priority. The complete business platform remains in scope.
3. Shared domain logic, platform playback adapters, cloud state and role-based panels are separate responsibilities.
4. A web implementation is available. The complete shared core, TV clients and Klaro business backend are not yet implemented.
5. The analyzed checkout is older than the existing P4 extraction branch. Check Git before starting; do not repeat completed work.
6. A provider in the existing business spec also sells Klaro licenses. Separate reseller/sub-reseller rules remain an explicit decision.
7. A task is complete only with evidence appropriate to its layer. A successful build is not device verification.

### Status vocabulary

| Label | Meaning |
|---|---|
| ACCEPTED | Explicit owner direction or an accepted source decision |
| EXISTING | Located in code; does not automatically mean deployed or device-verified |
| RECORDED | Reported in an earlier handoff; verify before relying on current runtime state |
| PROPOSED | Recommended design or scope, not an owner-approved business rule |
| OPEN | Decision/evidence still needed |
| NOT STARTED | No implementation established by this review |

Never upgrade PROPOSED to ACCEPTED, or RECORDED to verified, without evidence.

### Reading routes

- Product/roles/billing: sections 1, 4–7, 10, 12.
- Client/core/playback: sections 2–3, 8–9, 11–13.
- Backend/panel: sections 4–8, 10–13.
- Coordinator/resuming agent: sections 2, 11–14 first.

## 1. North star and product boundaries

**One setup. Every screen.** A user can use Klaro on a single TV, or carry sources, favorites, preferences and viewing progress across supported devices. Installation, activation and everyday playback should be simple enough to use without technical assistance.

The full product consists of:

1. Player applications: Samsung, LG, Android TV/Google TV, Fire TV, Apple TV, Android, iOS, web/PWA, VIDAA and future justified targets.
2. Shared core: source/catalog/EPG/playback contracts and policies, local state, licensing and sync abstractions.
3. Klaro backend: identities, organizations, devices, activation, entitlements, credits, notifications and synchronized user data.
4. One role-aware panel: end users, commercial providers/resellers, their staff and Klaro administrators.
5. Operating system for the business: sales and credit accounting, support, observability, release management and recovery.
6. Public onboarding/support surfaces and the approved Klaro design system.

Klaro ships no channels or content. Source access and Klaro software entitlement are separate. A valid Klaro license does not grant IPTV content access; a working IPTV subscription does not itself grant a Klaro license.

EXYU is the existing live web integration and a reference system for testing. The owner reports top-level control of EXYU infrastructure. This enables coordinated diagnosis but is not proof of access in a particular session and does not authorize production changes. Preserve EXYU SSO and its independent operation.

The first TV builds are internal engineering deliverables. They do not need the complete commercial panel to prove playback. Public commercial releases do require the applicable activation, entitlement, support and store flows.

## 2. Evidence, current state and document precedence

### Source register

| Source | What to use it for | Availability/caveat |
|---|---|---|
| Owner conversation, 2026-10-20 | Whole-product vision; no provider transcoding by us; realtime state; device recovery goal; TV apps first; one GRAND_PLAN | Latest product direction |
| [Design mirror guide](design/README.md), [panel design rules](design/klaro-panel/README.md), player/panel `.dc.html` exports | Newer design and account model; screen/state references | Committed on local `feat/klaro-player-rebrand` at `bfd5d3f` and merged into this branch. Available in this checkout; not pushed. Read-only mirror, not production code or blanket approval of every mockup |
| `docs/KLARO-NALOZI-I-PANEL.md`, 2026-10-05 | Detailed user/provider/genadmin panels, credits, vouchers, activation | Untracked source found in worktree branch `t3code/klaro-player-logo-design`; not present in this checkout. Its important requirements are consolidated here; do not assume a relative link resolves |
| `docs/DECISION-KLARO-PLATFORM-STACK-20261006.md` | Accepted React/Convex/Effect boundaries | Tracked on branch `t3code/evaluate-svelte-convex-effect-fit`, reviewed at `2f8d14d`; not in this checkout |
| `docs/P4-CORE-EXTRACTION-PLAN-20261006.md` and that branch's `HANDOFF.md` | Extraction tasks and recorded validation | Same P4 branch; existing completed work must be retained |
| [VISION.md](VISION.md), [SESSION-ARCHITECTURE.md](SESSION-ARCHITECTURE.md) | Earlier vision and session model | Several commercial/platform assumptions superseded; see conflict register |
| [Multiplatform execution plan](docs/PLAN-MULTIPLATFORM-EXECUTION.md) | Detailed contracts, invariants and platform work | Apply newer decisions and current owner direction |
| [September handoff](docs/AGENT-HANDOFF-20260925.md), [HANDOFF.md](HANDOFF.md) | Historical Git/release evidence | Historical production reports are not a fresh live check |
| [Brand spec](docs/BRAND-KLARO-PLAYER.md) | Public identity and technical identifier boundaries | Design exports/assets remain distributed across worktrees |

Locate sibling checkouts with `git worktree list`; do not guess paths or copy private configuration. Tracked P4 documents can also be read with `git show 2f8d14d:<path>`. If that object or the untracked business spec is unavailable, use this consolidation and report the missing evidence. Do not invent its contents.

### Verified repository snapshot

Reviewed repository: `alltheclicks/lumenplayer`.

| Area | State as reviewed |
|---|---|
| Analysis/documentation checkout | `t3/klaro-codebase-analysis`, baseline `0105fb7` |
| Documentation/design integration | Plan committed as `291710d`; design commit `bfd5d3f` merged locally into this branch. Local integration with `feat/klaro-player-rebrand` is owner-authorized; no push |
| Newer P4 branch | `t3code/evaluate-svelte-convex-effect-fit`, `2f8d14d`, 10 commits beyond baseline |
| Existing applications | `apps/web`, `apps/proxy`, `apps/push-api` |
| Web | React/Vite, hls.js, live/EPG/catch-up/VOD/series, source handling, Cast/AirPlay, PWA |
| Shared packages | `types`, `api`, `core`, `session-core`, `player-core`, `storage`, `input`, `demo-data`, `tsconfig` |
| Portability | Incomplete: substantial logic remains in web components; browser storage/transport coupling remains |
| Session/cloud sync | LocalStorage/BroadcastChannel implementation is not cross-device cloud sync |
| Business platform | Convex accounts, pairing, credits, licensing and role-aware panel NOT STARTED in reviewed code |
| TV/mobile applications | No dedicated target established in reviewed tree |
| Provider notifications | Web subscription persistence is local; standalone push-api presence does not prove end-to-end production delivery |
| EXYU analytics | Existing integration; separate from the future Klaro business backend |
| P4 progress | RECORDED: 0a–0d, 1a, 1b part 1 complete; next contracts/config work is step 2 |
| P4 checks | RECORDED: 603 unit tests and required checks passed on that branch; not rerun during this documentation change |
| Device evidence | Owner-reported device inventory corrected on 2026-10-21; see section 3. Samsung 2019, LG webOS 5.6.2-21, Sony 2022 or 2023 (year unconfirmed) and Fire TV Stick 4K Max on Fire OS 7.7.1.3. No agent device verification; Apple TV planned |

Do not replace the newer P4 branch with this older code baseline. Documentation and design have been combined locally; the P4 implementation branch remains separate. Integrate these documents deliberately into the chosen implementation base. No push or production deployment is authorized by this plan.

### Conflict register

| Older statement | Current interpretation |
|---|---|
| PWA/Cast first, native apps distant | Dedicated Samsung/LG/Android TV apps are the next execution priority; Cast remains a feature |
| Complete all P4 before any TV application | Owner agreed to early TV apps and extraction alongside their needs; preserve tests and boundaries, avoid wholesale component duplication |
| Assistant suggestion: Sony first, other TV apps later | Superseded by agreed Samsung/LG and Android development streams; no platform may be called verified from another platform's result |
| Free 1–2-device accounts / October 5 direct per-device licensing | Newer imported panel has account-level Free/Premium, 5 linked devices, 1/5 concurrent viewers, €10/year Premium and 30-day trial. Record as current design evidence; reconcile approval and remaining contradictions before billing implementation |
| Postgres business backend | Superseded by October 6 accepted Convex decision |
| `app.klaroplayer.com` hosts dashboard | October 5 spec: `panel.klaroplayer.com` is panel; `app.klaroplayer.com` is PWA. Deployment/DNS not established here |
| Pairing expires in 10 minutes | Owner suggested 15 minutes; use 15 as current planning value, make final behavior explicit |
| Serbian copy in design exports implies a Serbian-only product | Superseded by owner direction on 2026-10-21: English is the application default; TV and desktop must offer language selection, with broad world-language and Balkan coverage. See section 9 localization requirements |
| Device = installation, always recognizable | OPEN identity refinement: durable device/license record plus replaceable installation and recovery proof; hardware ID alone cannot satisfy every reset case |
| All clients share “the same session” | Preserve explicit controller/renderer sessions; PROPOSED clarification: ordinary playback on separate devices stays independent, account data syncs |
| HTTP `/v1` only + realtime without polling | Both are accepted requirements; transport design remains OPEN. Direct Convex player subscriptions are a proposal, not permission to bypass `/v1` policy |
| Old FFmpeg/remux or shared-provider edits | Current no-media constraints still apply; do not revive disabled paths or edit shared production `timeshift.php` for Klaro |

Latest explicit owner direction wins over older planning prose. Existing code proves implementation, not product approval. This consolidation does not silently approve proposals listed below.

## 3. Platform strategy and expansion

| Target | Intended family / playback boundary | Delivery position |
|---|---|---|
| Samsung Tizen | React TV web UI; Samsung AVPlay adapter, alternatives only after evidence | First TV stream; test Samsung UE43RU7092UXXH (2019) |
| LG webOS | Shared TV web UI where appropriate; separate webOS media/lifecycle adapter | First TV stream; test LG 60UN71003LB / webOS 5.6.2-21 |
| Android TV / Google TV | react-native-tvos; Media3/ExoPlayer adapter | First native TV stream; test Sony Android TV (2022 or 2023, unconfirmed; exact model/OS pending) |
| Fire TV | Owner test device is Fire TV Stick 4K Max on Fire OS 7.7.1.3; use Android-family path. Vega remains a separate future target | Early target; never equate a Sony pass with a Fire pass |
| Apple TV | react-native-tvos/tvOS; AVPlayer adapter | Early playback validation when hardware is available, then full app |
| Android mobile | React Native family; touch UI and Android lifecycle/media integration | After common TV/backend foundation; independent validation |
| iOS mobile | React Native family; touch UI and Apple media integration | Same foundation; iPhone testing can precede Apple TV acquisition |
| Web/PWA | Existing React client/hls.js; Klaro redesign and backend integration behind brand boundaries | Keep working throughout; preserve EXYU flow |
| Hisense VIDAA | Candidate TV-web family with its own SDK, media, remote and distribution validation | In whole-product scope; hardware/SDK/store eligibility and timing OPEN |
| Future TV platforms | Evaluate runtime, decoding, storage, input, auth, realtime, packaging and distribution | Add target only with a bounded compatibility study and demand |
| Desktop | PWA initially; packaged native desktop not committed | Future decision |
| Cast / AirPlay | Renderer/control integrations | Preserve; not substitutes for dedicated TV apps |

ACCEPTED: React family; no Svelte introduction; framework-free shared domain packages. Do not force the same visual components onto remote, touch and mouse interfaces.

### Owner-reported test devices — 2026-10-21

| Device | Model / year | Reported software | Still to establish |
|---|---|---|---|
| Samsung | UE43RU7092UXXH, 2019 | T-MSLDEUC-1500.9 | Developer Mode, local connectivity, certificate setup; verify SDK/API compatibility rather than infer Tizen version from firmware |
| LG | webOS TV 60UN71003LB | webOS 5.6.2-21 | Developer account/mode and local connectivity; model year not independently established |
| Fire TV | Fire TV Stick 4K Max | Fire OS 7.7.1.3; Fire TV Home 7280112.1 | Exact generation/build-model and ADB connectivity; Fire OS path is established by owner report, not an on-device test |
| Sony | Android TV, 2022 or 2023 (unconfirmed); owner reports regular updates | Exact Android version/build not yet supplied | Exact model, OS/build and ADB connectivity |

These details supersede the earlier approximate Samsung 2023 / LG 2022 / Sony 2024 inventory. They are owner reports, not installation or playback evidence. Do not equate regular firmware updates with the newest Android major version. Target the actual Samsung/LG browser and media capabilities during toolchain setup; current desktop-browser success is insufficient. Device access and developer-mode changes have not been performed by this inventory update.

Minimum OS/model years are OPEN. Existing test televisions define initial evidence, not a universal support claim.

Each new target must provide: playback adapter, capability report, secure-storage assessment, local persistence, input/focus handling, lifecycle behavior, sync connectivity, packaging/signing and real-device checks. Most domain/business rules should be reused unchanged.

## 4. Roles, ownership and commercial hierarchy

### Existing agreed business baseline

Historical October 5 baseline below. The newer design adds Free/Premium account plans for direct users; see section 12's design reconciliation. Preserve the provider credit workflow while resolving direct-user entitlement changes.

The October 5 spec has:

`Genadmin → commercial provider → optional user account → licensed device → assigned source`

A direct Klaro user has no provider and purchases their own device entitlement. A provider purchases credits from Klaro and activates customer devices. A user account is optional for voucher-activated provider devices.

One panel changes navigation and permissions by role. Separate roles do not require separate dashboard applications or separate backends.

### Role map

| Actor | Responsibility and visibility |
|---|---|
| Direct end user | Own profile, devices, sources, licenses, purchase history and support |
| Managed end user | Own devices and service status; provider-assigned source is read-only |
| Guest/device-only user | Uses a licensed device without email account; still needs recovery/support path |
| Commercial provider / license reseller | Own customers, devices, source assignment, credits, vouchers, messages and permitted branding |
| Content provider | Supplies IPTV source; may also be the commercial provider, but this is not automatically true |
| Provider owner | Commercial account, staff access, credits and operational control |
| Provider support staff | Restricted customer/device assistance within the provider's scope |
| Klaro support/admin | PROPOSED operational role with explicit scoped permissions; not implicitly genadmin |
| Genadmin | System owner: provider management, pricing, credit controls, global operational/business visibility, audited support |
| Sub-reseller/sub-provider | Future commercial hierarchy; previously deferred. Parent relationship can be accommodated, but credit transfer and visibility rules are OPEN |

Do not implement a new independent seller hierarchy from terminology alone. Resolve whether “seller/reseller/provider” are commercial labels for one role or distinct entities. Never infer that a content provider can see unrelated customers using its server.

PROPOSED authorization rule: server checks actor, action and resource ownership. Hiding a panel menu is not authorization. Support access should be least-privilege, time-bounded where appropriate and audited.

## 5. Panel requirements by audience

### End-user panel — accepted baseline

- Register/login; manage profile; change credentials; revoke sessions.
- List devices: name, platform, last seen, assigned source, license status and expiry.
- Pair, rename, remove and replace a device. Replacement limits need final values.
- Add own Xtream/M3U/EPG sources and assign to devices where permitted.
- View provider-assigned sources without editing managed credentials.
- Direct users: trial, annual/lifetime purchase, renewal, receipts and purchase recovery.
- Managed users: provider contact and renewal instructions.
- PROPOSED additions: profiles, synced preferences, notification inbox and privacy/data deletion controls.

### Provider/reseller panel — accepted baseline plus marked additions

- Overview: licensed active devices, expiries in 7/30 days, credit balance and activation trend.
- Customers: create/invite, search, devices, assigned source, licensing history, suspension and internal notes.
- Activate via TV pairing code; show customer/source/duration and credit cost before confirmation.
- Renew, deactivate and recover/reset device registration. “Reset” must distinguish credential revocation from factory reset.
- Configure source server once, then assign per-customer credentials.
- Credits: acquire from genadmin; see balance and complete transaction history with actor/reason.
- Vouchers: generate batches, export permitted data, inspect unused/redeemed/revoked states.
- White-label lite: provider name/logo/support contact in allowed player locations.
- Staff: owner/support access, with server-enforced permission limits.
- Bulk operations follow proven individual flows; preview targets/cost and avoid duplicate charges on retries.
- Owner vision addition: publish targeted provider messages and see delivery/read status separately.
- PROPOSED operational additions: platform/app-version breakdown, failure summaries and support cases scoped to this provider.

### Genadmin panel — accepted baseline plus proposed measurement detail

- Approve, create and suspend providers; configure provider-specific credit/lifetime pricing.
- Inspect credit sales, consumption, balances and corrections; corrections require an audit reason.
- Manage direct-user plans, trial duration and price configuration.
- Search by device ID/support code, user, provider and voucher.
- View device/license distribution globally and by provider.
- Manage announcements, feature flags and minimum supported app versions per platform.
- Audit who changed what; inspect blocked/suspended accounts/devices.
- Controlled “view as/support as” access with attribution; never silently assume another identity.
- PROPOSED: operational/admin roles below genadmin, billing reconciliation, support workflow and platform rollout health.

### Statistics contract — proposed definitions to agree before dashboards

| Metric | Definition/data needed | Visibility |
|---|---|---|
| Licensed devices | Count of current entitlements in each state; distinguish trial, paid, expired and revoked | User own; provider own; genadmin all |
| Online devices | Recent authenticated heartbeat within a defined freshness window; show last-seen and window | Scoped operational access |
| Active usage | Distinct users/devices with qualifying activity in a selected day/week/month, separate from licensed count | Aggregated provider/genadmin |
| Credit balance | Sum of posted ledger entries; reservations separate if adopted | Provider own; genadmin all |
| Credit sales/consumption | Credits sold by Klaro vs credits spent on activations/renewals; never the same metric | Provider own history; genadmin global |
| Cash collected | Settled direct purchases and provider payments, currency/time window, refunds shown separately | Authorized commercial roles |
| Revenue | Accounting definition OPEN; do not label consumed credits or unpaid assignments as cash revenue | Genadmin/authorized finance |
| Activation funnel | Pairing started → approved → entitlement granted → source ready → first successful playback | Aggregated, scoped |
| Renewals/expiry | Upcoming expiries, eligible renewals and completed renewals with a defined cohort | Provider/genadmin |
| Playback quality | Successful starts, first-frame p50/p95, rebuffering, seek outcome, fatal errors by platform/version/source class | Scoped diagnostic access |
| Notification delivery | Targeted, delivered, read, expired; no inference that delivered means read | Message sender's scope |
| Release health | Version adoption, crash/error change, unsupported clients and rollout failures | Genadmin/platform operations |

Counters must name their time range, timezone, freshness, denominator and data source. “Online”, “licensed” and “watching” are distinct. Start with operationally useful metrics; do not ship decorative graphs with invented data. Avoid exposing individual viewing history unless the support purpose and access policy justify it.

## 6. Accounts, devices, sources and activation

Conceptual model (not a committed database schema):

`Organization/Membership`, `User/Profile`, `Device`, `Installation`, `Source/Assignment`, `Entitlement`, `PairingSession`, `Voucher`, `CreditLedgerEntry`, `Purchase`, `Notification/Receipt`, `AuditEvent`, `PlaybackSession`.

- A Klaro identity is separate from Xtream credentials.
- Source ownership and assignment permissions must be explicit.
- Content identity includes source context; numeric IDs from different providers can collide.
- Device licensing, maximum installed devices and provider simultaneous-stream limits are different constraints.
- PROPOSED: durable logical device record, replaceable installation credentials and separately tracked entitlement.
- Hardware identifiers can be hints where allowed, not sole authentication or a guaranteed identity after factory reset.

### Activation journeys

1. TV presents QR, short code and web address, with visible expiry.
2. User opens the pairing page or provider enters the code in the panel.
3. Server authenticates the approving actor, checks ownership/permissions and atomically claims the pending pairing.
4. License/source assignment is completed; TV updates without manual refresh.
5. If no source is available, show a clear next action rather than an empty player.

Provider voucher activation without user account remains a product requirement, subject to distribution/billing rules. Pairing code and paid voucher are different objects with different permissions and lifetimes.

Required states: waiting, expired, rejected, already claimed, connected, no source, license expiring/expired, suspended, offline grace, device limit and recovery required.

### Recovery and lifecycle

Reinstallation can reuse credentials only if valid storage survives. Otherwise account/provider/recovery proof reconnects a new installation to the existing entitlement. Guest recovery proof and replacement limits are OPEN.

Rebinding should avoid duplicate credit consumption and revoke the old installation's online access. Offline token grace creates a bounded delay for revocation; its duration is a business/security decision.

No factory reset of an owner's TV is implicit in ordinary test authorization.

## 7. Licensing, credits and payments

Historical ACCEPTED October 5 baseline — direct-user trial/per-device purchase terms are now disputed by the newer design and must not be implemented unchanged (see section 12):

- Device entitlement: annual or lifetime; direct users get a 7-day trial.
- One credit activates one device for one year.
- Lifetime costs multiple credits; genadmin-configurable, potentially per provider. The earlier 2–3-credit figure is a planning value, not a hardcoded constant.
- Credit sales initially run genadmin → provider. Sub-provider sales were deferred.
- Credit changes are ledger entries with actor/reason; balance is derived, not manually overwritten.
- License token is signed and supports an explicitly bounded offline period.

OPEN before commercial implementation:

- Final prices, currencies, tax/receipt handling, lifetime terms and trial-abuse policy.
- When voucher issuance reserves or consumes credits; cancellation and expiry accounting.
- Renewal start date, device replacement limits, transfers and account/provider migration.
- Refund/chargeback rules for credits already spent and entitlements already issued.
- Store-specific purchase/restore paths and permitted external activation.

PROPOSED invariants: activation and credit debit are atomic; repeat requests/webhooks are idempotent; purchase verification is server-side; reversals preserve history. Stripe is a candidate for web/B2B, not an approved universal substitute for platform billing.

Suspension of a reseller must have an explicit effect on existing paying users. Do not invent this behavior while implementing a generic “suspend” button.

## 8. Backend, synchronization and notifications

ACCEPTED: Convex owns the Klaro business/control data. Media delivery, catch-up transport and high-volume playback telemetry remain outside it. Source secrets are encrypted at application level; keys are outside the database.

ACCEPTED: player-facing APIs are versioned to support old store clients. Panel can use the Convex client directly. Realtime is required; polling is not an accepted replacement.

OPEN: reconcile HTTP-only player access with realtime delivery. Evaluate a versioned streaming gateway or obtain explicit approval for a versioned subscription facade inside a Klaro sync adapter. Do not quietly couple clients to internal database functions.

Sync scope: profiles/preferences, favorites, source assignments, progress/history, licenses and inbox. PROPOSED: keep independent playback sessions independent; explicit handoff/remote control links controllers and renderers.

Required correctness:

- Local operation and bounded outbox while disconnected.
- Idempotent commands and reconnect reconciliation.
- Explicit conflict rules; “maximum timestamp/position wins” alone is insufficient for rewind/rewatch.
- Checkpoint/coalesced progress writes rather than writes on every frame.
- Cloud outage does not unnecessarily interrupt an already authorized stream.
- Provider messages are tenant-scoped, deduplicated and have expiry/priority.
- Foreground realtime delivery; durable inbox on reconnect; OS push where supported.
- Delivered/read acknowledgements are separate; ordinary messages do not interrupt playback.

Hosting, data region, auth integration, retention, backup/restore and connection/telemetry budgets are OPEN before production backend rollout. Effect remains limited to the accepted server integration boundary; it is not a client-core dependency.

## 9. Playback, shared core and UX

Keep pure source/catalog/EPG/timeline policies in shared packages. Put codecs, platform media APIs, browser repair, focus/input and lifecycle behavior behind explicit adapters.

Continue P4 contracts/config work before duplicating web implementation in a TV target. Extract only well-bounded responsibilities with characterization tests; do not combine risky playback behavior changes and wholesale file relocation.

Preserve generation/cancellation guards, seek/progress semantics, redirect/token handling, live fallback and existing recovery behavior. Renderer switching and account sync are separate concepts.

No transcoding by us for providers. Existing no-media restrictions also exclude re-enabling server remux/generated-media paths as an unreviewed shortcut. EXYU control does not permit changing shared production timeshift behavior for this task.

First TV scope: install/launch, controlled EXYU test source, channels/EPG, live, catch-up, remote navigation and intelligible error/recovery states.

Full player scope retains VOD/series, search/categories, favorites, progress, subtitles/audio tracks, settings and supported casting. Later consideration: profiles/parental controls, PiP and explicit phone-as-remote/handoff. Confirm release scope rather than dropping features silently.

UX handoff must cover remote focus/Back, couch readability, touch layouts, orientation, accessibility, slow/empty/offline states and activation/recovery. The inspected Claude Design mirror is now committed and available under `design/`; see sections 2 and 12 for omissions and unresolved rules. Rendered behavior and full approval are not established by that source inspection. Do not invent a new visual identity or mark the redesign integrated into the application from mockups alone.

### Localization and language selection — owner direction, 2026-10-21

ACCEPTED: the application is multilingual, with **English as the default** and an explicit language selector at least on TV and desktop/web. Coverage must include widely used world languages and Balkan languages. Serbian text in the design mirror is prototype copy, not a product language restriction. Agent replies remain Serbian; repository/code language conventions remain unchanged.

Implementation requirements:

- Offer language selection during first launch, before activation/sign-in, and later in Settings → Language. Keep English as the initial default rather than silently replacing it with the OS language.
- Store user-visible strings in localization resources from the first UI implementation. Cover navigation, playback controls, activation, errors, notifications, accessibility labels and help; avoid concatenated translated sentences and support locale-aware plurals, dates, times and numbers. Missing translations fall back to English.
- Keep UI language independent of audio/subtitle preferences and provider-supplied channel names, EPG titles and descriptions. Do not imply automatic translation of provider content.
- Persist the selected language per device, including before login. A language change must not unexpectedly change the interface on other household devices. Reuse the localization foundation on mobile; exact mobile and panel release-language coverage remains to be scheduled explicitly.
- Support longer translations, Cyrillic and other required scripts, appropriate fonts and right-to-left layout for languages such as Arabic, Hebrew and Urdu. On TV, verify focus order and directional navigation in RTL layouts; do not blindly mirror media-control semantics.
- Language options should be recognizable through their native names, with script/region variants distinguished. Do not use flags as the sole language identifier.

PROPOSED initial locale inventory (coverage target, not a claim of completed translations or a final release list):

- Balkan/regional: Serbian Latin and Cyrillic, Croatian, Bosnian, Slovenian, Macedonian, Albanian, Bulgarian, Romanian, Greek and Turkish.
- Wider coverage: English, German, French, Spanish, Portuguese, Italian, Polish, Czech, Slovak, Hungarian, Ukrainian, Russian, Arabic, Hebrew, Hindi, Bengali, Urdu, Indonesian, Vietnamese, Thai, Simplified Chinese, Traditional Chinese, Japanese and Korean.
- OPEN: final locale identifiers and regional variants (including Portuguese/Chinese), further languages, translation ownership/review and rollout batches. Do not interpret “widely used languages” as a finalized exhaustive list or ship unreviewed machine translations as verified localization.

Acceptance evidence before declaring a target localized: language selection works with its actual input method, survives restart and works before login; English fallback is exercised; long strings/plurals and RTL are checked; changing UI language does not change audio/subtitles or other devices. Browser mockups do not establish physical-TV readability or remote behavior.

Playback copy clarification: owner prefers **“Back to Live TV”** in English for returning from catch-up. Final Serbian wording is deferred for iteration; earlier “Nazad na uživo” and “Vrati se uživo” suggestions are not approved copy. A clearly reachable action in the normal TV catch-up layout is a proposed UX improvement from prototype review, not an implemented feature. Preserve the read-only exports; apply copy corrections upstream or in production localization resources.

Public brand is Klaro. Preserve `@lumen/*`, storage keys, cookies, environment names and other technical identifiers unless a separately authorized migration requires changes.

## 10. Security, support and operations as product requirements

- Tenant isolation and per-action authorization on the server.
- MFA for privileged access; scoped staff roles; audit for credits, source assignment, revocation, exports and support access.
- Redact source credentials, tokens and private URLs from logs, analytics and agent handoffs.
- User-visible support code correlates to device/build/error evidence without exposing secrets.
- Define retention, data export/deletion and source-secret rotation.
- Maintain staging, feature flags, version compatibility and independent platform rollout/rollback.
- Backups require a tested restoration procedure, not merely a configured schedule.
- Store submissions need appropriate review accounts/sources, metadata, privacy disclosures and signing ownership.
- Physical mobile testing runs through the Mac under workspace rules; TV device access must also be established explicitly. Buildara build results are not device results.
- Publishing, deployment and provider infrastructure mutations require task-specific authority.

## 11. Delivery sequence: small milestones inside the whole vision

### M1 — First installable TV applications (CURRENT PRIORITY)

Two implementation streams: Samsung/LG TV web and Android TV native. Shared contracts/core changes have one owner. Use the newer P4 work as baseline after checking its current state.

Done when each target installs on its actual device and demonstrates source access, channels/EPG, live, catch-up, remote controls and bounded failure recovery. Record model, firmware, build and failed cases. A simulator/browser pass cannot close a hardware gate.

Backend/domain and design preparation can proceed independently, but complete billing/panels are not M1 prerequisites. Internal test provisioning must not become hardcoded production credentials.

### M2 — Connected Klaro beta

Add Convex/auth, pairing, device/installation/entitlement model, source assignment, basic sync/inbox and a small role-aware panel. User/provider can onboard and manage a TV without developer intervention. Prove reconnect and backend-outage behavior.

### M3 — Commercial operations and platform expansion

Complete provider/genadmin operations, credit ledger, vouchers, payment/restore/refund flows and support. Extend verified foundation to Fire TV and Apple TV, mobile and Klaro PWA; finish VOD/series and approved UX scope per release.

These are parallel streams where dependencies allow, not a requirement to finish every business feature before testing another platform.

### M4 — Broader platform coverage and scaling

Validate VIDAA and additional targets, older device generations where justified, partner white-label needs and commercial sub-reseller hierarchy if approved. Improve capacity, support efficiency and measured playback quality.

No universal launch date or “all platforms done” claim is established. Estimate after M1 platform evidence; release each platform when its own applicable gates pass.

## 12. Open decisions and decision timing

| ID | Decision | Needed before | Current position |
|---|---|---|---|
| D01 | Are reseller and provider the same commercial role? Sub-reseller rights/credit flow? | Business schema and permissions | Existing provider already resells; distinct hierarchy OPEN |
| D02 | Can one user belong to multiple providers; who owns transfer/recovery? | Source ownership and account schema | OPEN |
| D03 | Logical device vs installation; guest recovery proof and replacement limits | Pairing/licensing implementation | Recovery model PROPOSED |
| D04 | Versioned realtime transport | Sync implementation | HTTP-only rule remains until explicitly amended |
| D05 | Convex hosting/region/auth and recovery policy | Backend foundation | OPEN |
| D06 | Exact TV models/OS and minimum supported generations | Platform compatibility claims | Owner inventory recorded in section 3; Sony model/OS, Fire generation and device access remain OPEN |
| D07 | Prices, lifetime terms, voucher accounting, refunds and store purchase paths | Commercial release | Baseline credits/trial accepted; remaining rules OPEN |
| D08 | Approved design export, screen inventory, profiles/parental scope | Production UI implementation | Mirror committed and available locally; rendered review and final approval OPEN |
| D09 | Genadmin operational roles, metric definitions and viewing-data access | Full dashboards/telemetry | Detailed proposal in sections 4–5 |
| D10 | VIDAA hardware/distribution and future-target priority | Committing its release schedule | In vision; implementation timing OPEN |
| D11 | Independent playback vs explicit shared control/handoff | Cloud playback/session integration | Clarification PROPOSED; do not sync setSource globally |
| D12 | Offline grace and revocation semantics | License issuance | Signed-token direction accepted; duration OPEN |

Resolve decisions when their implementation needs them. Most do not block M1.

### Design import reconciliation — 2026-10-20

The mirror was imported through `t3/sync-klaro-design-dashboard`, committed as `bfd5d3f` and incorporated into local `feat/klaro-player-rebrand` and this branch. It contains player, activation and user/provider/genadmin panels. Its README records four missing large player screenshots and some shared assets copied from the companion project. This review inspected source files and instructions, not rendered UI or byte-for-byte fidelity against Claude Design.

Current design evidence from panel README, `PanelPlan.dc.html` and `PanelGenadmin.dc.html`:

- Basic viewing without an account; no account/password typing on TV.
- Free: 5 linked devices, 1 concurrent viewer. Premium: €10/year **per account**, 5 concurrent viewers, progress/history sync and settings backup.
- Premium trial: 30 days, described as once per account and device; trial expiry returns to Free without automatic charge.
- Provider-managed users still have a separate provider/credit/device workflow. Do not replace it with direct Premium billing or assume it has identical entitlements.
- TV pairing is single-use with 15-minute expiry. Backend device continuity remains subject to recovery proof; a mockup does not establish hardware recognition after reset.

These findings supersede treating the October 5 direct-user price/trial model as uncontested. Owner confirmation of final commercial rules is still required before implementing billing. In particular, “5 concurrent viewers” is a Klaro plan limit, not a promise that the source subscription permits 5 streams. Define guest/concurrency enforcement and provider-customer sync entitlement before those features.

Mixed-generation content remains **inside** the export: `Aktivacija.dc.html`, README proposal #3 and legacy text/logic in `PanelKorisnik.dc.html` retain 7-day trial/per-device annual/lifetime pricing. Provider server/branding copy also mixes immediate delivery and next-launch updates. Use the relevant current screen plus explicit business decisions, not every string indiscriminately. Preserve mirror bytes; corrections belong upstream or in a separate reconciliation record.

Both instruction entry points are preserved: `GRAND_PLAN.md` navigation and `design/README.md` navigation. The design commit incorporated identical `AGENTS.md`/`CLAUDE.md` contents, so the local merge required no conflict resolution. Preserve both entry points in future integrations. Export completeness, inferred visual approval and mock payment behavior must not be mistaken for implemented production features.

## 13. AI execution and handoff protocol

One coordinator owns the product map, shared public contracts and integration order. Use a small number of bounded parallel tasks. Worker models follow the owner's current workspace/model instructions; this plan does not freeze a model choice.

Every implementation task must state:

```text
Task ID / milestone:
Goal and user-visible result:
Base branch + immutable commit:
Source decisions and unresolved assumptions:
Allowed files/packages:
Dependencies and shared contract owner:
Out of scope:
Acceptance scenarios:
Required checks and actual-device evidence:
Handoff: commit, results, remaining failures, next dependency:
```

Rules:

1. Check current branch, dirty files, worktrees and instructions. Preserve unrelated work.
2. Use an isolated task worktree for code; resume existing task work where appropriate.
3. Do not let concurrent agents rewrite the same playback components or invent incompatible domain models.
4. Separate extraction from behavior changes; integrate small reviewable changes.
5. Run project-required checks and relevant tests. Distinguish pre-existing failures from introduced regressions.
6. Track code-complete, reviewed, device-verified and released separately.
7. Update this plan only when product status/decisions change; put detailed run logs in task handoffs.
8. Amend the conflict register when retiring an old decision. Do not silently delete scope to simplify a milestone.
9. Record a precise blocker and continue independent authorized work. Do not turn every OPEN business decision into a global stop.
10. Never treat generated UI, a stub API or a mock dataset as a delivered business capability.

### Current milestone ledger

| Workstream | Status | Next evidence |
|---|---|---|
| Whole-product consolidation | Working plan created; owner review of proposals pending | Resolve only decisions needed by next task |
| Shared core/P4 | P4 combined in local TV integration base; TV-003 contracts implemented and coordinator-reviewed on task branch | Integrate contracts with both shells and rerun consumer checks |
| Samsung/LG apps | TV-004 shell reviewed on local task branch; LG IPK built; Samsung build passes but signing profile blocks WGT | Shared-contract/lockfile integration, real adapters/catalog, owner signing and separate device results |
| Android TV app | TV-005 shell reviewed on local task branch; ARM debug APK rebuilt on Buildara | Shared-contract/lockfile integration, Media3/catalog and Mac/device runtime checks |
| Fire/Apple/VIDAA | Planned targets; readiness unverified | Exact Fire identity; Apple hardware; VIDAA access |
| Klaro backend/panel/billing | NOT STARTED in reviewed tree | Domain decisions then smallest connected beta |
| Klaro redesign | Player/panel mirror committed and available locally; not integrated into application code | Rendered/state review; reconcile current and legacy account rules |
| EXYU web | Existing; historical deployment evidence | Preserve behavior; inspect live only within authorized task |

### TV-003–005 review evidence — 2026-10-21

All three owner-authorized child tasks have returned; their results remain on
separate local branches based on `ebb93acd6aaace2202b305a15a655b7f06ac32c5`.
They have not been merged into the integration branch or pushed. Detailed
handoffs are `docs/tv/TV-003-contracts.md`, `TV-004-shell.md` and
`TV-005-shell.md` on their respective task branches (not yet in this tree).

- TV-003: `t3/shared-playback-contracts` at `6a038cab55c11be274ef9ed3e62566ea725327e3`;
  coordinator corrected cancellation/live-transition handling. Root lint,
  typecheck, build and 617 unit tests passed; QAF035 passed with existing
  final-release/device evidence blockers still open.
- TV-004: `t3/tv-web-shell` at `416bbd54952c3d70a1bcf52393ee07e9975cb910`;
  coordinator corrected D-pad language selection and OK/focus handling.
  Package checks, seven Node tests, both Chrome 63-targeted builds/output
  checks and LG IPK packaging passed. Eight synthetic DOM-event assertions
  passed against dev and generated webOS output in the desktop T3 browser.
  Samsung WGT remains blocked by the owner-created signing profile (TV-013).
- TV-005: source `d90031f83b996fecf488261786e1f7ee21905d85`, handoff tip
  `f61764ab7a9ff3f256a1f65b5fa20d93d109733c` on `t3/android-tv-shell-apk`;
  coordinator corrected Settings Back origin and stale test completion.
  Package typecheck/lint, seven tests and Gradle debug build passed. APK
  metadata and bundled JS were inspected without device execution.

These are shell/contract deliverables, with playback explicitly unavailable.
Next is one serial integration of shared contracts and dependency lockfile,
then platform playback adapters and catalog screens. NDK 27.1.12297006 and
CMake 3.22.1 are required for the Android build; the isolated TV environment
setup/check does not yet provision/check them. No TV, emulator or mobile
device was used, and M1 physical acceptance remains open.

The earlier conversation's “25 work packages” are a planning decomposition, not 25 mandatory serial gates. Keep their detail only where useful; milestones and current evidence govern execution.

## 14. Maintenance and verification

On meaningful milestone completion, update: date, repository evidence, milestone ledger, affected decisions and next actionable work. Keep this document concise enough to navigate; link detailed acceptance reports rather than accumulating raw logs.

This revision was assembled from repository files, the sibling P4 branch, the untracked October 5 account/panel spec and owner discussion. No application code, production system or device was changed to create it. No new device tests, full regression run or live deployment verification are claimed.

Reference documentation consulted during the preceding analysis (recheck when implementing, especially store/platform policy):

- [Samsung identifiers and lifecycle FAQ](https://developer.samsung.com/smarttv/develop/faq/device-information-and-firmware.html)
- [Android identifier guidance](https://developer.android.com/identity/user-data-ids)
- [Amazon Fire TV device identification](https://www.developer.amazon.com/docs/device-specs/identify-fire-tv-devices.html)
- [Convex JavaScript clients](https://docs.convex.dev/client/javascript/overview)
- [LG streaming constraints](https://webostv.developer.lge.com/develop/specifications/streaming-protocol-drm)
- [Android Media3 formats](https://developer.android.com/media/media3/exoplayer/supported-formats)
- [Apple review guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Google Play payments policy](https://support.google.com/googleplay/android-developer/answer/9858738?hl=en)
