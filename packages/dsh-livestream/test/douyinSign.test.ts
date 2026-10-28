import { describe, expect, it } from 'vitest';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertBundled, bundledSignFile, packageRoot, resetSigner, signFilePath, signatureFor } from '../src/core/platforms/douyin/douyinSign';

/**
 * 签名脚本随包分发（third_party/douyin-sign/sign.js）：
 * - 找得到，且 sha256 和 douyinSign.ts 里钉的值一致；
 * - 不联网也能算出签名（证明没有退回「首次连接去下载」那条路）；
 * - 签名字符串的形状符合抖音的要求（16 字符，可能含 + /）。
 */
describe('douyin signer (bundled, offline)', () => {
  it('ships the sign script inside the package', () => {
    expect(packageRoot()).not.toBe('');
    const file = bundledSignFile();
    expect(file).not.toBe('');
    expect(existsSync(file)).toBe(true);
    // 缓存路径是另一回事：不联网时不应该依赖它
    expect(file).not.toBe(signFilePath());
    expect(file).toBe(join(packageRoot(), 'third_party', 'douyin-sign', 'sign.js'));
  });

  it('signs without any network access', async () => {
    resetSigner();
    // 断网式的护栏：这条用例里任何 fetch 都直接失败
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new Error('测试里不应该联网'))) as typeof fetch;
    try {
      const signature = await signatureFor('7701223924599966490');
      expect(typeof signature).toBe('string');
      expect(signature).toHaveLength(16);
      expect(signature).toMatch(/^[A-Za-z0-9+/]+$/);
      // 换房间号必须给出不同签名（入参真的进了哈希）
      const other = await signatureFor('7000000000000000001');
      expect(other).toHaveLength(16);
      expect(other).not.toBe(signature);
    } finally {
      globalThis.fetch = realFetch;
      resetSigner();
    }
  }, 30_000);

  it('accepts the shipped script and refuses a tampered one', () => {
    const source = readFileSync(bundledSignFile(), 'utf8');
    expect(() => assertBundled(source)).not.toThrow();
    expect(() => assertBundled(`${source}\n// tampered`)).toThrow(/校验不一致/);
    expect(() => assertBundled('')).toThrow(/校验不一致/);
  });

  it('lets DSH_DOUYIN_SIGN_FILE point at its own copy', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'douyin-sign-own-'));
    const own = join(dir, 'sign.js');
    copyFileSync(bundledSignFile(), own);
    const before = process.env.DSH_DOUYIN_SIGN_FILE;
    process.env.DSH_DOUYIN_SIGN_FILE = own;
    resetSigner();
    try {
      expect((await signatureFor('7701223924599966490')).length).toBe(16);
    } finally {
      if (before === undefined) delete process.env.DSH_DOUYIN_SIGN_FILE;
      else process.env.DSH_DOUYIN_SIGN_FILE = before;
      resetSigner();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
