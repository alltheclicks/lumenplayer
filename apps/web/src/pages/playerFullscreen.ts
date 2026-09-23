type WebKitFullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

export type WebKitFullscreenVideo = HTMLVideoElement & {
  webkitDisplayingFullscreen?: boolean;
  webkitSupportsFullscreen?: boolean;
  webkitEnterFullscreen?: () => void;
  webkitEnterFullScreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitExitFullScreen?: () => void;
};

type WebKitFullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

export interface PlayerFullscreenResult {
  ok: boolean;
  active: boolean;
  method: 'standard' | 'webkit-element' | 'webkit-video' | 'expanded' | 'unsupported' | 'failed';
  errorName?: string;
}

const errorName = (error: unknown): string => (
  error instanceof Error && error.name ? error.name : 'FullscreenError'
);

const findVideo = (container: HTMLElement): WebKitFullscreenVideo | null => (
  container.querySelector('video') as WebKitFullscreenVideo | null
);

// Player.tsx renders the active container fixed to the viewport. This fallback
// keeps MSE video and custom controls usable when iOS rejects native fullscreen.
const expandedPlayers = new WeakSet<HTMLElement>();

interface FullscreenNavigator {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
}

export const isIosLikeDevice = (targetNavigator: FullscreenNavigator | null): boolean => {
  if (!targetNavigator) return false;
  return (
    /iPad|iPhone|iPod/i.test(targetNavigator.userAgent) ||
    (targetNavigator.platform === 'MacIntel' && targetNavigator.maxTouchPoints > 1)
  );
};

const enterNativeVideoFullscreen = (video: WebKitFullscreenVideo): boolean => {
  const enter = video.webkitEnterFullscreen ?? video.webkitEnterFullScreen;
  if (typeof enter !== 'function') return false;
  enter.call(video);
  return true;
};

const exitNativeVideoFullscreen = (video: WebKitFullscreenVideo): boolean => {
  const exit = video.webkitExitFullscreen ?? video.webkitExitFullScreen;
  if (typeof exit !== 'function') return false;
  exit.call(video);
  return true;
};

export const isPlayerFullscreenActive = (
  container: HTMLElement,
  targetDocument: Document = document,
): boolean => {
  if (expandedPlayers.has(container)) return true;
  const webkitDocument = targetDocument as WebKitFullscreenDocument;
  const fullscreenElement = targetDocument.fullscreenElement ?? webkitDocument.webkitFullscreenElement;
  if (fullscreenElement) {
    return fullscreenElement === container || container.contains(fullscreenElement);
  }
  return findVideo(container)?.webkitDisplayingFullscreen === true;
};

/**
 * Uses the standard element fullscreen API where available and falls back to
 * iOS Safari's native video fullscreen API. Every failure is contained so a
 * fullscreen capability gap can never become an unhandled player crash.
 */
export const togglePlayerFullscreen = async (
  container: HTMLElement,
  targetDocument: Document = document,
  targetNavigator: FullscreenNavigator | null = typeof navigator === 'undefined'
    ? null
    : navigator,
): Promise<PlayerFullscreenResult> => {
  const webkitDocument = targetDocument as WebKitFullscreenDocument;
  const webkitContainer = container as WebKitFullscreenElement;
  const video = findVideo(container);

  if (expandedPlayers.has(container)) {
    expandedPlayers.delete(container);
    return { ok: true, active: false, method: 'expanded' };
  }

  if (isPlayerFullscreenActive(container, targetDocument)) {
    try {
      if (targetDocument.fullscreenElement && typeof targetDocument.exitFullscreen === 'function') {
        await targetDocument.exitFullscreen();
        return { ok: true, active: false, method: 'standard' };
      }
      if (webkitDocument.webkitFullscreenElement && webkitDocument.webkitExitFullscreen) {
        await webkitDocument.webkitExitFullscreen.call(targetDocument);
        return { ok: true, active: false, method: 'webkit-element' };
      }
      if (video?.webkitDisplayingFullscreen && exitNativeVideoFullscreen(video)) {
        return { ok: true, active: false, method: 'webkit-video' };
      }
    } catch (error) {
      return { ok: false, active: true, method: 'failed', errorName: errorName(error) };
    }
  }

  // iPhone does not support arbitrary element fullscreen. Its native video
  // method must run synchronously inside the click/touch gesture. Trying and
  // awaiting requestFullscreen() first consumes that gesture in iOS browsers,
  // including Brave's WKWebView, so native fullscreen must be the first path.
  let standardError: unknown;
  let nativeAttempted = false;
  if (video && isIosLikeDevice(targetNavigator)) {
    nativeAttempted = true;
    try {
      if (enterNativeVideoFullscreen(video)) {
        return { ok: true, active: true, method: 'webkit-video' };
      }
    } catch (error) {
      standardError = error;
    }
  }

  if (typeof container.requestFullscreen === 'function') {
    try {
      await container.requestFullscreen();
      return { ok: true, active: true, method: 'standard' };
    } catch (error) {
      standardError = error;
    }
  } else if (typeof webkitContainer.webkitRequestFullscreen === 'function') {
    try {
      await webkitContainer.webkitRequestFullscreen.call(container);
      return { ok: true, active: true, method: 'webkit-element' };
    } catch (error) {
      standardError = error;
    }
  }

  if (video && !nativeAttempted) {
    try {
      if (enterNativeVideoFullscreen(video)) {
        return { ok: true, active: true, method: 'webkit-video' };
      }
    } catch (error) {
      standardError = error;
    }
  }

  if (video) {
    expandedPlayers.add(container);
    return {
      ok: true, active: true, method: 'expanded',
      ...(standardError ? { errorName: errorName(standardError) } : {}),
    };
  }

  return standardError
    ? { ok: false, active: false, method: 'failed', errorName: errorName(standardError) }
    : { ok: false, active: false, method: 'unsupported' };
};
