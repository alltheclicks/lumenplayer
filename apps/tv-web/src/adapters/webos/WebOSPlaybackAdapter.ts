import type {
  PlaybackError, PlaybackState, TVLivePlaybackRequest, TVPlaybackAdapter,
  TVPlaybackCapabilities, TVPlaybackRequest, TVPlaybackSnapshot,
} from "@lumen/types";

/** HTMLVideoElement satisfies this surface; host tests need no DOM or decoder. */
export type WebOSMediaElement = Pick<HTMLMediaElement,
  "src" | "currentTime" | "duration" | "readyState" | "paused" | "ended" | "seeking" |
  "error" | "seekable" | "autoplay" | "preload" | "load" | "play" | "pause" |
  "removeAttribute" | "addEventListener" | "removeEventListener"
>;

export interface WebOSVisibility extends Pick<Document, "addEventListener" | "removeEventListener"> {
  readonly hidden?: boolean;
  readonly webkitHidden?: boolean;
}

export interface WebOSPlaybackOptions {
  /** Return a fresh, exclusively owned element for each load; mount it in the UI. */
  createMediaElement(): WebOSMediaElement;
  /** Remove the emptied element from its mount. Never reuse retired elements. */
  releaseMediaElement?(element: WebOSMediaElement): void;
  visibility?: WebOSVisibility;
  /** Domain/source layer supplies the real live URL; archive URLs are never rewritten. */
  resolveLiveRequest?(request: TVPlaybackRequest): TVLivePlaybackRequest;
  loadTimeoutMs?: number;
  seekTimeoutMs?: number;
}

type Session = {
  media: WebOSMediaElement;
  request: TVPlaybackRequest;
  signal: AbortSignal;
  cleanups: Array<() => void>;
  rejectLoad: ((error: Error) => void) | null;
  rejectSeek: ((error: Error) => void) | null;
  hasPlayed: boolean;
};

const emptySnapshot = (): TVPlaybackSnapshot => ({
  request: null, state: "idle", positionMs: 0, durationMs: null, error: null,
});
const abortError = (): Error => Object.assign(new Error("Playback operation cancelled"), { name: "AbortError" });
const failure = (code: string, fatal = true): Error & PlaybackError => Object.assign(
  new Error("Playback request failed"), { code, fatal },
);
const finiteMs = (seconds: number): number | null => (
  Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : null
);

/** Native HTML media path for webOS TV 5; no MSE library, DRM, or provider rewriting. */
export class WebOSPlaybackAdapter implements TVPlaybackAdapter {
  private snapshot = emptySnapshot();
  private session: Session | null = null;
  private readonly retired = new WeakSet<WebOSMediaElement>();
  private readonly listeners = new Set<(snapshot: TVPlaybackSnapshot) => void>();
  private destroyed = false;
  private resume: { request: TVPlaybackRequest; positionMs: number; signal: AbortSignal } | null = null;
  private unsubscribeResume: (() => void) | null = null;
  private readonly visibilityEvent: string;
  private readonly loadTimeoutMs: number;
  private readonly seekTimeoutMs: number;

  constructor(private readonly options: WebOSPlaybackOptions) {
    this.loadTimeoutMs = options.loadTimeoutMs ?? 30_000;
    this.seekTimeoutMs = options.seekTimeoutMs ?? 10_000;
    if (![this.loadTimeoutMs, this.seekTimeoutMs].every(value => Number.isFinite(value) && value > 0)) {
      throw new RangeError("Playback timeouts must be positive finite milliseconds");
    }
    this.visibilityEvent = options.visibility?.hidden !== undefined ? "visibilitychange" : "webkitvisibilitychange";
    options.visibility?.addEventListener(this.visibilityEvent, this.onVisibility);
  }

  getCapabilities(): TVPlaybackCapabilities {
    return {
      live: !this.destroyed, catchUp: !this.destroyed, seek: !this.destroyed,
      returnToLive: !this.destroyed && !!this.options.resolveLiveRequest,
      mediaTypes: this.destroyed ? [] : ["hls", "mp4"],
    };
  }

  getSnapshot(): TVPlaybackSnapshot { return { ...this.snapshot }; }
  onChange(listener: (snapshot: TVPlaybackSnapshot) => void): () => void {
    if (this.destroyed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  load(request: TVPlaybackRequest, { signal }: { signal: AbortSignal }): Promise<void> {
    this.assertAlive();
    if (signal.aborted) return Promise.reject(abortError());
    this.validate(request);
    this.clearResume();
    this.release(abortError());
    this.snapshot = { request, state: "loading", positionMs: 0, durationMs: null, error: null };
    if (this.isHidden()) {
      this.rememberResume(request, 0, signal);
      this.publish("paused");
      return Promise.reject(abortError());
    }
    let media: WebOSMediaElement;
    try {
      media = this.options.createMediaElement();
      if (this.retired.has(media)) throw failure("webos_element_reused");
      this.retired.add(media);
    } catch {
      const error = failure("webos_element_unavailable");
      this.publish("error", error);
      return Promise.reject(error);
    }
    const session: Session = { media, request, signal, cleanups: [], rejectLoad: null, rejectSeek: null, hasPlayed: false };
    this.session = session;
    return new Promise<void>((resolve, reject) => {
      session.rejectLoad = reject;
      const current = () => this.session === session && !signal.aborted && !this.destroyed;
      const listen = (name: string, handler: () => void) => {
        const guarded = () => { if (current()) handler(); };
        media.addEventListener(name, guarded);
        session.cleanups.push(() => media.removeEventListener(name, guarded));
      };
      const ready = () => {
        if (media.readyState < 3 || !session.rejectLoad) return;
        clearTimeout(timeout);
        session.rejectLoad = null;
        this.refresh(session);
        this.publish(media.paused ? "paused" : "buffering");
        resolve();
      };
      const timeout = setTimeout(() => {
        if (current()) this.fail(session, failure("webos_load_timeout"));
      }, this.loadTimeoutMs);
      session.cleanups.push(() => clearTimeout(timeout));
      const abort = () => {
        if (this.session !== session) return;
        this.release(abortError());
        this.snapshot = emptySnapshot();
        this.publish("idle");
      };
      signal.addEventListener("abort", abort, { once: true });
      session.cleanups.push(() => signal.removeEventListener("abort", abort));
      listen("canplay", ready);
      listen("loadeddata", ready);
      for (const event of ["loadedmetadata", "durationchange", "timeupdate"]) {
        listen(event, () => { this.refresh(session); this.publish(this.snapshot.state); });
      }
      listen("playing", () => {
        if (!media.paused && !this.isHidden()) {
          session.hasPlayed = true;
          this.refresh(session);
          this.publish("playing");
        }
      });
      listen("pause", () => { this.refresh(session); this.publish("paused"); });
      listen("waiting", () => this.publish(media.paused ? "paused" : "buffering"));
      listen("stalled", () => this.publish(media.paused ? "paused" : "buffering"));
      listen("seeking", () => this.publish("seeking"));
      listen("seeked", () => {
        this.refresh(session);
        this.publish(this.settledState(session));
      });
      listen("ended", () => { this.refresh(session); this.publish("ended"); });
      listen("error", () => {
        const code = media.error?.code;
        // MEDIA_ERR_ABORTED from the platform is distinct from caller cancellation.
        this.fail(session, failure(code === 1 ? "webos_media_aborted" : code === 2 ? "webos_media_network" :
          code === 3 ? "webos_media_decode" : code === 4 ? "webos_media_unsupported" : "webos_media_failed"));
      });
      this.publish("loading");
      // A subscriber can stop/destroy/load again during notification.
      if (!current()) return;
      try {
        media.autoplay = false;
        media.preload = "auto";
        media.src = request.media.url;
        media.load();
      } catch {
        if (current()) this.fail(session, failure("webos_load_failed"));
      }
    });
  }

  async play(): Promise<void> {
    this.assertAlive();
    if (this.isHidden()) throw failure("webos_app_hidden", false);
    if (this.resume) {
      const resume = this.resume;
      this.clearResume();
      if (resume.signal.aborted) { this.stop(); throw abortError(); }
      const loading = this.load(resume.request, { signal: resume.signal });
      const resumedSession = this.session;
      await loading;
      if (!resumedSession || this.session !== resumedSession || resume.signal.aborted) throw abortError();
      if (resume.request.kind === "catch-up" && resume.positionMs > 0) await this.seek(resume.positionMs);
      if (this.session !== resumedSession || resume.signal.aborted) throw abortError();
    }
    const session = this.requireSession();
    if (session.rejectLoad) throw failure("webos_not_ready", false);
    try { await session.media.play(); }
    catch {
      if (this.session !== session || session.signal.aborted) throw abortError();
      const error = failure("webos_play_failed", false);
      this.publish("error", error);
      throw error;
    }
    if (this.session !== session || session.signal.aborted) throw abortError();
    // Only the media 'playing' event establishes playback, never a resolved play().
  }

  pause(): void {
    this.assertAlive();
    if (this.resume) return;
    const session = this.requireSession();
    try { session.media.pause(); this.refresh(session); this.publish("paused"); }
    catch { throw failure("webos_pause_failed", false); }
  }

  seek(positionMs: number): Promise<void> {
    this.assertAlive();
    if (!Number.isFinite(positionMs)) throw new RangeError("Seek position must be finite milliseconds");
    const session = this.requireSession();
    if (session.rejectLoad) throw failure("webos_not_ready", false);
    const media = session.media;
    this.refresh(session);
    let target = Math.max(0, positionMs) / 1000;
    if (this.snapshot.durationMs !== null) target = Math.min(target, this.snapshot.durationMs / 1000);
    // Reject holes/outside the platform's current seekable ranges rather than claiming a seek.
    let inRange = false;
    for (let index = 0; index < media.seekable.length; index++) {
      if (target >= media.seekable.start(index) && target <= media.seekable.end(index)) inRange = true;
    }
    if (!inRange) throw failure("webos_seek_unavailable", false);
    session.rejectSeek?.(abortError());
    if (!media.seeking && Math.abs(media.currentTime - target) < 0.001) {
      this.publish(this.settledState(session));
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        media.removeEventListener("seeked", done);
        if (session.rejectSeek === cancel) session.rejectSeek = null;
        if (error) reject(error); else resolve();
      };
      const cancel = (error: Error) => finish(error);
      const done = () => {
        if (this.session === session && !session.signal.aborted && !media.seeking && Math.abs(media.currentTime - target) < 0.25) finish();
      };
      const timeout = setTimeout(() => {
        if (this.session === session) {
          this.refresh(session);
          this.publish(media.paused ? "paused" : "buffering");
        }
        finish(failure("webos_seek_timeout", false));
      }, this.seekTimeoutMs);
      session.rejectSeek = cancel;
      media.addEventListener("seeked", done);
      this.publish("seeking");
      if (this.session !== session || session.signal.aborted) return;
      try { media.currentTime = target; }
      catch {
        this.refresh(session);
        this.publish(media.paused ? "paused" : "buffering");
        finish(failure("webos_seek_failed", false));
      }
    });
  }

  async returnToLive(): Promise<void> {
    this.assertAlive();
    if (!this.options.resolveLiveRequest) throw failure("webos_live_resolver_unavailable", false);
    const session = this.requireSession();
    let request: TVLivePlaybackRequest;
    try { request = this.options.resolveLiveRequest(session.request); }
    catch { throw failure("webos_live_resolve_failed", false); }
    if (this.session !== session || session.signal.aborted) throw abortError();
    if (request.kind !== "live" || request.sourceId !== session.request.sourceId || request.channelId !== session.request.channelId) {
      throw failure("webos_live_request_invalid", false);
    }
    await this.load(request, { signal: session.signal });
    // Caller explicitly asks for playback after load/return; loading itself never autoplays.
  }

  stop(): void {
    this.clearResume();
    this.release(abortError());
    this.snapshot = emptySnapshot();
    if (!this.destroyed) this.publish("idle");
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.options.visibility?.removeEventListener(this.visibilityEvent, this.onVisibility);
    this.stop();
    this.listeners.clear();
  }

  private readonly onVisibility = () => {
    const session = this.session;
    if (!this.isHidden() || !session) return;
    this.refresh(session);
    const positionMs = this.snapshot.positionMs;
    this.release(abortError());
    this.rememberResume(session.request, positionMs, session.signal);
    this.publish("paused");
  };
  private clearResume(): void {
    this.unsubscribeResume?.();
    this.unsubscribeResume = null;
    this.resume = null;
  }
  private rememberResume(request: TVPlaybackRequest, positionMs: number, signal: AbortSignal): void {
    this.clearResume();
    if (signal.aborted) return;
    this.resume = { request, positionMs, signal };
    const abort = () => {
      this.clearResume();
      this.snapshot = emptySnapshot();
      this.publish("idle");
    };
    signal.addEventListener("abort", abort, { once: true });
    this.unsubscribeResume = () => signal.removeEventListener("abort", abort);
  }
  private isHidden(): boolean {
    return !!(this.options.visibility?.hidden ?? this.options.visibility?.webkitHidden);
  }
  private assertAlive(): void {
    if (this.destroyed) throw failure("webos_adapter_destroyed");
  }
  private requireSession(): Session {
    const session = this.session;
    if (!session || session.signal.aborted) throw failure("webos_no_media", false);
    return session;
  }
  private validate(request: TVPlaybackRequest): void {
    if (!["hls", "mp4"].includes(request.media.type)) throw failure("webos_media_type_unsupported");
    if (request.media.drm) throw failure("webos_drm_unsupported");
    let url: URL;
    try { url = new URL(request.media.url); } catch { throw failure("webos_url_invalid"); }
    if (!["http:", "https:"].includes(url.protocol)) throw failure("webos_protocol_unsupported");
    if (request.kind === "catch-up" && (!Number.isFinite(request.startTimeMs) ||
      !Number.isFinite(request.durationMs) || request.durationMs <= 0)) {
      throw new RangeError("Catch-up start and duration must use finite milliseconds");
    }
  }
  private refresh(session: Session): void {
    this.snapshot = {
      ...this.snapshot,
      positionMs: finiteMs(session.media.currentTime) ?? 0,
      // Request duration is an archive hint, not observed media duration.
      durationMs: finiteMs(session.media.duration),
    };
  }
  private settledState(session: Session): PlaybackState {
    const media = session.media;
    return media.ended ? "ended" : media.paused ? "paused" :
      session.hasPlayed && media.readyState >= 3 && !media.seeking ? "playing" : "buffering";
  }
  private publish(state: PlaybackState, error: PlaybackError | null = null): void {
    this.snapshot = { ...this.snapshot, state, error: error ? { code: error.code, message: "Playback request failed", fatal: error.fatal } : null };
    for (const listener of this.listeners) listener(this.getSnapshot());
  }
  private fail(session: Session, error: Error & PlaybackError): void {
    if (this.session !== session) return;
    this.refresh(session);
    this.release(error);
    this.publish("error", error);
  }
  private release(error: Error): void {
    const session = this.session;
    if (!session) return;
    this.session = null;
    for (const cleanup of session.cleanups) cleanup();
    session.rejectLoad?.(error);
    session.rejectLoad = null;
    session.rejectSeek?.(error);
    session.rejectSeek = null;
    // Best effort independently: one failing platform call must not skip later cleanup.
    try { session.media.pause(); } catch { /* Continue releasing decoder. */ }
    try { session.media.removeAttribute("src"); } catch { /* Continue resetting media. */ }
    try { session.media.load(); } catch { /* Continue unmounting element. */ }
    try { this.options.releaseMediaElement?.(session.media); } catch { /* Already invalidated. */ }
  }
}

export function createWebOSPlaybackAdapter(options: WebOSPlaybackOptions): TVPlaybackAdapter {
  return new WebOSPlaybackAdapter(options);
}
