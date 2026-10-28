import { mkdtempSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Finance } from '../src/body/finance';
import { LiveAttention, TUNING } from '../src/core/attention/attention';
import { LiveHub } from '../src/core/hub';
import { decodeDouyinMessage, resetDouyinDecode } from '../src/core/platforms/douyin/douyinDecode';
import { pbWrite, pbWriteBytes, pbWriteVarint } from '../src/core/protobuf';
import { topicText } from '../src/core/topicText';

const AT = Date.parse('2026-10-27T22:08:40Z');
let dir = '';
beforeEach(() => {
  resetDouyinDecode();
  dir = mkdtempSync(join(tmpdir(), 'dsh-douyin-gift-'));
});
afterEach(() => {
  for (const name of readdirSync(dir)) unlinkSync(join(dir, name));
  rmdirSync(dir);
});

describe('Douyin gift timestamp through thanks and finance', () => {
  it.each(['seconds', 'milliseconds'] as const)('thanks and accounts for %s gifts, without counting a combo tail twice', (unit) => {
    const finance = new Finance(join(dir, 'finance.json'), () => ({ initialBalanceYuan: null, giftPrices: [] }));
    const attention = new LiveAttention(AT);
    const hub = new LiveHub();
    let now = AT;
    hub.subscribe((event, isUpdate) => {
      attention.observe(event, isUpdate, now);
      finance.recordLive(event, 1234);
    });
    for (const [repeat, ended] of [[1, false], [2, false], [2, true]] as const) {
      const payload = pbWrite(
        pbWriteBytes(1, pbWrite(pbWriteVarint(2, now), pbWriteVarint(4, unit === 'seconds' ? Math.floor(now / 1000) : now))),
        pbWriteVarint(2, 19536), pbWriteVarint(5, repeat), pbWriteVarint(9, ended ? 1 : 0), pbWriteVarint(11, 777),
        pbWriteBytes(7, pbWrite(pbWriteVarint(1, 42), pbWriteBytes(3, '测试观众'))),
        pbWriteBytes(15, pbWrite(pbWriteVarint(12, 1), pbWriteBytes(16, '小心心'))),
      );
      for (const output of decodeDouyinMessage('WebcastGiftMessage', payload, {}, now)) {
        if (output.type === 'event') hub.ingest(output.event, now);
      }
      now += 1000;
    }
    const topic = attention.next(now + TUNING.comboSettleMs);
    expect(topic?.kind).toBe('gifts');
    if (topic?.kind !== 'gifts') throw new Error('Gift did not reach the host');
    expect(topic.events).toHaveLength(1);
    expect(topic.events[0]).toMatchObject({ count: 2, valueYuan: 0.2 });
    const prompt = topicText(topic, {});
    expect(prompt).toContain('测试观众');
    expect(prompt).toContain('小心心');
    expect(finance.snapshot(now)).toMatchObject({ date: '2026-10-28', todayGiftYuan: 0.2 });
    expect(attention.next(now + TUNING.comboSettleMs + 1)).toBeNull();
    const reloaded = new Finance(join(dir, 'finance.json'), () => ({ initialBalanceYuan: null, giftPrices: [] }));
    expect(reloaded.snapshot(now).todayGiftYuan).toBe(0.2);
  });
});
