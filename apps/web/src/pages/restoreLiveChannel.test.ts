import { describe, expect, it } from 'vitest';
import type { PlayerChannel } from '@lumen/types';
import { resolveStartupLiveChannel } from './restoreLiveChannel';

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
});
