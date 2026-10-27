import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Packs } from '../src/body/packs';
import { StageServer } from '../src/body/server';
import { Stage } from '../src/body/stage';

let dir = '';
let server: StageServer | null = null;

afterEach(() => {
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
