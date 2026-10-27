/** 舞台与控制台只展示昵称的首尾字符，身份匹配仍使用原始 uid。 */
export function viewerName(name: string): string {
  const chars = Array.from(name.trim());
  if (!chars.length) return '观****众';
  return `${chars[0]}****${chars.length > 1 ? chars.at(-1) : ''}`;
}
