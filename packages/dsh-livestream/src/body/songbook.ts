/** 点歌队列：轮到时解析音源，实际播放和切歌由舞台音频回执驱动。 */

import type { SongQuery } from '../core/songRequest';
import { isRestrictedSong, isRestrictedSongRequest, SONG_RESTRICTION_MESSAGE } from '../core/songPolicy';
import type { SongPlayback, SongPlaybackReport } from '../stage/protocol';
import type { NeteaseSong, SongMatch } from './netease';

export interface SongViewer {
  id: string;
  name: string;
}

export interface QueuedSong {
  seq: number;
  song: NeteaseSong;
  by: SongViewer;
  requestedAt: number;
  startedAt?: number;
}

export type SongOutcome =
  | { kind: 'loading' | 'playing'; song: NeteaseSong; by: SongViewer }
  | { kind: 'queued'; song: NeteaseSong; by: SongViewer; position: number }
  | { kind: 'notfound' }
  | { kind: 'blocked' }
  | { kind: 'duplicate'; song: NeteaseSong }
  | { kind: 'full' }
  | { kind: 'tooMany' }
  | { kind: 'error'; message: string };

export interface SongbookOptions {
  find(query: SongQuery): Promise<SongMatch | null>;
  resolve(song: NeteaseSong): Promise<string>;
  onChange?(): void;
  log?(level: 'info' | 'warn', message: string): void;
  maxQueue?: number | (() => number);
  maxPerUser?: number | (() => number);
  /** 没有出声的舞台时保留队列，不把等待 OBS 连接当成坏音源。 */
  hasStage?(): boolean;
  now?(): number;
}

const DEFAULT_MAX_QUEUE = 20;
const DEFAULT_MAX_PER_USER = 2;
const RESOLVE_TIMEOUT_MS = 15_000;
const PLAYBACK_TIMEOUT_MS = 30_000;

export class Songbook {
  private current: QueuedSong | null = null;
  private queue: QueuedSong[] = [];
  private played: QueuedSong[] = [];
  private seq = 0;
  private sourceUrl: string | null = null;
  private progress: SongPlayback | null = null;
  /** 停播后，尚未完成的搜索不能重新开播。 */
  private epoch = 0;
  private searching = new Map<string, number>();
  private cancelResolve: (() => void) | null = null;
  private playbackTimer: ReturnType<typeof setTimeout> | null = null;
  private furthestPositionMs = 0;

  constructor(private readonly options: SongbookOptions) {}

  private get now(): number { return this.options.now?.() ?? Date.now(); }

  private limit(value: number | (() => number) | undefined, fallback: number): number {
    const raw = typeof value === 'function' ? value() : value;
    return Number.isFinite(raw) && (raw as number) > 0 ? Math.floor(raw as number) : fallback;
  }

  get playing(): QueuedSong | null { return this.current; }
  get waiting(): QueuedSong[] { return [...this.queue]; }
  get recent(): QueuedSong[] { return [...this.played].reverse().slice(0, 10); }
  get playback(): SongPlayback | null { return this.progress ? { ...this.progress } : null; }

  /** 音源只留在服务器，舞台只能按当前队列编号取流。 */
  source(seq: number): string | null {
    return this.current?.seq === seq ? this.sourceUrl : null;
  }

  private full(by: SongViewer): 'full' | 'tooMany' | null {
    const pending = (this.current?.by.id === by.id ? 1 : 0) + this.queue.filter((q) => q.by.id === by.id).length;
    if (pending >= this.limit(this.options.maxPerUser, DEFAULT_MAX_PER_USER)) return 'tooMany';
    if (this.current && this.queue.length >= this.limit(this.options.maxQueue, DEFAULT_MAX_QUEUE)) return 'full';
    return null;
  }

  async request(query: SongQuery, by: SongViewer): Promise<SongOutcome> {
    if (isRestrictedSongRequest(query)) return { kind: 'blocked' };
    const full = this.full(by);
    if (full) return { kind: full };
    const busy = this.searching.get(by.id) ?? 0;
    if (busy >= 2) return { kind: 'tooMany' };
    const epoch = this.epoch;
    this.searching.set(by.id, busy + 1);
    let match: SongMatch | null;
    try {
      match = await this.options.find(query);
    } catch (err) {
      const message = (err as Error).message;
      this.options.log?.('warn', `点歌搜索失败（${query.raw}）：${message}`);
      return { kind: 'error', message };
    } finally {
      const left = (this.searching.get(by.id) ?? 1) - 1;
      if (left > 0) this.searching.set(by.id, left);
      else this.searching.delete(by.id);
    }
    if (epoch !== this.epoch) return { kind: 'error', message: '点歌已停止' };
    if (!match) return { kind: 'notfound' };
    if (isRestrictedSong(match)) return { kind: 'blocked' };
    if (this.current?.song.id === match.id || this.queue.some((q) => q.song.id === match.id)) {
      return { kind: 'duplicate', song: match };
    }
    // 并发搜索期间，其他请求可能已占满队列或个人额度。
    const filled = this.full(by);
    if (filled) return { kind: filled };
    const entry: QueuedSong = {
      seq: ++this.seq,
      song: { id: match.id, name: match.name, artists: match.artists, album: match.album, durationMs: match.durationMs, ...(match.aliases?.length ? { aliases: [...match.aliases] } : {}) },
      by,
      requestedAt: this.now,
    };
    if (!this.current) {
      const error = await this.start(entry);
      if (error) return { kind: 'error', message: error };
      if (this.playing?.seq !== entry.seq) return { kind: 'error', message: '这首歌已被跳过或点歌已停止' };
      return { kind: this.progress?.status === 'playing' ? 'playing' : 'loading', song: entry.song, by };
    }
    this.queue.push(entry);
    this.options.onChange?.();
    return { kind: 'queued', song: entry.song, by, position: this.queue.length };
  }

  async next(): Promise<QueuedSong | null> {
    this.cancelPending();
    if (this.current?.startedAt !== undefined) {
      this.played.push(this.current);
      this.played = this.played.slice(-20);
    }
    this.current = null;
    this.sourceUrl = null;
    this.progress = null;
    let next = this.queue.shift();
    // 队列中的曲目也在轮到播放时复查，不让旧条目绕过限制。
    while (next && isRestrictedSong(next.song)) {
      this.options.log?.('info', '点歌：跳过不开放点播的歌曲');
      next = this.queue.shift();
    }
    if (!next) {
      this.options.onChange?.();
      return null;
    }
    await this.start(next);
    return this.current === next ? next : null;
  }

  clear(): number {
    const n = this.queue.length;
    this.queue = [];
    this.options.onChange?.();
    return n;
  }

  stop(): void {
    this.epoch++;
    this.cancelPending();
    this.current = null;
    this.queue = [];
    this.sourceUrl = null;
    this.progress = null;
    this.options.onChange?.();
  }

  disconnect(): void {
    this.clearPlaybackTimer();
    if (!this.progress || !this.sourceUrl || this.progress.status === 'error') return;
    this.progress = { ...this.progress, status: 'paused', updatedAt: this.now, detail: '舞台已断开，重新连接后继续播放' };
    this.options.onChange?.();
  }

  /** 第一张出声的舞台重新连接时，从原进度恢复，并重新给一次加载宽限。 */
  connect(): void {
    if (!this.current || !this.sourceUrl || !this.progress || this.progress.status === 'error') return;
    this.furthestPositionMs = this.progress.positionMs;
    this.progress = { ...this.progress, status: 'loading', updatedAt: this.now, detail: '等待舞台恢复播放' };
    this.watchPlayback(this.current);
    this.options.onChange?.();
  }

  /** 旧歌曲的迟到回执不能结束或改写新歌曲。 */
  report(seq: number, status: SongPlaybackReport, positionMs?: number, durationMs?: number, detail?: string): void {
    if (this.current?.seq !== seq || !this.sourceUrl || !this.progress) return;
    if (status === 'error') {
      this.fail(this.current, detail || '舞台无法播放音频');
      return;
    }
    if (status === 'ended') {
      if (this.current.startedAt === undefined || this.progress.status === 'error') return;
      this.options.log?.('info', `点歌：《${this.current.song.name}》播放结束`);
      void this.next();
      return;
    }
    const duration = Number.isFinite(durationMs) && durationMs! > 0 ? durationMs! : this.progress.durationMs;
    const position = Number.isFinite(positionMs) && positionMs! >= 0 ? positionMs! : this.progress.positionMs;
    if (status === 'playing') this.current.startedAt ??= this.now;
    this.progress = {
      status,
      positionMs: duration > 0 ? Math.min(position, duration) : position,
      durationMs: duration,
      updatedAt: this.now,
      ...(detail ? { detail: detail.slice(0, 200) } : {}),
    };
    if (status === 'paused' || status === 'blocked') {
      // 暂停或浏览器需要点击授权时，换歌也不会恢复声音，不能把队列跳空。
      this.clearPlaybackTimer();
    } else if (!this.playbackTimer || this.progress.positionMs > this.furthestPositionMs) {
      this.furthestPositionMs = Math.max(this.furthestPositionMs, this.progress.positionMs);
      this.watchPlayback(this.current);
    }
    this.options.onChange?.();
  }

  private clearPlaybackTimer(): void {
    if (this.playbackTimer) clearTimeout(this.playbackTimer);
    this.playbackTimer = null;
  }

  private cancelPending(): void {
    this.clearPlaybackTimer();
    this.cancelResolve?.();
    this.cancelResolve = null;
  }

  /** 只因实际进度前进而续期，重复的 loading/playing 回执不能无限拖延。 */
  private watchPlayback(entry: QueuedSong): void {
    this.clearPlaybackTimer();
    if (this.options.hasStage?.() === false) return;
    this.playbackTimer = setTimeout(() => {
      this.playbackTimer = null;
      if (this.current !== entry || this.options.hasStage?.() === false) return;
      this.fail(entry, entry.startedAt === undefined ? '等待播放超过 30 秒，未收到有效进度' : '播放连续 30 秒没有进度，可能音源或网络中断');
    }, PLAYBACK_TIMEOUT_MS);
    this.playbackTimer.unref?.();
  }

  private fail(entry: QueuedSong, message: string): void {
    if (this.current !== entry || !this.progress) return;
    this.progress = { ...this.progress, status: 'error', detail: message.slice(0, 200), updatedAt: this.now };
    this.options.log?.('warn', `点歌播放失败（${entry.song.name}）：${message}；已自动跳过`);
    this.options.onChange?.();
    void this.next();
  }

  private async start(entry: QueuedSong): Promise<string | undefined> {
    if (isRestrictedSong(entry.song)) return SONG_RESTRICTION_MESSAGE;
    this.cancelPending();
    this.current = entry;
    this.furthestPositionMs = 0;
    this.sourceUrl = null;
    this.progress = { status: 'resolving', positionMs: 0, durationMs: entry.song.durationMs, updatedAt: this.now };
    this.options.onChange?.();
    let rejectResolve!: (reason: Error) => void;
    const interrupted = new Promise<never>((_resolve, reject) => { rejectResolve = reject; });
    const cancel = () => rejectResolve(new Error('这首歌已被跳过或点歌已停止'));
    this.cancelResolve = cancel;
    const timeout = setTimeout(() => rejectResolve(new Error('获取音源超过 15 秒')), RESOLVE_TIMEOUT_MS);
    timeout.unref?.();
    try {
      // 包一层 Promise，让同步抛错也进入 race，取消分支始终有拒绝处理器。
      const source = await Promise.race([Promise.resolve().then(() => this.options.resolve(entry.song)), interrupted]);
      if (this.current !== entry) return;
      if (!source) throw new Error('网易云没有返回可播放音源');
      this.sourceUrl = source;
      this.progress = { ...this.progress!, status: 'loading', updatedAt: this.now };
      this.watchPlayback(entry);
      this.options.onChange?.();
    } catch (err) {
      if (this.current !== entry) return;
      const message = err instanceof Error ? err.message : String(err);
      this.fail(entry, message);
      return message;
    } finally {
      clearTimeout(timeout);
      if (this.cancelResolve === cancel) this.cancelResolve = null;
    }
  }
}
