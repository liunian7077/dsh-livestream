import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DouyinProfiles } from '../src/body/douyinProfile';

const { launch } = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock('playwright-core', () => ({ chromium: { launchPersistentContext: launch } }));

const SEC_UID = 'MS4wLjABAAAA-test-viewer-001';
const OTHER_UID = 'MS4wLjABAAAA-test-viewer-002';
const rawProfile = (secUid = SEC_UID) => ({
  status_code: 0,
  user: { uid: '12345', sec_uid: secUid, nickname: '测试观众', signature: '测试签名', follower_count: 10 },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class FakePage {
  closed = false;
  url = 'about:blank';
  body: unknown;
  goto = vi.fn(async (url: string) => { this.url = url; });
  bringToFront = vi.fn(async () => {});
  isClosed = () => this.closed;
  close = vi.fn(async () => { this.closed = true; });
  waitForResponse = vi.fn(async (predicate: (response: { url(): string; ok(): boolean }) => boolean) => {
    // 等 goto 指定本次主页后再模拟返回，只交付查询所匹配的公开资料接口。
    await Promise.resolve();
    if (this.closed) throw new Error('page closed');
    const target = new URL(this.url).pathname.split('/').at(-1)!;
    const self = target === 'self';
    const response = {
      url: () => self ? 'https://www.douyin.com/aweme/v1/web/user/profile/self/'
        : `https://www.douyin.com/aweme/v1/web/user/profile/other/?sec_user_id=${target}`,
      ok: () => true,
      json: async () => this.body ?? rawProfile(self ? SEC_UID : target),
    };
    if (!predicate(response)) throw new Error('unmatched response');
    return response;
  });
}

class FakeContext {
  allPages = [new FakePage()];
  closed = false;
  listeners: Array<() => void> = [];
  on = vi.fn((_event: string, callback: () => void) => { this.listeners.push(callback); });
  pages = () => this.allPages.filter((p) => !p.closed);
  newPage = vi.fn(async () => {
    const page = new FakePage();
    this.allPages.push(page);
    return page;
  });
  addCookies = vi.fn(async (_cookies: unknown[]) => {});
  close = vi.fn(async () => {
    this.closed = true;
    for (const page of this.allPages) page.closed = true;
    for (const listener of this.listeners) listener();
  });
}

let profiles: DouyinProfiles;
let cookie: ReturnType<typeof vi.fn<() => Promise<string>>>;
let contexts: FakeContext[];
beforeEach(() => {
  contexts = [];
  cookie = vi.fn(async () => 'sessionid=test-cookie');
  profiles = new DouyinProfiles('test-only-profile-directory', cookie);
  launch.mockReset();
  launch.mockImplementation(async () => {
    const context = new FakeContext();
    contexts.push(context);
    return context;
  });
});
afterEach(async () => {
  await profiles.close();
  vi.useRealTimers();
});

describe('Douyin profile browser lifecycle', () => {
  it.each([SEC_UID, '自己'])('closes the temporary browser and its startup blank page after reading %s', async (target) => {
    expect(await profiles.fetch(target)).toMatchObject({ uid: '12345', name: '测试观众', secUid: SEC_UID });
    const context = contexts[0];
    expect(context.close).toHaveBeenCalledOnce();
    expect(context.allPages).toHaveLength(2);
    expect(context.allPages.every((p) => p.closed)).toBe(true);
    expect(launch).toHaveBeenCalledWith('test-only-profile-directory', expect.objectContaining({ channel: 'chrome', headless: false }));
  });

  it('reopens the same persistent profile directory for subsequent queries', async () => {
    await profiles.fetch(SEC_UID);
    expect((await profiles.fetch(OTHER_UID)).secUid).toBe(OTHER_UID);
    expect(contexts).toHaveLength(2);
    expect(contexts.every((c) => c.closed)).toBe(true);
    expect(launch.mock.calls.map(([dir]) => dir)).toEqual(['test-only-profile-directory', 'test-only-profile-directory']);
    expect(contexts.every((c) => c.addCookies.mock.calls.length === 1)).toBe(true);
  });

  it('closes the query browser if the profile response body never finishes', async () => {
    vi.useFakeTimers();
    const context = new FakeContext();
    launch.mockResolvedValueOnce(context);
    const page = new FakePage();
    const reading = deferred<void>();
    page.waitForResponse.mockResolvedValueOnce({
      url: () => '', ok: () => true,
      json: async () => { reading.resolve(); return new Promise<never>(() => {}); },
    });
    context.newPage.mockResolvedValueOnce(page);
    const rejected = expect(profiles.fetch(SEC_UID)).rejects.toThrow('没有返回可核对');
    await reading.promise;
    await vi.advanceTimersByTimeAsync(19_999);
    expect(context.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(context.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['response timeout', 'invalid response', 'wrong profile', 'navigation failure'])('closes the temporary browser after %s', async (failure) => {
    const context = new FakeContext();
    launch.mockResolvedValueOnce(context);
    const page = new FakePage();
    context.newPage.mockImplementationOnce(async () => { context.allPages.push(page); return page; });
    if (failure === 'response timeout' || failure === 'navigation failure') page.waitForResponse.mockRejectedValueOnce(new Error('timed out'));
    if (failure === 'invalid response') page.body = { status_code: 1 };
    if (failure === 'wrong profile') page.body = rawProfile(OTHER_UID);
    if (failure === 'navigation failure') page.goto.mockRejectedValueOnce(new Error('network failed'));
    await expect(profiles.fetch(SEC_UID)).rejects.toThrow(failure === 'navigation failure' ? '主页没打开' : '没有返回可核对');
    expect(context.close).toHaveBeenCalledOnce();
    expect(page.closed).toBe(true);
  });

  it.each(['cookie', 'page creation'])('cleans up even when %s fails before navigation and hides raw errors', async (failure) => {
    const context = new FakeContext();
    launch.mockResolvedValueOnce(context);
    if (failure === 'cookie') context.addCookies.mockRejectedValueOnce(new Error('sensitive-cookie-value'));
    else context.newPage.mockRejectedValueOnce(new Error('sensitive-cookie-value'));
    await expect(profiles.fetch(SEC_UID)).rejects.toThrow(failure === 'cookie' ? '抖音窗口暂不可用' : '查询页未能打开');
    expect(context.close).toHaveBeenCalledOnce();
    expect(context.allPages.every((p) => p.closed)).toBe(true);
  });

  it('keeps an explicitly opened login page and only closes the separate query tab', async () => {
    await profiles.openLogin();
    const context = contexts[0];
    const login = context.allPages[0];
    expect(login.bringToFront).toHaveBeenCalledOnce();
    await profiles.fetch(SEC_UID);
    await profiles.fetch(OTHER_UID);
    expect(login.closed).toBe(false);
    expect(login.goto).toHaveBeenCalledTimes(1);
    expect(login.url).toBe('https://www.douyin.com/');
    expect(context.allPages.slice(1).every((p) => p.closed)).toBe(true);
    expect(context.close).not.toHaveBeenCalled();
    expect(context.addCookies).toHaveBeenCalledOnce();
    await profiles.close();
    expect(login.closed).toBe(true);
  });

  it('closes a failed query without closing the login page', async () => {
    await profiles.openLogin();
    const context = contexts[0];
    const page = new FakePage();
    page.waitForResponse.mockRejectedValueOnce(new Error('verification required'));
    context.newPage.mockResolvedValueOnce(page);
    await expect(profiles.fetch(SEC_UID)).rejects.toThrow('完成登录或验证');
    expect(page.close).toHaveBeenCalledOnce();
    expect(context.allPages[0].closed).toBe(false);
    expect(context.close).not.toHaveBeenCalled();
  });

  it('closes the entire query browser if the user has already closed the login page', async () => {
    await profiles.openLogin();
    const context = contexts[0];
    await context.allPages[0].close();
    await profiles.fetch(SEC_UID);
    expect(context.close).toHaveBeenCalledOnce();
  });

  it('recovers after the user closes the query window mid-request', async () => {
    const context = new FakeContext();
    launch.mockResolvedValueOnce(context);
    const page = new FakePage();
    page.goto.mockImplementationOnce(async () => { await context.close(); throw new Error('target closed'); });
    page.waitForResponse.mockRejectedValueOnce(new Error('target closed'));
    context.newPage.mockResolvedValueOnce(page);
    await expect(profiles.fetch(SEC_UID)).rejects.toThrow('主页没打开');
    expect(context.close).toHaveBeenCalledOnce();
    expect((await profiles.fetch(OTHER_UID)).secUid).toBe(OTHER_UID);
  });

  it('serializes concurrent queries and finishes cleanup before opening the next browser', async () => {
    const firstContext = new FakeContext();
    launch.mockResolvedValueOnce(firstContext);
    const response = deferred<Awaited<ReturnType<FakePage['waitForResponse']>>>();
    const page = new FakePage();
    page.waitForResponse.mockReturnValueOnce(response.promise);
    firstContext.newPage.mockResolvedValueOnce(page);
    const first = profiles.fetch(SEC_UID);
    const second = profiles.fetch(OTHER_UID);
    await vi.waitFor(() => expect(page.goto).toHaveBeenCalledOnce());
    expect(launch).toHaveBeenCalledTimes(1);
    launch.mockImplementationOnce(async () => {
      expect(firstContext.closed).toBe(true);
      const context = new FakeContext();
      contexts.push(context);
      return context;
    });
    response.resolve({ url: () => '', ok: () => true, json: async () => rawProfile() });
    expect((await first).secUid).toBe(SEC_UID);
    expect((await second).secUid).toBe(OTHER_UID);
    expect(contexts[0].closed).toBe(true);
  });

  it('reports a cleanup failure without exposing raw browser details and allows cleanup retry', async () => {
    const context = new FakeContext();
    launch.mockResolvedValueOnce(context);
    context.close.mockRejectedValueOnce(new Error('sensitive browser details'));
    await expect(profiles.fetch(SEC_UID)).rejects.toThrow('查询窗口未能自动关闭');
    await profiles.close();
    expect(context.close).toHaveBeenCalledTimes(2);
    expect(context.closed).toBe(true);
  });

  it('does not open a browser for an invalid profile target', async () => {
    await expect(profiles.fetch('12345')).rejects.toThrow('缺少抖音主页标识');
    expect(launch).not.toHaveBeenCalled();
  });

  it('cleans up a failed login-window setup', async () => {
    const context = new FakeContext();
    launch.mockResolvedValueOnce(context);
    cookie.mockRejectedValueOnce(new Error('credential service failed'));
    await expect(profiles.openLogin()).rejects.toThrow('抖音登录页暂不可用');
    expect(context.close).toHaveBeenCalledOnce();
  });
});
