/**
 * 抖音直播弹幕连接：补齐 cookie → 解析内部 room_id → 算签名 → 连 wss → 心跳 + ack。
 *
 * 保活和 B 站那侧同一套：5 秒心跳（抖音网页端就是 5 秒，心跳是 payloadType=hb 的 PING 帧），
 * 70 秒没有任何数据认为连接已死，主动断开重连，退避 1s → 30s。
 * 服务端要求 needAck 时必须回 ack，不回会被断开。
 */

import WebSocket from 'ws';
import type { LiveRoomInfo } from '../../live';
import type { LiveSource, LiveSourceListener } from '../source';
import { ensureCookie, getRoom, pushUrl, UA } from './douyinApi';
import { decodeDouyinMessage } from './douyinDecode';
import { ackFrame, decodeFrame, heartBeatFrame } from './douyinProto';
import { signatureFor } from './douyinSign';

const HEARTBEAT_MS = 5_000;
const SILENCE_LIMIT_MS = 70_000;
const CONNECT_TIMEOUT_MS = 15_000;
const MAX_BACKOFF_MS = 30_000;

export class DouyinLiveSource implements LiveSource {
  readonly platform = 'douyin' as const;
  private listener: LiveSourceListener | null = null;
  private ws: WebSocket | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private backoffMs = 1000;
  private lastDataAt = 0;
  private stopped = true;
  /** 连上后是否已经确认「确实在播」（收到过消息）；下播只由 ControlMessage 翻回去 */
  private confirmedLive = false;

  constructor(private readonly webRid: number, private readonly cookie: string) {}

  start(listener: LiveSourceListener): void {
    this.listener = listener;
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.closeSocket();
    this.listener?.state('idle');
    this.listener = null;
  }

  private async connect(): Promise<void> {
    const listener = this.listener;
    if (this.stopped || !listener) return;
    listener.state(this.backoffMs > 1000 ? 'reconnecting' : 'connecting');
    try {
      const auth = await ensureCookie(this.cookie);
      const room = await getRoom(this.webRid, auth.cookie);
      if (this.stopped) return;

      const info: LiveRoomInfo = {
        platform: 'douyin',
        roomId: this.webRid,
        title: room.title,
        anchorName: room.anchorName,
      };
      listener.room(info);

      // 没有登录 Cookie 时，抖音只推弹幕/进场/点赞，不推礼物
      const note = auth.loggedIn ? undefined : '抖音要登录 Cookie 才会推礼物；现在只能收到弹幕、进场、点赞';

      this.confirmedLive = false;
      const signature = await signatureFor(room.roomId);
      await this.open(pushUrl(room.roomId, signature), auth.cookie);
      this.backoffMs = 1000;
      listener.state('connected', { loggedIn: auth.loggedIn, error: note });
    } catch (err) {
      this.scheduleRetry((err as Error).message);
    }
  }

  /** 连上（101）就 resolve；握手被拒就 reject，交给上层退避重连 */
  private open(url: string, cookie: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, {
        headers: { 'User-Agent': UA, Cookie: cookie },
        handshakeTimeout: CONNECT_TIMEOUT_MS,
      });
      let opened = false;
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error('连接超时'));
      }, CONNECT_TIMEOUT_MS);

      ws.on('open', () => {
        clearTimeout(timer);
        opened = true;
        this.ws = ws;
        this.startKeepAlive();
        resolve();
      });
      ws.on('unexpected-response', (_request, res) => {
        clearTimeout(timer);
        // 抖音拒连时回 200 而不是 101，且不给原因：多半是签名或 cookie 不对
        reject(new Error(`抖音拒绝了连接（HTTP ${res.statusCode}，不是 101）：签名或 cookie 没通过`));
      });
      ws.on('error', (err) => {
        if (!opened) {
          clearTimeout(timer);
          reject(err);
        }
      });
      ws.on('message', (data: Buffer) => {
        this.lastDataAt = Date.now();
        this.dispatch(data);
      });
      ws.on('close', (code) => {
        clearTimeout(timer);
        if (!opened) {
          reject(new Error(`握手阶段连接关闭（${code}）`));
        } else if (this.ws === ws) {
          this.ws = null;
          this.stopKeepAlive();
          this.scheduleRetry(`连接断开（${code}）`);
        }
      });
    });
  }

  private dispatch(data: Buffer): void {
    const listener = this.listener;
    if (!listener) return;
    const decoded = decodeFrame(data);
    if (!decoded) return;
    const { frame, response } = decoded;

    // 服务端要求确认时必须回，否则会断流
    if (frame.payloadType !== 'hb' && response.needAck && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(ackFrame(frame.logId, response.internalExt));
    }

    for (const message of response.messages) {
      // 收到任何业务消息就说明这个房间在播；页面上的 room_status 语义不稳，不拿它判断
      if (!this.confirmedLive) {
        this.confirmedLive = true;
        listener.stats({ live: true });
      }
      let outputs;
      try {
        outputs = decodeDouyinMessage(message.method, message.payload);
      } catch (err) {
        console.warn(`[DouyinLive] 解析 ${message.method} 失败：`, (err as Error).message);
        continue;
      }
      for (const out of outputs) {
        if (out.type === 'event') listener.event(out.event);
        else listener.stats(out.stats);
      }
    }
  }

  private startKeepAlive(): void {
    this.stopKeepAlive();
    this.lastDataAt = Date.now();
    const beat = () => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(heartBeatFrame());
    };
    beat();
    this.heartbeat = setInterval(beat, HEARTBEAT_MS);
    this.watchdog = setInterval(() => {
      if (Date.now() - this.lastDataAt > SILENCE_LIMIT_MS) {
        console.warn('[DouyinLive] 70 秒没有收到任何数据，重连');
        this.ws?.terminate();
      }
    }, 10_000);
  }

  private stopKeepAlive(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.watchdog) clearInterval(this.watchdog);
    this.heartbeat = null;
    this.watchdog = null;
  }

  private closeSocket(): void {
    this.stopKeepAlive();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.removeAllListeners();
      ws.on('error', () => {});
      ws.terminate();
    }
  }

  private scheduleRetry(reason: string): void {
    const listener = this.listener;
    if (this.stopped || !listener || this.retryTimer) return;
    console.warn(`[DouyinLive] ${reason}；${Math.round(this.backoffMs / 1000)} 秒后重连`);
    listener.state(this.backoffMs > 1000 ? 'reconnecting' : 'error', { error: reason });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
  }

}
