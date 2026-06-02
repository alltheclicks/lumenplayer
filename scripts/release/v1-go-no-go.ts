export type GoNoGoStatus = 'pending' | 'pass' | 'fail' | 'waived';

export interface GoNoGoCriterionDefinition {
  id: string;
  title: string;
  passCondition: string;
  failCondition: string;
  required: boolean;
}

export interface GoNoGoFeatureAreaDefinition {
  id: string;
  label: string;
  criteria: GoNoGoCriterionDefinition[];
}

export interface GoNoGoCriterionResult {
  status: GoNoGoStatus;
  evidence: string;
  notes: string;
  verifiedBy: string;
  verifiedAt: string | null;
}

export interface GoNoGoFeatureArea {
  id: string;
  label: string;
  criteria: Array<GoNoGoCriterionDefinition & GoNoGoCriterionResult>;
}

export interface GoNoGoChecklistTemplate {
  releaseVersion: 'v1';
  createdAt: string;
  decision: 'pending' | 'go' | 'no-go';
  summary: string;
  areas: GoNoGoFeatureArea[];
  unresolvedRequiredCriteria: string[];
  failedRequiredCriteria: string[];
}

export const V1_GO_NO_GO_FEATURE_AREAS: GoNoGoFeatureAreaDefinition[] = [
  {
    id: 'content',
    label: 'Content Playback (Live/VOD/Series)',
    criteria: [
      {
        id: 'content-live-playback',
        title: 'Live channel playback starts and recovers after transient network loss.',
        passCondition: 'Live playback starts in target environments and resumes after reconnect without session reset.',
        failCondition: 'Live playback cannot start or loses session continuity after reconnect.',
        required: true,
      },
      {
        id: 'content-vod-series',
        title: 'VOD and Series episode playback works end-to-end from catalog to player session.',
        passCondition: 'At least one VOD asset and one series episode start and remain controllable in session.',
        failCondition: 'VOD or Series playback fails to start, crashes, or desynchronizes session state.',
        required: true,
      },
      {
        id: 'content-epg-catchup',
        title: 'EPG timeline and catch-up navigation provide correct metadata and seek points.',
        passCondition: 'EPG rows align with channels and catch-up seeking lands near requested offset.',
        failCondition: 'EPG metadata mismatch, missing rows, or catch-up seek does not move playback.',
        required: true,
      },
      {
        id: 'content-provider-auth-live-catalog',
        title: 'Provider auth and live catalog are proven with release QA credentials.',
        passCondition: 'Provider preflight evidence shows accepted auth and a non-empty live catalog for the QA account.',
        failCondition: 'Provider auth is rejected, live catalog is empty, or provider evidence is missing.',
        required: true,
      },
      {
        id: 'content-provider-focused-playback',
        title: 'Provider-backed focused live/catch-up browser playback smoke passes.',
        passCondition: 'Focused playback smoke passes with redacted provider-backed browser evidence.',
        failCondition: 'Focused provider playback is blocked, only local/unit evidence exists, or evidence leaks credentials.',
        required: true,
      },
      {
        id: 'content-catchup-no-transcode-remux',
        title: 'Catch-up beta path does not use ffmpeg, transcode, remux, generated HLS, or XUI-side media processing.',
        passCondition: 'Provider/catch-up evidence shows browser playback uses provider media bytes, normalized manifests, or a clear unsupported overlay without local or upstream media processing.',
        failCondition: 'Broken catch-up channels are made to pass through ffmpeg, server-side transcode/remux, generated HLS, or unproven XUI-side media processing.',
        required: true,
      },
    ],
  },
  {
    id: 'cast',
    label: 'Google Cast Renderer',
    criteria: [
      {
        id: 'cast-session-handoff',
        title: 'Renderer switch local <-> cast keeps one active session without source reset.',
        passCondition: 'Switching to cast and back preserves source, playback state, and position tolerance.',
        failCondition: 'Switching renderer resets source unexpectedly or drops session state.',
        required: true,
      },
      {
        id: 'cast-remote-controls',
        title: 'Phone-as-remote commands apply to cast receiver with stable feedback in UI.',
        passCondition: 'Play/pause/seek/channel-change commands from controller match receiver state updates.',
        failCondition: 'Controller commands are delayed, ignored, or diverge from receiver playback state.',
        required: true,
      },
      {
        id: 'cast-older-devices',
        title: 'Older-device cast path keeps acceptable startup and channel-switch behavior.',
        passCondition: 'Measured cast startup/swap behavior stays within agreed performance guardrails.',
        failCondition: 'Receiver shows repeated stalls, black-screen regressions, or unacceptable startup delay.',
        required: true,
      },
    ],
  },
  {
    id: 'airplay',
    label: 'AirPlay Renderer',
    criteria: [
      {
        id: 'airplay-detect-connect',
        title: 'AirPlay availability and connection state are detected reliably in supported clients.',
        passCondition: 'Availability signal and connected state match actual AirPlay device status.',
        failCondition: 'AirPlay appears available when unavailable, or connection state is stale/wrong.',
        required: true,
      },
      {
        id: 'airplay-renderer-switch',
        title: 'Switching renderer local <-> airplay does not break active playback session.',
        passCondition: 'Source and position remain aligned while moving between local and airplay renderers.',
        failCondition: 'Renderer transitions break playback continuity or lose current source.',
        required: true,
      },
      {
        id: 'airplay-fallback',
        title: 'Unsupported clients show deterministic fallback messaging.',
        passCondition: 'Unsupported environments receive clear guidance and no broken AirPlay action states.',
        failCondition: 'Unsupported environments expose unusable controls or misleading ready states.',
        required: true,
      },
    ],
  },
  {
    id: 'pwa',
    label: 'PWA Installability and Offline',
    criteria: [
      {
        id: 'pwa-install',
        title: 'Install prompt and platform fallback copy are correct on desktop/mobile.',
        passCondition: 'Install affordance appears where supported and fallback text appears where unsupported.',
        failCondition: 'Install prompt is missing when supported or instructions are incorrect per platform.',
        required: true,
      },
      {
        id: 'pwa-offline-fallback',
        title: 'Offline navigation fallback is served when network is unavailable.',
        passCondition: 'Offline route requests return fallback page without blank state or crash.',
        failCondition: 'Offline navigation breaks or shows browser error without app fallback.',
        required: true,
      },
      {
        id: 'pwa-push-ux',
        title: 'Push opt-in flow respects capability matrix and permission lifecycle.',
        passCondition: 'Opt-in UX shows only for supported contexts and reports permission outcomes correctly.',
        failCondition: 'Push UX appears in unsupported contexts or permission states are misrepresented.',
        required: true,
      },
    ],
  },
  {
    id: 'performance',
    label: 'Performance Guardrails',
    criteria: [
      {
        id: 'perf-ttfc',
        title: 'Time-to-first-channel guardrail remains below target threshold.',
        passCondition: 'Benchmark reports p95 startup below configured release threshold.',
        failCondition: 'Benchmark exceeds threshold or produces unstable startup variance.',
        required: true,
      },
      {
        id: 'perf-memory',
        title: 'RSS memory usage stays below release memory cap under benchmark dataset.',
        passCondition: 'Memory benchmark stays under cap with acceptable delta to baseline.',
        failCondition: 'RSS cap breach or significant regression against baseline.',
        required: true,
      },
      {
        id: 'perf-channel-list',
        title: 'Large catalog UX remains responsive under search/filter/navigation.',
        passCondition: 'Channel list interactions remain smooth with virtualized list and debounced search.',
        failCondition: 'Noticeable interaction lag, dropped input events, or UI lock during navigation.',
        required: true,
      },
      {
        id: 'perf-beta-capacity-300-500',
        title: 'Beta capacity plan supports 300-500 live users without server-side media processing.',
        passCondition: 'Release sign-off includes capacity evidence or an approved plan showing the production media path does not rely on transcode/remux media processing.',
        failCondition: '300-500-user beta would depend on unproven server CPU media processing or lacks an owner-approved capacity plan.',
        required: true,
      },
    ],
  },
  {
    id: 'quality',
    label: 'Quality Gate and Regression Safety',
    criteria: [
      {
        id: 'quality-local-gate',
        title: 'Local quality gate (lint/typecheck/build) passes on release candidate head.',
        passCondition: 'All mandatory workspace quality commands complete successfully on candidate commit.',
        failCondition: 'Any mandatory quality command fails or requires ad-hoc local patches.',
        required: true,
      },
      {
        id: 'quality-smoke-matrix',
        title: 'Smoke/regression matrix execution has no unresolved blockers.',
        passCondition: 'All smoke cases pass and no critical regression case remains unresolved.',
        failCondition: 'Any smoke case fails or critical regression case remains open.',
        required: true,
      },
      {
        id: 'quality-release-note',
        title: 'Known limitations and rollback notes are explicitly captured for release decision.',
        passCondition: 'Release sign-off includes concrete limitation list and rollback owner.',
        failCondition: 'Release ships without explicit limitation/rollback accountability.',
        required: true,
      },
    ],
  },
];

export const createV1GoNoGoChecklistTemplate = (
  createdAt: string = new Date().toISOString(),
): GoNoGoChecklistTemplate => {
  const areas: GoNoGoFeatureArea[] = V1_GO_NO_GO_FEATURE_AREAS.map((area) => ({
    id: area.id,
    label: area.label,
    criteria: area.criteria.map((criterion) => ({
      ...criterion,
      status: 'pending',
      evidence: '',
      notes: '',
      verifiedBy: '',
      verifiedAt: null,
    })),
  }));

  return {
    releaseVersion: 'v1',
    createdAt,
    decision: 'pending',
    summary: '',
    areas,
    unresolvedRequiredCriteria: areas
      .flatMap((area) => area.criteria)
      .filter((criterion) => criterion.required)
      .map((criterion) => criterion.id),
    failedRequiredCriteria: [],
  };
};

export const evaluateV1GoNoGoChecklist = (
  checklist: GoNoGoChecklistTemplate,
): GoNoGoChecklistTemplate => {
  const requiredCriteria = checklist.areas
    .flatMap((area) => area.criteria)
    .filter((criterion) => criterion.required);

  const failedRequiredCriteria = requiredCriteria
    .filter((criterion) => criterion.status === 'fail')
    .map((criterion) => criterion.id);

  const unresolvedRequiredCriteria = requiredCriteria
    .filter((criterion) => criterion.status === 'pending')
    .map((criterion) => criterion.id);

  const decision = failedRequiredCriteria.length > 0
    ? 'no-go'
    : unresolvedRequiredCriteria.length > 0
      ? 'pending'
      : 'go';

  return {
    ...checklist,
    decision,
    failedRequiredCriteria,
    unresolvedRequiredCriteria,
  };
};
