import { describe, expect, it } from 'vitest';
import type { XtreamEPGItem } from '@lumen/types';
import { mapXtreamEpgItemToProgram, normalizeEpgText } from './epgProgramMapper';

const buildEpgItem = (overrides: Partial<XtreamEPGItem> = {}): XtreamEPGItem => ({
  id: '1',
  epg_id: '1',
  title: 'RG5ldm5paw==',
  lang: 'en',
  start: '2026-02-17 10:00:00',
  end: '2026-02-17 11:00:00',
  description: 'VmVjZXJuamUgdmVzdGk=',
  channel_id: '11',
  start_timestamp: '1739786400',
  stop_timestamp: '1739790000',
  now_playing: 0,
  has_archive: 1,
  ...overrides,
});

describe('epgProgramMapper', () => {
  it('normalizes HTML entities and numeric entities', () => {
    expect(normalizeEpgText('Tom &amp; Jerry &#8211; Kids')).toBe('Tom & Jerry – Kids');
  });

  it('decodes base64-encoded provider payload values', () => {
    expect(normalizeEpgText('VmVjZXJuamUgdmVzdGk=')).toBe('Vecernje vesti');
  });

  it('repairs common CP-1252 mojibake text', () => {
    expect(normalizeEpgText('Dnevnik â€“ Vecernje vesti')).toBe('Dnevnik – Vecernje vesti');
  });

  it('maps Xtream EPG item into normalized program shape', () => {
    const program = mapXtreamEpgItemToProgram(buildEpgItem(), 0);

    expect(program.title).toBe('Dnevnik');
    expect(program.description).toBe('Vecernje vesti');
    expect(program.hasCatchUp).toBe(true);
  });
});
