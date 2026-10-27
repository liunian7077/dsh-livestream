/**
 * 抖音 wss 签名（signature / X-Bogus）。
 *
 * 抖音的弹幕连接必须带一个由网页端安全 SDK 算出的 signature；服务端对没有签名或签名不对的
 * 连接直接回 HTTP 200（不是 101），连不上也不给原因。
 *
 * 算法本身是：md5(signParams(roomId)) → SDK 的 X-MS-STUB 出口 → X-Bogus 字符串。
 * 官方 CDN 上的 webmssdk（1.0.0.53）用同样的入参算出来**不被接受**（实测），能用的那份是
 * 社区对 webmssdk 做过封装的产物（社区项目里通常叫 sign.js，调用方式是
 * `frontierSign({"X-MS-STUB": md5})["X-Bogus"]`）。
 *
 * 那份脚本是 AGPL-3.0，和本仓库的 MIT 不同，所以作为独立第三方组件原样放在
 * `third_party/douyin-sign/sign.js`（附上游 LICENSE 全文，见该目录的 README），
 * 不修改、不并进 MIT 代码，运行时用 node:vm 加载后只调 `get_sign` / `frontierSign`。
 *
 * 加载顺序：
 *   1. `DSH_DOUYIN_SIGN_FILE` 指定的文件（自托管/换版本）
 *   2. 包内自带的 `third_party/douyin-sign/sign.js`（默认走这条，不用联网）
 *   3. `$DSH_HOME/dsh-livestream/douyin/sign.js` 缓存
 *   4. 都没有才按固定提交下载并校验 sha256
 *
 * 第 2 步会校验 sha256：包内文件被改动过就拒绝加载，不至于拿一份来路不明的脚本去签名。
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { UA, signParams } from './douyinApi';

/** 固定到某个提交：内容不会变，改版时由我们主动升级 */
const SIGN_URL = 'https://raw.githubusercontent.com/saermart/DouyinLiveWebFetcher/40a904bdb0561a5a9c958a95634a29681cc4fbf4/sign.js';
const SIGN_SHA256 = '81fb78a5e8728af99ffb9d20625b01bcedc43a82b05e3bef79e2bc0d29ccff5d';

/** 用户可以自己指路径（自托管/离线） */
const override = () => process.env.DSH_DOUYIN_SIGN_FILE?.trim() || '';

export function signFilePath(): string {
  if (override()) return override();
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh');
  return join(home, 'dsh-livestream', 'douyin', 'sign.js');
}

/**
 * 插件包目录（lib/ 或 lib/chunks/ 往上找 package.json）。
 * 和 dsh/runtime.ts 的 packageDir 同一套办法，但这里在 core 层，不能反过来依赖 dsh 层。
 */
export function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  // 产物在 lib/ 或 lib/chunks/（2～3 层），源码在 src/core/platforms/douyin/（5 层），
  // 所以往上找到 6 层；到盘根就停。
  for (let i = 0; i < 6; i++) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: string };
      if (pkg.name === 'dsh-livestream') return dir;
    } catch {
      // 继续往上找
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '';
}

/** 包内自带的签名脚本（随插件分发，不需要联网） */
export function bundledSignFile(): string {
  const root = packageRoot();
  return root ? join(root, 'third_party', 'douyin-sign', 'sign.js') : '';
}

interface Signer {
  /** md5(signParams) → signature */
  sign: (md5: string) => string;
}

let cached: Signer | null = null;

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

async function download(path: string): Promise<string> {
  const res = await fetch(SIGN_URL, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`签名脚本下载失败（HTTP ${res.status}）`);
  const text = await res.text();
  const actual = sha256(text);
  if (actual !== SIGN_SHA256) {
    throw new Error(`签名脚本校验不一致（期望 ${SIGN_SHA256.slice(0, 12)}…，实际 ${actual.slice(0, 12)}…），可能上游被改动过，先不加载`);
  }
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
  return text;
}

/**
 * 包内那份必须和源码里钉的 sha256 一致：万一被替换或误改，宁可报错也不要拿它去签名。
 * 单独导出是为了让测试能真的走到这条判断上。
 */
export function assertBundled(text: string): void {
  const actual = sha256(text);
  if (actual !== SIGN_SHA256) {
    throw new Error(
      `包内的签名脚本校验不一致（期望 ${SIGN_SHA256.slice(0, 12)}…，实际 ${actual.slice(0, 12)}…）：`
      + 'third_party/douyin-sign/sign.js 可能被改过',
    );
  }
}

async function loadSource(): Promise<string> {
  const overridePath = override();
  if (overridePath) {
    // 用户自己指定的文件：信任它，不校验（可能就是想试新版）
    if (!existsSync(overridePath)) throw new Error(`DSH_DOUYIN_SIGN_FILE 指向的文件不存在：${overridePath}`);
    return readFileSync(overridePath, 'utf8');
  }

  const bundled = bundledSignFile();
  if (bundled && existsSync(bundled)) {
    const text = readFileSync(bundled, 'utf8');
    assertBundled(text);
    return text;
  }

  const cachePath = signFilePath();
  if (existsSync(cachePath)) return readFileSync(cachePath, 'utf8');
  return download(cachePath);
}

/**
 * 加载签名脚本。脚本是 webmssdk 的反混淆产物：它自己会写 `document`/`window`/`navigator`，
 * 所以沙箱只需要 console；别给它 fetch / WebSocket，它也用不着。
 */
export async function signer(): Promise<Signer> {
  if (cached) return cached;
  const source = await loadSource();
  const sandbox: Record<string, unknown> = { console: { log() {}, warn() {}, error() {}, info() {}, debug() {} }, navigator: { userAgent: UA } };
  vm.createContext(sandbox);
  try {
    vm.runInContext(source, sandbox, { filename: 'douyin-sign.js', timeout: 10_000 });
  } catch (err) {
    throw new Error(`签名脚本跑不起来：${(err as Error).message}`);
  }

  // 两种出口都认：上游的 get_sign(md5)，或直接 frontierSign({"X-MS-STUB": md5})
  const getSign = sandbox.get_sign;
  const frontierSign = (sandbox.byted_acrawler as { frontierSign?: (arg: unknown) => { 'X-Bogus'?: string } } | undefined)?.frontierSign;
  const sign = (md5: string): string => {
    if (typeof getSign === 'function') {
      const out = (getSign as (m: string) => unknown)(md5);
      if (typeof out === 'string' && out) return out;
    }
    if (typeof frontierSign === 'function') {
      const out = frontierSign({ 'X-MS-STUB': md5 });
      const value = out?.['X-Bogus'];
      if (typeof value === 'string' && value) return value;
    }
    throw new Error('签名脚本没有给出 signature（get_sign / frontierSign 都不可用）');
  };
  cached = { sign };
  return cached;
}

/** 算一次签名：md5(signParams(roomId)) → signature */
export async function signatureFor(roomId: string): Promise<string> {
  const { sign } = await signer();
  const md5 = createHash('md5').update(signParams(roomId)).digest('hex');
  return sign(md5);
}

/** 测试/排错用：清掉进程内的签名器缓存 */
export function resetSigner(): void {
  cached = null;
}
