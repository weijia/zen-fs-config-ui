import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * connectGroup 的类型回退：
 * - 新建/未知远端 → 仍按历史约定传 `groupType: 'data-sync'`；
 * - 远端已经是配置组（`Group type mismatch … config-sync`）→ 退回 config-sync 连接，
 *   不能让整个应用因为「默认 data-sync」而打不开（数据组本来由配置组托管）。
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

describe('connectGroup 的 groupType 回退', () => {
  it('正常路径仍按 data-sync 连接', async () => {
    connectMock.mockResolvedValue({ groupType: 'data-sync', appDataGroups: [] });
    await connectGroup('golf', backendInfo, 'node-1');
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(connectMock.mock.calls[0][1]).toMatchObject({ groupType: 'data-sync' });
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
});
