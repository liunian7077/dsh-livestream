import type { SongQuery } from './songRequest';
import { HISTORICAL_RESTRICTED_SONGS } from './restrictedSongs2015';

/** 娱乐直播点歌的本地限制；仅按名称/别名判断，不是音频内容识别。 */
export const SONG_RESTRICTION_MESSAGE = '这首歌不开放点播，请换一首。';

/** 主人指定的本地娱乐点歌限制，独立于 2015 年官方历史名单；不限定歌手。 */
const LOCAL_RESTRICTED_SONG_NAMES = ['八连杀', '8连杀', 'baliansha', '8liansha'];

// 覆盖本地名单中常见的繁体字形；不依赖在线转换或在线名单服务。
const traditional = new Map(
  ('國国 義义 軍军 進进 師师 陰阴 兒儿 報报 沒没 說说 錢钱 瘋疯 憑凭 麼么 買买 單单 燒烧 這这 條条 龍龙 宮宫 請请 '
    + '組组 們们 覺觉 學学 髒脏 殺杀 記记 餅饼 愛爱 顏颜 韻韵 膿脓 來来 嗎吗 謠谣 樂乐 隊队 區区 裡里 裏里 級级 車车 '
    + '趙赵 敗败 類类 網网 絡络 飛飞 別别 馬马 東东 無无 賤贱 習习 對对 恥耻 亂乱 綠绿 絕绝 蘇苏 誘诱 鍾钟 鐘钟 潔洁 '
    + '漁渔 劉刘 縱纵 慾欲 費费 鄺邝 陸陆 歐欧 陽阳 瑩莹 烏乌 諾诺 壞坏 虛虚 侶侣 黃黄 連连 開开 媽妈 會会 褲裤 體体 '
    + '過过 舉举 讓让 瑣琐 個个 處处 節节 張张 嶽岳 搖摇 頭头 許许 幫帮 補补 歲岁 騷骚 麥麦 經经 廳厅 現现 場场 寫写 '
    + '給给 話话 藥药 膠胶 鳩鸠 懶懒 強强 瀋沈 聲声 羅罗 寶宝 貝贝 動动 為为 鐵铁 夢梦 數数 熱热')
    .split(' ').map((pair) => [pair[0], pair[1]]),
);

function normalized(text: string): string {
  return text.normalize('NFKD').toLowerCase()
    .replace(/./gu, (char) => traditional.get(char) ?? char)
    .replace(/[^\p{Letter}\p{Number}]/gu, '');
}

/** 同时覆盖简繁体、空格/标点/零宽字符拆字、常见英文与拼音名称。 */
export function isRestrictedSongName(text: string): boolean {
  const key = normalized(text);
  // 同名翻唱、伴奏、DJ 版本和 API 返回的别名同样限制，不因换歌手而放行。
  if (LOCAL_RESTRICTED_SONG_NAMES.some((name) => key.includes(name))) return true;
  // 军歌仅限制这首有特殊用途的作品，不按「军歌」「进行曲」泛化到整个曲风。
  return /国歌|义勇军进行曲|marchof(?:the)?volunteers|yiyongjunjinxingqu|nationalanthemof(?:thepeoplesrepublicof)?china|中国人民解放军(?:军歌|进行曲)|(?:marchofthepeoplesliberationarmymarch|peoplesliberationarmymarch)/.test(key);
}

function artistKey(text: string): string {
  const key = normalized(text);
  return ['mchotdog', 'hotdog', '哈狗帮', '热狗'].includes(key) ? 'mchotdog' : key;
}

/** 仅剥离常见版本后缀，不把短歌名当子串匹配（例如「爽」不会匹配「爽快」）。 */
function titleKeys(text: string): Set<string> {
  let key = normalized(text);
  const keys = new Set([key]);
  for (;;) {
    const base = key.replace(/(?:live|remix|dj|伴奏|纯音乐|纯享|翻唱|现场|演唱会|原唱|原版|完整版|加速|降速|慢速|加长)(?:版|版本)?$/, '');
    if (!base || base === key) return keys;
    keys.add(base);
    key = base;
  }
}

const historicalRules = HISTORICAL_RESTRICTED_SONGS.map((song) => ({
  // 原公告在两条歌名中用括号标注替代字，而非版本名。
  titles: new Set((song.title === '今晚叼胶（鸠）你'
    ? [song.title, '今晚叼胶你', '今晚叼鸠你'] : [song.title]).map(normalized)),
  artists: new Set(song.artists.filter((name) => name !== '网络歌手').map(artistKey)),
}));

function historicalMatch(name: string, artists: readonly string[], rejectUnknownArtist: boolean): boolean {
  const cover = name.match(/[（(\[【]\s*(?:cover(?:\s+by)?\s*[:：]?|原唱\s*[:：]?|翻唱\s*[:：]?)\s*([^）)\]】]+)[）)\]】]\s*$/iu);
  const titles = titleKeys(cover ? name.slice(0, cover.index) : name);
  const creditedArtists = [...artists, ...(cover ? [cover[1]] : [])]
    .flatMap((artist) => artist.split(/[/、,&+;；]/))
    .map(artistKey).filter((key) => key && key !== '网络歌手' && key !== '佚名' && key !== '未知');
  return historicalRules.some((rule) => [...titles].some((title) => rule.titles.has(title))
    && (!rule.artists.size || (!creditedArtists.length && rejectUnknownArtist)
      || creditedArtists.some((artist) => rule.artists.has(artist))));
}

export function isRestrictedSongRequest(query: SongQuery): boolean {
  // raw 保留了被解析器拆成歌名/歌手、或被长度限制截掉的部分。
  if ([query.raw, query.title, query.artist ?? '', `${query.title}${query.artist ?? ''}`]
    .some(isRestrictedSongName)) return true;
  // 未写歌手时留到搜索结果确认，避免把其他歌手的同名作品一并拒绝。
  if (historicalMatch(query.title, query.artist ? [query.artist] : [], false)) return true;
  // 英文歌名/拆字可能被解析器拆到歌手字段；原文中的完整作品+署名仍要检查。
  const raw = normalized(query.raw);
  return historicalRules.some((rule) => [...rule.titles].some((title) =>
    !rule.artists.size ? raw === title : [...rule.artists].some((artist) => raw === title + artist)));
}

export function isRestrictedSong(song: { name: string; aliases?: readonly string[]; artists?: readonly string[] }): boolean {
  return [song.name, ...(song.aliases ?? [])].some((name) => isRestrictedSongName(name)
    || historicalMatch(name, song.artists ?? [], true));
}
