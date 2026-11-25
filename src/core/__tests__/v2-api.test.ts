import { describe, it, expect, vi } from 'vitest';

const connections = new WeakMap<object, any>();
const repoToConnection = new WeakMap<object, any>();

vi.mock('zen-fs-config', () => {
  const connectionToAppRepo = (connection: any) => {
    const existing = connections.get(connection);
    if (existing) return existing;
    const repo = {
      appId: connection.appId,
      getDefaultDataGroup: async () => ({ id: 'default' }),
    };
    connections.set(connection, repo);
    repoToConnection.set(repo, connection);
    return repo;
  };
  return {
    connectV2: async (appId: string) => connectionToAppRepo({ appId, repo: {} }),
    connectionToAppRepo,
    getUiConnection: (repo: any) => {
      const connection = repoToConnection.get(repo);
      if (!connection) throw new Error('unknown repo');
      return connection;
    },
  };
});

describe('UI V2 runtime bridge', () => {
  it('preserves connection -> AppRepo identity', async () => {
    const bridge = await import('../v2-api.js');
    expect(bridge.hasV2Api()).toBe(true);

    const connection = { appId: 'golf', repo: {} } as any;
    const first = bridge.connectionToAppRepo(connection);
    const second = bridge.connectionToAppRepo(connection);
    expect(first).toBe(second);
    expect(bridge.getUiConnection(first)).toBe(connection);
  });

  it('connectV2 through the bridge returns a usable AppRepo', async () => {
    const bridge = await import('../v2-api.js');
    const api = bridge.requireV2Api();
    const repo = await api.connectV2('golf');
    expect(repo.appId).toBe('golf');
    expect(bridge.getUiConnection(repo).appId).toBe('golf');
  });
});
