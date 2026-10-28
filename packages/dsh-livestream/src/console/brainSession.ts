import { GAME_PRESET_ID } from '../core/livePresets';

export interface BrainSessionServices {
  workspaces: { list: { getSnapshot(): { items: readonly { workspaceId: string }[] } } };
  sessions: {
    create(opts: { workspaceId: string; agentPreset: string }): Promise<string>;
    using<T>(target: string, options: { source: string }, operation: (reference: { ready: Promise<{ session: any }> }) => T | Promise<T>): Promise<T>;
  };
}

/** 创建时直接指定预设，避免先载入默认预设后又把自定义选择覆盖。 */
export async function createBrainSession(svc: BrainSessionServices, livePresetId: string, line: 'live' | 'game' = 'live'): Promise<string> {
  const workspace = svc.workspaces.list.getSnapshot().items[0];
  if (!workspace) throw new Error('先在 DSH 里打开一个工作区。');
  const agentPreset = line === 'game' ? GAME_PRESET_ID : livePresetId;
  if (!agentPreset) throw new Error('请先选择主播 Agent 预设。');
  const sessionId = await svc.sessions.create({ workspaceId: workspace.workspaceId, agentPreset });
  const date = new Date();
  const title = `直播${line === 'game' ? '游戏线' : ''} · ${date.getMonth() + 1}月${date.getDate()}日 ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
  await svc.sessions.using(sessionId, { source: 'controllerOperation' }, async (reference) => {
    const { session } = await reference.ready;
    await session.rename?.(title)?.catch?.(() => {});
  });
  return sessionId;
}
