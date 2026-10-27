import { gzipSync } from 'node:zlib';
import { describe, expect, it, beforeEach } from 'vitest';
import { LiveHub } from '../src/core/hub';
import type { LiveEvent, LiveGiftEvent } from '../src/core/live';
import { decodeDouyinMessage, resetDouyinDecode } from '../src/core/platforms/douyin/douyinDecode';
import { ackFrame, decodeFrame, decodePushFrame, heartBeatFrame } from '../src/core/platforms/douyin/douyinProto';
import { pbWrite, pbWriteBytes, pbWriteVarint } from '../src/core/protobuf';

/**
 * 抖音没有可离线回放的公开录制，所以这里按字段号手工造 protobuf 帧，
 * 断言的是"解码器理解字段的方式"。字段号本身的依据见 douyinDecode.ts 的注释。
 */

const T = 1_760_000_000; // 秒
const AT = T * 1000;

function user({ id, name, face }: { id: bigint; name: string; face?: string }) {
  const parts = [pbWriteVarint(1, id), pbWriteBytes(3, name)];
  if (face) parts.push(pbWriteBytes(9, pbWrite(pbWriteBytes(1, face))));
  return pbWrite(...parts);
}

function common({ msgId, at = T }: { msgId: number; at?: number }) {
  return pbWrite(pbWriteVarint(2, msgId), pbWriteVarint(3, 7701113878461025034n), pbWriteVarint(4, at));
}

function read(outputs: ReturnType<typeof decodeDouyinMessage>) {
  return outputs.flatMap((out) => (out.type === 'event' ? [out.event] : []));
}

beforeEach(() => resetDouyinDecode());

describe('douyin decode', () => {
  it('reads a chat message, keeping the 19-digit user id exact', () => {
    // 7351234567890123456 > Number.MAX_SAFE_INTEGER，过 Number 会变成 …456000
    const payload = pbWrite(
      pbWriteBytes(1, common({ msgId: 111 })),
      pbWriteBytes(2, user({ id: 7351234567890123456n, name: '田💕心', face: 'https://p3.douyinpic.com/a.jpg' })),
      pbWriteBytes(3, '劲道牛肉丸'),
    );
    const [event] = read(decodeDouyinMessage('WebcastChatMessage', payload));

    expect(event.kind).toBe('chat');
    expect(event.platform).toBe('douyin');
    expect(event.id).toBe('douyin:chat:111');
    expect(event.ts).toBe(AT);
    expect(event.user.id).toBe('7351234567890123456');
    expect(event.user.name).toBe('田💕心');
    expect(event.user.face).toBe('https://p3.douyinpic.com/a.jpg');
    expect(event.kind === 'chat' && event.text).toBe('劲道牛肉丸');
  });

  it('merges a gift combo by groupId and only emits the increments', () => {
    const giftOne = (repeat: number, repeatEnd = false) => pbWrite(
      pbWriteBytes(1, common({ msgId: 900 + repeat })),
      pbWriteVarint(2, 19536n),
      pbWriteVarint(5, repeat),
      pbWriteVarint(9, repeatEnd ? 1 : 0),
      pbWriteVarint(11, 555000111n),
      pbWriteBytes(7, user({ id: 42n, name: '老王' })),
      pbWriteBytes(15, pbWrite(pbWriteVarint(12, 10), pbWriteBytes(16, '小心心'))),
    );

    const events = [1, 2, 3].flatMap((n) => read(decodeDouyinMessage('WebcastGiftMessage', giftOne(n))));
    // 收尾消息的 repeatCount 和上一条一样，不该再发一次
    const tail = read(decodeDouyinMessage('WebcastGiftMessage', giftOne(3, true)));

    expect(events.map((e) => (e as LiveGiftEvent).count)).toEqual([1, 1, 1]);
    expect(events.map((e) => e.id)).toEqual(['douyin:gift:555000111', 'douyin:gift:555000111', 'douyin:gift:555000111']);
    expect(tail).toEqual([]);
    const first = events[0] as LiveGiftEvent;
    expect(first.giftName).toBe('小心心');
    expect(first.valueYuan).toBe(1); // 10 抖币 = 1 元
  });

  it('hands the combo to LiveHub, which stacks it into one gift of three', () => {
    const hub = new LiveHub();
    const seen: LiveEvent[] = [];
    hub.subscribe((event) => seen.push(event));

    for (const repeat of [1, 2, 3]) {
      const payload = pbWrite(
        pbWriteBytes(1, common({ msgId: 700 + repeat })),
        pbWriteVarint(2, 19536n),
        pbWriteVarint(5, repeat),
        pbWriteVarint(11, 777000111n),
        pbWriteBytes(7, user({ id: 42n, name: '老王' })),
        pbWriteBytes(15, pbWrite(pbWriteVarint(12, 10), pbWriteBytes(16, '小心心'))),
      );
      for (const event of read(decodeDouyinMessage('WebcastGiftMessage', payload))) hub.ingest(event, AT);
    }

    const last = seen.at(-1) as LiveGiftEvent;
    expect(seen.every((e) => e.id === 'douyin:gift:777000111')).toBe(true);
    expect(last.count).toBe(3);
    expect(last.valueYuan).toBe(3);
  });

  it('reads enter, like, follow and fans-club join', () => {
    const enter = pbWrite(pbWriteBytes(1, common({ msgId: 1 })), pbWriteBytes(2, user({ id: 7n, name: '路人甲' })), pbWriteVarint(3, 12n));
    const like = pbWrite(pbWriteBytes(1, common({ msgId: 2 })), pbWriteVarint(2, 5n), pbWriteVarint(3, 260n), pbWriteBytes(5, user({ id: 7n, name: '路人甲' })));
    const follow = pbWrite(pbWriteBytes(1, common({ msgId: 3 })), pbWriteBytes(2, user({ id: 8n, name: '新粉丝' })), pbWriteVarint(4, 1n));
    const club = pbWrite(
      pbWriteBytes(1, common({ msgId: 4 })),
      pbWriteVarint(2, 2n),
      pbWriteBytes(3, '欢迎加入粉丝团'),
      pbWriteBytes(4, user({ id: 9n, name: '团友' })),
    );

    expect(read(decodeDouyinMessage('WebcastMemberMessage', enter))[0].kind).toBe('enter');
    expect(read(decodeDouyinMessage('WebcastSocialMessage', follow))[0].kind).toBe('follow');

    const likeOut = decodeDouyinMessage('WebcastLikeMessage', like);
    expect(read(likeOut)[0].kind).toBe('like');
    expect(likeOut.find((o) => o.type === 'stats')).toEqual({ type: 'stats', stats: { likes: 260 } });

    const join = read(decodeDouyinMessage('WebcastFansclubMessage', club))[0];
    expect(join.kind).toBe('membership');
    expect(join.kind === 'membership' && join.levelName).toBe('粉丝团');
  });

  it('reads room stats and the end-of-stream control message', () => {
    const seq = pbWrite(pbWriteVarint(3, 1234n), pbWriteVarint(7, 4321n), pbWriteVarint(11, 98765n));
    expect(decodeDouyinMessage('WebcastRoomUserSeqMessage', seq)).toEqual([
      { type: 'stats', stats: { online: 1234, watched: 98765 } },
    ]);

    const stop = pbWrite(pbWriteVarint(2, 3n));
    expect(decodeDouyinMessage('WebcastControlMessage', stop)).toEqual([{ type: 'stats', stats: { live: false } }]);
  });

  it('ignores methods it does not know instead of throwing', () => {
    expect(decodeDouyinMessage('WebcastSomethingNew', Buffer.from([0x08, 0x01]))).toEqual([]);
    expect(decodeDouyinMessage('WebcastChatMessage', Buffer.from([0xff, 0xff]))).toEqual([]);
  });
});

describe('douyin frame protocol', () => {
  it('unpacks a gzip Response and reports needAck with the internalExt', () => {
    const chat = pbWrite(
      pbWriteBytes(1, common({ msgId: 55 })),
      pbWriteBytes(2, user({ id: 11n, name: '观众' })),
      pbWriteBytes(3, 'hello'),
    );
    const response = pbWrite(
      pbWriteBytes(1, pbWrite(pbWriteBytes(1, 'WebcastChatMessage'), pbWriteBytes(2, chat), pbWriteVarint(3, 55n))),
      pbWriteBytes(2, 'd-1_u-1_fh-7392091211001140287_t-1721106114633_r-1'),
      pbWriteVarint(3, 0n),
      pbWriteBytes(5, 'internal-ext-token'),
      pbWriteVarint(9, 1n),
    );
    const frame = pbWrite(pbWriteVarint(2, 88n), pbWriteBytes(7, 'msg'), pbWriteBytes(8, gzipSync(response)));

    const decoded = decodeFrame(frame);
    expect(decoded).not.toBeNull();
    expect(decoded?.frame.logId).toBe('88');
    expect(decoded?.response.needAck).toBe(true);
    expect(decoded?.response.internalExt).toBe('internal-ext-token');
    expect(decoded?.response.cursor).toBe('d-1_u-1_fh-7392091211001140287_t-1721106114633_r-1');
    expect(decoded?.response.messages.map((m) => m.method)).toEqual(['WebcastChatMessage']);

    const events = read(decodeDouyinMessage('WebcastChatMessage', decoded!.response.messages[0].payload));
    expect(events[0].kind === 'chat' && events[0].text).toBe('hello');
  });

  it('builds the heartbeat and ack frames the server expects', () => {
    expect(decodePushFrame(heartBeatFrame()).payloadType).toBe('hb');

    const ack = decodePushFrame(ackFrame('88', 'internal-ext-token'));
    expect(ack.payloadType).toBe('ack');
    expect(ack.logId).toBe('88');
    expect(ack.payload.toString('utf8')).toBe('internal-ext-token');
  });

  it('returns null for a frame it cannot parse rather than throwing', () => {
    expect(decodeFrame(Buffer.from([0xff, 0xff, 0xff]))).toBeNull();
    expect(decodeFrame(pbWriteVarint(2, 1n))).toBeNull();
  });
});
