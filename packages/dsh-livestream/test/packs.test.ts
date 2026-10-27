import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Packs } from '../src/body/packs';
import type { CharacterManifest } from '../src/stage/protocol';

/** 插件包目录（有 assets/ 的那一层） */
const packageDir = fileURLToPath(new URL('..', import.meta.url));
const charactersDir = join(packageDir, 'assets', 'characters');

const ids = readdirSync(charactersDir).filter((id) => existsSync(join(charactersDir, id, 'character.json')));

describe('character packs', () => {
  it('ships the built-in characters', () => {
    expect(ids).toContain('dafeiyu');
  });

  for (const id of ids) {
    describe(id, () => {
      const dir = join(charactersDir, id);
      const manifest = JSON.parse(readFileSync(join(dir, 'character.json'), 'utf8')) as CharacterManifest;

      it('matches its directory name and can be listed', () => {
        expect(manifest.id).toBe(id);
        expect(manifest.format).toBe(1);
        expect(new Packs(packageDir, join(packageDir, 'user-assets')).list('characters').map((c) => c.id)).toContain(id);
      });

      it('references only files that exist and are not empty', () => {
        const files = [
          ...Object.values(manifest.clips ?? {}).filter((v): v is string => typeof v === 'string'),
          ...Object.values(manifest.clips?.moods ?? {}),
          ...Object.values(manifest.clips?.talkMoods ?? {}),
          ...Object.values(manifest.art ?? {}),
        ];
        expect(files.length).toBeGreaterThan(0);
        for (const file of files) {
          const path = join(dir, file);
          expect(existsSync(path), `${id}: 缺文件 ${file}`).toBe(true);
          expect(statSync(path).size, `${id}: 空文件 ${file}`).toBeGreaterThan(0);
        }
      });

      it('has a frame inside its clip size when it declares one', () => {
        const clips = manifest.clips;
        if (!clips) return;
        const [w, h] = clips.size;
        expect(w).toBeGreaterThan(0);
        expect(h).toBeGreaterThan(0);
        if (!clips.frame) return;
        const [x, y, fw, fh] = clips.frame;
        expect(fw).toBeGreaterThan(0);
        expect(fh).toBeGreaterThan(0);
        expect(x + fw).toBeLessThanOrEqual(w);
        expect(y + fh).toBeLessThanOrEqual(h);
      });

      it('only reacts with moods it can play', () => {
        const moods = manifest.clips?.moods ?? manifest.image?.moods ?? {};
        for (const [trigger, mood] of Object.entries(manifest.reactions ?? {})) {
          expect(moods[mood], `${id}: ${trigger} 用了没有的表情 ${mood}`).toBeTruthy();
        }
      });
    });
  }
});
