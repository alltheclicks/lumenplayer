import {
  AndroidPlaybackAdapter, type AndroidPlaybackBridge, type AndroidPlaybackEvent,
  type ResolveLiveRequest,
} from "./AndroidPlaybackAdapter";

export type NativePlaybackModule = Omit<AndroidPlaybackBridge, "subscribe"> & {
  addListener(name: string): void;
  removeListeners(count: number): void;
};

/** Dependency injection keeps the RN availability boundary testable on a Node host. */
export function bindAndroidPlayback(host: {
  platform: string;
  module: NativePlaybackModule | undefined;
  hasSurface: () => boolean;
  subscribe: (module: NativePlaybackModule, listener: (event: AndroidPlaybackEvent) => void) => () => void;
}) {
  const module = host.module;
  const available = host.platform === "android" && !!module && host.hasSurface();
  return {
    available,
    createAdapter(resolveLive?: ResolveLiveRequest): AndroidPlaybackAdapter | undefined {
      if (!available || !module) return undefined;
      const bridge: AndroidPlaybackBridge = {
        load: (...args) => module.load(...args),
        play: (...args) => module.play(...args),
        pause: (...args) => module.pause(...args),
        seek: (...args) => module.seek(...args),
        returnToLive: (...args) => module.returnToLive(...args),
        stop: (...args) => module.stop(...args),
        release: (...args) => module.release(...args),
        subscribe: (listener) => host.subscribe(module, listener),
      };
      return new AndroidPlaybackAdapter(bridge, resolveLive);
    },
  };
}
