export type SeekDirection = "forward" | "backward";

export interface SeekState {
  active: boolean;
  direction: SeekDirection | null;
  speed: number;
  time: number;
}

export type SeekEngineListener = (state: SeekState) => void;

/**
 * SeekEngine — ported from lumen-smarttv PlayerFullScreen.tsx
 *
 * Pure state machine for exponential seek (5→10→20→...→640).
 * Speed doubles every 1.2s, tick every 50ms.
 */
export class SeekEngine {
  private speed = 5;
  private time = 0;
  private direction: SeekDirection | null = null;
  private active = false;

  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private speedInterval: ReturnType<typeof setInterval> | null = null;

  private listeners: Set<SeekEngineListener> = new Set();

  private readonly initialSpeed: number;
  private readonly maxSpeed: number;
  private readonly speedDoubleMs: number;
  private readonly tickMs: number;

  constructor(
    options: {
      initialSpeed?: number;
      maxSpeed?: number;
      speedDoubleMs?: number;
      tickMs?: number;
    } = {},
  ) {
    this.initialSpeed = options.initialSpeed ?? 5;
    this.maxSpeed = options.maxSpeed ?? 640;
    this.speedDoubleMs = options.speedDoubleMs ?? 1200;
    this.tickMs = options.tickMs ?? 50;
  }

  start(
    direction: SeekDirection,
    currentTime: number,
    duration: number,
  ): void {
    this.stop();

    this.active = true;
    this.direction = direction;
    this.speed = this.initialSpeed;
    this.time = currentTime;

    this.speedInterval = setInterval(() => {
      if (this.speed < this.maxSpeed) {
        this.speed = this.speed * 2;
      }
    }, this.speedDoubleMs);

    this.tickInterval = setInterval(() => {
      if (this.direction === "forward") {
        this.time = Math.min(duration, this.time + this.speed);
      } else {
        this.time = Math.max(0, this.time - this.speed);
      }
      this.emit();
    }, this.tickMs);

    this.emit();
  }

  stop(): number {
    const finalTime = this.time;

    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    if (this.speedInterval) {
      clearInterval(this.speedInterval);
      this.speedInterval = null;
    }

    this.active = false;
    this.direction = null;
    this.speed = this.initialSpeed;

    this.emit();
    return finalTime;
  }

  getState(): SeekState {
    return {
      active: this.active,
      direction: this.direction,
      speed: this.speed,
      time: this.time,
    };
  }

  onStateChange(listener: SeekEngineListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  destroy(): void {
    this.stop();
    this.listeners.clear();
  }

  private emit(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}
