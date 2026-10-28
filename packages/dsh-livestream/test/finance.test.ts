import { existsSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beijingDate, Finance } from '../src/body/finance';

const AT = Date.parse('2026-10-27T22:08:40Z');
const DAY = '2026-10-28';
const BAD_DAY = '+058792-04';
const zero = { costYuan: 0, giftYuan: 0, chatGiftYuan: 0, tokens: 0, unpricedTokens: 0 };
const settings = () => ({ initialBalanceYuan: 10, giftPrices: [] });
let dir = '';
let file = '';
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AT);
  dir = mkdtempSync(join(tmpdir(), 'dsh-finance-date-'));
  file = join(dir, 'finance.json');
});
afterEach(() => {
  vi.useRealTimers();
  for (const name of readdirSync(dir)) unlinkSync(join(dir, name));
  rmdirSync(dir);
});

describe('repair legacy Douyin gift dates', () => {
  it('backs up and restores the gift amount to its day without altering usage or deduplication', () => {
    const giftId = 'douyin:1234:gift:douyin:gift:777';
    const original = JSON.stringify({
      version: 1,
      days: {
        [DAY]: { ...zero, costYuan: 0.08, giftYuan: 1, tokens: 1200 },
        [BAD_DAY]: { ...zero, giftYuan: 0.4, chatGiftYuan: 0.2 },
      },
      usage: { 'session:one': 7 },
      gifts: { [giftId]: { yuan: 0.4, unitYuan: null } },
    });
    writeFileSync(file, original);
    const changed = vi.fn();
    const finance = new Finance(file, settings, changed);
    expect(changed).not.toHaveBeenCalled();
    expect(finance.snapshot()).toMatchObject({ date: DAY, todayGiftYuan: 1.4, todayChatGiftYuan: 0.2, todayCostYuan: 0.08, todayTokens: 1200, balanceYuan: 9.92 });
    expect(readFileSync(`${file}.before-douyin-time-fix.bak`, 'utf8')).toBe(original);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved.days[BAD_DAY]).toBeUndefined();
    expect(saved.usage).toEqual({ 'session:one': 7 });
    expect(saved.gifts[giftId]).toEqual({ yuan: 0.4, unitYuan: null });
    // Reloading and receiving the same gift cannot credit it again.
    const reloaded = new Finance(file, settings);
    reloaded.recordLive({ id: 'douyin:gift:777', kind: 'gift', platform: 'douyin', ts: AT, user: { id: '42', name: '观众' }, giftName: '小心心', count: 4, valueYuan: 0.4 }, 1234);
    expect(reloaded.snapshot().todayGiftYuan).toBe(1.4);
    expect(readFileSync(`${file}.before-douyin-time-fix.bak`, 'utf8')).toBe(original);
  });

  it('does not guess the day when the recovered interval crosses Beijing midnight', () => {
    const ambiguous = beijingDate(Date.parse('2026-10-27T16:00:00Z') * 1000);
    const original = JSON.stringify({ version: 1, days: { [ambiguous]: { ...zero, giftYuan: 1 } }, usage: {}, gifts: {} });
    writeFileSync(file, original);
    new Finance(file, settings);
    expect(readFileSync(file, 'utf8')).toBe(original);
    expect(existsSync(`${file}.before-douyin-time-fix.bak`)).toBe(false);
  });

  it.each([
    [DAY, { ...zero, giftYuan: 1 }],
    [BAD_DAY, { ...zero, giftYuan: 1, costYuan: 0.1 }],
    ['+999999-12', { ...zero, giftYuan: 1 }],
    ['+058792-99', { ...zero, giftYuan: 1 }],
  ])('leaves normal or unrecognised ledger entries untouched: %s', (key, day) => {
    const original = JSON.stringify({ version: 1, days: { [key]: day }, usage: {}, gifts: {} });
    writeFileSync(file, original);
    new Finance(file, settings);
    expect(readFileSync(file, 'utf8')).toBe(original);
  });
});
