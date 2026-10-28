import type { StageSongs } from './protocol';

export interface BackgroundMusicSettings {
  enabled: boolean;
  /** 0～1；仅控制背景音乐，不改变点歌和主播音量。 */
  volume: number;
}

interface BackgroundState {
  connected: boolean;
  onAir: boolean;
  speaking: boolean;
  songs: StageSongs | null;
  media: unknown;
  game: unknown;
  backgroundMusic: BackgroundMusicSettings | null;
}

/** 一个循环播放器：点歌占用期间暂停并保留进度；不参与点歌回执。 */
export class BackgroundMusic {
  private player: HTMLAudioElement | null = null;
  private allowed = false;
  private starting = false;
  private failed = false;
  blocked = false;

  constructor(private readonly source: string, private readonly changed: () => void, private readonly silent = false) {}

  sync(state: BackgroundState): void {
    const config = state.backgroundMusic;
    const volume = Number.isFinite(config?.volume) ? Math.max(0, Math.min(1, config!.volume)) : 0.12;
    const enabled = !this.silent && state.connected && state.onAir && config?.enabled && volume > 0;
    // 重连时先等队列快照，避免在尚未收到当前点歌状态时抢先出声。
    this.allowed = !!enabled && !!state.songs && !state.songs.playing && !state.songs.waiting.length && !state.media && !state.game;
    if (!enabled) {
      this.dispose();
      return;
    }
    if (!this.allowed) {
      this.player?.pause();
      this.blocked = false;
      return;
    }
    if (this.failed) return;
    if (!this.player) {
      const player = new Audio(this.source);
      this.player = player;
      player.loop = true;
      player.preload = 'auto';
      player.onerror = () => {
        if (this.player !== player) return;
        this.failed = true;
        this.blocked = false;
        player.pause();
        this.changed();
      };
    }
    this.player.volume = volume * (state.speaking ? 0.35 : 1);
    this.play();
  }

  unlock(): void {
    this.blocked = false;
    this.play();
  }

  private play(): void {
    const player = this.player;
    if (!this.allowed || !player || this.failed || this.blocked || this.starting || !player.paused) return;
    this.starting = true;
    void player.play().then(() => {
      if (this.player !== player) { player.pause(); return; }
      this.starting = false;
      // play() 尚未完成时可能来了点歌、下播或断线，不能被迟到的完成回调重新打开。
      if (!this.allowed) player.pause();
      else if (player.paused) this.play();
    }, (error: Error) => {
      if (this.player !== player) return;
      this.starting = false;
      if (error.name === 'AbortError') {
        // 暂停打断了加载；若点歌已经结束，可继续同一播放器。
        if (this.allowed) this.play();
        return;
      }
      if (error.name === 'NotAllowedError') this.blocked = this.allowed;
      else this.failed = true;
      this.changed();
    });
  }

  private dispose(): void {
    const player = this.player;
    this.player = null;
    this.starting = false;
    this.blocked = false;
    this.failed = false;
    if (player) {
      player.onerror = null;
      player.pause();
      player.removeAttribute('src');
      player.load();
    }
  }
}
