import { describe, expect, it } from 'vitest';
import type { PlayerChannel } from '@lumen/types';
import {
  resolveStartupLiveChannel,
  shouldSnapSessionRestoreToLiveEdge,
} from './restoreLiveChannel';

const buildChannel = (id: string): PlayerChannel => ({
  id,
  streamId: Number(id),
  source: 'xtream',
  number: Number(id),
  name: `Channel ${id}`,
  logo: 'logo',
  categoryId: 'cat-1',
  categoryName: 'Category',
  hasCatchUp: false,
  catchUpDays: 0,
  epgChannelId: null,
  epg: [],
});

describe('resolveStartupLiveChannel', () => {
  it('returns null when channels list is empty', () => {
    expect(resolveStartupLiveChannel([], null)).toBeNull();
  });

  it('returns last watched channel when it is present in current catalog', () => {
    const channels = [buildChannel('10'), buildChannel('20'), buildChannel('30')];
    const resolved = resolveStartupLiveChannel(channels, '20');

    expect(resolved?.id).toBe('20');
  });

  it('prefers explicitly requested startup channel when available', () => {
    const channels = [buildChannel('10'), buildChannel('20'), buildChannel('30')];
    const resolved = resolveStartupLiveChannel(channels, '20', '30');

    expect(resolved?.id).toBe('30');
  });

  it('falls back from missing preferred channel to last watched', () => {
    const channels = [buildChannel('10'), buildChannel('20'), buildChannel('30')];
    const resolved = resolveStartupLiveChannel(channels, '20', '99');

    expect(resolved?.id).toBe('20');
  });

  it('falls back to first channel when last watched channel is missing', () => {
    const channels = [buildChannel('10'), buildChannel('20')];
    const resolved = resolveStartupLiveChannel(channels, '99');

    expect(resolved?.id).toBe('10');
  });

  it('falls back to first channel when last watched channel id is null', () => {
    const channels = [buildChannel('10'), buildChannel('20')];
    const resolved = resolveStartupLiveChannel(channels, null);

    expect(resolved?.id).toBe('10');
  });

  it('can prefer the first catch-up-enabled channel for validation flows', () => {
    const channels = [
      buildChannel('10'),
      { ...buildChannel('20'), hasCatchUp: true },
      { ...buildChannel('30'), hasCatchUp: true },
    ];

    const resolved = resolveStartupLiveChannel(channels, null, null, {
      preferCatchUp: true,
    });

    expect(resolved?.id).toBe('20');
  });
});

describe('shouldSnapSessionRestoreToLiveEdge', () => {
  it('returns true for explicit live metadata mode', () => {
    expect(
      shouldSnapSessionRestoreToLiveEdge({
        metadata: {
          mode: 'live',
        },
      })
    ).toBe(true);
  });

  it('returns true for channel-bound source without explicit mode', () => {
    expect(
      shouldSnapSessionRestoreToLiveEdge({
        channelId: '42',
      })
    ).toBe(true);
  });

  it('returns false for non-live on-demand source', () => {
    expect(
      shouldSnapSessionRestoreToLiveEdge({
        metadata: {
          mode: 'vod',
        },
      })
    ).toBe(false);
  });

  it('returns false for explicit non-live mode even when channelId exists', () => {
    expect(
      shouldSnapSessionRestoreToLiveEdge({
        channelId: '42',
        metadata: {
          mode: 'vod',
        },
      })
    ).toBe(false);
  });

  it('returns false when source is missing', () => {
    expect(shouldSnapSessionRestoreToLiveEdge(null)).toBe(false);
  });
});
