import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { clearLocalSyncConfig, rebuildMarkerKeys } from '../api.js';

/**
 * 清除本页同步组配置：UI 侧封装负责把「后端信息键」与「重建登记键」一并
 * 交给库层的 purgeLocalSyncConfig，并把失败库名聚合出来如实提示。
 */

class MemoryStorage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  key(i: number) { return Array.from(this.map.keys())[i] ?? null; }
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
}

const appId = 'golf';

describe('rebuildMarkerKeys', () => {
  const originalStorage = (globalThis as any).localStorage;
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    (globalThis as any).localStorage = storage;
  });

  afterEach(() => {
    (globalThis as any).localStorage = originalStorage;
  });

  it('只返回本 appId 的重建登记键', () => {
    storage.setItem(`zen-fs-config:rebuild-data-store:${appId}:g1`, '{}');
    storage.setItem(`zen-fs-config:rebuild-data-store:${appId}:g2`, '{}');
    storage.setItem('zen-fs-config:rebuild-data-store:other:g1', '{}');
    storage.setItem('zenfs-config-ui:backend', '{}');
    expect(rebuildMarkerKeys(appId).sort()).toEqual([
      `zen-fs-config:rebuild-data-store:${appId}:g1`,
      `zen-fs-config:rebuild-data-store:${appId}:g2`,
    ]);
  });
});

describe('clearLocalSyncConfig', () => {
  const originalStorage = (globalThis as any).localStorage;
  const originalIdb = (globalThis as any).indexedDB;
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    storage.setItem('zenfs-config-ui:backend', '{}');
    storage.setItem(`zen-fs-config:rebuild-data-store:${appId}:g1`, '{}');
    (globalThis as any).localStorage = storage;
  });

  afterEach(() => {
    (globalThis as any).localStorage = originalStorage;
    (globalThis as any).indexedDB = originalIdb;
  });

  it('数据库删除被占用时如实返回失败库名，并清掉后端信息与重建登记键', async () => {
    (globalThis as any).indexedDB = {
      deleteDatabase(name: string) {
        const req: any = {};
        setTimeout(() => {
          if (name === `zen-fs-config-data-${appId}-g1`) req.onblocked?.();
          else req.onsuccess?.();
        }, 0);
        return req;
      },
    };

    const result = await clearLocalSyncConfig(appId, {
      groupIds: ['default', 'g1'],
      extraStorageKeys: ['zenfs-config-ui:backend'],
      timeoutMs: 60,
    });

    expect(result.ok).toBe(false);
    expect(result.failed).toEqual([`zen-fs-config-data-${appId}-g1`]);
    expect(storage.getItem('zenfs-config-ui:backend')).toBeNull();
    expect(storage.getItem(`zen-fs-config:rebuild-data-store:${appId}:g1`)).toBeNull();
    expect(result.removedStorageKeys).toContain(`zen-fs-config:rebuild-data-store:${appId}:g1`);
  });

  it('全部删除成功时 ok=true', async () => {
    (globalThis as any).indexedDB = {
      deleteDatabase() {
        const req: any = {};
        setTimeout(() => req.onsuccess?.(), 0);
        return req;
      },
    };
    const result = await clearLocalSyncConfig(appId, { groupIds: ['default'], timeoutMs: 60 });
    expect(result.ok).toBe(true);
    expect(result.failed).toEqual([]);
  });
});
