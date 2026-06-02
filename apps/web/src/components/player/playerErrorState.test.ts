import { describe, expect, it } from 'vitest';
import type { SessionSource } from '@lumen/session-core';
import {
  buildPlayerErrorState,
  resolvePlayerErrorActionSource,
} from './playerErrorState';

const buildSource = (url: string): SessionSource => ({
  url,
  type: 'hls',
  title: url,
});

describe('playerErrorState', () => {
  it('binds primary actions to the source that produced the error', () => {
    const errorSource = buildSource('https://example.com/archive-a.m3u8');
    const currentSource = buildSource('https://example.com/live-b.m3u8');
    const errorState = buildPlayerErrorState({
      type: 'network',
      message: 'Snimak za TV unazad trenutno nije dostupan',
      primaryAction: 'switch-to-live',
      primaryActionLabel: 'Gledaj kanal uživo',
    }, errorSource);

    expect(resolvePlayerErrorActionSource(errorState, currentSource)).toBe(errorSource);
  });

  it('does not invent an action source for source-less errors', () => {
    const currentSource = buildSource('https://example.com/live-b.m3u8');
    const errorState = buildPlayerErrorState({
      type: 'unknown',
      message: 'Nije moguće učitati stream',
      primaryActionLabel: 'Gledaj kanal uživo',
    }, null);

    expect(resolvePlayerErrorActionSource(errorState, currentSource)).toBeNull();
  });
});
