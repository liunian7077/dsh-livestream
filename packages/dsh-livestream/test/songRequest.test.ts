import { describe, expect, it } from 'vitest';
import { parseSongRequest } from '../src/core/songRequest';

/**
 * 「点歌」解析：只要是「点歌」开头就要认，歌名/歌手之间可以用 -- 或空格分隔。
 * 解析错了会去网易云搜一个不存在的词，观众只会听到「没有这首歌」，所以逐种写法都钉住。
 */
describe('song request parsing', () => {
  it('reads a bare title', () => {
    expect(parseSongRequest('点歌 晴天')).toEqual({ title: '晴天', raw: '晴天' });
    expect(parseSongRequest('点歌晴天')).toEqual({ title: '晴天', raw: '晴天' });
  });

  it('splits title and artist on --, —, and with punctuation', () => {
    expect(parseSongRequest('点歌 晴天--周杰伦')).toEqual({ title: '晴天', artist: '周杰伦', raw: '晴天--周杰伦' });
    expect(parseSongRequest('点歌 晴天 —— 周杰伦')).toEqual({ title: '晴天', artist: '周杰伦', raw: '晴天 —— 周杰伦' });
    expect(parseSongRequest('点歌：晴天 -- 周杰伦')).toEqual({ title: '晴天', artist: '周杰伦', raw: '晴天 -- 周杰伦' });
  });

  it('falls back to space as the separator', () => {
    expect(parseSongRequest('点歌 晴天 周杰伦')).toEqual({ title: '晴天', artist: '周杰伦', raw: '晴天 周杰伦' });
    // 多段空格：第一个词是歌名，其余算歌手
    expect(parseSongRequest('点歌 富士山下 陈奕迅 粤语')).toEqual({ title: '富士山下', artist: '陈奕迅 粤语', raw: '富士山下 陈奕迅 粤语' });
  });

  it('accepts full-width spaces and traditional 點歌', () => {
    expect(parseSongRequest('點歌　晴天　周杰伦')).toEqual({ title: '晴天', artist: '周杰伦', raw: '晴天 周杰伦' });
  });

  it('ignores messages that are not song requests', () => {
    expect(parseSongRequest('今天点歌好多人啊')).toBeNull();
    expect(parseSongRequest('唱歌 晴天')).toBeNull();
    expect(parseSongRequest('点歌')).toBeNull();
    expect(parseSongRequest('点歌：')).toBeNull();
    expect(parseSongRequest('')).toBeNull();
  });

  it('caps absurdly long requests', () => {
    const long = '点歌 ' + '啊'.repeat(200);
    const parsed = parseSongRequest(long);
    expect(parsed?.title.length).toBe(40);
  });
});
