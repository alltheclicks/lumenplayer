import type { Page, Request, Response } from '@playwright/test';

export type QaNetworkFailure = {
  action: string;
  kind: 'response' | 'requestfailed';
  method: string;
  resourceType: string;
  status: number | null;
  url: string;
  failureText: string | null;
};

const resolveXtreamAction = (urlValue: string): string | null => {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    return null;
  }

  const pathname = url.pathname.toLowerCase();
  if (pathname.endsWith('/player_api.php')) {
    return url.searchParams.get('action') ?? 'authenticate';
  }

  if (pathname.endsWith('/xmltv.php')) {
    return 'xmltv';
  }

  if (pathname.includes('/live/')) {
    return 'live-stream';
  }

  if (pathname.includes('/movie/')) {
    return 'vod-stream';
  }

  if (pathname.includes('/series/')) {
    return 'series-stream';
  }

  return null;
};

const toFailureFromResponse = (response: Response): QaNetworkFailure | null => {
  const status = response.status();
  if (status < 400) {
    return null;
  }

  const request = response.request();
  const action = resolveXtreamAction(response.url());
  if (!action) {
    return null;
  }

  return {
    action,
    kind: 'response',
    method: request.method(),
    resourceType: request.resourceType(),
    status,
    url: response.url(),
    failureText: null,
  };
};

const toFailureFromRequest = (request: Request): QaNetworkFailure | null => {
  const action = resolveXtreamAction(request.url());
  if (!action) {
    return null;
  }

  return {
    action,
    kind: 'requestfailed',
    method: request.method(),
    resourceType: request.resourceType(),
    status: null,
    url: request.url(),
    failureText: request.failure()?.errorText ?? null,
  };
};

export const createQaNetworkTracker = (page: Page) => {
  const failures: QaNetworkFailure[] = [];

  const handleResponse = (response: Response) => {
    const failure = toFailureFromResponse(response);
    if (failure) {
      failures.push(failure);
    }
  };

  const handleRequestFailed = (request: Request) => {
    const failure = toFailureFromRequest(request);
    if (failure) {
      failures.push(failure);
    }
  };

  page.on('response', handleResponse);
  page.on('requestfailed', handleRequestFailed);

  return {
    getFailures: (): QaNetworkFailure[] => failures.slice(),
    dispose: () => {
      page.off('response', handleResponse);
      page.off('requestfailed', handleRequestFailed);
    },
  };
};
