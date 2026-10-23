export type ShellScreen = "home" | "settings" | "playback";
export type ShellPlaybackState = "idle" | "loading" | "error";

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
  startTest(): Promise<void>;
  destroy(): void;
}

export function createShellController(options: {
  storage?: Pick<Storage, "getItem" | "setItem">;
  createPlaybackController: () => import("@lumen/player-core").TVPlaybackController;
}): ShellController;

export function createInitialState(language?: string): ShellState;
export type ShellAction =
  | { type: "OPEN_SETTINGS" | "START_TEST" | "BACK" }
  | { type: "PLAYBACK_ERROR"; message: string }
  | { type: "SET_LANGUAGE"; language: string };
export function reduceShellState(state: ShellState, action: ShellAction): ShellState;
