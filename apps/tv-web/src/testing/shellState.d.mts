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
}

export function createShellController(options: {
  storage?: Pick<Storage, "getItem" | "setItem">;
  adapter: import("@lumen/types").PlayerAdapter;
}): ShellController;
