import { afterEach, describe, expect, it, vi } from 'vitest';
import { Songbook } from '../src/body/songbook';
import type { NeteaseSong } from '../src/body/netease';
import type { SongQuery } from '../src/core/songRequest';

/**
 * 点歌队列：搜到就排、搜不到就说没有、同一首不重复、一人不能连点、
 * 轮到时交给客户端播、按歌曲时长换下一首。
 */

const track = (id: string, name: string, durationMs = 200_000): NeteaseSong => ({
  id, name, artists: ['测试歌手'], album: name, durationMs,
});

const pick = (title: string): SongQuery => ({ title, raw: title });

function make(overrides: Partial<ConstructorParameters<typeof Songbook>[0]> = {}) {
  const played: NeteaseSong[] = [];
  const book = new Songbook({
    find: async (query) => {
      if (query.title === '不存在') return null;
      if (query.title === '炸了') throw new Error('网断了');
      return { ...track(`id-${query.title}`, query.title), score: 1 };
    },
    play: (song) => played.push(song),
    ...overrides,
  });
  return { book, played };
}

const alice = { id: 'u1', name: '爱丽丝' };
const bob = { id: 'u2', name: '鲍勃' };

afterEach(() => {
  vi.useRealTimers();
});

describe('songbook', () => {
  it('plays the first request right away and queues the rest', async () => {
    const { book, played } = make();
    expect(await book.request(pick('第一首'), alice)).toEqual({ kind: 'playing', song: expect.objectContaining({ name: '第一首' }), by: alice });
    expect(played.map((s) => s.name)).toEqual(['第一首']);

    const second = await book.request(pick('第二首'), bob);
    expect(second.kind).toBe('queued');
    expect(second.kind === 'queued' && second.position).toBe(1);
    expect(book.playing?.song.name).toBe('第一首');
    expect(book.waiting.map((q) => q.song.name)).toEqual(['第二首']);
  });

  it('says notfound when netease has nothing, and error when it breaks', async () => {
    const { book, played } = make();
    expect((await book.request(pick('不存在'), alice)).kind).toBe('notfound');
    const broken = await book.request(pick('炸了'), alice);
    expect(broken.kind).toBe('error');
    expect(broken.kind === 'error' && broken.message).toContain('网断了');
    // 没搜到、出错都不能占着播放位
    expect(book.playing).toBeNull();
    expect(played).toEqual([]);
  });

  it('refuses the same song twice', async () => {
    const { book } = make();
    expect((await book.request(pick('晴天'), alice)).kind).toBe('playing');
    expect((await book.request(pick('晴天'), bob)).kind).toBe('duplicate');
    // 换个人点另一首是正常的
    expect((await book.request(pick('稻香'), bob)).kind).toBe('queued');
  });

  it('limits how many one viewer can pin at once', async () => {
    const { book } = make({ maxPerUser: 1 });
    expect((await book.request(pick('一'), alice)).kind).toBe('playing');
    expect((await book.request(pick('二'), alice)).kind).toBe('tooMany');
    expect((await book.request(pick('三'), bob)).kind).toBe('queued');
  });

  it('refuses when the queue is full, and reads limits live', async () => {
    let max = 1;
    const { book } = make({ maxQueue: () => max });
    await book.request(pick('一'), alice);
    expect((await book.request(pick('二'), bob)).kind).toBe('queued');
    expect((await book.request(pick('三'), { id: 'u3', name: 'C' })).kind).toBe('full');

    // 主人在控制台调大上限，下一次请求立刻按新值
    max = 2;
    expect((await book.request(pick('四'), { id: 'u4', name: 'D' })).kind).toBe('queued');
  });

  it('advances to the next song after the current one finishes', async () => {
    vi.useFakeTimers();
    const { book, played } = make();
    await book.request(pick('短的'), alice); // 200 秒
    await book.request(pick('下一首'), bob);

    expect(played.map((s) => s.name)).toEqual(['短的']);
    // 时长 + 宽限（6 秒）之后换下一首
    vi.advanceTimersByTime(200_000 + 5_999);
    expect(played.map((s) => s.name)).toEqual(['短的']);
    vi.advanceTimersByTime(1);
    expect(played.map((s) => s.name)).toEqual(['短的', '下一首']);
    expect(book.playing?.song.name).toBe('下一首');
    expect(book.recent.map((q) => q.song.name)).toEqual(['短的']);
  });

  it('lets the owner skip manually and clear the queue', async () => {
    const { book, played } = make();
    await book.request(pick('一'), alice);
    await book.request(pick('二'), bob);
    await book.request(pick('三'), { id: 'u3', name: 'C' });

    expect(book.clear()).toBe(2);
    expect(book.waiting).toEqual([]);
    expect(book.next()).toBeNull();
    expect(book.playing).toBeNull();
    expect(played.map((s) => s.name)).toEqual(['一']);
  });

  it('stops timers when the show ends', async () => {
    vi.useFakeTimers();
    const { book, played } = make();
    await book.request(pick('一'), alice);
    await book.request(pick('二'), bob);
    book.stop();
    vi.advanceTimersByTime(600_000);
    expect(played.map((s) => s.name)).toEqual(['一']);
    expect(book.playing).toBeNull();
  });
});
