import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Songbook } from '../src/body/songbook';
import type { NeteaseSong } from '../src/body/netease';

const pick = (title: string) => ({ title, raw: title });
const alice = { id: 'u1', name: '爱丽丝' };
const bob = { id: 'u2', name: '鲍勃' };
const carol = { id: 'u3', name: 'C' };
const books: Songbook[] = [];
const flush = () => vi.advanceTimersByTimeAsync(0);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function make(overrides: Partial<ConstructorParameters<typeof Songbook>[0]> = {}) {
  const resolve = vi.fn(async (song: NeteaseSong) => `https://audio.example/${song.id}`);
  const log = vi.fn();
  const book = new Songbook({
    find: async (q) => ({ id: q.title, name: q.title, artists: ['测试歌手'], album: '', durationMs: 200_000, score: 1 }),
    resolve, log, ...overrides,
  });
  books.push(book);
  return { book, resolve, log };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const book of books.splice(0)) book.stop();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('automatic recovery from unavailable songs', () => {
  it.each(['empty', 'permission', 'synchronous error'])('releases the player after %s and allows a new request', async (failure) => {
    const resolve = vi.fn(() => {
      if (failure === 'empty') return Promise.resolve('');
      if (failure === 'synchronous error') throw new Error('获取音源失败');
      return Promise.reject(new Error('这首歌没有可播放音源'));
    });
    const { book, log } = make({ resolve });
    expect((await book.request(pick('坏歌'), alice)).kind).toBe('error');
    expect(book.playing).toBeNull();
    expect(book.playback).toBeNull();
    expect(book.recent).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('已自动跳过'));
    resolve.mockImplementation(() => Promise.resolve('https://audio.example/good'));
    expect((await book.request(pick('好歌'), alice)).kind).toBe('loading');
  });

  it('continues through consecutive bad queued sources to the next usable song', async () => {
    const bad = deferred<string>();
    const { book } = make({ resolve: async (s) => {
      if (s.name === '一') return bad.promise;
      if (s.name === '二') return '';
      return 'https://audio.example/good';
    } });
    const request = book.request(pick('一'), alice);
    await flush();
    await book.request(pick('二'), bob);
    await book.request(pick('三'), carol);
    bad.reject(new Error('无权限'));
    expect((await request).kind).toBe('error');
    await flush();
    expect(book.playing?.song.name).toBe('三');
    expect(book.playback?.status).toBe('loading');
    expect(book.waiting).toEqual([]);
    expect(book.recent).toEqual([]);
  });

  it('bounds a hung resolver, settles its request and ignores its late result', async () => {
    const slow = deferred<string>();
    const { book } = make({ resolve: async (s) => s.name === '一' ? slow.promise : 'https://audio.example/second' });
    const request = book.request(pick('一'), alice);
    await flush();
    const first = book.playing!;
    await book.request(pick('二'), bob);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(book.playing).toBe(first);
    await vi.advanceTimersByTimeAsync(1);
    expect(await request).toMatchObject({ kind: 'error', message: expect.stringContaining('15 秒') });
    expect(book.playing?.song.name).toBe('二');
    slow.resolve('https://audio.example/stale');
    await flush();
    expect(book.source(book.playing!.seq)).toBe('https://audio.example/second');
    expect(book.source(first.seq)).toBeNull();
  });

  it('skips a media/CDN error once even if several failure reports arrive', async () => {
    const { book } = make();
    await book.request(pick('一'), alice);
    await book.request(pick('二'), bob);
    await book.request(pick('三'), carol);
    const first = book.playing!;
    book.report(first.seq, 'error', undefined, undefined, 'HTTP 403');
    book.report(first.seq, 'error', undefined, undefined, 'MediaError 4');
    await flush();
    book.report(first.seq, 'ended');
    book.report(first.seq, 'playing', 180_000);
    expect(book.playing?.song.name).toBe('二');
    expect(book.playback?.positionMs).toBe(0);
    expect(book.waiting.map((s) => s.song.name)).toEqual(['三']);
  });

  it('empties an entirely failed queue and can accept songs afterwards', async () => {
    const { book } = make();
    await book.request(pick('一'), alice);
    await book.request(pick('二'), bob);
    book.report(book.playing!.seq, 'error');
    await flush();
    book.report(book.playing!.seq, 'error');
    expect(book.playing).toBeNull();
    expect(book.waiting).toEqual([]);
    expect(book.playback).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect((await book.request(pick('三'), alice)).kind).toBe('loading');
  });

  it.each(['loading', 'playing', 'no report'] as const)('skips after 30 seconds without progress even with repeated %s', async (state) => {
    const { book } = make();
    await book.request(pick('一'), alice);
    await book.request(pick('二'), bob);
    const first = book.playing!;
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(5000);
      if (state !== 'no report') book.report(first.seq, state, 0);
    }
    await vi.advanceTimersByTimeAsync(4999);
    expect(book.playing).toBe(first);
    await vi.advanceTimersByTimeAsync(1);
    expect(book.playing?.song.name).toBe('二');
    expect(book.playback?.status).toBe('loading');
  });

  it('keeps healthy playback and gives a fresh grace period after buffering recovers', async () => {
    const { book } = make();
    await book.request(pick('一'), alice);
    await book.request(pick('二'), bob);
    const first = book.playing!;
    for (let i = 1; i <= 12; i++) {
      await vi.advanceTimersByTimeAsync(10_000);
      book.report(first.seq, 'playing', i * 10_000);
    }
    book.report(first.seq, 'loading', 120_000);
    await vi.advanceTimersByTimeAsync(29_000);
    book.report(first.seq, 'playing', 121_000);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(book.playing).toBe(first);
    await vi.advanceTimersByTimeAsync(1);
    expect(book.playing?.song.name).toBe('二');
  });

  it.each(['paused', 'blocked'] as const)('preserves the queue while %s, then watches resumed playback', async (state) => {
    const { book } = make();
    await book.request(pick('一'), alice);
    await book.request(pick('二'), bob);
    const first = book.playing!;
    book.report(first.seq, state, 0);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(book.playing).toBe(first);
    expect(book.waiting).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    book.report(first.seq, 'playing', 0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(book.playing?.song.name).toBe('二');
  });

  it('waits for OBS to connect, suspends on disconnect and resumes the watchdog on reconnect', async () => {
    let connected = false;
    const { book } = make({ hasStage: () => connected });
    await book.request(pick('一'), alice);
    await book.request(pick('二'), bob);
    const first = book.playing!;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(book.playing).toBe(first);
    connected = true;
    book.connect();
    book.report(first.seq, 'playing', 10_000);
    await vi.advanceTimersByTimeAsync(20_000);
    connected = false;
    book.disconnect();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(book.playing).toBe(first);
    expect(book.playback?.positionMs).toBe(10_000);
    expect(book.playback?.status).toBe('paused');
    connected = true;
    book.connect();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(book.playing).toBe(first);
    await vi.advanceTimersByTimeAsync(1);
    expect(book.playing?.song.name).toBe('二');
  });

  it('does not arm playback timers if OBS disconnects while resolving', async () => {
    let connected = true;
    const slow = deferred<string>();
    const { book } = make({ hasStage: () => connected, resolve: () => slow.promise });
    const request = book.request(pick('一'), alice);
    await flush();
    connected = false;
    book.disconnect();
    slow.resolve('https://audio.example/one');
    await request;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(book.playing?.song.name).toBe('一');
    expect(vi.getTimerCount()).toBe(0);
    connected = true;
    book.connect();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(book.playing).toBeNull();
  });

  it.each(['stop', 'next'] as const)('settles an outstanding resolve on %s and ignores late rejection', async (action) => {
    const slow = deferred<string>();
    const { book } = make({ resolve: () => slow.promise });
    const request = book.request(pick('一'), alice);
    await flush();
    await book[action]();
    expect((await request).kind).toBe('error');
    expect(vi.getTimerCount()).toBe(0);
    slow.reject(new Error('迟到的网络失败'));
    await flush();
    expect(book.playing).toBeNull();
  });

  it('stops active playback timers when the show ends', async () => {
    const { book, resolve } = make();
    await book.request(pick('一'), alice);
    await book.request(pick('二'), bob);
    book.stop();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(book.playing).toBeNull();
  });
});
