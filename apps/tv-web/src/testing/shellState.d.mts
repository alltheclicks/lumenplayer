export type ShellScreen = "home" | "settings" | "playback";
export type ShellPlaybackState = import("@lumen/types").PlaybackState;

export interface ShellState {
  screen: ShellScreen;
  previousScreen: ShellScreen;
  playback: ShellPlaybackState;
  error: string;
  language: string;
}

export interface ShellController {
  getState(): ShellState;
  subscribe(listener: (state: ShellState) => void): () => void;
  back(): void;
  openSettings(): void;
  setLanguage(language: string): void;
  startTest(url?: string): Promise<void>;
  destroy(): void;
}

export function createShellController(options: {
  storage?: Pick<Storage, "getItem" | "setItem">;
  createPlaybackController: () => import("@lumen/player-core").TVPlaybackController;
}): ShellController;

export function createInitialState(language?: string): ShellState;
export type ShellAction =
  | { type: "OPEN_SETTINGS" | "START_TEST" | "BACK" }
  | { type: "PLAYBACK_STATE"; state: ShellPlaybackState; code?: string }
  | { type: "PLAYBACK_ERROR"; message: string }
  | { type: "SET_LANGUAGE"; language: string };
export function reduceShellState(state: ShellState, action: ShellAction): ShellState;
