export const DEFAULT_LANGUAGE = "en";

export function createInitialState(language = DEFAULT_LANGUAGE) {
  return {
    screen: "home",
    previousScreen: "home",
    playback: "idle",
    error: "",
    language: language || DEFAULT_LANGUAGE,
  };
}

export function reduceShellState(state, action) {
  switch (action.type) {
    case "OPEN_SETTINGS":
      return { ...state, previousScreen: "home", playback: "idle", screen: "settings", error: "" };
    case "START_TEST":
      return { ...state, screen: "playback", playback: "loading", error: "" };
    case "PLAYBACK_STATE":
      return { ...state, playback: action.state, error: action.code || "" };
    case "PLAYBACK_ERROR":
      return { ...state, playback: "error", error: action.message };
    case "SET_LANGUAGE":
      return { ...state, language: action.language };
    case "BACK":
      if (state.screen === "settings") {
        return { ...state, screen: state.previousScreen, error: "" };
      }
      if (state.screen === "playback") {
        return { ...state, screen: "home", playback: "idle", error: "" };
      }
      return state;
    default:
      return state;
  }
}

export function createShellController(options = {}) {
  const storage = options.storage;
  const createPlaybackController = options.createPlaybackController;
  let playback;
  let generation = 0;
  let unsubscribe;
  function cancel() {
    generation += 1;
    unsubscribe?.();
    unsubscribe = undefined;
    playback?.destroy();
    playback = undefined;
  }
  const savedLanguage = storage?.getItem("@lumen/tv-web/language");
  let state = createInitialState(savedLanguage || DEFAULT_LANGUAGE);
  const listeners = new Set();

  function update(action) {
    state = reduceShellState(state, action);
    if (action.type === "SET_LANGUAGE") {
      storage?.setItem("@lumen/tv-web/language", action.language);
    }
    listeners.forEach((listener) => listener(state));
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    back() {
      cancel();
      update({ type: "BACK" });
    },
    openSettings() {
      cancel();
      update({ type: "OPEN_SETTINGS" });
    },
    setLanguage(language) {
      update({ type: "SET_LANGUAGE", language });
    },
    destroy() { cancel(); listeners.clear(); },
    async startTest(url = "") {
      cancel();
      const current = generation;
      url = url.trim();
      update({ type: "START_TEST" });
      try {
        const parsed = new URL(url);
        if (!["https:", "http:"].includes(parsed.protocol)) throw new Error();
      } catch {
        update({ type: "PLAYBACK_ERROR", message: "invalid_url" });
        return;
      }
      try {
        playback = createPlaybackController();
        const active = playback;
        unsubscribe = active.onChange(snapshot => {
          if (current !== generation) return;
          update({ type: "PLAYBACK_STATE", state: snapshot.state, code: snapshot.error?.code });
        });
        await active.load({ kind: "live", sourceId: "internal-live-test", channelId: "internal-live-test",
          media: { url, type: "hls" } });
        url = "";
        if (current !== generation) return;
        await active.play();
      } catch (error) {
        if (current !== generation) return;
        const code = error?.code === "source_origin_unconfigured" ? "source_origin_unconfigured"
          : error?.code === "platform_api_missing" ? "platform_api_missing"
          : error?.code === "tizen_recovery_required" ? "tizen_recovery_required"
          : error?.name === "UnsupportedPlaybackCapabilityError" ? "unsupported" : "playback_failed";
        update({ type: "PLAYBACK_ERROR", message: code });
      } finally { url = ""; }
    },
  };
}
