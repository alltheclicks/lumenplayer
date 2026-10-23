import type {
  MediaSource,
  PlaybackError,
  PlaybackState,
  PlayerAdapter,
} from "@lumen/types";

/** Explicit shell placeholder. TV-008 supplies the production Media3 adapter. */
export class NoPlaybackAdapter implements PlayerAdapter {
  private generation = 0;
  private state: PlaybackState = "idle";
  private stateListeners = new Set<(state: PlaybackState) => void>();
  private errorListeners = new Set<(error: PlaybackError) => void>();
  private timeListeners = new Set<(time: number) => void>();

  async load(_source: MediaSource): Promise<void> {
    const generation = ++this.generation;
    this.changeState("loading");
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    if (generation !== this.generation) {
      const cancelled = new Error("Playback test cancelled");
      cancelled.name = "AbortError";
      throw cancelled;
    }
    const error: PlaybackError = {
      code: "MEDIA_ADAPTER_NOT_AVAILABLE",
      message: "Android Media3 adapter is not connected in this build.",
      fatal: true,
    };
    this.changeState("error");
    this.errorListeners.forEach((listener) => listener(error));
    throw error;
  }

  play(): void {}
  pause(): void {}
  seek(_time: number): void {}
  stop(): void {
    this.generation += 1;
    this.changeState("idle");
  }
  destroy(): void {
    this.generation += 1;
    this.state = "idle";
    this.stateListeners.clear();
    this.errorListeners.clear();
    this.timeListeners.clear();
  }
  getCurrentTime(): number {
    return 0;
  }
  getDuration(): number {
    return 0;
  }
  getState(): PlaybackState {
    return this.state;
  }
  setVolume(_volume: number): void {}
  getVolume(): number {
    return 1;
  }
  onStateChange(callback: (state: PlaybackState) => void): () => void {
    this.stateListeners.add(callback);
    return () => this.stateListeners.delete(callback);
  }
  onError(callback: (error: PlaybackError) => void): () => void {
    this.errorListeners.add(callback);
    return () => this.errorListeners.delete(callback);
  }
  onTimeUpdate(callback: (time: number) => void): () => void {
    this.timeListeners.add(callback);
    return () => this.timeListeners.delete(callback);
  }

  private changeState(state: PlaybackState): void {
    this.state = state;
    this.stateListeners.forEach((listener) => listener(state));
  }
}
