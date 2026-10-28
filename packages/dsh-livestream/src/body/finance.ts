import { constants, copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { turnYuan, type TurnUsage } from '../core/cost';
import type { LiveEvent } from '../core/live';
import type { GiftPrice, StageFinance } from '../stage/protocol';

interface Day {
  costYuan: number;
  giftYuan: number;
  chatGiftYuan: number;
  tokens: number;
  unpricedTokens: number;
}
interface Ledger {
  version: 1;
  days: Record<string, Day>;
  usage: Record<string, number>;
  gifts: Record<string, { yuan: number; unitYuan: number | null }>;
}
const emptyDay = (): Day => ({ costYuan: 0, giftYuan: 0, chatGiftYuan: 0, tokens: 0, unpricedTokens: 0 });
const positive = (n: unknown): number => Number.isFinite(Number(n)) ? Math.max(0, Number(n)) : 0;
const BEIJING_OFFSET_MS = 8 * 3600_000;
export const beijingDate = (at: number): string => new Date(at + BEIJING_OFFSET_MS).toISOString().slice(0, 10);

/** 旧版把毫秒又乘了 1000，日期键变成了 "+058792-04"（扩展年份截断到月份）。 */
function repairedGiftDate(key: string): string | null {
  const match = /^\+(\d{6})-(\d{2})$/.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 10_000 || month < 1 || month > 12) return null;
  // 原键只剩月份，但除以 1000 后的整个区间不到 45 分钟；只有它完全落在同一天才迁移。
  const from = (Date.UTC(year, month - 1, 1) - BEIJING_OFFSET_MS) / 1000;
  const until = (Date.UTC(year, month, 1) - BEIJING_OFFSET_MS) / 1000;
  if (!Number.isFinite(from) || !Number.isFinite(until)) return null;
  const day = beijingDate(from);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day !== beijingDate(until - 1) || day > beijingDate(Date.now())) return null;
  return day;
}

/** 只存合计和去重游标，不保存观众姓名、弹幕或凭据。 */
export class Finance {
  private ledger: Ledger = { version: 1, days: {}, usage: {}, gifts: {} };

  constructor(
    private readonly file: string,
    private readonly settings: () => { initialBalanceYuan: number | null; giftPrices: GiftPrice[] },
    private readonly changed: () => void = () => {},
  ) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as Ledger;
      if (saved.version !== 1 || !saved.days || !saved.usage || !saved.gifts) throw new Error('收支账本格式不正确');
      this.ledger = saved;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    this.repairGiftDates();
  }

  snapshot(at = Date.now()): StageFinance {
    const date = beijingDate(at);
    const day = this.ledger.days[date] ?? emptyDay();
    const days = Object.values(this.ledger.days);
    const totalCostYuan = days.reduce((sum, d) => sum + d.costYuan, 0);
    const initial = this.settings().initialBalanceYuan;
    return {
      date, todayCostYuan: day.costYuan, totalCostYuan,
      balanceYuan: initial === null ? null : initial - totalCostYuan,
      todayGiftYuan: day.giftYuan, todayChatGiftYuan: day.chatGiftYuan,
      todayTokens: day.tokens, unpricedTokens: days.reduce((sum, d) => sum + d.unpricedTokens, 0),
    };
  }

  /** session + seq 去重：恢复会话时补读历史不会重复扣费。DSH 的 inputTokens 是未命中的输入。 */
  recordUsage(session: string, seq: number, model: string | undefined, usage: TurnUsage & { totalTokens?: number }, at: number): void {
    const key = `session:${session}`;
    if (!Number.isFinite(seq) || seq <= (this.ledger.usage[key] ?? -1)) return;
    const u = { inputTokens: positive(usage.inputTokens), cacheReadTokens: positive(usage.cacheReadTokens), outputTokens: positive(usage.outputTokens) };
    const tokens = positive(usage.totalTokens) || u.inputTokens + u.cacheReadTokens + u.outputTokens;
    if (!tokens) return;
    this.ledger.usage[key] = seq;
    const day = this.day(at);
    day.tokens += tokens;
    const yuan = turnYuan(model, u, at);
    if (yuan === null) day.unpricedTokens += tokens; else day.costYuan += yuan;
    this.save();
  }

  /** 只接收真实直播事件；模拟事件在这里也挡一次。礼物同 id 的累计金额只记差额。 */
  recordLive(event: LiveEvent, room: number | null): void {
    if (event.user.id.startsWith('sim-')) return;
    if (!['gift', 'chat', 'superchat', 'membership'].includes(event.kind)) return;
    const source = event.kind === 'chat' ? 'chat' : 'gift';
    const key = `${event.platform}:${room ?? ''}:${event.kind}:${event.id}`;
    const previous = this.ledger.gifts[key];
    if (event.kind === 'chat' && previous) return;
    const name = event.kind === 'chat' ? event.text.trim() : event.kind === 'gift' ? event.giftName.trim() : '';
    const rule = name ? this.settings().giftPrices.find((r) => r.source === source && r.name === name) : undefined;
    if (event.kind === 'chat' && !rule) return;
    // 一次连击沿用第一条事件的单价；改设置只影响之后的新礼物。
    const unitYuan = previous ? previous.unitYuan : rule?.yuan ?? null;
    const yuan = event.kind === 'chat' ? positive(unitYuan)
      : event.kind === 'gift' && unitYuan !== null ? positive(event.count) * positive(unitYuan)
        : 'valueYuan' in event ? positive(event.valueYuan) : 0;
    const delta = Math.max(0, yuan - (previous?.yuan ?? 0));
    if (!delta && previous) return;
    this.ledger.gifts[key] = { yuan: Math.max(yuan, previous?.yuan ?? 0), unitYuan };
    if (delta) {
      const day = this.day(event.ts);
      if (source === 'chat') day.chatGiftYuan += delta; else day.giftYuan += delta;
    }
    this.save();
  }

  private day(at: number): Day {
    return this.ledger.days[beijingDate(at)] ??= emptyDay();
  }

  private repairGiftDates(): void {
    const repairs = Object.entries(this.ledger.days).flatMap(([from, day]) => {
      const to = repairedGiftDate(from);
      // 只修复纯礼物账；不猜测成本、用量或无法确定日期的记录。
      if (!to || day.costYuan !== 0 || day.tokens !== 0 || day.unpricedTokens !== 0
        || !Number.isFinite(day.giftYuan) || day.giftYuan < 0
        || !Number.isFinite(day.chatGiftYuan) || day.chatGiftYuan < 0) return [];
      return [{ from, to, day }];
    });
    if (!repairs.length) return;
    try {
      copyFileSync(this.file, `${this.file}.before-douyin-time-fix.bak`, constants.COPYFILE_EXCL);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    for (const { from, to, day } of repairs) {
      const target = this.ledger.days[to] ??= emptyDay();
      target.giftYuan += day.giftYuan;
      target.chatGiftYuan += day.chatGiftYuan;
      delete this.ledger.days[from];
    }
    // 构造时宿主的 finance 变量尚未赋值，不能触发引用它的 changed 回调。
    this.save(false);
  }

  private save(notify = true): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.ledger));
    renameSync(`${this.file}.tmp`, this.file);
    if (notify) this.changed();
  }
}
