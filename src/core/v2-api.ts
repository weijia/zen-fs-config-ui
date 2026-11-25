/**
 * Runtime bridge to the optional V2 API in zen-fs-config.
 *
 * The UI supports older zen-fs-config releases (>= 0.7), so V2 exports must be
 * looked up at runtime instead of being imported as named exports. A missing
 * export only disables the V2 path; the legacy SyncGroupConfigurator keeps
 * working unchanged.
 */
import * as ZenFSConfig from 'zen-fs-config';
import type { ConnectResult, IConfigRepo } from 'zen-fs-config';

export interface DataGroupLike {
  readonly id: string;
  readonly fs: unknown;
  addBackend(input: {
    id?: string;
    type: string;
    options: Record<string, unknown>;
    description?: string;
  }): Promise<{ backendId: string; addedBackend: boolean }>;
  flush?(): Promise<unknown[]>;
  deleteFile?(path: string): Promise<void>;
  onSyncEvent(handler: (event: unknown) => void): () => void;
}

export interface DataGroupInfoLike {
  id: string;
  name: string;
  hasRemote: boolean;
}

export interface AppRepoLike {
  readonly appId: string;
  getDefaultDataGroup(): Promise<DataGroupLike>;
  getDataGroup?(id: string): Promise<DataGroupLike>;
  listDataGroups?(): Promise<DataGroupInfoLike[]>;
}

export type UiConnection = ConnectResult & { appId: string };

interface V2Api {
  connectV2(
    appId: string,
    options?: {
      nodeId?: string;
      backendInfo?: { type: string; options: Record<string, unknown> };
    },
  ): Promise<AppRepoLike>;
  getUiConnection(repo: AppRepoLike): UiConnection;
  connectionToAppRepo(connection: UiConnection): AppRepoLike;
}

function v2Api(): V2Api | null {
  const api = ZenFSConfig as unknown as Partial<V2Api>;
  if (
    typeof api.connectV2 !== 'function' ||
    typeof api.getUiConnection !== 'function' ||
    typeof api.connectionToAppRepo !== 'function'
  ) {
    return null;
  }
  return api as V2Api;
}

export function hasV2Api(): boolean {
  return v2Api() !== null;
}

export function requireV2Api(): V2Api {
  const api = v2Api();
  if (!api) {
    throw new Error(
      'zen-fs-config V2 API is unavailable; install zen-fs-config with connectV2() support or pass a repo from the host',
    );
  }
  return api;
}

/** Wrap a legacy connect() result so hosts can use the same AppRepo surface. */
export function wrapConnectionAsAppRepo(connection: UiConnection): AppRepoLike | null {
  const api = v2Api();
  if (!api) return null;
  return api.connectionToAppRepo(connection);
}

export function connectionToAppRepo(connection: UiConnection): AppRepoLike {
  return requireV2Api().connectionToAppRepo(connection);
}

export function getUiConnection(repo: AppRepoLike): UiConnection {
  return requireV2Api().getUiConnection(repo);
}

/** Narrow a raw connection's repo without leaking the V2 types to callers. */
export function repoOf(connection: UiConnection): IConfigRepo | undefined {
  return connection.repo;
}
