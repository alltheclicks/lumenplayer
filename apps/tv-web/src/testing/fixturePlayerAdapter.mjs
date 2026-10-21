/** Deterministic UI fixture. It never opens a URL or reports successful playback. */
export class FixturePlayerAdapter {
  constructor() {
    this.errors = new Set();
    this.states = new Set();
    this.state = "idle";
  }

  async load() {
    const error = {
      code: "TV_PLAYBACK_ADAPTER_MISSING",
      message: "Fixture adapter: no media playback is available.",
      fatal: true,
    };
    this.state = "error";
    this.states.forEach((listener) => listener("error"));
    this.errors.forEach((listener) => listener(error));
    throw new Error(error.message);
  }

  play() {}
  pause() {}
  seek() {}
  stop() {}
  destroy() {}
  getCurrentTime() { return 0; }
  getDuration() { return 0; }
  getState() { return this.state; }
  setVolume() {}
  getVolume() { return 1; }
  onStateChange(callback) {
    this.states.add(callback);
    return () => this.states.delete(callback);
  }
  onError(callback) {
    this.errors.add(callback);
    return () => this.errors.delete(callback);
  }
  onTimeUpdate() { return () => undefined; }
}
