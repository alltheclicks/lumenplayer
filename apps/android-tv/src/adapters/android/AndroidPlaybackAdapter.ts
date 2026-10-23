import type {
  PlaybackState, TVLivePlaybackRequest, TVPlaybackAdapter, TVPlaybackCapabilities,
  TVPlaybackRequest, TVPlaybackSnapshot,
} from "@lumen/types";

/** Wire format contains no URL, request, exception message or diagnostic details. */
export interface AndroidPlaybackEvent {
  sessionId: string;
  generation: number;
  state: PlaybackState;
  positionMs: number;
  durationMs: number | null;
  errorCode?: string;
}

export interface AndroidPlaybackBridge {
  load(sessionId: string, generation: number, url: string, type: string): Promise<void>;
  play(sessionId: string, generation: number): Promise<void>;
  pause(sessionId: string, generation: number): Promise<void>;
  seek(sessionId: string, generation: number, positionMs: number): Promise<void>;
  returnToLive(sessionId: string, generation: number): Promise<void>;
  stop(sessionId: string, generation: number): Promise<void>;
  release(sessionId: string): Promise<void>;
  subscribe(listener: (event: AndroidPlaybackEvent) => void): () => void;
}

export type ResolveLiveRequest = (
  request: TVPlaybackRequest, signal: AbortSignal,
) => Promise<TVLivePlaybackRequest>;

let sessionCounter = 0;
const idle = (): TVPlaybackSnapshot => ({
  request: null, state: "idle", positionMs: 0, durationMs: null, error: null,
});
const safeFailure = () => new Error("Android playback operation failed");
const abortError = () => Object.assign(new Error("Playback cancelled"), { name: "AbortError" });
const finiteMs = (value: number) => Number.isFinite(value) && value >= 0;
const safeCode = (value: string) => /^MEDIA3_[A-Z0-9_]{1,48}$/.test(value) ? value : "MEDIA3_PLAYBACK_FAILED";

/** One adapter owns one native player. Times are media-relative milliseconds. */
export class AndroidPlaybackAdapter implements TVPlaybackAdapter {
  readonly sessionId = `android-playback-${++sessionCounter}`;
  private generation = 0;
  private destroyed = false;
  private snapshot = idle();
  private listeners = new Set<(snapshot: TVPlaybackSnapshot) => void>();
  private cancelLoad: (() => void) | null = null;
  private currentSignal: AbortSignal | null = null;
  private liveTransition: AbortController | null = null;
  private unsubscribe: () => void;

  constructor(
    private readonly bridge: AndroidPlaybackBridge,
    private readonly resolveLive?: ResolveLiveRequest,
    private readonly loadTimeoutMs = 30_000,
  ) {
    this.unsubscribe = bridge.subscribe((event) => {
      if (this.destroyed || this.currentSignal?.aborted || event.sessionId !== this.sessionId
        || event.generation !== this.generation || !this.snapshot.request) return;
      // Never trust a platform event to carry provider diagnostics or invalid times.
      const states: PlaybackState[] = ["idle", "loading", "playing", "paused", "buffering", "seeking", "error", "ended"];
      if (!states.includes(event.state)) return;
      this.snapshot = {
        ...this.snapshot, state: event.state,
        positionMs: finiteMs(event.positionMs) ? event.positionMs : 0,
        durationMs: event.durationMs !== null && finiteMs(event.durationMs) ? event.durationMs : null,
        error: event.state === "error" ? {
          code: safeCode(event.errorCode ?? "MEDIA3_PLAYBACK_FAILED"),
          message: "Android playback failed", fatal: true,
        } : null,
      };
      this.emit();
    });
  }

  getCapabilities(): TVPlaybackCapabilities {
    return { live: true, catchUp: true, seek: true, returnToLive: !!this.resolveLive || this.snapshot.request?.kind === "live", mediaTypes: ["hls", "dash", "mp4"] };
  }

  async load(request: TVPlaybackRequest, { signal }: { signal: AbortSignal }): Promise<void> {
    this.assertAlive();
    if (signal.aborted) throw abortError();
    if (request.media.drm || !this.getCapabilities().mediaTypes.includes(request.media.type)) {
      throw new Error("Android media type or DRM is unsupported");
    }
    if (!/^https?:\/\//i.test(request.media.url)) throw new Error("HTTP(S) media URL required");
    if (request.kind === "catch-up" && (!Number.isFinite(request.startTimeMs)
      || !finiteMs(request.durationMs) || request.durationMs === 0)) throw new Error("Invalid archive milliseconds");
    this.liveTransition?.abort();
    this.cancelLoad?.();
    const generation = ++this.generation;
    this.currentSignal = signal;
    this.snapshot = { ...idle(), request, state: "loading" };
    this.emit();
    // A loading listener may synchronously abort, replace or destroy this load.
    if (signal.aborted || !this.isCurrent(generation)) throw abortError();
    // Keep the signal binding after READY: the controller owns the entire load lifetime.
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve();
      };
      const cancel = () => {
        this.liveTransition?.abort();
        signal.removeEventListener("abort", cancel);
        if (this.cancelLoad === cancel) this.cancelLoad = null;
        void this.bridge.stop(this.sessionId, generation).catch(() => undefined);
        if (this.isCurrent(generation) && this.snapshot.state !== "error") {
          this.snapshot = idle();
          this.emit();
        }
        finish(abortError());
      };
      const timer = setTimeout(() => {
        if (!this.isCurrent(generation)) return;
        this.fail("MEDIA3_LOAD_TIMEOUT");
        finish(safeFailure());
        cancel();
        // Invalidate late platform events even if the caller retains its signal.
        this.generation += 1;
      }, this.loadTimeoutMs);
      this.cancelLoad = cancel;
      signal.addEventListener("abort", cancel, { once: true });
      this.bridge.load(this.sessionId, generation, request.media.url, request.media.type).then(() => {
        if (this.isCurrent(generation) && !signal.aborted) finish();
      }, () => {
        if (!this.isCurrent(generation) || signal.aborted) return;
        this.fail("MEDIA3_LOAD_FAILED");
        finish(safeFailure());
        cancel();
        this.generation += 1;
      });
    });
  }

  play(): Promise<void> { return this.command(() => this.bridge.play(this.sessionId, this.generation)); }
  pause(): Promise<void> { return this.command(() => this.bridge.pause(this.sessionId, this.generation)); }
  seek(positionMs: number): Promise<void> {
    if (!Number.isFinite(positionMs)) return Promise.reject(new Error("Finite seek milliseconds required"));
    const duration = this.snapshot.durationMs;
    const target = Math.max(0, duration === null ? positionMs : Math.min(positionMs, duration));
    return this.command(() => this.bridge.seek(this.sessionId, this.generation, target));
  }

  async returnToLive(): Promise<void> {
    this.assertAlive();
    const request = this.snapshot.request;
    if (!request) throw new Error("No active playback");
    if (request.kind === "live") {
      await this.command(() => this.bridge.returnToLive(this.sessionId, this.generation));
      return;
    }
    if (!this.resolveLive) throw new Error("Live request resolver is unavailable");
    this.liveTransition?.abort();
    const transition = new AbortController();
    this.liveTransition = transition;
    const generation = this.generation;
    const signal = this.currentSignal!;
    let next: TVLivePlaybackRequest;
    try { next = await this.resolveLive(request, transition.signal); }
    catch { if (transition.signal.aborted || !this.isCurrent(generation)) return; throw safeFailure(); }
    if (transition.signal.aborted || signal.aborted || !this.isCurrent(generation)) return;
    if (next.kind !== "live" || next.sourceId !== request.sourceId || next.channelId !== request.channelId) {
      throw new Error("Live resolver returned a different channel");
    }
    this.liveTransition = null;
    try {
      await this.load(next, { signal });
    } catch {
      if (this.destroyed || signal.aborted || this.currentSignal !== signal) return;
      if (this.snapshot.request === next) {
        // A failed transition is not adopted by TVPlaybackController. Publish its
        // terminal error under the previous request so the controller can see it.
        this.snapshot = { ...this.snapshot, request };
        this.emit();
      }
      throw safeFailure();
    }
  }

  async stop(): Promise<void> {
    if (this.destroyed) return;
    this.liveTransition?.abort();
    this.cancelLoad?.();
    const generation = this.generation++;
    this.currentSignal = null;
    this.snapshot = idle();
    this.emit();
    try { await this.bridge.stop(this.sessionId, generation); } catch { throw safeFailure(); }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.liveTransition?.abort();
    this.cancelLoad?.();
    this.generation += 1;
    this.snapshot = idle();
    this.currentSignal = null;
    this.unsubscribe();
    this.listeners.clear();
    void this.bridge.release(this.sessionId).catch(() => undefined);
  }
  getSnapshot(): TVPlaybackSnapshot { return this.snapshot; }
  onChange(listener: (snapshot: TVPlaybackSnapshot) => void): () => void {
    if (this.destroyed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private assertAlive() { if (this.destroyed) throw new Error("Android playback adapter was destroyed"); }
  private isCurrent(generation: number) { return !this.destroyed && this.generation === generation; }
  private async command(run: () => Promise<void>) {
    this.assertAlive();
    if (!this.snapshot.request || this.currentSignal?.aborted) throw new Error("No active playback");
    try { await run(); } catch { throw safeFailure(); }
  }
  private fail(code: string) {
    this.snapshot = { ...this.snapshot, state: "error", error: { code, message: "Android playback failed", fatal: true } };
    this.emit();
  }
  private emit() { for (const listener of this.listeners) listener(this.snapshot); }
}
