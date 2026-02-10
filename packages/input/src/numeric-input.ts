export interface NumericInputMatch<T> {
  item: T;
  number: string;
}

export type NumericInputCallback<T> = (match: NumericInputMatch<T> | null) => void;

/**
 * NumericChannelInput — ported from lumen-smarttv ChannelsList.tsx
 *
 * Accumulates digit presses to form a channel number,
 * searches the channel list, and auto-selects after a 2s timeout.
 */
export class NumericChannelInput<T> {
  private buffer = "";
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private readonly timeoutMs: number;
  private readonly maxDigits: number;
  private readonly getNumber: (item: T) => number;
  private readonly onMatch: NumericInputCallback<T>;
  private readonly onSelect: NumericInputCallback<T>;

  constructor(options: {
    items: () => T[];
    getNumber: (item: T) => number;
    onMatch: NumericInputCallback<T>;
    onSelect: NumericInputCallback<T>;
    timeoutMs?: number;
    maxDigits?: number;
  }) {
    this.getNumber = options.getNumber;
    this.onMatch = options.onMatch;
    this.onSelect = options.onSelect;
    this.timeoutMs = options.timeoutMs ?? 2000;
    this.maxDigits = options.maxDigits ?? 4;
    this._getItems = options.items;
  }

  private _getItems: () => T[];

  addDigit(digit: number): void {
    if (this.buffer.length >= this.maxDigits) return;

    this.clearTimeout();

    this.buffer += String(digit);

    const channelNum = parseInt(this.buffer, 10);
    const items = this._getItems();
    const match = items.find((item) => this.getNumber(item) === channelNum);

    if (match) {
      this.onMatch({ item: match, number: this.buffer });
    } else {
      this.onMatch(null);
    }

    this.timeout = setTimeout(() => {
      if (match) {
        this.onSelect({ item: match, number: this.buffer });
      } else {
        this.onSelect(null);
      }
      this.reset();
    }, this.timeoutMs);
  }

  getBuffer(): string {
    return this.buffer;
  }

  isActive(): boolean {
    return this.buffer.length > 0;
  }

  reset(): void {
    this.buffer = "";
    this.clearTimeout();
  }

  destroy(): void {
    this.reset();
  }

  private clearTimeout(): void {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }
}
