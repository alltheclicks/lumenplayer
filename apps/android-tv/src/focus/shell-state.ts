import type { PlaybackError, PlaybackState } from "@lumen/types";

export type Screen = "home" | "playback" | "settings";
export type PlaybackStatus = "idle" | "loading" | "playing" | "error";

export interface PlaybackViewState {
  status: PlaybackStatus;
  error: PlaybackError | null;
  engineState: PlaybackState;
}

export type PlaybackAction =
  | { type: "start" }
  | { type: "stateChanged"; state: PlaybackState }
  | { type: "failed"; error: PlaybackError }
  | { type: "reset" };

export const initialPlaybackState: PlaybackViewState = {
  status: "idle",
  error: null,
  engineState: "idle",
};

export function reducePlaybackState(
  state: PlaybackViewState,
  action: PlaybackAction,
): PlaybackViewState {
  switch (action.type) {
    case "start":
      return { status: "loading", error: null, engineState: "loading" };
    case "stateChanged":
      return {
        status: action.state === "error" ? "error" : action.state === "playing" ? "playing" : state.status,
        error: action.state === "error" ? state.error : null,
        engineState: action.state,
      };
    case "failed":
      return { status: "error", error: action.error, engineState: "error" };
    case "reset":
      return initialPlaybackState;
  }
}

export function backDestination(screen: Screen): Screen | null {
  return screen === "home" ? null : "home";
}
