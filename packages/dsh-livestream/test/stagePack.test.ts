import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Packs } from '../src/body/packs';
import { StageServer } from '../src/body/server';
import { Stage } from '../src/body/stage';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const packs = new Packs(packageDir, join(packageDir, 'user-assets'));
const server = new StageServer({
  port: 0,
  token: 'test-token',
  packageDir,
  packs,
  stage: new Stage(),
  current: () => ({ character: 'dafeiyu-chibi', template: 'default' }),
});

afterAll(() => server.stop());

describe('stage server serves a character pack', () => {
  it('hands out clips, memes and fonts with the right type', async () => {
    await server.start();
    const origin = new URL(server.url).origin;
    const cases: Array<[string, string]> = [
      ['/characters/dafeiyu-chibi/clips/idle-breathe.webm', 'video/webm'],
      ['/characters/dafeiyu-chibi/clips/click-happy.webm', 'video/webm'],
      ['/characters/dafeiyu-chibi/art/portrait.webp', 'image/webp'],
      ['/characters/dafeiyu-chibi/art/memes/deep-sleep.png', 'image/png'],
      ['/characters/dafeiyu-chibi/fonts/shangshou-ruantangti.ttf', 'application/octet-stream'],
    ];
    for (const [path, type] of cases) {
      const res = await fetch(`${origin}${path}?token=test-token`);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('content-type'), path).toContain(type);
      expect((await res.arrayBuffer()).byteLength, path).toBeGreaterThan(1024);
    }
  }, 20_000);

  it('greets an opened stage with the pack, including its frame', async () => {
    await server.start();
    const origin = new URL(server.url).origin;
    const res = await fetch(`${origin}/events?token=test-token`);
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    await reader.cancel();
    const line = new TextDecoder().decode(value).split('\n').find((l) => l.startsWith('data: '))!;
    const hello = JSON.parse(line.slice(6));
    expect(hello.type).toBe('hello');
    expect(hello.character.id).toBe('dafeiyu-chibi');
    expect(hello.character.clips.frame).toEqual([150, 10, 370, 345]);
    const manifest = JSON.parse(readFileSync(join(packageDir, 'assets', 'characters', 'dafeiyu-chibi', 'character.json'), 'utf8'));
    expect(hello.character.clips.moods).toEqual(manifest.clips.moods);
    expect(Object.keys(hello.character.clips.moods)).toEqual(expect.arrayContaining(['angry', 'laugh', 'sad', 'scared', 'shocked', 'shy', 'think', 'hum-song', 'unwrap-gift']));
  }, 20_000);
});
