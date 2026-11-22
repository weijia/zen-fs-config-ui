import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * connectGroup 的类型处理：
 * - 首次连接不再强行传 groupType，交给探测；
 * - 空库（NeedsInitError）原样抛出，由上层询问用户后带 initGroupType 重调；
 * - 远端已经是配置组（`Group type mismatch … config-sync`）→ 退回 config-sync 连接。
 */

const connectMock = vi.fn();

vi.mock('zen-fs-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('zen-fs-config')>();
  return { ...actual, connect: (...args: any[]) => connectMock(...args) };
});

import { connectGroup } from '../api.js';

const backendInfo = { type: 'Gitee', options: { owner: 'weijia432', repo: 'configs' } } as any;

beforeEach(() => {
  connectMock.mockReset();
});

describe('connectGroup 的类型处理', () => {
  it('首次连接只传 backendInfo，不预设 groupType', async () => {
    connectMock.mockResolvedValue({ groupType: 'data-sync', appDataGroups: [] });
    await connectGroup('golf', backendInfo, 'node-1');
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(connectMock.mock.calls[0][1]).not.toHaveProperty('groupType');
    expect(connectMock.mock.calls[0][1]).not.toHaveProperty('initGroupType');
  });

  it('带 initGroupType 时以显式 groupType 透传给 connect', async () => {
    connectMock.mockResolvedValue({ groupType: 'data-sync', appDataGroups: [] });
    await connectGroup('golf', backendInfo, 'node-1', { initGroupType: 'data-sync' });
    expect(connectMock.mock.calls[0][1]).toMatchObject({ groupType: 'data-sync' });
  });

  it('空库的 NeedsInitError 原样抛出，不被回退逻辑吞掉', async () => {
    const err = Object.assign(new Error('远端尚未初始化'), { code: 'NEEDS_INIT' });
    connectMock.mockRejectedValue(err);
    await expect(connectGroup('golf', backendInfo)).rejects.toMatchObject({
      code: 'NEEDS_INIT',
    });
    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  it('远端是配置组时退回 config-sync，而不是抛出', async () => {
    connectMock
      .mockRejectedValueOnce(
        new Error(
          'Group type mismatch: 远端标记为 "config-sync"' +
            '（kind=config · id=config · 实例 ID=5a529e4a-…），本端要求 "data-sync"。',
        ),
      )
      .mockResolvedValueOnce({ groupType: 'config-sync', repo: {} });

    const result = await connectGroup('golf', backendInfo, 'node-1');
    expect(result.groupType).toBe('config-sync');
    expect(connectMock).toHaveBeenCalledTimes(2);
    expect(connectMock.mock.calls[1][1]).toMatchObject({ groupType: 'config-sync' });
  });

  it('其它错误照常抛出，不吞掉', async () => {
    connectMock.mockRejectedValue(new Error('network down'));
    await expect(connectGroup('golf', backendInfo)).rejects.toThrow('network down');
    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  it('没有 backendInfo 时不重试（本地模式）', async () => {
    connectMock.mockRejectedValue(
      new Error('Group type mismatch: 远端标记为 "config-sync"，本端要求 "data-sync"'),
    );
    await expect(connectGroup('golf')).rejects.toThrow('Group type mismatch');
    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  it('deferReplicaSetup 透传给 connect', async () => {
    connectMock.mockResolvedValue({ groupType: 'config-sync' });
    await connectGroup('golf', backendInfo, 'node-1', { deferReplicaSetup: true });
    expect(connectMock.mock.calls[0][1]).toMatchObject({ deferReplicaSetup: true });
  });

  it('两信号原样返回给调用方', async () => {
    const whenReplicasReady = Promise.resolve({
      ready: ['Gitee-replica'],
      skipped: [],
      failed: [],
    });
    connectMock.mockResolvedValue({
      groupType: 'config-sync',
      replicasPending: true,
      whenReplicasReady,
    });
    const result = await connectGroup('golf', backendInfo, 'node-1', { deferReplicaSetup: true });
    expect((result as any).replicasPending).toBe(true);
    expect((result as any).whenReplicasReady).toBe(whenReplicasReady);
  });
});
