export type IdleTimerCallback = () => void;

/**
 * IdleTimer — ported from lumen-smarttv PlayerFullScreen.tsx
 *
 * Hides controls after `timeoutMs` of inactivity.
 * Includes a `graceMs` period after hide to prevent
 * accidental re-trigger from the same mouse/key event.
 */
export class IdleTimer {
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private graceTimeout: ReturnType<typeof setTimeout> | null = null;
  private inGrace = false;

  private readonly timeoutMs: number;
  private readonly graceMs: number;
  private readonly onIdle: IdleTimerCallback;

  constructor(
    onIdle: IdleTimerCallback,
    options: { timeoutMs?: number; graceMs?: number } = {},
  ) {
    this.onIdle = onIdle;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.graceMs = options.graceMs ?? 1000;
  }

  reset(): void {
    if (this.inGrace) return;

    this.clear();

    this.timeout = setTimeout(() => {
      this.inGrace = true;
      this.onIdle();

      this.graceTimeout = setTimeout(() => {
        this.inGrace = false;
      }, this.graceMs);
    }, this.timeoutMs);
  }

  clear(): void {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }

  destroy(): void {
    this.clear();
    if (this.graceTimeout) {
      clearTimeout(this.graceTimeout);
      this.graceTimeout = null;
    }
    this.inGrace = false;
  }

  isInGracePeriod(): boolean {
    return this.inGrace;
  }
}
