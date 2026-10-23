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
      return { ...state, previousScreen: state.screen, screen: "settings", error: "" };
    case "START_TEST":
      return { ...state, screen: "playback", playback: "loading", error: "" };
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
  function cancel() {
    generation += 1;
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
    async startTest() {
      cancel();
      const current = generation;
      playback = createPlaybackController();
      update({ type: "START_TEST" });
      try {
        await playback.load({ kind: "live", sourceId: "shell-test", channelId: "shell-test",
          media: { url: "fixture://no-playback", type: "hls" } });
        if (current !== generation) return;
        update({ type: "PLAYBACK_ERROR", message: "Fixture adapter unexpectedly accepted playback." });
      } catch {
        if (current !== generation) return;
        update({
          type: "PLAYBACK_ERROR",
          message: "Platform adapter is not connected; no media playback is available.",
        });
      }
    },
  };
}
