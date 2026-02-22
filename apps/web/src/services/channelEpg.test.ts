import { describe, expect, it, vi } from 'vitest';
import type { XtreamEPGItem } from '@lumen/types';
import { createShortEpgProgramFetcher } from './channelEpg';

const buildEpgItem = (id: string, title = 'RG5ldm5paw=='): XtreamEPGItem => ({
  id,
  epg_id: id,
  title,
  lang: 'en',
  start: '2026-02-17 10:00:00',
  end: '2026-02-17 11:00:00',
  description: 'VmVjZXJuamUgdmVzdGk=',
  channel_id: '10',
  start_timestamp: '1739786400',
  stop_timestamp: '1739790000',
  now_playing: 0,
  has_archive: 1,
});

describe('channelEpg', () => {
  it('reuses cached programs for repeated stream requests', async () => {
    const fetchEpg = vi.fn(async () => [buildEpgItem('1')]);
    const fetcher = createShortEpgProgramFetcher({
      fetchEpg,
      cacheTtlMs: 60_000,
      minRequestIntervalMs: 0,
      maxRateLimitRetries: 0,
      retryBackoffMs: 0,
    });

    const first = await fetcher.getPrograms(100);
    const second = await fetcher.getPrograms(100);

    expect(fetchEpg).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it('deduplicates in-flight requests for same stream id', async () => {
    const fetchEpg = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 5);
      });
      return [buildEpgItem('2')];
    });

    const fetcher = createShortEpgProgramFetcher({
      fetchEpg,
      cacheTtlMs: 60_000,
      minRequestIntervalMs: 0,
      maxRateLimitRetries: 0,
      retryBackoffMs: 0,
    });

    const [first, second] = await Promise.all([
      fetcher.getPrograms(200),
      fetcher.getPrograms(200),
    ]);

    expect(fetchEpg).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it('retries rate-limited requests and succeeds on retry', async () => {
    const fetchEpg = vi.fn()
      .mockRejectedValueOnce(new Error('HTTP 429: Too Many Requests'))
      .mockResolvedValueOnce([buildEpgItem('3')]);

    const fetcher = createShortEpgProgramFetcher({
      fetchEpg,
      cacheTtlMs: 60_000,
      minRequestIntervalMs: 0,
      maxRateLimitRetries: 1,
      retryBackoffMs: 0,
    });

    const programs = await fetcher.getPrograms(300);
    expect(fetchEpg).toHaveBeenCalledTimes(2);
    expect(programs[0]?.title).toBe('Dnevnik');
  });

  it('serves stale cache when follow-up fetch is still rate-limited', async () => {
    let requestCount = 0;
    const fetchEpg = vi.fn(async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return [buildEpgItem('4')];
      }

      throw new Error('HTTP 429: Too Many Requests');
    });

    const fetcher = createShortEpgProgramFetcher({
      fetchEpg,
      cacheTtlMs: -1,
      minRequestIntervalMs: 0,
      maxRateLimitRetries: 0,
      retryBackoffMs: 0,
    });

    const first = await fetcher.getPrograms(400);
    const second = await fetcher.getPrograms(400);

    expect(fetchEpg).toHaveBeenCalledTimes(2);
    expect(second).toEqual(first);
    expect(second[0]?.title).toBe('Dnevnik');
  });

  it('merges archive fallback rows when short EPG has no archive flags', async () => {
    const fetchEpg = vi.fn(async () => [
      { ...buildEpgItem('10', 'RG5ldm5paw=='), has_archive: 0 },
    ]);
    const fetchArchiveEpg = vi.fn(async () => [
      { ...buildEpgItem('10', 'RG5ldm5paw=='), has_archive: 1 },
    ]);

    const fetcher = createShortEpgProgramFetcher({
      fetchEpg,
      fetchArchiveEpg,
      cacheTtlMs: 60_000,
      minRequestIntervalMs: 0,
      maxRateLimitRetries: 0,
      retryBackoffMs: 0,
    });

    const programs = await fetcher.getPrograms(500, { includeArchiveFallback: true });
    expect(fetchArchiveEpg).toHaveBeenCalledTimes(1);
    expect(programs[0]?.hasCatchUp).toBe(true);
  });

  it('keeps cache partitioned by archive-fallback option', async () => {
    const fetchEpg = vi.fn(async () => [
      { ...buildEpgItem('11', 'RG5ldm5paw=='), has_archive: 0 },
    ]);
    const fetchArchiveEpg = vi.fn(async () => [
      { ...buildEpgItem('11', 'RG5ldm5paw=='), has_archive: 1 },
    ]);

    const fetcher = createShortEpgProgramFetcher({
      fetchEpg,
      fetchArchiveEpg,
      cacheTtlMs: 60_000,
      minRequestIntervalMs: 0,
      maxRateLimitRetries: 0,
      retryBackoffMs: 0,
    });

    await fetcher.getPrograms(501, { includeArchiveFallback: false });
    await fetcher.getPrograms(501, { includeArchiveFallback: true });

    expect(fetchEpg).toHaveBeenCalledTimes(2);
    expect(fetchArchiveEpg).toHaveBeenCalledTimes(1);
  });
});
