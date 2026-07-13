type WebKitFullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

export type WebKitFullscreenVideo = HTMLVideoElement & {
  webkitDisplayingFullscreen?: boolean;
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
};

type WebKitFullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

export interface PlayerFullscreenResult {
  ok: boolean;
  active: boolean;
  method: 'standard' | 'webkit-element' | 'webkit-video' | 'unsupported' | 'failed';
  errorName?: string;
}

const errorName = (error: unknown): string => (
  error instanceof Error && error.name ? error.name : 'FullscreenError'
);

const findVideo = (container: HTMLElement): WebKitFullscreenVideo | null => (
  container.querySelector('video') as WebKitFullscreenVideo | null
);

export const isPlayerFullscreenActive = (
  container: HTMLElement,
  targetDocument: Document = document,
): boolean => {
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
): Promise<PlayerFullscreenResult> => {
  const webkitDocument = targetDocument as WebKitFullscreenDocument;
  const webkitContainer = container as WebKitFullscreenElement;
  const video = findVideo(container);

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
      if (video?.webkitDisplayingFullscreen && video.webkitExitFullscreen) {
        video.webkitExitFullscreen();
        return { ok: true, active: false, method: 'webkit-video' };
      }
    } catch (error) {
      return { ok: false, active: true, method: 'failed', errorName: errorName(error) };
    }
  }

  let standardError: unknown;
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

  if (typeof video?.webkitEnterFullscreen === 'function') {
    try {
      video.webkitEnterFullscreen();
      return { ok: true, active: true, method: 'webkit-video' };
    } catch (error) {
      return { ok: false, active: false, method: 'failed', errorName: errorName(error) };
    }
  }

  return standardError
    ? { ok: false, active: false, method: 'failed', errorName: errorName(standardError) }
    : { ok: false, active: false, method: 'unsupported' };
};
