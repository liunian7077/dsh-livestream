import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Packs } from '../src/body/packs';
import { StageServer } from '../src/body/server';
import { Stage } from '../src/body/stage';
import { Songbook } from '../src/body/songbook';

let dir = '';
let server: StageServer | null = null;
const connections: AbortController[] = [];
let book: Songbook | null = null;

afterEach(() => {
  for (const connection of connections.splice(0)) connection.abort();
  book?.stop();
  book = null;
  vi.restoreAllMocks();
  server?.stop();
  server = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

/** 一个最小的插件包目录：有构建好的舞台脚本、样式、角色和模板 */
function makePackage(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-livestream-stage-'));
  mkdirSync(join(root, 'lib'), { recursive: true });
  mkdirSync(join(root, 'stage'), { recursive: true });
  writeFileSync(join(root, 'lib', 'stage.js'), 'console.log("one");\n');
  writeFileSync(join(root, 'lib', 'stage.js.map'), '{"version":3,"sources":[],"mappings":""}\n');
  writeFileSync(join(root, 'stage', 'stage.css'), '.one{}\n');
  mkdirSync(join(root, 'assets', 'characters', 'test'), { recursive: true });
  writeFileSync(join(root, 'assets', 'characters', 'test', 'character.json'), JSON.stringify({ id: 'test', name: '测试' }));
  mkdirSync(join(root, 'assets', 'templates', 'test'), { recursive: true });
  writeFileSync(join(root, 'assets', 'templates', 'test', 'template.json'), JSON.stringify({ id: 'test', name: '测试', canvas: [1920, 1080] }));
  return root;
}

function within<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等了 ${ms}ms 还没有 ${label}`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/** 一直读事件流，直到看见 needle */
async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, decoder: TextDecoder, needle: string, ms = 5000): Promise<string> {
  let text = '';
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const { value, done } = await within(reader.read(), deadline - Date.now(), needle);
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (text.includes(needle)) return text;
  }
  throw new Error(`事件流里没有 ${needle}：${text}`);
}

describe('stage server hot reload', () => {
  it('serves the local instrumental behind stage authentication and replays its settings to new pages', async () => {
    dir = makePackage();
    mkdirSync(join(dir, 'assets', 'music'), { recursive: true });
    writeFileSync(join(dir, 'assets', 'music', 'quiet-room.wav'), 'RIFF-test-audio');
    const stage = new Stage();
    stage.broadcast({ type: 'backgroundMusic', settings: { enabled: true, volume: 0.12 } });
    server = new StageServer({
      port: 0, token: 'test-token', packageDir: dir,
      packs: new Packs(dir, join(dir, 'user')), stage,
      current: () => ({ character: 'test', template: 'test' }),
    });
    await server.start();
    const origin = new URL(server.url).origin;
    expect((await fetch(`${origin}/background-music.wav`)).status).toBe(401);
    const audio = await fetch(`${origin}/background-music.wav?token=test-token`);
    expect(audio.status).toBe(200);
    expect(audio.headers.get('content-type')).toBe('audio/wav');
    expect(await audio.text()).toBe('RIFF-test-audio');
    const controller = new AbortController(); connections.push(controller);
    const events = await fetch(`${origin}/events?preview=1&token=test-token`, { signal: controller.signal });
    const stream = await readUntil(events.body!.getReader(), new TextDecoder(), '"type":"backgroundMusic"');
    expect(stream).toContain('"volume":0.12');
    expect(stage.watchers).toBe(0);
  });

  it('keeps preview separate from playback, reconnects music, and advances after a CDN failure', async () => {
    dir = makePackage();
    const stage = new Stage();
    book = new Songbook({
      find: async (q) => ({ id: q.title, name: q.title, artists: [], album: '', durationMs: 180_000, score: 1 }),
      resolve: async (song) => `https://audio.example/${song.id}`,
      hasStage: () => stage.watchers > 0,
    });
    const connected = vi.spyOn(book, 'connect');
    const disconnected = vi.spyOn(book, 'disconnect');
    server = new StageServer({
      port: 0, token: 'test-token', packageDir: dir,
      packs: new Packs(dir, join(dir, 'user')), stage, music: book,
      current: () => ({ character: 'test', template: 'test' }),
    });
    await server.start();
    await book.request({ title: 'one', raw: 'one' }, { id: '1', name: '甲' });
    await book.request({ title: 'two', raw: 'two' }, { id: '2', name: '乙' });
    const first = book.playing!;
    const subscribe = async (preview = false) => {
      const controller = new AbortController();
      connections.push(controller);
      const response = await fetch(`${server!.url.replace('/?', '/events?')}${preview ? '&preview=1' : ''}`, { signal: controller.signal });
      await readUntil(response.body!.getReader(), new TextDecoder(), '"type":"hello"');
      return controller;
    };
    await subscribe(true);
    expect(stage.watchers).toBe(0);
    expect(connected).not.toHaveBeenCalled();
    const firstWindow = await subscribe();
    expect(connected).toHaveBeenCalledTimes(1);
    const secondWindow = await subscribe();
    expect(connected).toHaveBeenCalledTimes(1);
    book.report(first.seq, 'playing', 10_000);
    firstWindow.abort();
    await vi.waitFor(() => expect(stage.watchers).toBe(1));
    expect(disconnected).not.toHaveBeenCalled();
    secondWindow.abort();
    await vi.waitFor(() => expect(stage.watchers).toBe(0));
    expect(disconnected).toHaveBeenCalledTimes(1);
    expect(book.playback).toMatchObject({ status: 'paused', positionMs: 10_000 });
    await subscribe();
    expect(connected).toHaveBeenCalledTimes(2);
    expect(book.playback).toMatchObject({ status: 'loading', positionMs: 10_000 });

    const fetchLocal = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => String(url).startsWith('https://audio.example/')
      ? Promise.resolve(new Response('unavailable', { status: 403 })) : fetchLocal(url, init));
    const response = await fetch(`${new URL(server.url).origin}/music?seq=${first.seq}&token=test-token`);
    expect(response.status).toBe(403);
    await response.text();
    expect(book.playing?.song.name).toBe('two');
    expect(book.playback?.status).toBe('loading');
  });

  it('tells an open stage page to reload when the stage bundle is rebuilt', async () => {
    dir = makePackage();
    server = new StageServer({
      port: 0,
      token: 'test-token',
      packageDir: dir,
      packs: new Packs(dir, join(dir, 'user')),
      stage: new Stage(),
      current: () => ({ character: 'test', template: 'test' }),
    });
    await server.start();

    // 开发构建的 sourcemap 也由舞台服务器发（DevTools 里看得到 src/stage 的源码），而且不缓存
    const map = await fetch(`${new URL(server.url).origin}/stage.js.map?token=test-token`);
    expect(map.status).toBe(200);
    expect(map.headers.get('content-type')).toContain('application/json');
    expect(map.headers.get('cache-control')).toBe('no-store');

    const controller = new AbortController();
    const events = await fetch(server.url.replace('/?', '/events?'), { signal: controller.signal });
    expect(events.status).toBe(200);
    const reader = events.body!.getReader();
    const decoder = new TextDecoder();
    // 先收到 hello，说明舞台页已经订阅上了
    await readUntil(reader, decoder, '"type":"hello"');

    // 构建脚本重建舞台页：换内容、换 mtime（真实构建还会换大小）
    writeFileSync(join(dir, 'lib', 'stage.js'), 'console.log("two");\n');
    const future = (Date.now() + 5000) / 1000;
    utimesSync(join(dir, 'lib', 'stage.js'), future, future);

    await readUntil(reader, decoder, '"type":"reload"');
    controller.abort();
  }, 15_000);
});
