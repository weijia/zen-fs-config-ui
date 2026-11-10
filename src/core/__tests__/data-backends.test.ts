import { describe, it, expect } from 'vitest';
import type { AppDataGroup } from 'zen-fs-config';
import { listDataBackends } from '../api.js';

const connected = { id: 'gitee-1', type: 'Gitee', options: {}, description: '' };
const offline = { id: 'remotestorage-1', type: 'RemoteStorage', options: {}, description: '' };

function fakeGroup(declared: unknown[] | undefined, live: unknown[]): AppDataGroup {
  return {
    listBackends: () => live,
    ...(declared === undefined ? {} : { listDeclaredBackends: () => declared }),
  } as unknown as AppDataGroup;
}

describe('listDataBackends', () => {
  it('prefers the declared list over the connected view', () => {
    const group = fakeGroup([connected, offline], [connected]);
    expect(listDataBackends(group).map((b) => b.id)).toEqual(['gitee-1', 'remotestorage-1']);
  });

  it('falls back to the connected view when nothing is declared', () => {
    expect(listDataBackends(fakeGroup([], [connected])).map((b) => b.id)).toEqual(['gitee-1']);
  });

  it('supports groups without listDeclaredBackends', () => {
    expect(listDataBackends(fakeGroup(undefined, [connected])).map((b) => b.id)).toEqual(['gitee-1']);
  });
});
