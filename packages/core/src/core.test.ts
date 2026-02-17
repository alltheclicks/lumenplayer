import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel, PlayerChannel, Program } from '@lumen/types';
import {
  filterChannels,
  sortChannels,
  getCurrentProgram,
  getProgramProgress,
  formatTime,
  formatDate,
  formatDuration,
  millisecondsToTime,
} from './index';

const createProgram = (
  id: string,
  startTime: Date,
  endTime: Date
): Program => ({
  id,
  title: `Program ${id}`,
  description: '',
  startTime,
  endTime,
  category: 'General',
  hasCatchUp: false,
});

const createPlayerChannel = (
  overrides: Partial<PlayerChannel>
): PlayerChannel => ({
  id: 'channel-1',
  streamId: 1,
  source: 'xtream',
  number: 1,
  name: 'News One',
  logo: '',
  categoryId: 'news',
  categoryName: 'News',
  hasCatchUp: false,
  catchUpDays: 0,
  epgChannelId: null,
  epg: [],
  ...overrides,
});

describe('@lumen/core channels', () => {
  it('returns the same array when filter query is empty', () => {
    const channels = [
      createPlayerChannel({ id: 'a', name: 'Alpha' }),
      createPlayerChannel({ id: 'b', name: 'Bravo' }),
    ];

    const filtered = filterChannels(channels, '   ');
    expect(filtered).toBe(channels);
  });

  it('filters channels case-insensitively', () => {
    const channels = [
      createPlayerChannel({ id: 'a', name: 'Cinema Plus' }),
      createPlayerChannel({ id: 'b', name: 'Sports Arena' }),
    ];

    expect(filterChannels(channels, 'cinema')).toEqual([channels[0]]);
    expect(filterChannels(channels, 'SPORT')).toEqual([channels[1]]);
  });

  it('sorts channels by number without mutating input', () => {
    const channels = [
      createPlayerChannel({ id: 'a', number: 20 }),
      createPlayerChannel({ id: 'b', number: 5 }),
      createPlayerChannel({ id: 'c', number: 11 }),
    ];

    const sorted = sortChannels(channels);

    expect(sorted.map((channel) => channel.number)).toEqual([5, 11, 20]);
    expect(channels.map((channel) => channel.number)).toEqual([20, 5, 11]);
  });

  it('sorts channels by display name', () => {
    const channels = [
      createPlayerChannel({ id: 'a', name: 'Zulu' }),
      createPlayerChannel({ id: 'b', name: 'Alpha' }),
      createPlayerChannel({ id: 'c', name: 'Hotel' }),
    ];

    const sorted = sortChannels(channels, 'name');
    expect(sorted.map((channel) => channel.name)).toEqual(['Alpha', 'Hotel', 'Zulu']);
  });
});

describe('@lumen/core epg', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns current program for active time window', () => {
    vi.setSystemTime(new Date('2026-02-17T10:00:00.000Z'));

    const programs = [
      createProgram('p1', new Date('2026-02-17T09:00:00.000Z'), new Date('2026-02-17T09:59:00.000Z')),
      createProgram('p2', new Date('2026-02-17T10:00:00.000Z'), new Date('2026-02-17T10:30:00.000Z')),
      createProgram('p3', new Date('2026-02-17T10:30:00.000Z'), new Date('2026-02-17T11:00:00.000Z')),
    ];

    const channel: Channel = {
      id: 'channel-1',
      number: 1,
      name: 'News',
      logo: '',
      category: 'General',
      hasCatchUp: false,
      isFavorite: false,
      epg: programs,
    };

    expect(getCurrentProgram(channel)?.id).toBe('p2');
  });

  it('returns undefined when no active program exists', () => {
    vi.setSystemTime(new Date('2026-02-17T06:00:00.000Z'));

    const channel: Channel = {
      id: 'channel-1',
      number: 1,
      name: 'News',
      logo: '',
      category: 'General',
      hasCatchUp: false,
      isFavorite: false,
      epg: [
        createProgram('p1', new Date('2026-02-17T08:00:00.000Z'), new Date('2026-02-17T09:00:00.000Z')),
      ],
    };

    expect(getCurrentProgram(channel)).toBeUndefined();
  });

  it('calculates and clamps program progress', () => {
    const program = createProgram(
      'p1',
      new Date('2026-02-17T10:00:00.000Z'),
      new Date('2026-02-17T11:00:00.000Z')
    );

    vi.setSystemTime(new Date('2026-02-17T10:30:00.000Z'));
    expect(getProgramProgress(program)).toBe(50);

    vi.setSystemTime(new Date('2026-02-17T09:30:00.000Z'));
    expect(getProgramProgress(program)).toBe(0);

    vi.setSystemTime(new Date('2026-02-17T12:00:00.000Z'));
    expect(getProgramProgress(program)).toBe(100);
  });
});

describe('@lumen/core time', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-17T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats time using 24-hour hh:mm format', () => {
    const date = new Date('2026-02-17T07:05:00.000Z');
    expect(formatTime(date)).toBe(
      date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    );
  });

  it('formats date as Today and Yesterday for relative days', () => {
    const now = new Date('2026-02-17T12:00:00.000Z');
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    expect(formatDate(now)).toBe('Today');
    expect(formatDate(yesterday)).toBe('Yesterday');
  });

  it('formats older dates with short weekday/month format', () => {
    const date = new Date('2026-02-12T12:00:00.000Z');
    expect(formatDate(date)).toBe(
      date.toLocaleDateString('en-US', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      })
    );
  });

  it('formats durations for minute and hour ranges', () => {
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3661)).toBe('1:01:01');
  });

  it('formats milliseconds into mm:ss or h:mm:ss', () => {
    expect(millisecondsToTime(65_000)).toBe('01:05');
    expect(millisecondsToTime(3_661_000)).toBe('1:01:01');
  });
});
