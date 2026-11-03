import { describe, it, expect } from 'vitest';
import type { AppDataGroupDescriptor } from 'zen-fs-config';
import {
  detectLegacyAppDataGroup,
  migrateLegacyAppDataGroup,
} from '../api.js';

const legacyBackend = {
  id: 'rs-app',
  type: 'RemoteStorage',
  options: { href: 'https://storage.5apps.com/weijia', token: 't' },
  description: 'legacy',
  createdAt: 1,
};

function makeGroup(id: string, backends: unknown[] = []): AppDataGroupDescriptor {
  return { id, groupType: 'data-sync', backends } as AppDataGroupDescriptor;
}

/**
 * Fake repo with both descriptor-level APIs and live group instances,
 * mirroring ConfigRepo: `addBackend` on the live group also rewrites its
 * descriptor (FR2.3).
 */
function createFakeRepo(initial: AppDataGroupDescriptor[]) {
  let groups = structuredClone(initial);
  interface FakeLiveGroup {
    addCalls: string[];
    listBackends: () => { id: string; type: string }[];
    addBackend: (
      backendId: string,
      type: string,
      options: Record<string, unknown>,
      description?: string,
    ) => Promise<void>;
  }
  const live = new Map<string, FakeLiveGroup>();

  const makeLive = (id: string) => {
    const group = {
      addCalls: [] as string[],
      listBackends: () => (groups.find((g) => g.id === id)?.backends ?? []),
      addBackend: async (
        backendId: string,
        type: string,
        options: Record<string, unknown>,
        description?: string,
      ) => {
        const target = groups.find((g) => g.id === id);
        if (!target) throw new Error(`Data group "${id}" not found`);
        if (target.backends.some((b: { id: string }) => b.id === backendId)) {
          throw new Error(`Backend "${backendId}" already exists`);
        }
        target.backends.push({ id: backendId, type, options, description, createdAt: Date.now() });
        group.addCalls.push(backendId);
      },
    };
    live.set(id, group);
    return group;
  };

  groups.forEach((g) => makeLive(g.id));

  return {
    list: () => structuredClone(groups),
    listAppDataGroups: async () => structuredClone(groups),
    getAppDataGroup: async (id: string) => {
      const group = live.get(id) ?? makeLive(id);
      if (!groups.some((g) => g.id === id)) throw new Error(`App data group "${id}" not found`);
      return group;
    },
    createAppDataGroup: async (id: string) => {
      groups = [...groups, makeGroup(id)];
      return makeLive(id);
    },
    updateAppDataGroupDescriptor: async (id: string, backends: unknown[]) => {
      groups = groups.map((g) => (g.id === id ? makeGroup(g.id, backends) : g));
    },
    removeAppDataGroup: async (id: string) => {
      groups = groups.filter((g) => g.id !== id);
      live.delete(id);
    },
    /** Test helper: live instance of a group (to inspect addBackend calls). */
    live: (id: string) => live.get(id),
  };
}

describe('detectLegacyAppDataGroup', () => {
  it('recognizes app-data + rs-app RemoteStorage', () => {
    const match = detectLegacyAppDataGroup([makeGroup('app-data', [legacyBackend])]);
    expect(match?.groupId).toBe('app-data');
    expect(match?.backend.type).toBe('RemoteStorage');
  });

  it('ignores other groups or other backend ids', () => {
    expect(detectLegacyAppDataGroup([makeGroup('app-data', [{ ...legacyBackend, id: 'other' }])])).toBeNull();
    expect(detectLegacyAppDataGroup([makeGroup('default', [legacyBackend])])).toBeNull();
  });
});

describe('migrateLegacyAppDataGroup', () => {
  it('moves the rs-app backend into default and removes app-data', async () => {
    const repo = createFakeRepo([makeGroup('app-data', [legacyBackend])]);
    const result = await migrateLegacyAppDataGroup(repo as never);
    expect(result).toEqual({ migrated: true, targetGroupId: 'default' });

    const after = repo.list();
    expect(after.map((g) => g.id)).toEqual(['default']);
    expect(after[0].backends.map((b: { id: string }) => b.id)).toEqual(['rs-app']);
    // 清理后再次检测 → 不再提示
    expect(detectLegacyAppDataGroup(after)).toBeNull();
  });

  it('keeps upload target working in-session when app-data was the only group', async () => {
    const repo = createFakeRepo([makeGroup('app-data', [legacyBackend])]);
    await migrateLegacyAppDataGroup(repo as never);

    // 远端后端是在「活实例」上接管的，而不是只写描述符：宿主无需刷新即可上传
    expect(repo.live('default')?.addCalls).toEqual(['rs-app']);
    const backends = repo.live('default')?.listBackends() as { type: string }[];
    expect(backends.some((b) => b.type === 'RemoteStorage')).toBe(true);
    // 描述符同步 payload 也包含该远端后端
    expect(repo.list()[0].backends.some((b) => (b as { type: string }).type === 'RemoteStorage')).toBe(true);
  });

  it('does not duplicate rs-app when default already has it', async () => {
    const repo = createFakeRepo([
      makeGroup('default', [legacyBackend]),
      makeGroup('app-data', [legacyBackend]),
    ]);
    await migrateLegacyAppDataGroup(repo as never);
    const after = repo.list();
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe('default');
    expect(after[0].backends).toHaveLength(1);
    expect(repo.live('default')?.addCalls).toEqual([]);
  });

  it('is a no-op when the legacy group is absent', async () => {
    const repo = createFakeRepo([]);
    expect(await migrateLegacyAppDataGroup(repo as never)).toEqual({
      migrated: false,
      targetGroupId: '',
    });
    expect(repo.live('default')).toBeUndefined();
  });
});
