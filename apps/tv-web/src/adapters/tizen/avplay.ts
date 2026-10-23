/** Minimal structural binding; inject webapis.avplay, never extract its methods. */
export interface AVPlayListener {
  onbufferingstart?(): void;
  onbufferingcomplete?(): void;
  oncurrentplaytime?(milliseconds: number): void;
  onstreamcompleted?(): void;
  onerror?(event: string): void;
  onerrormsg?(event: string, message: string): void;
}

export interface AVPlay {
  open(url: string): void;
  close(): void;
  setListener(listener: AVPlayListener): void;
  setDisplayRect(x: number, y: number, width: number, height: number): void;
  prepareAsync(success: () => void, error: (error: unknown) => void): void;
  play(): void;
  pause(): void;
  stop(): void;
  getState(): string;
  getDuration(): number;
  getCurrentTime(): number;
  seekTo(milliseconds: number, success: () => void, error: (error: unknown) => void): void;
}

/** AVPlay coordinates always use the 1920 × 1080 reference plane. */
export interface AVPlayDisplayArea { x: number; y: number; width: number; height: number }
