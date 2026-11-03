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

/** Minimal fake repo covering the descriptor-level helpers. */
function createFakeRepo(initial: AppDataGroupDescriptor[]) {
  let groups = structuredClone(initial);
  return {
    list: () => structuredClone(groups),
    listAppDataGroups: async () => structuredClone(groups),
    createAppDataGroup: async (id: string) => {
      groups = [...groups, makeGroup(id)];
      return {} as never;
    },
    updateAppDataGroupDescriptor: async (id: string, backends: unknown[]) => {
      groups = groups.map((g) => (g.id === id ? makeGroup(g.id, backends) : g));
    },
    removeAppDataGroup: async (id: string) => {
      groups = groups.filter((g) => g.id !== id);
    },
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
    expect(after[0].backends.map((b) => b.id)).toEqual(['rs-app']);
    // 清理后再次检测 → 不再提示
    expect(detectLegacyAppDataGroup(after)).toBeNull();
  });

  it('keeps upload target working when app-data was the only group', async () => {
    const repo = createFakeRepo([makeGroup('app-data', [legacyBackend])]);
    await migrateLegacyAppDataGroup(repo as never);
    const after = repo.list();
    expect(after.some((g) => g.backends.some((b) => b.type === 'RemoteStorage'))).toBe(true);
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
  });

  it('is a no-op when the legacy group is absent', async () => {
    const repo = createFakeRepo([]);
    expect(await migrateLegacyAppDataGroup(repo as never)).toEqual({
      migrated: false,
      targetGroupId: '',
    });
  });
});
