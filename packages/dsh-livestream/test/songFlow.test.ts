import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveShow, SIMULATED_PREFIX } from '../src/body/show';
import { Songbook } from '../src/body/songbook';
import type { NeteaseSong } from '../src/body/netease';
import type { LiveEvent } from '../src/core/live';

/**
 * 走真实入口：一条「点歌 …」的弹幕进来，看推给她（会话）的那段话里
 * 是不是「找到了、在放」或者「没有这首歌」。这比只测解析/队列更接近线上。
 */

let seq = 0;
const resources: Array<{ show: LiveShow; book: Songbook }> = [];
/** 每条弹幕一个独立 id（真实平台的 msg id 本来就不同；同 id 会被 LiveHub 当重复丢掉） */
function chat(text: string, id = 'u1', name = '爱丽丝'): LiveEvent {
  return { id: `chat-${++seq}`, kind: 'chat', platform: 'bilibili', ts: Date.now(), user: { id, name }, text };
}

const track = (title: string): NeteaseSong => ({ id: `id-${title}`, name: title, artists: ['测试歌手'], album: title, durationMs: 180_000 });

function setup() {
  const pushed: string[] = [];
  const played: string[] = [];
  const book = new Songbook({
    find: async (query) => (query.title === '不存在' ? null : { ...track(query.title), score: 1 }),
    resolve: async (song) => { played.push(song.name); return `https://audio.example/${song.id}`; },
  });
  const show = new LiveShow(
    { push: async (_s, text) => { pushed.push(text); return true; }, synthesize: async () => null, log: () => {} },
    { dataDir: mkdtempSync(join(tmpdir(), 'dsh-song-')), names: ['大肥鱼'], songs: () => book },
  );
  show.goLive('s1');
  resources.push({ show, book });
  return { show, book, pushed, played };
}

afterEach(() => {
  for (const { show, book } of resources.splice(0)) { show.dispose(); book.stop(); }
  vi.useRealTimers();
});

/** 等她这一轮真的把题目推给会话：搜歌是异步的，导演每 200ms 走一步 */
const settle = (ms = 600) => new Promise((resolve) => setTimeout(resolve, ms));

describe('song requests through the live show', () => {
  it('plays a found song and tells her which one', async () => {
    const { show, played, pushed } = setup();

    show.inject(chat(`点歌 晴天 周杰伦`, `${SIMULATED_PREFIX}1`));
    await settle();

    expect(played).toEqual(['晴天']);
    // 开场那一轮先说话；她说完（turnEnded）才会轮到点歌这件事
    show.turnEnded('s1');
    await settle();
    expect(pushed.join("\n")).toContain("晴天");
    expect(pushed.join('\n')).toContain('网易云');
  });

  it('says there is no such song when the search comes back empty', async () => {
    const { show, pushed, played } = setup();

    show.inject(chat('点歌 不存在', `${SIMULATED_PREFIX}2`));
    await settle();
    expect(played).toEqual([]);
    show.turnEnded('s1');
    await settle();
    expect(pushed.join('\n')).toContain('没有找到这首歌');
  });

  it('ignores 「点歌」 while off air, unless it is the console simulator', async () => {
    const played: string[] = [];
    const book = new Songbook({
      find: async (query) => ({ ...track(query.title), score: 1 }),
      resolve: async (song) => { played.push(song.name); return `https://audio.example/${song.id}`; },
    });
    const show = new LiveShow(
      { push: async () => true, synthesize: async () => null, log: () => {} },
      { dataDir: mkdtempSync(join(tmpdir(), 'dsh-song-')), names: ['大肥鱼'], songs: () => book },
    );
    resources.push({ show, book });

    // 没开播：真实观众的弹幕不该抢播放器
    show.inject(chat('点歌 晴天', 'real-1'));
    await settle(400);
    expect(played).toEqual([]);

    // 控制台的模拟观众仍然能试
    show.inject(chat('点歌 晴天', `${SIMULATED_PREFIX}3`));
    await settle(400);
    expect(played).toEqual(['晴天']);
  });
});
