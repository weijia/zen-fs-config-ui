import { describe, it, expect } from 'vitest';
import { formatReplicaSetupNote } from '../configurator.js';

/**
 * deferReplicaSetup 的信号②文案：后台建对结果必须能被状态行表达出来，
 * 尤其是冲突被「跳过」时不应当成失败或空列表。
 */
describe('formatReplicaSetupNote', () => {
  it('未结束时没有摘要（状态行由 pending 分支接管）', () => {
    expect(formatReplicaSetupNote(null, null)).toBeUndefined();
  });

  it('全部就绪只报数量', () => {
    expect(formatReplicaSetupNote({ ready: ['a', 'b'], skipped: [], failed: [] }, null))
      .toBe('后台建对 就绪 2');
  });

  it('冲突跳过时带 backendId 与原因', () => {
    const note = formatReplicaSetupNote(
      { ready: [], skipped: [{ backendId: 'x-replica', reason: 'belongs to another group' }], failed: [] },
      null,
    );
    expect(note).toContain('跳过 1');
    expect(note).toContain('x-replica');
  });

  it('后台抛错时给出错误摘要', () => {
    expect(formatReplicaSetupNote(null, 'boom')).toBe('后台建对失败 · boom');
  });
});
