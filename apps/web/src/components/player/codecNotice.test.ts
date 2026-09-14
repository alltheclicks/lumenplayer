import { describe, expect, it } from 'vitest';
import { resolveCodecNotice } from './codecNotice';

describe('codec notices', () => {
  it('explains video-only MP2 playback for live and archived content', () => {
    expect(resolveCodecNotice('mp2', null)).toContain('Slika se reprodukuje bez zvuka');
    expect(resolveCodecNotice('mp2', null)).toContain('MP2');
  });
  it('keeps the audio explanation when video is also unsupported', () => {
    expect(resolveCodecNotice('mp2', 'hevc')).toContain('MP2');
    expect(resolveCodecNotice('mp2', 'hevc')).toContain('HEVC');
    expect(resolveCodecNotice(null, null)).toBeNull();
  });
});
