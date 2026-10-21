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
  const adapter = options.adapter;
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
      update({ type: "BACK" });
    },
    openSettings() {
      update({ type: "OPEN_SETTINGS" });
    },
    setLanguage(language) {
      update({ type: "SET_LANGUAGE", language });
    },
    async startTest() {
      update({ type: "START_TEST" });
      try {
        await adapter.load({ url: "fixture://no-playback", type: "hls" });
        update({ type: "PLAYBACK_ERROR", message: "Fixture adapter unexpectedly accepted playback." });
      } catch (error) {
        update({
          type: "PLAYBACK_ERROR",
          message: error instanceof Error ? error.message : "Playback is unavailable in this build.",
        });
      }
    },
  };
}
