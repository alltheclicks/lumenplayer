import type {
  TVCatchUpPlaybackRequest, TVLivePlaybackRequest, TVPlaybackAdapter,
  TVPlaybackCapabilities, TVPlaybackRequest, TVPlaybackSnapshot,
} from "@lumen/types";
import type { AVPlay, AVPlayDisplayArea, AVPlayListener } from "./avplay";

export interface TizenPlaybackOptions {
  avplay: AVPlay;
  /** Native preparation watchdog, in addition to the public operation deadline. */
  prepareTimeoutMs?: number;
  /** Bounds each public wait including queue time; also watches native seeks. */
  operationTimeoutMs?: number;
  displayArea: AVPlayDisplayArea;
  /** Resolves through the caller's source policy; must preserve source/channel. */
  resolveLive?: (archive: TVCatchUpPlaybackRequest, signal: AbortSignal) =>
    TVLivePlaybackRequest | Promise<TVLivePlaybackRequest>;
}

type Session = {
  request: TVPlaybackRequest;
  signal: AbortSignal;
  cancellation: AbortController;
  detach: () => void;
  pending: Set<(error: Error) => void>;
  prepared: boolean;
  seeking: boolean;
  playing: boolean;
};
const failure = (code: string): Error => Object.assign(new Error("Playback request failed"), { code, fatal: true });
const aborted = (): Error => Object.assign(new Error("Playback request cancelled"), { name: "AbortError" });
const idle = (): TVPlaybackSnapshot => ({ request: null, state: "idle", positionMs: 0, durationMs: null, error: null });
const MAX_TIME = 2_147_483_647; // AVPlay seekTo's signed WebIDL long, in ms.

/** One exclusive owner of the injected AVPlay singleton. load prepares; play starts. */
export class TizenTVPlaybackAdapter implements TVPlaybackAdapter {
  private snapshot = idle();
  private readonly listeners = new Set<(snapshot: TVPlaybackSnapshot) => void>();
  private session: Session | null = null;
  private nativeSession: Session | null = null;
  private nativeQueue: Promise<unknown> = Promise.resolve();
  private destroyed = false;
  private recoveryRequired = false;
  private nativeSeeking = false;
  private readonly publicPending = new Set<(error: Error) => void>();
  private readonly area: AVPlayDisplayArea;

  constructor(private readonly options: TizenPlaybackOptions) {
    if (!Number.isFinite(options.prepareTimeoutMs ?? 30_000) || (options.prepareTimeoutMs ?? 30_000) <= 0) {
      throw new RangeError("Invalid AVPlay preparation timeout");
    }
    if (!Number.isFinite(options.operationTimeoutMs ?? 30_000) || (options.operationTimeoutMs ?? 30_000) <= 0) {
      throw new RangeError("Invalid AVPlay operation timeout");
    }
    const area = options.displayArea;
    if (![area.x, area.y, area.width, area.height].every(Number.isInteger)
      || area.x < 0 || area.y < 0 || area.width <= 0 || area.height <= 0
      || area.x + area.width > 1920 || area.y + area.height > 1080) {
      throw new RangeError("Invalid AVPlay display area");
    }
    this.area = { ...area };
  }

  /** A new owner must never bypass an unresolved native seek or recovery latch. */
  requiresNativeRestart(): boolean { return this.nativeSeeking || this.recoveryRequired; }
  isNativeReleased(): boolean { return this.nativeSession === null && !this.nativeSeeking; }

  getCapabilities(): TVPlaybackCapabilities {
    return { live: true, catchUp: true, seek: true, returnToLive: !!this.options.resolveLive, mediaTypes: ["hls", "mp4"] };
  }
  getSnapshot(): TVPlaybackSnapshot { return { ...this.snapshot, error: this.snapshot.error && { ...this.snapshot.error } }; }
  onChange(callback: (snapshot: TVPlaybackSnapshot) => void): () => void {
    if (this.destroyed) return () => undefined;
    this.listeners.add(callback);
    return () => { this.listeners.delete(callback); };
  }

  load(request: TVPlaybackRequest, { signal }: { signal: AbortSignal }): Promise<void> {
    this.assertAlive();
    this.validate(request);
    if (signal.aborted) return Promise.reject(aborted());
    this.invalidate();
    const session: Session = { request, signal, cancellation: new AbortController(), detach: () => undefined, pending: new Set(), prepared: false, seeking: false, playing: false };
    this.session = session;
    const cancel = () => {
      if (this.session !== session || this.destroyed) return;
      this.invalidate();
      // Cancellation freezes the last snapshot; no provider error is emitted.
      void this.enqueue(() => this.release(session)).catch(() => undefined);
    };
    signal.addEventListener("abort", cancel, { once: true });
    let preparationTimer: ReturnType<typeof setTimeout> | undefined;
    session.detach = () => {
      signal.removeEventListener("abort", cancel);
      clearTimeout(preparationTimer);
    };
    this.update(session, { request, state: "loading", positionMs: 0, durationMs: request.kind === "catch-up" ? request.durationMs : null, error: null });
    return this.pending(session, (resolve, reject) => {
      void this.enqueue(() => {
        // Even a cancelled queued replacement must release its retired native
        // predecessor once the preceding seek has finished.
        this.release();
        if (!this.current(session)) return;
        this.nativeSession = session; // Also close when open throws partway through.
        const api = this.options.avplay;
        api.open(request.media.url);
        api.setListener(this.platformListener(session));
        const { x, y, width, height } = this.area;
        api.setDisplayRect(x, y, width, height);
        preparationTimer = setTimeout(() => this.fail(session, "tizen_prepare_timeout", reject), this.options.prepareTimeoutMs ?? 30_000);
        api.prepareAsync(() => {
          if (!this.current(session) || session.prepared) return;
          clearTimeout(preparationTimer);
          try {
            session.prepared = true;
            const nativeDuration = api.getDuration();
            const durationMs = request.kind === "catch-up" && Number.isFinite(nativeDuration) && nativeDuration > 0
              ? Math.min(request.durationMs, nativeDuration) : this.snapshot.durationMs;
            this.update(session, { state: "paused", durationMs });
            resolve();
          } catch { this.fail(session, "tizen_prepare_failed", reject); }
        }, () => this.fail(session, "tizen_prepare_failed", reject));
      }).catch(() => this.fail(session, "tizen_prepare_failed", reject));
    });
  }

  async play(): Promise<void> {
    const session = this.ready();
    await this.command(session, () => {
      this.options.avplay.play(); session.playing = true;
      this.update(session, { state: "playing" });
    });
  }
  async pause(): Promise<void> {
    const session = this.ready();
    await this.command(session, () => {
      // READY already corresponds to the contract's prepared/paused state.
      if (session.playing) this.options.avplay.pause();
      session.playing = false;
      this.update(session, { state: "paused" });
    });
  }

  seek(positionMs: number): Promise<void> {
    const session = this.ready();
    if (session.request.kind !== "catch-up") return Promise.reject(failure("tizen_live_seek_unsupported"));
    if (!Number.isFinite(positionMs)) return Promise.reject(new RangeError("Seek position must be finite milliseconds"));
    const target = Math.max(0, Math.min(Math.round(positionMs), Math.floor(this.snapshot.durationMs ?? MAX_TIME), MAX_TIME));
    return this.pending(session, (resolve, reject) => {
      void this.enqueue(() => {
        if (!this.current(session)) return;
        session.seeking = true;
        this.nativeSeeking = true;
        this.update(session, { state: "seeking" });
        // Samsung forbids other native calls until a seek callback. Keep the
        // native queue locked even if caller cancellation settles public work.
        return new Promise<void>((unlock) => {
          // Independent of the caller/session: abort must not cancel this watchdog.
          const timer = setTimeout(() => this.requireRecovery(), this.options.operationTimeoutMs ?? 30_000);
          let finished = false;
          const finish = (ok: boolean) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            this.nativeSeeking = false;
            unlock();
            if (!this.current(session)) return;
            session.seeking = false;
            if (!ok) { this.fail(session, "tizen_seek_failed", reject); return; }
            try {
              const actual = this.options.avplay.getCurrentTime();
              this.update(session, { state: session.playing ? "playing" : "paused", positionMs: this.clamp(actual, target) });
              resolve();
            } catch { this.fail(session, "tizen_seek_failed", reject); }
          };
          try { this.options.avplay.seekTo(target, () => finish(true), () => finish(false)); }
          catch { finish(false); }
        });
      }).catch(() => this.fail(session, "tizen_seek_failed", reject));
    });
  }

  async returnToLive(): Promise<void> {
    const session = this.ready();
    if (session.request.kind === "live") return;
    const resolver = this.options.resolveLive;
    if (!resolver) throw failure("tizen_return_live_unsupported");
    const archive = session.request;
    const live = await this.pending<TVLivePlaybackRequest>(session, (resolve, reject) => {
      Promise.resolve().then(() => resolver(archive, session.cancellation.signal)).then(resolve, () => reject(failure("tizen_live_resolution_failed")));
    });
    if (!this.current(session)) throw aborted();
    if (live.kind !== "live" || live.sourceId !== archive.sourceId || live.channelId !== archive.channelId) {
      throw failure("tizen_invalid_live_request");
    }
    await this.load(live, { signal: session.signal });
    if (this.session?.request !== live || session.signal.aborted) throw aborted();
    await this.play();
  }

  stop(): Promise<void> {
    if (this.recoveryRequired) return Promise.reject(failure("tizen_recovery_required"));
    if (this.destroyed) return Promise.reject(failure("tizen_destroyed"));
    this.invalidate();
    if (!this.destroyed) { this.snapshot = idle(); this.emit(); }
    return this.waitPublic((resolve, reject) => {
      void this.enqueue(() => this.release()).then(resolve, reject);
    });
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.invalidate();
    for (const reject of this.publicPending) reject(aborted());
    this.listeners.clear();
    this.snapshot = idle();
    void this.enqueue(() => this.release()).catch(() => undefined);
  }

  private platformListener(session: Session): AVPlayListener {
    return {
      onbufferingstart: () => { if (!session.seeking) this.update(session, { state: session.prepared ? "buffering" : "loading" }); },
      onbufferingcomplete: () => { if (session.prepared && !session.seeking) this.update(session, { state: session.playing ? "playing" : "paused" }); },
      oncurrentplaytime: (milliseconds) => {
        if (session.prepared && !session.seeking && Number.isFinite(milliseconds)) this.update(session, { positionMs: this.clamp(milliseconds, 0) });
      },
      onstreamcompleted: () => {
        if (!this.current(session)) return;
        this.update(session, { state: "ended" });
        this.invalidate(session);
        void this.enqueue(() => this.release(session)).catch(() => undefined);
      },
      onerror: () => this.fail(session, "tizen_playback_failed"),
      onerrormsg: () => this.fail(session, "tizen_playback_failed"),
    };
  }
  private validate(request: TVPlaybackRequest): void {
    if (!this.getCapabilities().mediaTypes.includes(request.media.type)) throw failure("tizen_format_unsupported");
    if (request.media.drm) throw failure("tizen_drm_unsupported");
    if (!/^https?:\/\/[^\s]+$/i.test(request.media.url)) throw failure("tizen_url_unsupported");
    if (request.kind === "catch-up" && (!Number.isFinite(request.startTimeMs)
      || !Number.isFinite(request.durationMs) || request.durationMs <= 0 || request.durationMs > MAX_TIME)) {
      throw new RangeError("Catch-up requires finite epoch milliseconds and a supported duration");
    }
  }
  private current(session: Session): boolean { return !this.destroyed && !this.recoveryRequired && this.session === session && !session.signal.aborted; }
  private assertAlive(): void {
    if (this.destroyed) throw failure("tizen_destroyed");
    if (this.recoveryRequired) throw failure("tizen_recovery_required");
  }
  private ready(): Session {
    this.assertAlive();
    if (!this.session || !this.current(this.session) || !this.session.prepared) throw failure("tizen_not_ready");
    return this.session;
  }
  private clamp(value: number, fallback: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.min(value, this.snapshot.durationMs ?? Infinity)) : fallback;
  }
  private update(session: Session, patch: Partial<TVPlaybackSnapshot>): void {
    if (!this.current(session)) return;
    this.snapshot = { ...this.snapshot, ...patch };
    this.emit();
  }
  private emit(): void { for (const listener of this.listeners) listener(this.getSnapshot()); }
  private invalidate(only?: Session): void {
    const session = this.session;
    if (only && session !== only) return;
    this.session = null;
    if (!session) return;
    session.detach();
    session.cancellation.abort();
    for (const reject of session.pending) reject(aborted());
    session.pending.clear();
  }
  private fail(session: Session, code: string, reject?: (error: Error) => void): void {
    if (!this.current(session)) return;
    const error = failure(code);
    this.update(session, { state: "error", error: { code, message: error.message, fatal: true } });
    reject?.(error);
    for (const pendingReject of session.pending) pendingReject(error);
    this.invalidate(session);
    void this.enqueue(() => this.release(session)).catch(() => undefined);
  }
  /** A timeout retires public work, never unlocks the native seek queue. */
  private requireRecovery(): void {
    if (this.recoveryRequired) return;
    this.recoveryRequired = true;
    const error = failure("tizen_recovery_required");
    for (const reject of this.publicPending) reject(error);
    this.invalidate();
    // Only runs after a real seek callback. The recovery latch is never reset,
    // even if late best-effort cleanup succeeds.
    void this.enqueue(() => this.release()).catch(() => undefined);
    if (!this.destroyed) {
      this.snapshot = { ...this.snapshot, state: "error", error: { code: "tizen_recovery_required", message: error.message, fatal: true } };
      this.emit();
    }
  }
  private waitPublic<T = void>(
    start: (resolve: (value: T) => void, reject: (error: Error) => void) => void,
    session?: Session,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.destroyed) { reject(failure("tizen_destroyed")); return; }
      if (this.recoveryRequired) { reject(failure("tizen_recovery_required")); return; }
      if (session && !this.current(session)) { reject(aborted()); return; }
      let settled = false;
      const cleanup = () => {
        settled = true;
        clearTimeout(timer);
        this.publicPending.delete(fail);
        session?.pending.delete(fail);
      };
      const fail = (error: Error) => { if (!settled) { cleanup(); reject(error); } };
      const timer = setTimeout(() => {
        if (this.nativeSeeking) this.requireRecovery();
        else if (session) this.fail(session, session.prepared ? "tizen_operation_timeout" : "tizen_prepare_timeout", fail);
        else fail(failure("tizen_operation_timeout"));
      }, this.options.operationTimeoutMs ?? 30_000);
      this.publicPending.add(fail);
      session?.pending.add(fail);
      try { start((value) => { if (!settled) { cleanup(); resolve(value); } }, fail); }
      catch (error) { fail(error instanceof Error ? error : failure("tizen_command_failed")); }
    });
  }
  private pending<T = void>(session: Session, start: (resolve: (value: T) => void, reject: (error: Error) => void) => void): Promise<T> {
    return this.waitPublic(start, session);
  }
  private enqueue<T>(action: () => T | Promise<T>): Promise<T> {
    const result = this.nativeQueue.then(action);
    this.nativeQueue = result.catch(() => undefined);
    return result;
  }
  private command(session: Session, action: () => void): Promise<void> {
    return this.pending(session, (resolve, reject) => {
      void this.enqueue(() => {
        if (!this.current(session)) return;
        try { action(); resolve(); }
        catch { this.fail(session, "tizen_command_failed", reject); }
      });
    });
  }
  private release(only?: Session): void {
    if (!this.nativeSession || (only && this.nativeSession !== only)) return;
    const api = this.options.avplay;
    // Keep ownership when close fails: a subsequent load must retry cleanup
    // rather than open a second native resource on top of a failed close.
    try {
      try {
        api.setListener({});
        if (["READY", "PLAYING", "PAUSED"].includes(api.getState())) api.stop();
      } finally {
        api.close();
        this.nativeSession = null;
      }
    } catch { throw failure("tizen_cleanup_failed"); }
  }
}

export const createTizenTVPlaybackAdapter = (options: TizenPlaybackOptions): TVPlaybackAdapter => new TizenTVPlaybackAdapter(options);
