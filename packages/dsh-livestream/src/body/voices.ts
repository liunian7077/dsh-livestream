/**
 * 豆包音色的模型版本（不碰网络、不碰 node，设置页也能用）。
 * 音色决定资源版本；API Key 或 APP ID + Access Token 都可用于鉴权。
 * 默认音色和狼人杀的角色、法官都是 2.0 音色，推荐使用新版控制台的 API Key。
 */

/** 大肥鱼的默认音色：萌丫头 2.0 */
export const DEFAULT_VOICE = 'zh_female_mengyatou_uranus_bigtts';

/** 嘉宾（Claude 小姐这些在电脑前帮忙管直播的人）上直播间说话的默认音色：知性女 2.0，和她的声音分得开 */
export const GUEST_VOICE = 'zh_female_zhixingnv_uranus_bigtts';

/** 2.0 音色和复刻音色使用 2.0 资源，与采用哪种鉴权方式无关。 */
export function usesV2Voice(voice: string): boolean {
  return voice.startsWith('S_') || voice.includes('_uranus_');
}
