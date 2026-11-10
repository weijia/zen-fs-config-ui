import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  LOCAL_STORAGE_UNAVAILABLE_MESSAGE,
  describeDataGroupError,
  scheduleDataGroupStorageRebuild,
  runPendingDataGroupStorageRebuild,
} from '../api.js';

class MemoryStorage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  key(i: number) { return Array.from(this.map.keys())[i] ?? null; }
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

const appId = 'dir-struct-gen';
const key = (groupId: string) => `zen-fs-config:rebuild-data-store:${appId}:${groupId}`;

function storageError() {
  const err = new Error('Data lost due to missing file. Affected record should be considered irrecoverable');
  err.name = 'NotReadableError';
  const wrapped = new Error('Failed to create local primary');
  (wrapped as { cause?: unknown }).cause = err;
  return Object.assign(wrapped, { code: 'LOCAL_STORAGE_UNAVAILABLE' });
}

describe('describeDataGroupError', () => {
  it('本地存储损坏 → 明确提示“需要重建”，并给出目标库名', () => {
    const info = describeDataGroupError(storageError(), appId, 'default');
    expect(info.kind).toBe('local-storage-unavailable');
    expect(info.message).toContain('需要重建');
    expect(info.message).toContain(LOCAL_STORAGE_UNAVAILABLE_MESSAGE.slice(0, 20));
    expect(info.message).toContain('NotReadableError');
    expect(info.storeName).toBe(`zen-fs-config-data-${appId}`);
  });

  it('普通错误不误判为本地存储损坏', () => {
    const info = describeDataGroupError(new Error('descriptor missing'), appId, 'g1');
    expect(info.kind).toBe('other');
    expect(info.storeName).toBeUndefined();
  });
});

describe('重建登记与启动执行', () => {
  const originalStorage = (globalThis as any).localStorage;
  const originalIdb = (globalThis as any).indexedDB;
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    (globalThis as any).localStorage = storage;
  });

  afterEach(() => {
    (globalThis as any).localStorage = originalStorage;
    (globalThis as any).indexedDB = originalIdb;
  });

  it('登记只写标记，不动任何库', () => {
    const pending = scheduleDataGroupStorageRebuild(appId, 'g1');
    expect(pending.storeName).toBe(`zen-fs-config-data-${appId}-g1`);
    expect(storage.getItem(key('g1'))).toContain('g1');
  });

  it('启动时只删登记的数据组库，成功后清除标记', async () => {
    const deleted: string[] = [];
    (globalThis as any).indexedDB = {
      deleteDatabase(name: string) {
        deleted.push(name);
        const req: any = {};
        setTimeout(() => req.onsuccess?.(), 0);
        return req;
      },
    };
    scheduleDataGroupStorageRebuild(appId, 'g1');
    const outcomes = await runPendingDataGroupStorageRebuild(appId);
    expect(deleted).toEqual([`zen-fs-config-data-${appId}-g1`]);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].cleared).toBe(true);
    expect(storage.getItem(key('g1'))).toBeNull();
  });

  it('被占用时保留标记并如实返回 blocked', async () => {
    (globalThis as any).indexedDB = {
      deleteDatabase() {
        const req: any = {};
        setTimeout(() => req.onblocked?.(), 0);
        return req;
      },
    };
    scheduleDataGroupStorageRebuild(appId, 'g1');
    const outcomes = await runPendingDataGroupStorageRebuild(appId, { timeoutMs: 20 });
    expect(outcomes[0].deletion.blocked).toBe(true);
    expect(outcomes[0].cleared).toBe(false);
    expect(storage.getItem(key('g1'))).not.toBeNull();
  });
});
