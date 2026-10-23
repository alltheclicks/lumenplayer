import type {
  PlaybackError,
  TVPlaybackAdapter,
  TVPlaybackRequest,
  TVPlaybackSnapshot,
} from "@lumen/types";

export class UnsupportedPlaybackCapabilityError extends Error {
  constructor(readonly capability: string) {
    super(`Playback capability is not supported: ${capability}`);
    this.name = "UnsupportedPlaybackCapabilityError";
  }
}

export type TVPlaybackListener = (snapshot: TVPlaybackSnapshot) => void;

/** The legacy PlayerAdapter surface uses seconds; TV/session contracts use ms. */
export const playerSecondsToMilliseconds = (seconds: number): number => {
  if (!Number.isFinite(seconds)) throw new RangeError("Player time must be finite seconds");
  return Math.round(seconds * 1000);
};

export const millisecondsToPlayerSeconds = (milliseconds: number): number => {
  if (!Number.isFinite(milliseconds)) throw new RangeError("Playback time must be finite milliseconds");
  return milliseconds / 1000;
};

export const clampSeekPositionMs = (positionMs: number, durationMs: number | null): number => {
  if (!Number.isFinite(positionMs)) throw new RangeError("Seek position must be finite milliseconds");
  return Math.max(0, durationMs === null ? positionMs : Math.min(positionMs, Math.max(0, durationMs)));
};

const initialSnapshot = (): TVPlaybackSnapshot => ({
  request: null,
  state: "idle",
  positionMs: 0,
  durationMs: null,
  error: null,
});

/**
 * Owns request generations and cleanup around a platform playback adapter.
 * All public times are milliseconds. Adapters must honor AbortSignal and
 * discard work started by a signal that has been aborted.
 */
export class TVPlaybackController {
  private generation = 0;
  private abortController: AbortController | null = null;
  private snapshot = initialSnapshot();
  private readonly listeners = new Set<TVPlaybackListener>();
  private readonly unsubscribeAdapter: () => void;
  private destroyed = false;

  constructor(private readonly adapter: TVPlaybackAdapter) {
    this.unsubscribeAdapter = adapter.onChange((snapshot) => {
      if (this.destroyed || this.abortController?.signal.aborted) return;
      // The adapter must echo the exact request object it received. This also
      // lets us discard late state/error notifications from an older load.
      if (this.snapshot.request !== null && snapshot.request !== this.snapshot.request) return;
      this.snapshot = {
        ...snapshot,
        error: snapshot.error ? redactPlaybackError(snapshot.error) : null,
      };
      this.emit();
    });
  }

  getSnapshot(): TVPlaybackSnapshot {
    return this.snapshot;
  }

  onChange(listener: TVPlaybackListener): () => void {
    if (this.destroyed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async load(request: TVPlaybackRequest, options: { signal?: AbortSignal } = {}): Promise<void> {
    this.assertAlive();
    this.assertSupported(request);
    if (options.signal?.aborted) return;
    this.abortController?.abort();
    const controller = new AbortController();
    const forwardCallerAbort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", forwardCallerAbort, { once: true });
    this.abortController = controller;
    const generation = ++this.generation;
    this.snapshot = {
      request,
      state: "loading",
      positionMs: 0,
      durationMs: request.kind === "catch-up" ? request.durationMs : null,
      error: null,
    };
    this.emit();

    try {
      await this.adapter.load(request, { signal: controller.signal });
      if (!this.isCurrent(generation) || controller.signal.aborted) return;
      const snapshot = this.adapter.getSnapshot();
      this.snapshot = {
        ...snapshot,
        request,
        error: snapshot.error ? redactPlaybackError(snapshot.error) : null,
      };
      this.emit();
    } catch (error) {
      if (!this.isCurrent(generation) || controller.signal.aborted || isAbortError(error)) return;
      const safeError = redactUnknownError(error);
      this.snapshot = { ...this.snapshot, state: "error", error: safeError };
      this.emit();
      throw new Error(safeError.message);
    } finally {
      options.signal?.removeEventListener("abort", forwardCallerAbort);
      // Retain the generation signal until replacement/teardown so adapters
      // can also cancel resources/events created by a completed load.
    }
  }

  async play(): Promise<void> {
    this.assertAlive();
    await this.adapter.play();
  }

  async pause(): Promise<void> {
    this.assertAlive();
    await this.adapter.pause();
  }

  async seek(positionMs: number): Promise<number> {
    this.assertAlive();
    if (!this.adapter.getCapabilities().seek) {
      throw new UnsupportedPlaybackCapabilityError("seek");
    }
    const clamped = clampSeekPositionMs(positionMs, this.snapshot.durationMs);
    await this.adapter.seek(clamped);
    return clamped;
  }

  async returnToLive(): Promise<void> {
    this.assertAlive();
    if (!this.adapter.getCapabilities().returnToLive) {
      throw new UnsupportedPlaybackCapabilityError("returnToLive");
    }
    const generation = this.generation;
    await this.adapter.returnToLive();
    if (!this.isCurrent(generation) || this.abortController?.signal.aborted) return;
    // Returning to live changes the request (including its media URL). Adopt
    // the adapter's new request before filtering its subsequent notifications.
    const snapshot = this.adapter.getSnapshot();
    this.snapshot = {
      ...snapshot,
      error: snapshot.error ? redactPlaybackError(snapshot.error) : null,
    };
    this.emit();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.generation += 1;
    this.abortController?.abort();
    this.abortController = null;
    this.unsubscribeAdapter();
    try {
      void Promise.resolve(this.adapter.stop()).catch(() => undefined);
    } catch {
      // Continue teardown even if a platform's synchronous stop path fails.
    }
    try {
      this.adapter.destroy();
    } finally {
      this.listeners.clear();
    }
  }

  private assertSupported(request: TVPlaybackRequest): void {
    const capabilities = this.adapter.getCapabilities();
    if (request.kind === "live" && !capabilities.live) {
      throw new UnsupportedPlaybackCapabilityError("live");
    }
    if (request.kind === "catch-up" && !capabilities.catchUp) {
      throw new UnsupportedPlaybackCapabilityError("catchUp");
    }
    if (!capabilities.mediaTypes.includes(request.media.type)) {
      throw new UnsupportedPlaybackCapabilityError(`mediaType:${request.media.type}`);
    }
    if (request.kind === "catch-up" && (
      !Number.isFinite(request.startTimeMs)
      || !Number.isFinite(request.durationMs)
      || request.durationMs <= 0
    )) {
      throw new RangeError("Catch-up start time and duration must use finite milliseconds");
    }
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error("Playback controller has been destroyed");
  }

  private isCurrent(generation: number): boolean {
    return !this.destroyed && generation === this.generation;
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.snapshot);
  }
}

const isAbortError = (error: unknown): boolean => (
  typeof error === "object" && error !== null && "name" in error && error.name === "AbortError"
);

const redactPlaybackError = (error: PlaybackError): PlaybackError => ({
  code: /^[a-z0-9_.-]{1,64}$/i.test(error.code) ? error.code : "playback_failed",
  message: "Playback request failed",
  fatal: error.fatal,
  ...(typeof error.httpStatus === "number" ? { httpStatus: error.httpStatus } : {}),
});

const redactUnknownError = (error: unknown): PlaybackError => {
  if (typeof error === "object" && error !== null && "code" in error && "fatal" in error) {
    return redactPlaybackError(error as PlaybackError);
  }
  return { code: "playback_failed", message: "Playback request failed", fatal: true };
};
