import { describe, expect, it, vi } from 'vitest';
import { SeekEngine } from './seek-engine';

describe('SeekEngine', () => {
  it('clamps forward seeking at duration', async () => {
    vi.useFakeTimers();

    try {
      const states: number[] = [];
      const engine = new SeekEngine({
        initialSpeed: 5,
        speedDoubleMs: 100,
        tickMs: 50,
      });
      engine.onStateChange((state) => states.push(state.time));

      engine.start('forward', 98, 100);
      await vi.advanceTimersByTimeAsync(150);

      expect(engine.getState()).toMatchObject({
        active: true,
        direction: 'forward',
        time: 100,
      });
      expect(Math.max(...states)).toBe(100);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clamps backward seeking at zero', async () => {
    vi.useFakeTimers();

    try {
      const states: number[] = [];
      const engine = new SeekEngine({
        initialSpeed: 5,
        speedDoubleMs: 100,
        tickMs: 50,
      });
      engine.onStateChange((state) => states.push(state.time));

      engine.start('backward', 3, 100);
      await vi.advanceTimersByTimeAsync(150);

      expect(engine.getState()).toMatchObject({
        active: true,
        direction: 'backward',
        time: 0,
      });
      expect(Math.min(...states)).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('accelerates held seeking up to the configured maximum speed', async () => {
    vi.useFakeTimers();

    try {
      const engine = new SeekEngine({
        initialSpeed: 5,
        maxSpeed: 20,
        speedDoubleMs: 100,
        tickMs: 50,
      });

      engine.start('forward', 0, 1_000);
      await vi.advanceTimersByTimeAsync(250);

      expect(engine.getState().speed).toBe(20);
      expect(engine.getState().time).toBeGreaterThan(20);
    } finally {
      vi.useRealTimers();
    }
  });

  it('restarts cleanly when the user changes seek direction before release', async () => {
    vi.useFakeTimers();

    try {
      const engine = new SeekEngine({
        initialSpeed: 5,
        speedDoubleMs: 100,
        tickMs: 50,
      });

      engine.start('forward', 40, 100);
      await vi.advanceTimersByTimeAsync(100);
      engine.start('backward', 50, 100);
      await vi.advanceTimersByTimeAsync(100);

      expect(engine.getState()).toMatchObject({
        active: true,
        direction: 'backward',
        time: 35,
      });

      const finalTime = engine.stop();
      expect(finalTime).toBe(35);
      expect(engine.getState()).toMatchObject({
        active: false,
        direction: null,
        speed: 5,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
