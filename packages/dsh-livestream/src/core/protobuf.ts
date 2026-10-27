/**
 * 最小 protobuf 读写器：只按字段号取值，不带 .proto 定义。
 *
 * B 站把进场（INTERACT_WORD_V2）和礼物（SEND_GIFT_V2）改成了 base64 的 protobuf；
 * 抖音整个弹幕通道都是 protobuf。两边都没有公开的 .proto，所以只做"按字段号读/写"。
 *
 * 读：varint 一律给 bigint（平台的 id 有 19 位，超过 Number.MAX_SAFE_INTEGER）。
 * 写：只用于拼心跳、ack 和测试里的合成帧。
 */

/** 一条消息里各字段号出现的原始值：varint 为 bigint，长度分隔为 Buffer */
export type PbMessage = Map<number, Array<bigint | Buffer>>;

export function readPb(buf: Buffer): PbMessage {
  const fields: PbMessage = new Map();
  let offset = 0;
  const varint = (): bigint => {
    let result = 0n;
    let shift = 0n;
    for (;;) {
      if (offset >= buf.length) throw new Error('truncated varint');
      const byte = buf[offset++];
      result |= BigInt(byte & 0x7f) << shift;
      if (!(byte & 0x80)) return result;
      shift += 7n;
    }
  };
  while (offset < buf.length) {
    const tag = Number(varint());
    const field = tag >> 3;
    let value: bigint | Buffer;
    switch (tag & 7) {
      case 0: value = varint(); break;
      case 1: value = buf.readBigUInt64LE(offset); offset += 8; break;
      case 2: {
        const len = Number(varint());
        if (offset + len > buf.length) throw new Error('truncated field');
        value = buf.subarray(offset, offset + len);
        offset += len;
        break;
      }
      case 5: value = BigInt(buf.readUInt32LE(offset)); offset += 4; break;
      default: throw new Error(`unsupported wire type ${tag & 7}`);
    }
    const list = fields.get(field);
    if (list) list.push(value);
    else fields.set(field, [value]);
  }
  return fields;
}

export function pbNumber(msg: PbMessage | undefined, field: number): number {
  const value = msg?.get(field)?.[0];
  return typeof value === 'bigint' ? Number(value) : 0;
}

/** uid 可能超过 2^53，按字符串取 */
export function pbId(msg: PbMessage | undefined, field: number): string {
  const value = msg?.get(field)?.[0];
  return typeof value === 'bigint' && value !== 0n ? value.toString() : '';
}

export function pbString(msg: PbMessage | undefined, field: number): string {
  const value = msg?.get(field)?.[0];
  return Buffer.isBuffer(value) ? value.toString('utf8') : '';
}

export function pbChild(msg: PbMessage | undefined, field: number): PbMessage | undefined {
  const value = msg?.get(field)?.[0];
  if (!Buffer.isBuffer(value)) return undefined;
  try {
    return readPb(value);
  } catch {
    return undefined;
  }
}

/** 同一字段号重复出现（repeated 子消息） */
export function pbChildren(msg: PbMessage | undefined, field: number): PbMessage[] {
  const list = msg?.get(field) ?? [];
  const out: PbMessage[] = [];
  for (const value of list) {
    if (!Buffer.isBuffer(value)) continue;
    try {
      out.push(readPb(value));
    } catch {
      // 单个子消息坏了不影响其它
    }
  }
  return out;
}

export function pbBool(msg: PbMessage | undefined, field: number): boolean {
  const value = msg?.get(field)?.[0];
  return typeof value === 'bigint' && value !== 0n;
}

// ── 写 ────────────────────────────────────────────────

function varint(value: bigint | number): Buffer {
  let v = typeof value === 'bigint' ? value : BigInt(Math.trunc(value));
  if (v < 0n) v += 1n << 64n;
  const bytes: number[] = [];
  while (v >= 0x80n) {
    bytes.push(Number((v & 0x7fn) | 0x80n));
    v >>= 7n;
  }
  bytes.push(Number(v));
  return Buffer.from(bytes);
}

const tag = (field: number, wire: number) => varint(BigInt((field << 3) | wire));

/** 字段号 + varint（bool 也走这里） */
export function pbWriteVarint(field: number, value: bigint | number | boolean): Buffer {
  const v = typeof value === 'boolean' ? (value ? 1 : 0) : value;
  return Buffer.concat([tag(field, 0), varint(v)]);
}

/** 字段号 + 长度分隔（字符串、字节、子消息） */
export function pbWriteBytes(field: number, value: Buffer | string): Buffer {
  const body = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  return Buffer.concat([tag(field, 2), varint(Buffer.byteLength(body)), body]);
}

/** 把若干字段拼成一条消息 */
export function pbWrite(...parts: Buffer[]): Buffer {
  return Buffer.concat(parts);
}
