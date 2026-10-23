import { TVPlaybackController, UnavailableTVPlaybackAdapter } from "@lumen/player-core";
import { TizenTVPlaybackAdapter } from "../adapters/tizen/TizenTVPlaybackAdapter";
import type { AVPlay } from "../adapters/tizen/avplay";
import { WebOSPlaybackAdapter } from "../adapters/webos/WebOSPlaybackAdapter";

export type TVTarget = "tizen" | "webos" | "browser";
export const buildTarget: TVTarget = (import.meta as ImportMeta & { env?: { VITE_TV_TARGET?: string } }).env?.VITE_TV_TARGET === "tizen"
  ? "tizen" : (import.meta as ImportMeta & { env?: { VITE_TV_TARGET?: string } }).env?.VITE_TV_TARGET === "webos" ? "webos" : "browser";

export const buildSourceOrigins: readonly string[] = (import.meta as ImportMeta & { env?: { VITE_TV_SOURCE_ORIGINS?: string[] } }).env?.VITE_TV_SOURCE_ORIGINS || [];

const apiMethods = ["open", "close", "setListener", "setDisplayRect", "prepareAsync", "play", "pause", "stop", "getState", "getDuration", "getCurrentTime", "seekTo"] as const;

/** One composition per application lifetime, including Samsung's recovery boundary. */
export function createPlatformPlayback(options: {
  target: TVTarget;
  document: Document;
  mount: HTMLElement;
  avplay?: AVPlay;
  webOSAvailable?: boolean;
  sourceOrigins?: readonly string[];
}) {
  let lastTizen: TizenTVPlaybackAdapter | undefined;
  let restartRequired = false;
  let tizenOwned = false;
  return () => {
    if (options.target === "browser") return new TVPlaybackController(new UnavailableTVPlaybackAdapter());
    if (options.target === "tizen") {
      restartRequired ||= !!lastTizen?.requiresNativeRestart();
      if (restartRequired) throw Object.assign(new Error("Application restart required"), { code: "tizen_recovery_required" });
      if (tizenOwned || (lastTizen && !lastTizen.isNativeReleased())) throw Object.assign(new Error("Platform player already owned"), { code: "playback_busy" });
      const api = options.avplay;
      if (!api || !apiMethods.every(key => typeof api[key] === "function")) {
        throw Object.assign(new Error("Platform API unavailable"), { code: "platform_api_missing" });
      }
      const object = options.document.createElement("object");
      object.type = "application/avplayer";
      options.mount.textContent = "";
      options.mount.appendChild(object);
      // Full screen reference plane. UI controls overlay the native video plane.
      const adapter = new TizenTVPlaybackAdapter({ avplay: api, displayArea: { x: 0, y: 0, width: 1920, height: 1080 } });
      lastTizen = adapter;
      tizenOwned = true;
      const controller = new TVPlaybackController(adapter);
      const load = controller.load.bind(controller);
      controller.load = (request, loadOptions) => {
        let origin = "";
        try { origin = new URL(request.media.url).origin; } catch { /* Reject below. */ }
        if (!options.sourceOrigins?.includes(origin)) return Promise.reject(Object.assign(new Error("Source origin is not configured"), { code: "source_origin_unconfigured" }));
        return load(request, loadOptions);
      };
      const destroy = controller.destroy.bind(controller);
      let destroyed = false;
      controller.destroy = () => {
        if (destroyed) return;
        destroyed = true;
        restartRequired ||= adapter.requiresNativeRestart();
        destroy(); object.remove(); tizenOwned = false;
      };
      return controller;
    }
    if (!options.webOSAvailable) throw Object.assign(new Error("Platform API unavailable"), { code: "platform_api_missing" });
    return new TVPlaybackController(new WebOSPlaybackAdapter({
      visibility: options.document,
      createMediaElement() {
        const video = options.document.createElement("video");
        video.setAttribute("playsinline", "");
        options.mount.textContent = "";
        options.mount.appendChild(video);
        return video;
      },
      releaseMediaElement(element) { (element as HTMLVideoElement).remove(); },
    }));
  };
}
