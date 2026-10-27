import { describe, expect, it } from 'vitest';
import { DouyinLiveSource } from '../src/core/platforms/douyin/douyinSource';
import type { LiveSourceListener } from '../src/core/platforms/source';
import type { LiveEvent } from '../src/core/live';

/**
 * 真连一次抖音直播间。默认跳过：要联网、要抖音又没改协议，不适合放进日常测试。
 *
 * 复验方法（挑一个正在直播的房间）：
 *   DSH_DOUYIN_E2E_ROOM=42647162882 pnpm test
 * 可选 DSH_DOUYIN_COOKIE="ttwid=…; sessionid_ss=…" 验证登录态下能收到礼物。
 */
const room = Number(process.env.DSH_DOUYIN_E2E_ROOM ?? 0);

describe.runIf(Number.isInteger(room) && room > 0)('douyin live source (needs network)', () => {
  it('connects, receives events and reports the room as live', async () => {
    const events: LiveEvent[] = [];
    const kinds = new Set<string>();
    const states: string[] = [];
    let live = false;

    const listener: LiveSourceListener = {
      event: (event) => {
        events.push(event);
        kinds.add(event.kind);
      },
      stats: (stats) => {
        if (stats.live !== undefined) live = stats.live;
      },
      room: () => {},
      state: (state) => states.push(state),
    };

    const source = new DouyinLiveSource(room, process.env.DSH_DOUYIN_COOKIE ?? '');
    source.start(listener);
    await new Promise((resolve) => setTimeout(resolve, 20_000));
    source.stop();

    expect(states).toContain('connected');
    expect(events.length).toBeGreaterThan(0);
    expect(live).toBe(true);
    // 匿名连接也一定能收到弹幕或进场（礼物要登录态，不在这里断言）
    expect([...kinds].some((k) => k === 'chat' || k === 'enter')).toBe(true);
  }, 40_000);
});
