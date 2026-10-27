/**
 * 抖音弹幕通道的帧格式（protobuf，字段号实测自 webcast.im 的 push/v2 连接）。
 *
 *   PushFrame  { 2 logId, 7 payloadType, 8 payload }
 *   Response   { 1 messages[] { 1 method, 2 payload, 3 msgId }, 5 internalExt, 9 needAck }
 *   Message    method 决定 payload 该按哪个消息体解，见 douyinDecode.ts
 *
 * 服务端压缩方式由连接参数 compress=gzip 决定，所以 payload 统一先解 gzip。
 * 心跳是 PushFrame{payloadType:"hb"}，ack 是 PushFrame{payloadType:"ack", payload:internalExt}，
 * 不发 ack 服务端会断流。
 */

import { gunzipSync } from 'node:zlib';
import { pbBool, pbChild, pbChildren, pbId, pbNumber, pbString, pbWrite, pbWriteBytes, pbWriteVarint, readPb } from '../../protobuf';

export interface PushFrame {
  logId: string;
  payloadType: string;
  payload: Buffer;
}

export interface PushMessage {
  method: string;
  msgId: string;
  payload: Buffer;
}

export interface Response {
  messages: PushMessage[];
  /** 必须回 ack，否则服务端会主动断开 */
  needAck: boolean;
  /** ack 的内容 */
  internalExt: string;
  cursor: string;
  /** 服务端建议的下次拉取间隔（毫秒） */
  fetchInterval: number;
}

export function decodePushFrame(buf: Buffer): PushFrame {
  const frame = readPb(buf);
  return {
    logId: pbId(frame, 2),
    payloadType: pbString(frame, 7),
    payload: (frame.get(8)?.[0] as Buffer | undefined) ?? Buffer.alloc(0),
  };
}

/** payload 是 gzip 的；解不开就当没压缩（服务端可能换压缩方式） */
function decompress(payload: Buffer): Buffer {
  if (payload.length < 2 || payload[0] !== 0x1f || payload[1] !== 0x8b) return payload;
  try {
    return gunzipSync(payload);
  } catch {
    return payload;
  }
}

export function decodeResponse(payload: Buffer): Response {
  const body = readPb(decompress(payload));
  return {
    messages: pbChildren(body, 1).map((msg) => ({
      method: pbString(msg, 1),
      msgId: pbId(msg, 3),
      payload: (msg.get(2)?.[0] as Buffer | undefined) ?? Buffer.alloc(0),
    })),
    needAck: pbBool(body, 9),
    internalExt: pbString(body, 5),
    cursor: pbString(body, 2),
    fetchInterval: pbNumber(body, 3),
  };
}

/** 心跳：payloadType "hb"，按 WebSocket PING 帧发 */
export function heartBeatFrame(): Buffer {
  return pbWriteBytes(7, 'hb');
}

/** 应答：把 Response.internalExt 原样回给服务端。logId 是 uint64，按 varint 写回 */
export function ackFrame(logId: string, internalExt: string): Buffer {
  const parts = [pbWriteBytes(7, 'ack'), pbWriteBytes(8, internalExt)];
  if (logId) parts.unshift(pbWriteVarint(2, BigInt(logId)));
  return pbWrite(...parts);
}

/** 一条 WebSocket 消息 → 帧 + 消息体；解析失败返回 null 由调用方跳过 */
export function decodeFrame(buf: Buffer): { frame: PushFrame; response: Response } | null {
  let frame: PushFrame;
  try {
    frame = decodePushFrame(buf);
  } catch {
    return null;
  }
  if (!frame.payload.length) return null;
  try {
    return { frame, response: decodeResponse(frame.payload) };
  } catch {
    return null;
  }
}

/** 只为了测试/调试：把 internalExt 拿出来（decodeResponse 已经给了，这里给个便捷判断） */
export { pbChild };
