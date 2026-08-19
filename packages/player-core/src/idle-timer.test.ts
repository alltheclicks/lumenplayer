import { afterEach, describe, expect, it, vi } from 'vitest';

import { IdleTimer } from './idle-timer';

describe('IdleTimer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ignores immediate activity after controls are hidden manually', () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const timer = new IdleTimer(onIdle, { timeoutMs: 3_000, graceMs: 1_000 });

    timer.hideNow();
    timer.reset();

    expect(onIdle).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3_000);
    expect(onIdle).toHaveBeenCalledTimes(1);

    timer.reset();
    vi.advanceTimersByTime(3_000);
    expect(onIdle).toHaveBeenCalledTimes(2);

    timer.destroy();
  });
});
