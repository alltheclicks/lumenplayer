// ── Channel & EPG types (from player-standalone) ──

export interface Channel {
  id: string;
  number: number;
  name: string;
  logo: string;
  category: string;
  streamUrl?: string;
  hasCatchUp: boolean;
  isFavorite: boolean;
  currentProgram?: Program;
  epg: Program[];
}

export interface Program {
  id: string;
  title: string;
  description: string;
  startTime: Date;
  endTime: Date;
  category: string;
  thumbnail?: string;
  hasCatchUp: boolean;
  progress?: number;
}

export interface Category {
  id: string;
  name: string;
  icon?: string;
  type: "live" | "movies" | "series" | "favorites";
}

// ── Player types (from player-standalone) ──

export interface PlayerChannel {
  id: string;
  streamId: number;
  source: "xtream" | "m3u";
  streamUrl?: string;
  number: number;
  name: string;
  logo: string;
  categoryId: string;
  categoryName: string;
  hasCatchUp: boolean;
  catchUpDays: number;
  epgChannelId: string | null;
  epg: Program[];
}

export interface PlayerCategory {
  id: string;
  name: string;
}

// ── Xtream Codes API types (from player-standalone) ──

export interface XtreamCredentials {
  server: string;
  username: string;
  password: string;
}

export interface XtreamUserInfo {
  username: string;
  password: string;
  message: string;
  auth: number;
  status: string;
  exp_date: string;
  is_trial: string;
  active_cons: string;
  created_at: string;
  max_connections: string;
  allowed_output_formats: string[];
}

export interface XtreamServerInfo {
  url: string;
  port: string;
  https_port: string;
  server_protocol: string;
  rtmp_port: string;
  timezone: string;
  timestamp_now: number;
  time_now: string;
}

export interface XtreamCategory {
  category_id: string;
  category_name: string;
  parent_id: number;
}

export interface XtreamLiveStream {
  num: number;
  name: string;
  stream_type: string;
  stream_id: number;
  stream_icon: string;
  epg_channel_id: string | null;
  added: string;
  category_id: string;
  custom_sid: string;
  tv_archive: number;
  direct_source: string;
  tv_archive_duration: number;
}

export interface XtreamVOD {
  num: number;
  name: string;
  stream_type: string;
  stream_id: number;
  stream_icon: string;
  rating: string;
  rating_5based: number;
  added: string;
  category_id: string;
  container_extension: string;
  custom_sid: string;
  direct_source: string;
}

export interface XtreamVODInfo {
  info: {
    tmdb_id?: string | number;
    name?: string;
    o_name?: string;
    releasedate?: string;
    release_date?: string;
    plot?: string;
    cast?: string;
    director?: string;
    genre?: string;
    duration?: string;
    duration_secs?: string | number;
    rating?: string;
    rating_5based?: string | number;
    movie_image?: string;
    backdrop_path?: string[] | string;
    youtube_trailer?: string;
    [key: string]: unknown;
  };
  movie_data: XtreamVOD & Record<string, unknown>;
}

export interface XtreamSeries {
  num: number;
  name: string;
  series_id: number;
  cover: string;
  plot: string;
  cast: string;
  director: string;
  genre: string;
  release_date: string;
  last_modified: string;
  rating: string;
  rating_5based: number;
  backdrop_path: string[];
  youtube_trailer: string;
  episode_run_time: string;
  category_id: string;
}

export interface XtreamSeriesEpisode {
  id: string | number;
  episode_num?: string | number;
  title?: string;
  container_extension?: string;
  info?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface XtreamSeriesInfo {
  info: {
    tmdb?: string | number;
    name?: string;
    cover?: string;
    plot?: string;
    cast?: string;
    director?: string;
    genre?: string;
    releaseDate?: string;
    last_modified?: string;
    rating?: string;
    rating_5based?: string | number;
    backdrop_path?: string[] | string;
    youtube_trailer?: string;
    episode_run_time?: string;
    [key: string]: unknown;
  };
  episodes: Record<string, XtreamSeriesEpisode[]>;
  seasons?: Array<Record<string, unknown>>;
}

export interface XtreamEPGItem {
  id: string;
  epg_id: string;
  title: string;
  lang: string;
  start: string;
  end: string;
  description: string;
  channel_id: string;
  start_timestamp: string;
  stop_timestamp: string;
  now_playing: number;
  has_archive: number;
}

export interface XtreamApiResponse {
  user_info: XtreamUserInfo;
  server_info: XtreamServerInfo;
}

// ── New types (per DECISION-DOC) ──

export type MediaSourceType = "hls" | "dash" | "mp4" | "webrtc";

export interface MediaSource {
  url: string;
  type: MediaSourceType;
  drm?: DRMConfig;
}

export interface DRMConfig {
  type: "widevine" | "fairplay" | "playready";
  licenseUrl: string;
  headers?: Record<string, string>;
}

export type PlaybackState =
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "buffering"
  | "seeking"
  | "error"
  | "ended";

export interface PlaybackError {
  code: string;
  message: string;
  fatal: boolean;
  details?: unknown;
  /**
   * Upstream HTTP status code when the error originated from a failed network
   * response (e.g. a 409 step-aside from the catch-up shadow endpoint). Absent
   * for non-network errors.
   */
  httpStatus?: number;
}

export interface AudioTrackOption {
  id: string;
  label: string;
  language: string | null;
  isDefault: boolean;
}

export interface SubtitleTrackOption {
  id: string;
  label: string;
  language: string | null;
  isDefault: boolean;
}

export interface PlayerAdapter {
  load(source: MediaSource): Promise<void>;
  play(): void;
  pause(): void;
  seek(time: number): void;
  stop(): void;
  destroy(): void;
  getCurrentTime(): number;
  getDuration(): number;
  getState(): PlaybackState;
  setVolume(volume: number): void;
  getVolume(): number;
  onStateChange(callback: (state: PlaybackState) => void): () => void;
  onError(callback: (error: PlaybackError) => void): () => void;
  onTimeUpdate(callback: (time: number) => void): () => void;
  onAudioTracksChange?(
    callback: (tracks: AudioTrackOption[], selectedTrackId: string | null) => void
  ): () => void;
  getAudioTracks?(): AudioTrackOption[];
  getSelectedAudioTrackId?(): string | null;
  setAudioTrack?(trackId: string): boolean;
  onSubtitleTracksChange?(
    callback: (tracks: SubtitleTrackOption[], selectedTrackId: string | null) => void
  ): () => void;
  getSubtitleTracks?(): SubtitleTrackOption[];
  getSelectedSubtitleTrackId?(): string | null;
  setSubtitleTrack?(trackId: string | null): boolean;
}

export type RendererType = "local-web" | "cast" | "airplay";

export interface RendererSnapshot {
  source: MediaSource | null;
  playback: PlaybackState;
  positionMs: number | null;
  liveOffsetMs: number | null;
}

export interface RendererAdapter {
  readonly type: RendererType;
  readonly id: string;
  isAvailable(): boolean | Promise<boolean>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  load(source: MediaSource, positionMs?: number): Promise<void>;
  play(): void | Promise<void>;
  pause(): void | Promise<void>;
  seek(positionMs: number): void | Promise<void>;
  stop(): void | Promise<void>;
  getSnapshot(): RendererSnapshot | Promise<RendererSnapshot>;
  setVolume?(volume: number): void | Promise<void>;
  setMuted?(muted: boolean): void | Promise<void>;
  onPlaybackStateChange(callback: (state: PlaybackState) => void): () => void;
  onError(callback: (error: PlaybackError) => void): () => void;
}

export interface StorageAdapter {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
  listKeys?(): Promise<string[]>;
}

export interface WatchHistoryEntry {
  channelId: string;
  timestamp: number;
  duration: number;
  progress: number;
}
