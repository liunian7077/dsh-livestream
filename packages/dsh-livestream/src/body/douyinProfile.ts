/** 普通个人号：通过独立的抖音浏览器窗口读取公开主页，不接入私信。 */
import type { BrowserContext, Page } from 'playwright-core';
import { cleanText } from '../core/safety';
import { parseCookie } from '../core/platforms/douyin/douyinApi';

export interface DouyinProfile {
  uid: string;
  secUid: string;
  name: string;
  sign: string;
  account: string;
  fans?: number;
  following?: number;
  videos?: number;
  likes?: number;
  official: string;
}

/** 只认完整主页或 sec_uid；数字 UID、可修改的抖音号不能拿来拼主页。 */
export function douyinSecUid(input: string): string | null {
  let value = input.trim();
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (!['www.douyin.com', 'douyin.com'].includes(url.hostname)) return null;
      value = url.pathname.match(/^\/user\/([^/]+)\/?$/)?.[1] ?? '';
    } catch { return null; }
  }
  return /^[A-Za-z0-9_-]{16,256}$/.test(value) && !/^\d+$/.test(value) ? value : null;
}

function profileOf(body: any, expected?: string): DouyinProfile | null {
  if (body?.status_code !== 0 || !body.user) return null;
  const u = body.user;
  const secUid = typeof u.sec_uid === 'string' ? douyinSecUid(u.sec_uid) : null;
  const uid = typeof u.uid === 'string' ? u.uid : Number.isSafeInteger(u.uid) ? String(u.uid) : '';
  if (!secUid || (expected && secUid !== expected) || !/^\d{1,20}$/.test(uid) || typeof u.nickname !== 'string' || !u.nickname.trim()) return null;
  const count = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined;
  const text = (s: unknown, limit = 300) => typeof s === 'string' ? cleanText(s).slice(0, limit) : '';
  return {
    uid, secUid, name: text(u.nickname, 80), sign: text(u.signature),
    account: text(u.unique_id || u.short_id, 80),
    fans: count(u.follower_count), following: count(u.following_count),
    videos: count(u.aweme_count), likes: count(u.total_favorited),
    official: text(u.custom_verify || u.enterprise_verify_reason, 100),
  };
}

/** 只打开抖音公开页面。独立用户目录保留登录态；浏览器操作串行，避免两个查询串到同一主页。 */
export class DouyinProfiles {
  private context: BrowserContext | null = null;
  /** 设置里主动打开的登录页需保留；自动查询不能占用或关闭它。 */
  private loginPage: Page | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private appliedCookie = '';

  constructor(private readonly userDataDir: string, private readonly cookie: () => Promise<string>) {}

  private serial<T>(run: () => Promise<T>): Promise<T> {
    const task = this.queue.then(run);
    this.queue = task.catch(() => {});
    return task;
  }

  private async browser(): Promise<BrowserContext> {
    if (!this.context) {
      const { chromium } = await import('playwright-core');
      for (const channel of ['chrome', 'msedge']) {
        try {
          this.context = await chromium.launchPersistentContext(this.userDataDir, { channel, headless: false, viewport: { width: 1100, height: 820 } });
          break;
        } catch { /* 本机未安装这个浏览器时试下一个 */ }
      }
      if (!this.context) throw new Error('抖音窗口未能启动；请确认本机已安装 Chrome 或 Edge，并关闭之前打开的抖音查询窗口后重试。');
      const context = this.context;
      context.on('close', () => {
        if (this.context === context) {
          this.context = null;
          this.loginPage = null;
          this.appliedCookie = '';
        }
      });
    }
    try {
      const cookie = await this.cookie();
      if (cookie && cookie !== this.appliedCookie) {
        await this.context.addCookies([...parseCookie(cookie)].map(([name, value]) => ({ name, value, domain: '.douyin.com', path: '/', secure: true })));
        this.appliedCookie = cookie;
      }
      return this.context;
    } catch {
      // 浏览器错误可能带 Cookie 参数，不把原始异常交给主播。
      throw new Error('抖音窗口暂不可用；请检查设置中的抖音 Cookie，或重新打开窗口登录后重试。');
    }
  }

  openLogin(): Promise<void> {
    return this.serial(async () => {
      try {
        const context = await this.browser();
        const page = this.loginPage && !this.loginPage.isClosed() ? this.loginPage
          : context.pages().find((p) => !p.isClosed()) ?? await context.newPage();
        this.loginPage = page;
        await page.goto('https://www.douyin.com/', { waitUntil: 'domcontentloaded', timeout: 25_000 });
        await page.bringToFront();
      } catch {
        // 获取 Cookie 或创建页面失败也不能留下无用途的后台浏览器。
        if (!this.loginPage || this.loginPage.isClosed()) await this.closeBrowser();
        throw new Error('抖音登录页暂不可用，请检查网络和抖音 Cookie 后重试。');
      }
    });
  }

  fetch(target: string): Promise<DouyinProfile> {
    return this.serial(async () => {
      const secUid = target === '自己' ? null : douyinSecUid(target);
      if (target !== '自己' && !secUid) throw new Error('缺少抖音主页标识；请提供完整的 douyin.com/user/… 主页链接。');
      let page: Page | null = null;
      let responseTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        const context = await this.browser();
        // 查询始终使用自己的标签页，不导航用户正在登录或验证的页面。
        try { page = await context.newPage(); }
        catch { throw new Error('抖音查询页未能打开，请重新打开抖音窗口后重试。'); }
        // 让抖音网页自己完成签名，只读取这个主页实际返回的公开资料。
        const received = page.waitForResponse((res) => {
          const url = new URL(res.url());
          if (url.origin !== 'https://www.douyin.com' || !res.ok()) return false;
          if (secUid) return url.pathname === '/aweme/v1/web/user/profile/other/' && url.searchParams.get('sec_user_id') === secUid;
          return url.pathname === '/aweme/v1/web/user/profile/self/';
        }, { timeout: 20_000 }).then((res) => res.json()).catch(() => null);
        // waitForResponse 只等响应头，正文下载也必须有上限，否则窗口仍可能一直留着。
        const response = Promise.race([received, new Promise<null>((resolve) => {
          responseTimer = setTimeout(() => resolve(null), 20_000);
          responseTimer.unref?.();
        })]);
        let navigated = true;
        try {
          await page.goto(`https://www.douyin.com/user/${secUid ?? 'self'}`, { waitUntil: 'domcontentloaded', timeout: 25_000 });
        } catch { navigated = false; }
        const profile = profileOf(await response, secUid ?? undefined);
        if (!profile) throw new Error(navigated
          ? '抖音没有返回可核对的主页资料；请在设置中打开抖音窗口完成登录或验证，再重试。也可能是主页不可见或网页已改版。'
          : '抖音主页没打开，检查网络后重试。');
        return profile;
      } finally {
        if (responseTimer) clearTimeout(responseTimer);
        if (this.loginPage && !this.loginPage.isClosed()) {
          // 用户的登录窗口留着，查询页无论成功、超时还是验证失败都关闭。
          try { if (page && !page.isClosed()) await page.close(); }
          catch { throw new Error('抖音查询页未能自动关闭，请手动关闭查询标签页。'); }
        } else {
          // 独立查询完成后关闭整个上下文（含启动时的空白页），释放浏览器进程。
          await this.closeBrowser();
        }
      }
    });
  }

  private async closeBrowser(): Promise<void> {
    const context = this.context;
    if (!context) return;
    try { await context.close(); }
    catch { throw new Error('抖音查询窗口未能自动关闭，请手动关闭这个独立窗口后重试。'); }
    if (this.context === context) {
      this.context = null;
      this.loginPage = null;
      this.appliedCookie = '';
    }
  }

  close(): Promise<void> {
    return this.serial(() => this.closeBrowser());
  }
}

export function douyinProfileText(p: DouyinProfile): string {
  const lines = [
    `${p.name} 的抖音主页（UID ${p.uid}）：`,
    `主页：https://www.douyin.com/user/${p.secUid}`,
    ...([['抖音号', p.account], ['粉丝', p.fans], ['关注', p.following], ['作品', p.videos], ['获赞', p.likes]] as const)
      .filter(([, value]) => value !== undefined && value !== '').map(([label, value]) => `- ${label}：${value}`),
  ];
  if (p.sign) lines.push(`- 个性签名：<签名>${p.sign}</签名>`);
  if (p.official) lines.push(`- 认证：${p.official}`);
  return lines.join('\n');
}

export function douyinProfileSummary(p: DouyinProfile): string {
  return [p.videos !== undefined ? `作品${p.videos}个` : '', p.fans !== undefined ? `粉丝${p.fans}` : '', p.sign ? `签名「${p.sign.slice(0, 50)}」` : '', p.official].filter(Boolean).join('，');
}
