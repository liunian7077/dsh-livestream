import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StageEvent } from '../src/stage/protocol';

class FakeAudio {
  static instances: FakeAudio[] = [];
  paused = true;
  ended = false;
  seeking = false;
  error: { code: number } | null = null;
  readyState = 4;
  currentTime = 0;
  duration = 180;
  volume = 1;
  loop = false;
  onloadedmetadata: (() => void) | null = null;
  onplaying: (() => void) | null = null;
  onwaiting: (() => void) | null = null;
  onstalled: (() => void) | null = null;
  onpause: (() => void) | null = null;
  ontimeupdate: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn(async () => {
    if (!this.paused) return;
    this.paused = false;
    // A browser fires playing asynchronously, after play() was requested.
    await Promise.resolve();
    if (!this.paused) this.onplaying?.();
  });
  pause = vi.fn(() => {
    if (this.paused) return;
    this.paused = true;
    this.onpause?.();
  });
  removeAttribute = vi.fn();
  load = vi.fn();
  constructor(readonly src = '') { FakeAudio.instances.push(this); }
  advance(seconds: number): void {
    if (this.paused || this.ended) return;
    this.currentTime += seconds;
    this.ontimeupdate?.();
  }
}

class FakeEventSource {
  static current: FakeEventSource;
  onmessage: ((message: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  constructor() { FakeEventSource.current = this; }
}

let store: typeof import('../src/stage/store');
const fetchMock = vi.fn(async (_url: string) => ({ ok: true }));
const emit = (event: StageEvent) => FakeEventSource.current.onmessage?.({ data: JSON.stringify(event) });
const flush = () => vi.advanceTimersByTimeAsync(0);
const say = () => emit({ v: 1, type: 'say', id: 'reply', text: '欢迎来到直播间', mood: '', audio: 'test-audio', estimateMs: 2000, at: Date.now() });
function song(): void {
  emit({
    v: 1, type: 'songs', at: Date.now(), songs: {
      enabled: true,
      playing: { seq: 1, id: 'test-song', name: '测试歌曲', artists: ['歌手'], album: '', durationMs: 180_000, by: '观众', requestedAt: Date.now() },
      waiting: [], playback: { status: 'loading', positionMs: 0, durationMs: 180_000, updatedAt: Date.now() },
    },
  });
}
function reports(): URLSearchParams[] {
  return fetchMock.mock.calls.map(([url]) => new URL(url, 'http://stage.test'))
    .filter((url) => url.pathname === '/music/state').map((url) => url.searchParams);
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  FakeAudio.instances = [];
  fetchMock.mockClear();
  vi.stubGlobal('location', { search: '' });
  vi.stubGlobal('sessionStorage', { getItem: () => null });
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('fetch', fetchMock);
  store = await import('../src/stage/store');
  store.connect();
});

function background(volume = 0.12): void {
  FakeEventSource.current.onopen?.();
  emit({ v: 1, type: 'backgroundMusic', settings: { enabled: true, volume }, at: Date.now() });
  emit({ v: 1, type: 'room', onAir: true, at: Date.now() });
}

function emptyQueue(): void {
  emit({ v: 1, type: 'songs', songs: { enabled: true, playing: null, waiting: [], playback: null }, at: Date.now() });
}

describe('instrumental background music', () => {
  it('waits for the song snapshot and loops quietly only while live', async () => {
    background();
    await flush();
    expect(FakeAudio.instances).toEqual([]);
    emptyQueue();
    await flush();
    const bg = FakeAudio.instances[0];
    expect(bg.src).toContain('/background-music.wav?');
    expect(bg.loop).toBe(true);
    expect(bg.volume).toBe(0.12);
    expect(bg.paused).toBe(false);
    expect(reports()).toEqual([]);
    emit({ v: 1, type: 'room', onAir: false, at: Date.now() });
    expect(bg.paused).toBe(true);
    expect(bg.removeAttribute).toHaveBeenCalledWith('src');
  });

  it('pauses even while resolving a request and resumes the same position after the whole queue ends', async () => {
    background(); emptyQueue(); await flush();
    const bg = FakeAudio.instances[0];
    bg.advance(8);
    song();
    const queued = store.getState().songs!;
    emit({ v: 1, type: 'songs', songs: { ...queued, playback: { ...queued.playback!, status: 'resolving' } }, at: Date.now() });
    await flush();
    expect(bg.paused).toBe(true);
    expect(bg.currentTime).toBe(8);
    song(); await flush();
    const current = FakeAudio.instances.at(-1)!;
    current.onended?.(); await flush();
    // 播完回执并不代表队列已清空，等待服务端发来下一首或空队列。
    expect(bg.paused).toBe(true);
    emit({ v: 1, type: 'songs', songs: { ...queued, playing: null, waiting: [queued.playing!], playback: null }, at: Date.now() });
    expect(bg.paused).toBe(true);
    emptyQueue(); await flush();
    expect(bg.paused).toBe(false);
    expect(bg.currentTime).toBe(8);
    expect(FakeAudio.instances.filter((p) => p.src.includes('background-music'))).toHaveLength(1);
  });

  it('resumes after an unavailable request is skipped and supports disabling song requests', async () => {
    background(); emptyQueue(); await flush();
    const bg = FakeAudio.instances[0];
    song(); await flush();
    const queued = store.getState().songs!;
    emit({ v: 1, type: 'songs', songs: { ...queued, playback: { ...queued.playback!, status: 'error' } }, at: Date.now() });
    expect(bg.paused).toBe(true);
    emit({ v: 1, type: 'songs', songs: { enabled: false, playing: null, waiting: [], playback: null }, at: Date.now() });
    await flush();
    expect(bg.paused).toBe(false);
  });

  it('ducks without pausing for speech and allows volume changes and zero volume', async () => {
    background(); emptyQueue(); await flush();
    const bg = FakeAudio.instances[0];
    bg.advance(5);
    say(); await flush();
    expect(bg.volume).toBeCloseTo(0.12 * 0.35);
    expect(bg.paused).toBe(false);
    FakeAudio.instances[1].onended?.();
    expect(bg.volume).toBe(0.12);
    emit({ v: 1, type: 'backgroundMusic', settings: { enabled: true, volume: 0.06 }, at: Date.now() });
    expect(bg.volume).toBe(0.06);
    expect(bg.currentTime).toBe(5);
    emit({ v: 1, type: 'backgroundMusic', settings: { enabled: true, volume: 0 }, at: Date.now() });
    expect(bg.paused).toBe(true);
  });

  it('yields to videos and games, and stops on disconnect until new snapshots arrive', async () => {
    background(); emptyQueue(); await flush();
    const bg = FakeAudio.instances[0];
    emit({ v: 1, type: 'media', action: 'play', id: 'video', src: '/video', title: '', up: '', from: 0, until: 30, at: Date.now() });
    expect(bg.paused).toBe(true);
    emit({ v: 1, type: 'media', action: 'stop', id: 'video', at: Date.now() });
    await flush(); expect(bg.paused).toBe(false);
    emit({ v: 1, type: 'game', source: { url: '/game' }, at: Date.now() });
    expect(bg.paused).toBe(true);
    emit({ v: 1, type: 'game', source: null, at: Date.now() });
    await flush(); expect(bg.paused).toBe(false);
    FakeEventSource.current.onerror?.();
    expect(bg.paused).toBe(true);
    background(); await flush();
    expect(FakeAudio.instances).toHaveLength(1);
    song(); await flush();
    expect(FakeAudio.instances.filter((p) => p.src.includes('background-music'))).toHaveLength(1);
    emptyQueue(); await flush();
    expect(FakeAudio.instances.at(-1)?.src).toContain('background-music');
    expect(FakeAudio.instances.at(-1)?.paused).toBe(false);
  });

  it('keeps the preview silent even when live background music is enabled', async () => {
    vi.resetModules(); vi.stubGlobal('location', { search: '?preview=1' });
    store = await import('../src/stage/store'); store.connect();
    background(); emptyQueue(); await flush();
    expect(FakeAudio.instances).toEqual([]);
  });

  it('shows an unlock button for autoplay blocking and recovers on click', async () => {
    const blocked = Object.assign(new Error('autoplay'), { name: 'NotAllowedError' });
    // 等配置齐全前先构造播放器，在 play() 第一次调用时模拟浏览器拦截。
    const Original = FakeAudio;
    class BlockedAudio extends Original {
      constructor(src = '') {
        super(src);
        if (src.includes('background-music')) this.play.mockRejectedValueOnce(blocked);
      }
    }
    vi.stubGlobal('Audio', BlockedAudio);
    background(); emptyQueue(); await flush();
    const bg = FakeAudio.instances[0];
    expect(store.getState().needsClick).toBe(true);
    expect(bg.play).toHaveBeenCalledOnce();
    store.unlockAudio(); await flush();
    expect(bg.paused).toBe(false);
    expect(store.getState().needsClick).toBe(false);
  });

  it('does not repeatedly retry a broken background asset or block requested songs', async () => {
    background(); emptyQueue(); await flush();
    const bg = FakeAudio.instances[0];
    bg.onerror?.();
    background(); emptyQueue(); await flush();
    expect(bg.play).toHaveBeenCalledOnce();
    expect(bg.paused).toBe(true);
    song(); await flush();
    expect(FakeAudio.instances.at(-1)?.paused).toBe(false);
    expect(store.getState().needsClick).toBe(false);
  });

  it('does not let a late background play completion overlap a requested song', async () => {
    let finish!: () => void;
    class SlowAudio extends FakeAudio {
      constructor(src = '') {
        super(src);
        if (src.includes('background-music')) this.play.mockImplementationOnce(() => new Promise<void>((resolve) => {
          finish = () => { this.paused = false; resolve(); };
        }));
      }
    }
    vi.stubGlobal('Audio', SlowAudio);
    background(); emptyQueue(); await flush();
    const bg = FakeAudio.instances[0];
    song(); await flush();
    finish(); await flush();
    expect(bg.paused).toBe(true);
    expect(FakeAudio.instances[1].paused).toBe(false);
    emptyQueue(); await flush();
    expect(bg.paused).toBe(false);
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('music while the host speaks', () => {
  it('keeps the same song advancing, ducks for speech and restores volume without restarting', async () => {
    song();
    await flush();
    const music = FakeAudio.instances[0];
    music.advance(12);
    say();
    await flush();
    expect(music.paused).toBe(false);
    expect(music.volume).toBeCloseTo(0.2);
    expect(music.pause).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    music.advance(3);
    await flush();
    expect(music.currentTime).toBe(15);
    expect(reports().some((r) => r.get('state') === 'playing' && r.get('at') === '15000')).toBe(true);
    expect(reports().some((r) => r.get('state') === 'paused')).toBe(false);
    FakeAudio.instances[1].onended?.();
    await flush();
    expect(store.getState().speaking).toBe(false);
    expect(music.volume).toBe(1);
    expect(music.currentTime).toBe(15);
    expect(music.play).toHaveBeenCalledOnce();
  });

  it('starts songs during speech and still reports buffering and completion', async () => {
    say();
    song();
    await flush();
    const music = FakeAudio.instances[1];
    expect(music.paused).toBe(false);
    expect(music.volume).toBeCloseTo(0.2);
    expect(reports().some((r) => r.get('state') === 'playing')).toBe(true);
    music.onwaiting?.();
    music.onstalled?.();
    await flush();
    expect(reports().filter((r) => r.get('state') === 'loading')).toHaveLength(2);
    music.ended = true;
    music.onended?.();
    await flush();
    expect(reports().at(-1)?.get('state')).toBe('ended');
    expect(store.getState().speaking).toBe(true);
  });

  it('restores music volume if speech audio fails', async () => {
    song();
    say();
    await flush();
    const [music, speech] = FakeAudio.instances;
    expect(music.volume).toBeCloseTo(0.2);
    speech.onerror?.();
    await flush();
    expect(store.getState().speaking).toBe(false);
    expect(music.volume).toBe(1);
    expect(music.paused).toBe(false);
    expect(music.pause).not.toHaveBeenCalled();
  });

  it('still stops music when the queue is stopped', async () => {
    song();
    await flush();
    const music = FakeAudio.instances[0];
    emit({ v: 1, type: 'songs', at: Date.now(), songs: { enabled: true, playing: null, waiting: [], playback: null } });
    expect(music.paused).toBe(true);
    expect(music.removeAttribute).toHaveBeenCalledWith('src');
  });

  it('keeps the console preview silent', async () => {
    vi.resetModules();
    vi.stubGlobal('location', { search: '?preview=1' });
    store = await import('../src/stage/store');
    store.connect();
    song();
    say();
    await flush();
    expect(FakeAudio.instances).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
