/**
 * 网易云音乐：公开搜索接口 + 当前账号有权播放的音频地址。
 *
 * 搜索走网页版的公开搜索接口（不需要登录、不需要 cookie）：
 *   GET https://music.163.com/api/search/get/?s=<关键词>&type=1&limit=N
 * 返回 result.songs[]：{ id, name, artists[{name}], album.name, duration(ms), alias[] }。
 *
 * 音频由舞台服务器转发给 OBS 浏览器源，实际播放状态由舞台回传。
 */

import type { SongQuery } from '../core/songRequest';
import { isRestrictedSong, SONG_RESTRICTION_MESSAGE } from '../core/songPolicy';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const SEARCH_URL = 'https://music.163.com/api/search/get/';
const PLAYER_URL = 'https://music.163.com/api/song/enhance/player/url';
export const NETEASE_HEADERS = { 'User-Agent': UA, Referer: 'https://music.163.com/' };
const TIMEOUT_MS = 8_000;
/** 歌名必须像到这个程度才算「搜到了」，否则当没有这首歌 */
const TITLE_THRESHOLD = 0.8;

export interface NeteaseSong {
  /** 网易云的歌曲 id（数字，用字符串装） */
  id: string;
  name: string;
  aliases?: string[];
  artists: string[];
  album: string;
  durationMs: number;
}

export interface SongMatch extends NeteaseSong {
  /** 相似度 0～1，越大越像 */
  score: number;
}

interface RawSong {
  id?: number | string;
  name?: string;
  alias?: string[];
  duration?: number;
  artists?: Array<{ name?: string }>;
  album?: { name?: string };
}

/** 归一化：全角转半角、去掉空白和标点、小写。比较歌名/歌手都走它 */
export function normalizeName(text: string): string {
  return text
    .replace(/[\uff01-\uff5e]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s\u3000]+/g, '')
    .replace(/[()（）[\]【】《》<>'"“”‘’·・.,，。!！?？~～\-—_/\\|:+*&^%$#@]/g, '')
    .toLowerCase();
}

/** 一个名字像不像：完全一样 1，前缀/后缀包住 0.9，包含 0.75，否则 0 */
function similarity(asked: string, actual: string): number {
  const a = normalizeName(asked);
  const b = normalizeName(actual);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (b.startsWith(a) || a.startsWith(b)) return 0.9;
  if (b.includes(a) || a.includes(b)) return 0.75;
  return 0;
}

/**
 * 在搜索结果里挑最像的一首。
 *
 * 歌名权重高（0.8），歌手作为加分项（0.2）：观众点「晴天 周杰伦」而网易云没有周杰伦的版本时，
 * 会选到同名翻唱而不是「没这首歌」——这不是猜，是平台确实只有这些；念的时候会把真实歌手说出来。
 */
export function pickSong(songs: NeteaseSong[], query: SongQuery): SongMatch | null {
  let best: SongMatch | null = null;
  for (const song of songs) {
    // 歌名可能带「(深情版)」这种后缀，也可能观众把歌手一起写进了歌名，两种都试
    const nameScore = Math.max(
      similarity(query.title, song.name),
      query.artist ? similarity(`${query.title} ${query.artist}`, song.name) * 0.95 : 0,
    );
    if (nameScore < TITLE_THRESHOLD) continue;
    const artistScore = query.artist
      ? Math.max(...song.artists.map((a) => similarity(query.artist!, a)), 0)
      : 0;
    const score = nameScore * 0.8 + artistScore * 0.2;
    if (!best || score > best.score) best = { ...song, score };
  }
  return best;
}

/** 搜索候选（按关键词）；网络/接口失败抛错，由上层决定说什么 */
export async function searchSongs(keyword: string, limit = 10, cookie = ''): Promise<NeteaseSong[]> {
  const url = `${SEARCH_URL}?s=${encodeURIComponent(keyword)}&type=1&limit=${Math.max(1, Math.min(30, limit))}&offset=0`;
  const res = await fetch(url, {
    headers: { ...NETEASE_HEADERS, Accept: 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`网易云搜索失败（HTTP ${res.status}）`);
  const body = (await res.json()) as { code?: number; result?: { songs?: RawSong[] } };
  if (body.code !== undefined && body.code !== 200) throw new Error(`网易云搜索失败（code=${body.code}）`);
  return (body.result?.songs ?? []).flatMap((s): NeteaseSong[] => {
    const id = s.id === undefined ? '' : String(s.id);
    const name = (s.name ?? '').trim();
    if (!id || !name) return [];
    const aliases = Array.isArray(s.alias) ? s.alias.filter((a): a is string => typeof a === 'string' && !!a.trim()) : [];
    return [{
      id,
      name,
      ...(aliases.length ? { aliases } : {}),
      artists: (s.artists ?? []).map((a) => (a.name ?? '').trim()).filter(Boolean),
      album: (s.album?.name ?? '').trim(),
      durationMs: Number(s.duration) || 0,
    }];
  });
}

/** 搜一首歌：返回最像的那首，没有像的就 null */
export async function findSong(query: SongQuery, cookie = ''): Promise<SongMatch | null> {
  // 有歌手时一起搜，平台会按相关度排；同一个关键词搜一次就够
  const keyword = query.artist ? `${query.title} ${query.artist}` : query.title;
  const songs = await searchSongs(keyword, 10, cookie);
  return pickSong(songs, query);
}

/** 网易云的 orpheus 深链：只能把客户端叫到前台并打开歌曲页，不保证开始播放 */
export function songUrl(songId: string): string {
  return `orpheus://song/${songId}`;
}

/** 网易云歌曲的网页地址。 */
export function webSongUrl(songId: string): string {
  return `https://music.163.com/#/song?id=${songId}`;
}

/** 取完整音频；没有权限或只有试听时明确报错，不把试听当整首播放。 */
export async function resolveSong(song: NeteaseSong, cookie = ''): Promise<string> {
  if (isRestrictedSong(song)) throw new Error(SONG_RESTRICTION_MESSAGE);
  if (!/^\d+$/.test(song.id)) throw new Error('网易云歌曲编号无效');
  const url = `${PLAYER_URL}?ids=${encodeURIComponent(JSON.stringify([song.id]))}&br=128000`;
  const res = await fetch(url, {
    headers: { ...NETEASE_HEADERS, Accept: 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`网易云音源获取失败（HTTP ${res.status}）`);
  const body = await res.json() as {
    code?: number;
    data?: Array<{ id?: number | string; code?: number; url?: string | null; freeTrialInfo?: unknown }>;
  };
  const track = body.data?.find((item) => String(item.id) === song.id);
  if (body.code !== 200 || !track?.url || (track.code !== undefined && track.code !== 200)) {
    throw new Error('这首歌没有可播放音源，请检查网易云登录、会员权限或版权');
  }
  if (track.freeTrialInfo != null) throw new Error('这首歌只返回了试听片段，需要有播放权限的网易云账号');
  const source = new URL(track.url);
  if (source.protocol === 'http:') source.protocol = 'https:';
  if (source.protocol !== 'https:') throw new Error('网易云返回的音频地址无效');
  return source.href;
}

/** 展示用的搜索关键词。 */
export function searchKeyword(song: Pick<NeteaseSong, 'name' | 'artists'>): string {
  const artist = song.artists[0]?.trim();
  return artist ? `${song.name} ${artist}` : song.name;
}
