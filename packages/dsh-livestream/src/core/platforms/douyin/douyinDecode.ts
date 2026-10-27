/**
 * 抖音弹幕消息（webcast.im 的 method）→ 统一直播事件。
 *
 * 字段号来自抖音 webcast 的 protobuf 定义（没有公开 .proto，按字段号取）：
 *
 *   Common       1 method, 2 msgId, 3 roomId, 4 createTime(秒)
 *   User         1 id, 3 nickName, 9 avatarThumb{1 urlList}, 23 payGrade,
 *                24 fansClub{1 data{1 clubName, 2 level, 6 anchorId}}, 38 displayId, 46 secUid, 1028 idStr
 *   ChatMessage  2 user, 3 content
 *   GiftMessage  2 giftId, 5 repeatCount, 6 comboCount, 7 user, 9 repeatEnd, 11 groupId,
 *                15 gift{2 describe, 12 diamondCount, 16 name}
 *   MemberMessage 2 user, 3 memberCount
 *   LikeMessage  2 count, 3 total, 5 user
 *   SocialMessage 2 user, 4 action
 *   RoomUserSeqMessage 3 total, 7 totalUser, 11 totalPvForAnchor
 *   ControlMessage 2 status（3 是下播）
 *   FansclubMessage 2 type（2 是加入）, 3 content, 4 user
 *
 * 金额：diamondCount 是每份的抖币数，10 抖币 = 1 元，所以 valueYuan = diamondCount × 份数 ÷ 10。
 * 这和 B 站 giftValueYuan 是同一口径（面值，不是主播到手）。
 *
 * 连击：同一次送礼会推多条 WebcastGiftMessage —— msgId 各不相同、groupId 相同，
 * 末尾还有一条 repeatEnd=1 的收尾消息。这里按 groupId 记上次的 repeatCount，只发增量，
 * 事件 id 用 groupId，交给 LiveHub 按 id 合并（见 core/hub.ts）。
 */

import type { LiveEvent, LiveRoomStats, LiveUser } from '../../live';
import { pbBool, pbChild, pbId, pbNumber, pbString, readPb } from '../../protobuf';

export interface DouyinRoomContext {
  /** 内部 room_id（19 位），不进事件，只用于日志 */
  roomId?: string;
  /** 主播 id，用来判断粉丝团是不是本直播间的 */
  anchorId?: string;
}

export type DouyinOutput =
  | { type: 'event'; event: LiveEvent }
  | { type: 'stats'; stats: Partial<LiveRoomStats> };

/** 10 抖币 = 1 元 */
const DIAMOND_PER_YUAN = 10;

let seq = 0;
const nextId = (prefix: string) => `douyin:${prefix}:${Date.now().toString(36)}${(++seq).toString(36)}`;

/** 连击进度：groupId → 上次已发的份数。只留最近一分钟内的 */
const combos = new Map<string, { count: number; at: number }>();

function pruneCombos(now: number): void {
  for (const [key, value] of combos) {
    if (now - value.at > 60_000) combos.delete(key);
  }
}

/** 测试用：清掉跨用例的连击状态 */
export function resetDouyinDecode(): void {
  combos.clear();
  seq = 0;
}

function userOf(msg: Map<number, Array<bigint | Buffer>> | undefined, common: Map<number, Array<bigint | Buffer>> | undefined, ctx: DouyinRoomContext, field = 2): LiveUser {
  const user = pbChild(msg, field) ?? pbChild(common, 15);
  // idStr 是字符串形式，避免 19 位 id 过 Number 时丢精度
  const id = pbString(user, 1028) || pbId(user, 1);
  const out: LiveUser = { id, name: pbString(user, 3) || '观众' };
  const secUid = pbString(user, 46);
  if (secUid) out.secUid = secUid;
  const avatar = pbChild(user, 9);
  const face = avatar ? pbString(avatar, 1) : '';
  if (face) out.face = face;

  const club = pbChild(pbChild(user, 24), 1);
  const clubName = pbString(club, 1);
  const clubLevel = pbNumber(club, 2);
  if (clubName && clubLevel) {
    const owner = pbId(club, 6);
    out.medal = { name: clubName, level: clubLevel, ofThisRoom: !ctx.anchorId || !owner || owner === ctx.anchorId };
  }
  return out;
}

/** common.createTime 是秒；缺了就用本地时间 */
function tsOf(common: Map<number, Array<bigint | Buffer>> | undefined, now: number): number {
  const seconds = pbNumber(common, 4);
  return seconds > 0 ? seconds * 1000 : now;
}

function base<K extends LiveEvent['kind']>(kind: K, id: string, user: LiveUser, ts: number) {
  return { id, kind, platform: 'douyin' as const, ts, user };
}

function chat(msg: Map<number, Array<bigint | Buffer>>, common: Map<number, Array<bigint | Buffer>>, ctx: DouyinRoomContext, now: number): LiveEvent | null {
  const text = pbString(msg, 3);
  if (!text) return null;
  const id = pbId(common, 2) ? `douyin:chat:${pbId(common, 2)}` : nextId('chat');
  return { ...base('chat', id, userOf(msg, common, ctx), tsOf(common, now)), text } as LiveEvent;
}

/** 表情包弹幕：只有默认文案，没有可用的图地址就不当表情处理 */
function emojiChat(msg: Map<number, Array<bigint | Buffer>>, common: Map<number, Array<bigint | Buffer>>, ctx: DouyinRoomContext, now: number): LiveEvent | null {
  const text = pbString(msg, 5) || pbString(pbChild(msg, 4), 2);
  if (!text) return null;
  const id = pbId(common, 2) ? `douyin:chat:${pbId(common, 2)}` : nextId('chat');
  return { ...base('chat', id, userOf(msg, common, ctx), tsOf(common, now)), text, emoteOnly: true } as LiveEvent;
}

function gift(msg: Map<number, Array<bigint | Buffer>>, common: Map<number, Array<bigint | Buffer>>, ctx: DouyinRoomContext, now: number): LiveEvent | null {
  const info = pbChild(msg, 15);
  const name = pbString(info, 16) || pbString(info, 2);
  if (!name) return null;

  const giftId = pbId(msg, 2) || pbId(info, 5);
  const groupId = pbId(msg, 11);
  const repeat = pbNumber(msg, 5) || pbNumber(msg, 6) || 1;
  const ended = pbBool(msg, 9);

  // 连击：只发比上次多的份数；收尾消息和重复消息直接丢掉
  const key = groupId || `${giftId}:${pbId(common, 2)}`;
  const prev = combos.get(key);
  const delta = prev && repeat >= prev.count ? repeat - prev.count : repeat;
  if (delta <= 0) return null;
  combos.set(key, { count: repeat, at: now });
  pruneCombos(now);

  const diamondCount = pbNumber(info, 12);
  const valueYuan = Math.round(diamondCount * delta) / DIAMOND_PER_YUAN;
  const id = `douyin:gift:${key}`;
  return {
    ...base('gift', id, userOf(msg, common, ctx, 7), tsOf(common, now)),
    giftName: name,
    count: delta,
    valueYuan: Math.round(valueYuan * 1000) / 1000,
  } as LiveEvent;
}

function member(msg: Map<number, Array<bigint | Buffer>>, common: Map<number, Array<bigint | Buffer>>, ctx: DouyinRoomContext, now: number): LiveEvent | null {
  const id = pbId(common, 2) ? `douyin:enter:${pbId(common, 2)}` : nextId('enter');
  return { ...base('enter', id, userOf(msg, common, ctx), tsOf(common, now)) } as LiveEvent;
}

function like(msg: Map<number, Array<bigint | Buffer>>, common: Map<number, Array<bigint | Buffer>>, ctx: DouyinRoomContext, now: number): LiveEvent | null {
  const id = pbId(common, 2) ? `douyin:like:${pbId(common, 2)}` : nextId('like');
  return { ...base('like', id, userOf(msg, common, ctx, 5), tsOf(common, now)) } as LiveEvent;
}

/** action：1 关注、2 分享。其余（比如 3）先当关注 —— 抖音只推这两种 */
function social(msg: Map<number, Array<bigint | Buffer>>, common: Map<number, Array<bigint | Buffer>>, ctx: DouyinRoomContext, now: number): LiveEvent | null {
  const action = pbNumber(msg, 4);
  const kind = action === 2 ? 'share' : 'follow';
  const id = pbId(common, 2) ? `douyin:${kind}:${pbId(common, 2)}` : nextId(kind);
  return { ...base(kind, id, userOf(msg, common, ctx), tsOf(common, now)) } as LiveEvent;
}

function membership(msg: Map<number, Array<bigint | Buffer>>, common: Map<number, Array<bigint | Buffer>>, ctx: DouyinRoomContext, now: number): LiveEvent | null {
  if (pbNumber(msg, 2) !== 2) return null; // 只要「加入」，升级不入事件
  const user = userOf(msg, common, ctx, 4);
  const id = pbId(common, 2) ? `douyin:fansclub:${pbId(common, 2)}` : nextId('fansclub');
  return {
    ...base('membership', id, user, tsOf(common, now)),
    levelName: '粉丝团',
    level: user.medal?.level ?? 0,
    count: 1,
    valueYuan: 0,
  } as LiveEvent;
}

/**
 * 一条 webcast 消息 → 事件 / 统计。
 * 认不出的 method 返回空数组：抖音的消息类型很多，未知的直接忽略好过报错。
 */
export function decodeDouyinMessage(method: string, payload: Buffer, ctx: DouyinRoomContext = {}, now = Date.now()): DouyinOutput[] {
  let msg: Map<number, Array<bigint | Buffer>>;
  try {
    msg = readPb(payload);
  } catch {
    return [];
  }
  const common = pbChild(msg, 1);

  switch (method) {
    case 'WebcastChatMessage': {
      const event = chat(msg, common ?? msg, ctx, now);
      return event ? [{ type: 'event', event }] : [];
    }
    case 'WebcastEmojiChatMessage': {
      const event = emojiChat(msg, common ?? msg, ctx, now);
      return event ? [{ type: 'event', event }] : [];
    }
    case 'WebcastGiftMessage': {
      const event = gift(msg, common ?? msg, ctx, now);
      return event ? [{ type: 'event', event }] : [];
    }
    case 'WebcastMemberMessage': {
      const event = member(msg, common ?? msg, ctx, now);
      return event ? [{ type: 'event', event }] : [];
    }
    case 'WebcastLikeMessage': {
      const event = like(msg, common ?? msg, ctx, now);
      const out: DouyinOutput[] = event ? [{ type: 'event', event }] : [];
      const total = pbNumber(msg, 3);
      if (total > 0) out.push({ type: 'stats', stats: { likes: total } });
      return out;
    }
    case 'WebcastSocialMessage': {
      const event = social(msg, common ?? msg, ctx, now);
      return event ? [{ type: 'event', event }] : [];
    }
    case 'WebcastFansclubMessage': {
      const event = membership(msg, common ?? msg, ctx, now);
      return event ? [{ type: 'event', event }] : [];
    }
    case 'WebcastRoomUserSeqMessage': {
      const stats: Partial<LiveRoomStats> = {};
      // total 是当前在线（protobuf 的缺省值为 0）；totalUser 是累计人数，不能拿来补在线人数。
      stats.online = pbNumber(msg, 3);
      const watched = pbNumber(msg, 11) || pbNumber(msg, 7);
      if (watched > 0) stats.watched = watched;
      return Object.keys(stats).length ? [{ type: 'stats', stats }] : [];
    }
    case 'WebcastControlMessage': {
      // status 3 是下播
      return [{ type: 'stats', stats: { live: pbNumber(msg, 2) !== 3 } }];
    }
    default:
      return [];
  }
}
