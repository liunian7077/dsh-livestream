import { describe, expect, it, vi } from 'vitest';
import { chooseLivePreset, livePresetOptions, type PresetComposition } from '../src/core/livePresets';
import { createBrainSession, type BrainSessionServices } from '../src/console/brainSession';

const composition = (id: string, overrides: Partial<PresetComposition> = {}): PresetComposition => ({
  id, name: id, isDefault: false, rows: [{ moduleName: 'dsh-livestream/agent', enabled: true }], ...overrides,
});

describe('livestream preset selection', () => {
  it('uses an explicitly selected custom preset even when the built-in is the DSH default', () => {
    const options = livePresetOptions([composition('dsh-livestream', { isDefault: true }), composition('my-host')]);
    expect(chooseLivePreset(options, 'my-host').id).toBe('my-host');
  });

  it('follows a custom live preset selected as the DSH default in automatic mode', () => {
    const options = livePresetOptions([composition('dsh-livestream'), composition('my-host', { isDefault: true })]);
    expect(chooseLivePreset(options).id).toBe('my-host');
  });

  it('keeps the original live preset when the DSH default is an ordinary chat preset', () => {
    const options = livePresetOptions([composition('dsh-livestream'), composition('standard', { isDefault: true, rows: [] })]);
    expect(chooseLivePreset(options).id).toBe('dsh-livestream');
  });

  it.each([
    { rows: [] },
    { rows: [{ moduleName: 'dsh-livestream/agent', enabled: false as const }] },
    { rows: [{ moduleName: 'dsh-livestream/agent', enabled: 'conditional' as const }] },
    { rows: [{ moduleName: 'dsh-game/agent', enabled: true as const }] },
    { rows: [{ moduleName: 'dsh-livestream', enabled: true as const }] },
    { broken: '预设配置无效' },
  ])('refuses an incompatible explicit choice without reverting to the default: %j', (overrides) => {
    const options = livePresetOptions([composition('dsh-livestream'), composition('my-host', overrides)]);
    expect(chooseLivePreset(options).id).toBe('dsh-livestream');
    expect(() => chooseLivePreset(options, 'my-host')).toThrow('不能用于直播');
  });

  it('reports a deleted saved choice instead of silently changing persona', () => {
    expect(() => chooseLivePreset(livePresetOptions([composition('dsh-livestream')]), 'deleted-host')).toThrow('已不存在');
  });

  it('does not expose prompts or other preset configuration in the selection roster', () => {
    expect(livePresetOptions([composition('my-host', { name: '我的主播' })])).toEqual([
      { id: 'my-host', name: '我的主播', isDefault: false },
    ]);
  });
});

function services() {
  const rename = vi.fn(async () => {});
  const create = vi.fn(async () => 'session-123');
  const using: BrainSessionServices['sessions']['using'] = async (_id, _options, operation) =>
    operation({ ready: Promise.resolve({ session: { rename } }) });
  const svc: BrainSessionServices = {
    workspaces: { list: { getSnapshot: () => ({ items: [{ workspaceId: 'workspace-1' }] }) } },
    sessions: { create, using },
  };
  return { svc, create, rename };
}

describe('creating a live conversation', () => {
  it('creates and readies the session under the custom preset from the first call', async () => {
    const { svc, create, rename } = services();
    expect(await createBrainSession(svc, 'my-host')).toBe('session-123');
    expect(create).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'workspace-1', agentPreset: 'my-host' });
    expect(rename).toHaveBeenCalledWith(expect.stringMatching(/^直播 · /));
  });

  it('keeps the game line on its dedicated preset without replacing the host choice', async () => {
    const { svc, create } = services();
    await createBrainSession(svc, 'my-host');
    await createBrainSession(svc, 'my-host', 'game');
    expect(create.mock.calls).toEqual([
      [{ workspaceId: 'workspace-1', agentPreset: 'my-host' }],
      [{ workspaceId: 'workspace-1', agentPreset: 'dsh-livestream-game' }],
    ]);
  });

  it('propagates a preset creation failure without creating a default session', async () => {
    const { svc, create, rename } = services();
    create.mockRejectedValueOnce(new Error('custom preset unavailable'));
    await expect(createBrainSession(svc, 'my-host')).rejects.toThrow('custom preset unavailable');
    expect(create).toHaveBeenCalledTimes(1);
    expect(rename).not.toHaveBeenCalled();
  });

  it('waits for session readiness before reporting success', async () => {
    const { svc } = services();
    svc.sessions.using = async (_id, _options, operation) => operation({ ready: Promise.reject(new Error('agent not ready')) });
    await expect(createBrainSession(svc, 'my-host')).rejects.toThrow('agent not ready');
  });

  it('requires a workspace before creating a session', async () => {
    const { svc, create } = services();
    svc.workspaces.list.getSnapshot = () => ({ items: [] });
    await expect(createBrainSession(svc, 'my-host')).rejects.toThrow('工作区');
    expect(create).not.toHaveBeenCalled();
  });
});
