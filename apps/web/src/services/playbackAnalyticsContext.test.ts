import { describe, expect, it } from 'vitest';
import { resolveSelectedPlaybackContext } from './playbackAnalyticsContext';

describe('selected playback diagnostics', () => {
  it('clears TV identity for a film, without treating its stream ID as a channel', () => {
    const live = resolveSelectedPlaybackContext({ contentKind: 'live', channelId: '5', channelName: 'RTS 1' });
    const movie = resolveSelectedPlaybackContext({ contentKind: 'vod', streamId: 22, contentId: '22', contentTitle: 'Film' });
    expect(live.channel.name).toBe('RTS 1');
    expect(movie.channel).toEqual({});
    expect(movie.content).toMatchObject({ kind: 'vod', id: '22', title: 'Film' });
  });
  it('retains episode identity and excludes source credentials', () => {
    const context = resolveSelectedPlaybackContext({ contentKind: 'series', contentId: '8', contentTitle: 'Serija', episodeId: '9', seasonNumber: 2, episodeNumber: 3, url: 'https://provider/user/password/9.mp4' });
    expect(context.channel).toEqual({});
    expect(context.content).toMatchObject({ id: '8', title: 'Serija', episodeId: '9', seasonNumber: 2, episodeNumber: 3 });
    expect(JSON.stringify(context)).not.toContain('password');
  });
});
