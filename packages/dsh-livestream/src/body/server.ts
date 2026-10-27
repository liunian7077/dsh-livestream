/**
 * 舞台服务器：插件自己开一个端口（DSH 网页版和桌面版都能用），OBS 的浏览器源直接打开它。
 *
 *   GET  /?token=…                 舞台页（按当前模板摆好挂件）
 *   GET  /stage.js /stage.js.map /stage.css   舞台页的代码（插件包 lib/）
 *   GET  /characters/<id>/<file>   角色包、/templates/<id>/<file> 模板（见 packs.ts）
 *   GET  /events?token=…           舞台事件流（SSE）
 *   POST /said?id=…&token=…        舞台念完一句
 *   GET  /video?id=…&token=…       正在放的视频（转发 B 站 CDN，带它要的 Referer，支持 Range）
 *   POST /media?id=…&state=…&token=…  视频开始放、放完、放不出来
 *   GET  /music?seq=…&token=…       当前歌曲音频（网易云 CDN，支持 Range）
 *   POST /music/state?seq=…&state=…&token=… 音乐播放状态与实际进度
 *
 * 所有请求都要带 token（OBS 里填的地址自带），只监听本机。
 * 开发时（pnpm dev）lib/stage.js 或 stage/stage.css 一重建，就让开着的舞台页自己刷新。
 */

import { existsSync, readFileSync, statSync, unwatchFile, watchFile, type Stats } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { Readable } from 'node:stream';
import type { SongPlaybackReport, StageEvent } from '../stage/protocol';
import { NETEASE_HEADERS } from './netease';
import type { Packs } from './packs';
import type { Stage } from './stage';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.map': 'application/json; charset=utf-8',
};

export interface StageServerOptions {
  port: number;
  token: string;
  /** 插件包目录（有 lib/、stage/） */
  packageDir: string;
  packs: Packs;
  stage: Stage;
  /** 现在用哪个角色、哪个模板 */
  current(): { character: string; template: string };
  /** 舞台上放的视频：id → CDN 地址；舞台的回执 */
  media?: {
    source(id: string): string | null;
    report(id: string, state: 'playing' | 'ended' | 'error', positionSec?: number, detail?: string): void;
  };
  music?: {
    source(seq: number): string | null;
    report(seq: number, state: SongPlaybackReport, positionMs?: number, durationMs?: number, detail?: string): void;
    disconnect?(): void;
  };
  log?(level: 'info' | 'warn', message: string): void;
}

/** 舞台页的脚本（构建产物） */
const stageScript = (packageDir: string): string => join(packageDir, 'lib', 'stage.js');

export class StageServer {
  private server: Server | null = null;

  /** 实际监听的端口（传 0 时由系统挑） */
  private port: number;

  /** 开发时盯着的文件：重建了就让开着的舞台页刷新（OBS 的浏览器源不会自己刷新） */
  private readonly watched = new Set<string>();
  private reloadTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: StageServerOptions) {
    this.port = options.port;
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}/?token=${this.options.token}`;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        this.handle(req, res).catch((err) => {
          this.options.log?.('warn', `舞台请求出错：${(err as Error).message}`);
          if (!res.headersSent) res.writeHead(500);
          res.end();
        });
      });
      server.requestTimeout = 0;
      server.once('error', reject);
      server.listen(this.options.port, '127.0.0.1', () => {
        server.off('error', reject);
        this.server = server;
        const address = server.address();
        if (address && typeof address === 'object') this.port = address.port;
        this.watchStageFiles();
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = null;
    for (const file of this.watched) unwatchFile(file, this.onStageFile);
    this.watched.clear();
    const server = this.server;
    this.server = null;
    if (!server) return Promise.resolve();
    return new Promise((resolve, reject) => {
      server.close((err) => err ? reject(err) : resolve());
      server.closeAllConnections();
    });
  }

  // ── 开发时热刷新 ────────────────────────────────────

  /**
   * 盯着舞台页的文件：lib/stage.js 是构建产物，stage/index.html 和 stage/stage.css 是舞台自己的页面和样式。
   * 用轮询而不是 inotify：网络盘、虚拟机挂载上 fs.watch 经常收不到。
   */
  private watchStageFiles(): void {
    const stageDir = join(this.options.packageDir, 'stage');
    for (const file of [stageScript(this.options.packageDir), join(stageDir, 'index.html'), join(stageDir, 'stage.css')]) {
      if (this.watched.has(file)) continue;
      watchFile(file, { interval: 400, persistent: false }, this.onStageFile);
      this.watched.add(file);
    }
  }

  private readonly onStageFile = (current: Stats, previous: Stats): void => {
    if (current.mtimeMs === previous.mtimeMs && current.size === previous.size) return;
    if (!current.isFile() || current.size === 0) return;
    this.scheduleReload();
  };

  /** 一次重建可能连着改好几个文件：合并成一次刷新 */
  private scheduleReload(): void {
    if (!this.server) return;
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null;
      this.options.stage.broadcast({ type: 'reload' });
      this.options.log?.('info', '舞台页的代码或样式重建了：让开着的舞台页刷新');
    }, 120);
  }

  /** 舞台页代码的版本：lib/stage.js 的修改时间和大小。变了，开着的舞台页（OBS）下次连上就自己刷新 */
  private stamp(file: string): string {
    try {
      const stats = statSync(file);
      return `${Math.round(stats.mtimeMs)}-${stats.size}`;
    } catch {
      return '';
    }
  }

  // ── 请求 ────────────────────────────────────────────

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.searchParams.get('token') !== this.options.token) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('舞台地址不对：请从 DSH 的直播控制台复制完整地址（带 token）。');
      return;
    }
    const path = url.pathname;
    if (req.method === 'POST' && path === '/music/state') {
      const status = url.searchParams.get('state') as SongPlaybackReport;
      const seq = Number(url.searchParams.get('seq'));
      if (!Number.isSafeInteger(seq) || seq < 1 || !['loading', 'playing', 'paused', 'blocked', 'error', 'ended'].includes(status)) {
        res.writeHead(400);
        res.end();
        return;
      }
      // 页面断开后才到达的回执，不能把已暂停的状态改回正在播放。
      if (!this.options.stage.watchers) {
        res.writeHead(409);
        res.end();
        return;
      }
      this.options.music?.report(seq, status, Number(url.searchParams.get('at') ?? NaN), Number(url.searchParams.get('duration') ?? NaN), url.searchParams.get('detail') ?? undefined);
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === 'POST' && path === '/said') {
      this.options.stage.said(url.searchParams.get('id') ?? '');
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === 'POST' && path === '/media') {
      const state = url.searchParams.get('state');
      if (state === 'playing' || state === 'ended' || state === 'error') {
        if (state === 'error') this.options.log?.('warn', `舞台放视频出错：${(url.searchParams.get('detail') ?? '').slice(0, 200)}`);
        this.options.media?.report(url.searchParams.get('id') ?? '', state, Number(url.searchParams.get('at') ?? NaN), url.searchParams.get('detail') ?? undefined);
      }
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method !== 'GET') {
      res.writeHead(405);
      res.end();
      return;
    }
    if (path === '/events') return this.events(req, res, url);
    if (path === '/video') return this.video(req, res, url.searchParams.get('id') ?? '');
    if (path === '/music') return this.music(req, res, Number(url.searchParams.get('seq')));
    if (path === '/' || path === '/index.html') return this.file(res, join(this.options.packageDir, 'stage', 'index.html'));
    // 开发时带 sourcemap：舞台页的 DevTools 里直接看 src/stage 的源码
    if (path === '/stage.js' || path === '/stage.js.map') return this.file(res, join(this.options.packageDir, 'lib', path.slice(1)));
    if (path === '/stage.css') return this.file(res, join(this.options.packageDir, 'stage', 'stage.css'));
    const pack = /^\/(characters|templates)\/([\w-]{1,64})\/(.+)$/.exec(path);
    if (pack) {
      const dir = this.options.packs.dir(pack[1] as 'characters' | 'templates', pack[2]);
      if (dir) return this.file(res, join(dir, decodeURIComponent(pack[3])), dir);
    }
    res.writeHead(404);
    res.end();
  }

  private events(req: IncomingMessage, res: ServerResponse, url: URL): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    const send = (event: StageEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    const { character, template } = this.options.current();
    const c = this.options.packs.character(character);
    const t = this.options.packs.template(template);
    if (c && t) send({ v: 1, type: 'hello', character: c, template: t, build: this.stamp(stageScript(this.options.packageDir)), at: Date.now() });
    // ?preview=1：控制台里的预览，静音、不回执
    const speaker = url.searchParams.get('preview') !== '1';
    const unsubscribe = this.options.stage.subscribe(send, speaker);
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
    req.on('close', () => {
      clearInterval(ping);
      unsubscribe();
      if (speaker && !this.options.stage.watchers) this.options.music?.disconnect?.();
    });
  }

  /** 转发视频：B 站 CDN 要 Referer；浏览器拖进度、OBS 边下边放都靠 Range */
  private async video(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    const source = this.options.media?.source(id);
    if (!source) {
      res.writeHead(404);
      res.end();
      return;
    }
    const abort = new AbortController();
    req.on('close', () => abort.abort());
    let upstream: Response;
    try {
      upstream = await fetch(source, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          Referer: 'https://www.bilibili.com/',
          ...(req.headers.range ? { Range: req.headers.range } : {}),
        },
        signal: abort.signal,
      });
    } catch (err) {
      if (!abort.signal.aborted) this.options.log?.('warn', `视频取不到：${(err as Error).message}`);
      if (!res.headersSent) res.writeHead(502);
      res.end();
      return;
    }
    const headers: Record<string, string> = { 'content-type': upstream.headers.get('content-type') ?? 'video/mp4', 'accept-ranges': 'bytes', 'cache-control': 'no-store' };
    for (const name of ['content-length', 'content-range']) {
      const value = upstream.headers.get(name);
      if (value) headers[name] = value;
    }
    res.writeHead(upstream.status, headers);
    if (!upstream.body) return void res.end();
    Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream).on('error', () => res.destroy()).pipe(res);
  }

  /** 网易云音频：地址、Cookie 留在服务器；支持浏览器边加载边播和 Range 跳转。 */
  private async music(req: IncomingMessage, res: ServerResponse, seq: number): Promise<void> {
    const source = this.options.music?.source(seq);
    if (!source) {
      res.writeHead(404);
      res.end();
      return;
    }
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    const timeout = setTimeout(() => abort.abort(), 20_000);
    let upstream: Response;
    try {
      upstream = await fetch(source, {
        headers: { ...NETEASE_HEADERS, ...(req.headers.range ? { Range: req.headers.range } : {}) },
        signal: abort.signal,
      });
    } catch {
      if (!res.destroyed) {
        this.options.music?.report(seq, 'error', undefined, undefined, '网易云音频连接失败，请检查网络后重新点歌');
        res.writeHead(502);
        res.end();
      }
      return;
    } finally {
      clearTimeout(timeout);
    }
    if (!upstream.ok) this.options.music?.report(seq, 'error', undefined, undefined, `网易云音频加载失败（HTTP ${upstream.status}）`);
    const headers: Record<string, string> = {
      'content-type': upstream.headers.get('content-type') ?? 'audio/mpeg',
      'accept-ranges': 'bytes', 'cache-control': 'no-store',
    };
    for (const name of ['content-length', 'content-range']) {
      const value = upstream.headers.get(name);
      if (value) headers[name] = value;
    }
    res.writeHead(upstream.status, headers);
    if (!upstream.body) return void res.end();
    Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream).on('error', () => res.destroy()).pipe(res);
  }

  private file(res: ServerResponse, file: string, within?: string): void {
    const resolved = normalize(file);
    // 只给包里或用户目录里的文件（防 ../ 跳出去）
    if (within && !resolved.startsWith(normalize(within) + sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (!existsSync(resolved) || !statSync(resolved).isFile()) {
      res.writeHead(404);
      res.end();
      return;
    }
    const ext = extname(resolved).toLowerCase();
    res.writeHead(200, {
      'content-type': TYPES[ext] ?? 'application/octet-stream',
      // 开发时重建过就要拿到新的：页面、脚本和它的 sourcemap 都不缓存
      'cache-control': ext === '.html' || ext === '.js' || ext === '.map' ? 'no-store' : 'max-age=3600',
    });
    res.end(readFileSync(resolved));
  }
}
