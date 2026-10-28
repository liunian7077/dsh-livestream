/** 直播预设选择：保留用户的明确选择，只把可接上直播身体的预设用于主播。 */
export const LIVE_PRESET_ID = 'dsh-livestream';
export const GAME_PRESET_ID = 'dsh-livestream-game';

export interface PresetComposition {
  id: string;
  name?: string;
  isDefault: boolean;
  broken?: string;
  rows: readonly { moduleName: string; enabled: boolean | 'conditional' }[];
}

export interface LivePresetOption {
  id: string;
  name: string;
  isDefault: boolean;
  unavailable?: string;
}

export function livePresetOptions(compositions: readonly PresetComposition[]): LivePresetOption[] {
  return compositions.map((preset) => ({
    id: preset.id,
    name: preset.name || preset.id,
    isDefault: preset.isDefault,
    ...((preset.broken || !preset.rows.some((row) => row.moduleName === 'dsh-livestream/agent' && row.enabled === true))
      ? { unavailable: preset.broken || '未启用直播回复插件 dsh-livestream/agent' } : {}),
  }));
}

export function chooseLivePreset(options: readonly LivePresetOption[], requestedId = ''): LivePresetOption {
  // 自动模式跟随 DSH 中设为默认的直播预设；普通聊天默认不适用于直播时保留原来的开播体验。
  const id = requestedId || options.find((preset) => preset.isDefault && !preset.unavailable)?.id || LIVE_PRESET_ID;
  const selected = options.find((preset) => preset.id === id);
  if (!selected) throw new Error('选定的主播预设已不存在，请在直播设置中重新选择。');
  if (selected.unavailable) throw new Error(`「${selected.name}」不能用于直播：${selected.unavailable}`);
  return selected;
}
