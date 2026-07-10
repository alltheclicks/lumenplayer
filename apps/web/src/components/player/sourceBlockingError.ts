import type { SessionSource } from '@lumen/session-core';
import { BRAND_SHORT } from '@/config/brand';

export type SourceBlockingError = {
  type: 'network' | 'mixed-content' | 'format' | 'unknown';
  message: string;
  details?: string;
  primaryAction?: 'switch-to-live' | 'report-problem';
  primaryActionLabel?: string;
};

const parseRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return value as Record<string, unknown>;
};

const parseString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const RUNTIME_PROVIDER_ISSUE_ERROR_CODES = new Set([
  'NETWORK_ERROR',
  'MEDIA_ERROR',
  'HLS_ERROR',
  'LOAD_FAILED',
  'MEDIA_ELEMENT_3',
  'MEDIA_ELEMENT_4',
  'STARTUP_TIMEOUT',
]);

const LIVE_REPORT_ERROR_CODES = new Set([
  'NETWORK_ERROR',
  'HLS_ERROR',
  'LOAD_FAILED',
  'MEDIA_ERROR',
  'MEDIA_ELEMENT_4',
  'HLS_NOT_SUPPORTED',
]);

const CATCH_UP_WEB_UNAVAILABLE_MESSAGE = 'Snimak za TV unazad nije dostupan u web playeru';

const buildProviderIssueDetails = (
  providerIssue: Record<string, unknown>,
  channelName: string,
): string => {
  const reasonCode = parseString(providerIssue.reasonCode);
  if (reasonCode === 'unsupported-audio-codec') {
    return `Na kanalu ${channelName}, TV unazad koristi audio kodek koji web browser ne može pouzdano da pusti. Live kanal može raditi normalno, ali ovaj snimak nije dostupan u web playeru bez promene formata kod provajdera.`;
  }

  if (reasonCode === 'unsupported-video-codec') {
    return `Na kanalu ${channelName}, TV unazad koristi video kodek koji web browser ne može pouzdano da pusti. Live kanal može raditi normalno, ali ovaj snimak nije dostupan u web playeru bez promene formata kod provajdera.`;
  }

  if (reasonCode === 'unsupported-archive-signal') {
    return `Na kanalu ${channelName}, TV unazad koristi format snimka koji web browser ne može pouzdano da pročita. Live kanal može raditi normalno, ali ovaj snimak nije dostupan u web playeru bez promene formata kod provajdera.`;
  }

  return `Na kanalu ${channelName}, TV unazad koristi audio/video kodek ili format koji web browser ne može pouzdano da pusti. Live kanal može raditi normalno, ali ovaj snimak nije dostupan u web playeru bez promene formata kod provajdera.`;
};

const buildProviderIssueBlockingError = (
  providerIssue: Record<string, unknown>,
): SourceBlockingError => {
  const channelName = parseString(providerIssue.channelName) ?? 'Ovaj kanal';

  return {
    type: 'format',
    message: CATCH_UP_WEB_UNAVAILABLE_MESSAGE,
    details: buildProviderIssueDetails(providerIssue, channelName),
    primaryAction: 'switch-to-live',
    primaryActionLabel: `Gledaj ${channelName} uživo`,
  };
};

export const resolveSessionSourceBlockingError = (
  source: SessionSource | null | undefined,
  playbackErrorCode?: string | null,
): SourceBlockingError | null => {
  const metadata = parseRecord(source?.metadata);
  const catchUpUnavailable = parseRecord(metadata?.catchUpUnavailable);
  if (catchUpUnavailable) {
    const code = parseString(catchUpUnavailable.code);
    if (code !== 'catchup_web_provider_incompatible') {
      return null;
    }

    return {
      type: 'format',
      message: parseString(catchUpUnavailable.title) ?? CATCH_UP_WEB_UNAVAILABLE_MESSAGE,
      details: parseString(catchUpUnavailable.description)
        ?? 'Snimak za TV unazad za ovaj kanal nije dostupan u web playeru. Live kanal može raditi normalno.',
      primaryAction: 'switch-to-live',
      primaryActionLabel: parseString(catchUpUnavailable.primaryActionLabel)
        ?? (
          parseString(catchUpUnavailable.channelName)
            ? `Gledaj ${parseString(catchUpUnavailable.channelName)} uživo`
            : 'Gledaj kanal uživo'
        ),
    };
  }

  if (playbackErrorCode && metadata?.mode === 'live' && LIVE_REPORT_ERROR_CODES.has(playbackErrorCode)) {
    const channelName = parseString(source?.title) ?? 'Live kanal';

    return {
      type: playbackErrorCode === 'NETWORK_ERROR' ? 'network' : 'unknown',
      message: 'Live kanal trenutno nije dostupan',
      details: `${channelName} trenutno ne može da se pokrene uživo. Stream ne stiže stabilno od provajdera ili servera. Nije do vašeg uređaja niti do ${BRAND_SHORT} playera.`,
      primaryAction: 'report-problem',
      primaryActionLabel: 'Prijavi problem',
    };
  }

  if (!playbackErrorCode || !RUNTIME_PROVIDER_ISSUE_ERROR_CODES.has(playbackErrorCode)) {
    return null;
  }

  const providerIssue = parseRecord(metadata?.catchUpWebProviderIssue);
  if (!providerIssue) {
    return null;
  }

  return buildProviderIssueBlockingError(providerIssue);
};

export const resolveCatchUpStartupUnavailableError = (
  source: SessionSource | null | undefined,
): SourceBlockingError | null => {
  const metadata = parseRecord(source?.metadata);
  if (metadata?.mode !== 'catchup') {
    return null;
  }

  return {
    type: 'network',
    message: 'Snimak za TV unazad trenutno nije dostupan',
    details: `Provajder trenutno ne vraća ispravan arhivski snimak za ovaj termin. Live kanal može raditi normalno. Nije do vašeg uređaja niti do ${BRAND_SHORT} playera.`,
    primaryAction: 'switch-to-live',
    primaryActionLabel: 'Gledaj kanal uživo',
  };
};
