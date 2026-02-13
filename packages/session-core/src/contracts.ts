import type { MediaSourceType } from "@lumen/types";

export type SessionRenderer = "local-web" | "cast" | "airplay";

export type SessionPlaybackState =
  | "idle"
  | "playing"
  | "paused"
  | "buffering"
  | "error";

export interface SessionSource {
  url: string;
  type: MediaSourceType;
  title?: string;
  channelId?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionError {
  code: string;
  message: string;
  fatal: boolean;
  details?: unknown;
}

export interface SessionState {
  sessionId: string;
  source: SessionSource | null;
  playback: SessionPlaybackState;
  positionMs: number | null;
  liveOffsetMs: number | null;
  renderer: SessionRenderer;
  updatedAt: number;
  error: SessionError | null;
}

export interface SetSourceCommand {
  type: "setSource";
  source: SessionSource;
  positionMs?: number;
}

export interface PlayCommand {
  type: "play";
}

export interface PauseCommand {
  type: "pause";
}

export interface SeekCommand {
  type: "seek";
  positionMs: number;
}

export interface SwitchRendererCommand {
  type: "switchRenderer";
  renderer: SessionRenderer;
}

export interface StopCommand {
  type: "stop";
}

export type SessionCommand =
  | SetSourceCommand
  | PlayCommand
  | PauseCommand
  | SeekCommand
  | SwitchRendererCommand
  | StopCommand;

export interface SessionUpdatedEvent {
  type: "sessionUpdated";
  state: SessionState;
}

export interface RendererChangedEvent {
  type: "rendererChanged";
  previousRenderer: SessionRenderer;
  renderer: SessionRenderer;
  state: SessionState;
}

export interface PlaybackStateChangedEvent {
  type: "playbackStateChanged";
  previousPlayback: SessionPlaybackState;
  playback: SessionPlaybackState;
  state: SessionState;
}

export interface ErrorEvent {
  type: "error";
  error: SessionError;
  state: SessionState;
}

export type SessionEvent =
  | SessionUpdatedEvent
  | RendererChangedEvent
  | PlaybackStateChangedEvent
  | ErrorEvent;
