/**
 * DeepSeek V4.1 Flash 官方人民币定价，2026-10-27 核实：
 * https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
 * 只认得 deepseek-flash；别的模型只报 token，不报钱。
 */

/** 元 / 百万 token，高峰时段；空闲时段五折 */
const FLASH = { cacheHit: 0.04, miss: 2, output: 8 };
/** 2026 放假日期：国办发明电〔2025〕7号；新年度须更新日历。周末调休上班仍按周末空闲价。 */
const HOLIDAYS = [
  ['2026-01-01', '2026-01-03'], ['2026-02-15', '2026-02-23'], ['2026-04-04', '2026-04-06'],
  ['2026-05-01', '2026-05-05'], ['2026-06-19', '2026-06-21'], ['2026-09-25', '2026-09-27'], ['2026-10-01', '2026-10-07'],
];
/** 豆包语音合成 2.0、声音复刻 2.0：元 / 万字 */
const TTS_YUAN_PER_10K_CHARS = 3;

/** 高峰时段：北京时间周一到周五 9–12 点、14–18 点，节假日除外。 */
export function isPeak(ms: number): boolean {
  const beijing = new Date(ms + 8 * 3600_000);
  const day = beijing.getUTCDay();
  const h = beijing.getUTCHours();
  const date = beijing.toISOString().slice(0, 10);
  return !HOLIDAYS.some(([from, to]) => date >= from && date <= to) && day >= 1 && day <= 5 && ((h >= 9 && h < 12) || (h >= 14 && h < 18));
}

export interface TurnUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
}

/** 一次请求花了多少元；不认得的模型返回 null */
export function turnYuan(model: string | undefined, usage: TurnUsage, at: number): number | null {
  if (!model || !['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'].includes(model.split('/').at(-1)!.toLowerCase())) return null;
  const k = isPeak(at) ? 1 : 0.5;
  return k * ((usage.cacheReadTokens ?? 0) * FLASH.cacheHit + (usage.inputTokens ?? 0) * FLASH.miss + (usage.outputTokens ?? 0) * FLASH.output) / 1e6;
}

export function ttsYuan(chars: number): number {
  return (chars / 10_000) * TTS_YUAN_PER_10K_CHARS;
}
