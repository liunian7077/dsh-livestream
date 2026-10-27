/**
 * 「点歌」指令解析。
 *
 * 认的写法（都以「点歌」开头，全角空格和大小写都宽松处理）：
 *   点歌 晴天
 *   点歌 晴天 周杰伦        ← 空格分隔：前面是歌名，后面是歌手
 *   点歌 晴天--周杰伦       ← 双减号分隔（——、--、— 都认）
 *   点歌：晴天 - 周杰伦
 *
 * 歌名/歌手都可能带空格（英文歌名尤其），所以分隔符只认两种：
 * 明确的减号分隔符，或者「第一个空白」之后全算歌手。都不满足就是只有歌名。
 */

export interface SongQuery {
  /** 歌名（去掉指令和歌手） */
  title: string;
  /** 歌手；没写就没有 */
  artist?: string;
  /** 「点歌」后面那段的原文，日志和提示里用 */
  raw: string;
}

/** 歌名和歌手各自最多这么长：弹幕一条本来就不长，超出的部分多半不是歌名 */
const MAX_PART = 40;

/** 指令头：点歌 / 點歌，允许后面跟标点 */
const LEAD = /^[点點]歌/;

/** 没带歌名的「点歌」也属于指令，不交给普通聊天去搜视频。 */
export function isSongCommand(text: string): boolean {
  return LEAD.test(text.trim());
}

export function parseSongRequest(text: string): SongQuery | null {
  if (!text) return null;
  // 全角空格、不可见字符先归一
  const clean = text.replace(/[\u3000\u00a0]/g, ' ').trim();
  if (!isSongCommand(clean)) return null;

  const rest = clean
    .replace(LEAD, '')
    .trim()
    // 「点歌：」「点歌，」「点歌!」这类标点
    .replace(/^[：:，,、。.!！?？~～\-—\s]+/, '')
    .trim();
  if (!rest) return null;

  // 减号分隔：两个及以上的 - 或 —，两边可以有空格
  const byDash = rest.split(/\s*[-—]{2,}\s*/).map((s) => s.trim()).filter(Boolean);
  if (byDash.length >= 2) {
    const title = byDash[0].slice(0, MAX_PART);
    const artist = byDash.slice(1).join(' ').slice(0, MAX_PART);
    return title ? { title, artist, raw: rest } : null;
  }

  // 空格分隔：第一个词是歌名，后面全是歌手
  const parts = rest.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return { title: parts[0].slice(0, MAX_PART), artist: parts.slice(1).join(' ').slice(0, MAX_PART), raw: rest };
  }

  return { title: rest.slice(0, MAX_PART), raw: rest };
}

/** 给提示词/日志看的一行描述 */
export function describeSongQuery(query: SongQuery): string {
  return query.artist ? `${query.title} — ${query.artist}` : query.title;
}
