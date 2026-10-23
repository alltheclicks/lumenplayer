import type { TVPlaybackAdapter, TVPlaybackCapabilities, TVPlaybackSnapshot } from "@lumen/types";

/** Honest placeholder until a platform engine is connected. Never opens media. */
export class UnavailableTVPlaybackAdapter implements TVPlaybackAdapter {
  getCapabilities(): TVPlaybackCapabilities {
    return { live: false, catchUp: false, seek: false, returnToLive: false, mediaTypes: [] };
  }
  async load(): Promise<void> { throw new Error("Platform playback adapter is unavailable"); }
  play(): void {}
  pause(): void {}
  seek(): void { throw new Error("Seek is unavailable"); }
  returnToLive(): void { throw new Error("Return to live is unavailable"); }
  stop(): void {}
  destroy(): void {}
  getSnapshot(): TVPlaybackSnapshot {
    return { request: null, state: "idle", positionMs: 0, durationMs: null, error: null };
  }
  onChange(): () => void { return () => undefined; }
}
