import { describe, expect, it } from 'vitest';
import { normalizeName, pickSong, searchKeyword, type NeteaseSong } from '../src/body/netease';

/**
 * 网易云搜索结果的挑选规则。用真实的返回样本（2026-10 实测：搜「晴天 周杰伦」时
 * 排在前面的都是同名翻唱，周杰伦的版本在网易云没有版权）钉住行为：
 * 同名翻唱要能选中（不然观众点周杰伦永远「没有这首歌」），但歌名不像的必须被拒。
 */

const song = (id: string, name: string, artists: string[], durationMs = 240_000): NeteaseSong => ({
  id, name, artists, album: name, durationMs,
});

const JAY_COVERS = [
  song('2652820720', '晴天(深情版)', ['Lucky小爱'], 278_961),
  song('3440441479', '晴天', ['Jay']),
  song('2668397359', '晴天 (原唱 周杰伦)', ['RyaVocal']),
];

describe('netease song matching', () => {
  it('normalizes full-width punctuation and spacing before comparing', () => {
    expect(normalizeName('晴天（深情版）')).toBe(normalizeName('晴天(深情版)'));
    expect(normalizeName('Shape of You')).toBe('shapeofyou');
    expect(normalizeName('《富士山下》')).toBe('富士山下');
  });

  it('picks the same-titled cover when the original is not on netease', () => {
    const match = pickSong(JAY_COVERS, { title: '晴天', artist: '周杰伦', raw: '晴天 周杰伦' });
    expect(match).not.toBeNull();
    // 三个都同名，选最像的（名字越干净越靠前）
    expect(['晴天', '晴天 (原唱 周杰伦)', '晴天(深情版)']).toContain(match!.name);
    expect(match!.score).toBeGreaterThan(0.7);
  });

  it('prefers the matching artist when it exists', () => {
    const list = [
      song('1', '晴天', ['Lucky小爱']),
      song('2', '晴天', ['周杰伦']),
    ];
    const match = pickSong(list, { title: '晴天', artist: '周杰伦', raw: '晴天 周杰伦' });
    expect(match?.id).toBe('2');
  });

  it('keeps a space-separated english title whole', () => {
    const list = [song('9', 'Shape of You', ['Ed Sheeran'])];
    // 解析成 title=Shape, artist=of You 时也不能漏掉
    const match = pickSong(list, { title: 'Shape', artist: 'of You', raw: 'Shape of You' });
    expect(match?.id).toBe('9');
  });

  it('returns null when nothing looks like what was asked', () => {
    expect(pickSong(JAY_COVERS, { title: '完全不是这首歌', raw: '完全不是这首歌' })).toBeNull();
    expect(pickSong([], { title: '晴天', raw: '晴天' })).toBeNull();
  });

  it('searches with the title plus the first artist, so the client picks the right version', () => {
    expect(searchKeyword({ name: '晴天', artists: ['周杰伦', '杨瑞代'] })).toBe('晴天 周杰伦');
    expect(searchKeyword({ name: '晴天', artists: [] })).toBe('晴天');
    expect(searchKeyword({ name: 'Shape of You', artists: ['  Ed Sheeran  '] })).toBe('Shape of You Ed Sheeran');
  });
});
