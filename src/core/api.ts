/**
 * Thin wrapper around zen-fs-config so the core doesn't depend on exact
 * import paths and can be tested with mocks.
 */
import type {
  IConfigRepo,
  AppDataGroup,
  AppDataGroupDescriptor,
  AppDataBackendDescriptor,
  BackendDescriptor,
  ConfigSyncGroupDescriptor,
  SyncGroupType,
  ConnectResult,
} from 'zen-fs-config';
import {
  connect,
  listBackendMetadata,
  LOCAL_IDB_BACKEND_ID,
  deleteDataGroupLocalStore,
  dataGroupLocalStoreName,
  isLocalStorageUnavailableError,
  type BackendMetadata,
  type LocalStoreDeletionResult,
} from 'zen-fs-config';
import type { BackendInfo } from '../types.js';

export interface ApiBackendDescriptor {
  id: string;
  type: string;
  options: Record<string, unknown>;
  description?: string;
}

/**
 * ConfigRepo exposes updateAppDataGroupDescriptor on the concrete class, but
 * the IConfigRepo interface does not declare it. This local interface lets the
 * descriptor-level data-group helpers call it through a typed assertion.
 */
export interface RepoWithAppDataGroups extends IConfigRepo {
  listAppDataGroups(): Promise<AppDataGroupDescriptor[]>;
  getAppDataGroup(id: string): Promise<AppDataGroup>;
  updateAppDataGroupDescriptor(id: string, backends: AppDataBackendDescriptor[]): Promise<void>;
  removeAppDataGroup(id: string): Promise<void>;
}

/**
 * Connect to a sync group. Auto-detects group type from the remote backend.
 * If no backendInfo is given, falls back to local config-sync mode.
 */
export async function connectGroup(
  appId: string,
  backendInfo?: BackendInfo,
  nodeId?: string,
): Promise<ConnectResult> {
  return connect(appId, {
    backendInfo,
    nodeId,
    // New backends default to data-sync (per requirements).
    groupType: 'data-sync',
  });
}

/** Get the sync group type from a connect result. */
export function getGroupType(result: ConnectResult): SyncGroupType {
  return result.groupType;
}

/** List all registered backend types with form metadata. */
export function getBackendMetadataList(): BackendMetadata[] {
  return listBackendMetadata();
}

/**
 * Get the list of config-sync backends (excluding the local primary).
 */
export async function getConfigBackends(repo: IConfigRepo): Promise<BackendDescriptor[]> {
  const meta = await repo.getBackends();
  // zen-fs-config prepends the implicit local primary (`local-idb`) to the
  // descriptor list, but it is the sync *source* and never a removable
  // backend. The card renders it once as a read-only "隐式 source" row, so
  // drop it here to avoid a second, deletable duplicate entry.
  return (meta?.backends ?? []).filter((b) => b.id !== LOCAL_IDB_BACKEND_ID);
}

/**
 * Add a remote backend to the config-sync group as a replica.
 */
export async function addConfigBackend(
  repo: IConfigRepo,
  id: string,
  type: string,
  options: Record<string, unknown>,
  description?: string,
): Promise<void> {
  await repo.addBackend(id, type, options, description);
}

/**
 * Remove a remote replica backend from the config-sync group.
 */
export async function removeConfigBackend(repo: IConfigRepo, id: string): Promise<void> {
  await repo.removeBackend(id);
}

/**
 * List data-sync groups under a config-sync repo.
 */
export async function getDataGroups(repo: IConfigRepo): Promise<AppDataGroupDescriptor[]> {
  return repo.listAppDataGroups();
}

/**
 * Get a data-sync group handle (cached instance or load from descriptor).
 * Unlike createDataGroup, this never fails with "group already exists".
 */
export async function getAppDataGroup(repo: IConfigRepo, id: string): Promise<AppDataGroup> {
  return repo.getAppDataGroup(id);
}

/**
 * Delete an entire data-sync group (dispose its instance and remove its
 * descriptor from .meta/app-data-groups/{id}.json).
 */
export async function removeAppDataGroup(repo: IConfigRepo, groupId: string): Promise<void> {
  await (repo as RepoWithAppDataGroups).removeAppDataGroup(groupId);
}

/**
 * Add a backend to a data-sync group at the descriptor level.
 *
 * Like removeAppDataGroupBackend, this does NOT re-instantiate the group, so
 * it works deterministically even when the backend cannot be re-created.
 * Multiple remote backends can be added to the same group this way.
 */
export async function addAppDataGroupBackend(
  repo: IConfigRepo,
  groupId: string,
  backendId: string,
  type: string,
  options: Record<string, unknown>,
  description?: string,
): Promise<void> {
  const groups = await repo.listAppDataGroups();
  const dg = groups.find((g) => g.id === groupId);
  if (!dg) throw new Error(`Data group "${groupId}" not found`);
  if (dg.backends.some((b) => b.id === backendId)) {
    throw new Error(`Backend "${backendId}" already exists in data group "${groupId}"`);
  }
  const next = [...dg.backends, { id: backendId, type, options, description, createdAt: Date.now() }];
  await (repo as RepoWithAppDataGroups).updateAppDataGroupDescriptor(groupId, next);
}

/**
 * Remove a backend from a data-sync group at the descriptor level.
 *
 * This does NOT re-instantiate the group or its backends. Deleting via
 * getAppDataGroup().removeBackend() fails when a backend (e.g. an old Gitee
 * entry) cannot be re-instantiated, because init() skips failed backends and
 * removeBackend() then throws "Backend not found". Operating on the
 * .meta/app-data-groups/{id}.json descriptor directly is deterministic and
 * avoids that entire failure mode.
 */
export async function removeAppDataGroupBackend(
  repo: IConfigRepo,
  groupId: string,
  backendId: string,
): Promise<void> {
  const groups = await repo.listAppDataGroups();
  const dg = groups.find((g) => g.id === groupId);
  if (!dg) throw new Error(`Data group "${groupId}" not found`);
  if (!dg.backends.some((b) => b.id === backendId)) {
    throw new Error(`Backend "${backendId}" not found in data group "${groupId}"`);
  }
  const next = dg.backends.filter((b) => b.id !== backendId);
  await (repo as RepoWithAppDataGroups).updateAppDataGroupDescriptor(groupId, next);
}

/**
 * Create a new data-sync group under a config-sync repo.
 */
export async function createDataGroup(
  repo: IConfigRepo,
  id: string,
  backends: AppDataBackendDescriptor[],
): Promise<AppDataGroup> {
  return repo.createAppDataGroup(id, backends);
}

// ── Group display names (descriptor-only edits) ──────────────────────

/**
 * Read the config-sync group's own display descriptor. Absent until the user
 * renames it once; older repos simply return null.
 */
export async function getConfigGroupDescriptor(
  repo: IConfigRepo,
): Promise<ConfigSyncGroupDescriptor | null> {
  try {
    return await repo.getConfigSyncGroupDescriptor();
  } catch {
    return null;
  }
}

/**
 * Rename the config-sync group. Backends, sync pairs and remote data are
 * untouched — this only rewrites `.meta/config-sync-group.json`.
 */
export async function updateConfigGroupName(repo: IConfigRepo, name: string): Promise<void> {
  await repo.updateConfigSyncGroupDescriptor({ name });
}

/**
 * Rename a data-sync group. Backends, sync pairs and remote data are
 * untouched — this only rewrites its descriptor's `name` field.
 */
export async function updateDataGroupName(
  repo: IConfigRepo,
  groupId: string,
  name: string,
): Promise<void> {
  await repo.updateAppDataGroupName(groupId, name);
}

/**
 * Replace a config-sync backend's parameters in place. The old pair is torn
 * down and a new pair is created against the new target (initial sync runs
 * immediately). Old remote data is not migrated.
 */
export async function replaceConfigBackend(
  repo: IConfigRepo,
  id: string,
  type: string,
  options: Record<string, unknown>,
  description?: string,
): Promise<void> {
  await repo.replaceBackend(id, type, options, description);
}

/**
 * Replace a data-sync backend's parameters in place. Same semantics as
 * replaceConfigBackend. Returns the rebuilt live group handle.
 */
export async function replaceDataGroupBackend(
  repo: IConfigRepo,
  groupId: string,
  backendId: string,
  type: string,
  options: Record<string, unknown>,
  description?: string,
): Promise<AppDataGroup> {
  return repo.replaceAppDataGroupBackend(groupId, backendId, type, options, description);
}

// ── Legacy `app-data` group migration ────────────────────────────────

export interface LegacyAppDataGroupMatch {
  groupId: string;
  backend: AppDataBackendDescriptor;
}

/**
 * Detect the data group that older dir-struct-gen versions created
 * automatically: id `app-data` with a RemoteStorage backend `rs-app`.
 *
 * Newer versions never create it, but the descriptor was persisted in the
 * config-sync repo (local IndexedDB and/or remote `.meta/app-data-groups/`),
 * so it keeps showing up on every session. Detection is pure so it can be
 * unit-tested without a repo.
 */
export function detectLegacyAppDataGroup(
  groups: AppDataGroupDescriptor[],
): LegacyAppDataGroupMatch | null {
  const group = groups.find((g) => g.id === 'app-data');
  if (!group) return null;
  const backend = group.backends.find(
    (b) => b.id === 'rs-app' && b.type === 'RemoteStorage',
  );
  return backend ? { groupId: group.id, backend } : null;
}

/**
 * Explicit, non-destructive migration of the legacy group:
 *
 * 1. Ensure the `default` group exists (created without backends so no remote
 *    connection is attempted).
 * 2. Attach the `rs-app` RemoteStorage backend to the live `default` group
 *    instance (`addBackend`), so uploads keep working in the current session
 *    even if `app-data` was the only group — a descriptor-only copy would
 *    leave the instantiated group without its remote target until reload.
 * 3. Remove only the `app-data` descriptor; remote files stay untouched.
 *
 * After this, detection returns null, so the UI stops prompting on every
 * subsequent startup. Only call this from an explicit user action.
 */
export async function migrateLegacyAppDataGroup(
  repo: IConfigRepo,
): Promise<{ migrated: boolean; targetGroupId: string }> {
  const groups = await repo.listAppDataGroups();
  const found = detectLegacyAppDataGroup(groups);
  if (!found) return { migrated: false, targetGroupId: '' };

  const targetId = 'default';
  if (!groups.some((g) => g.id === targetId)) {
    // Empty group first: avoids instantiating the remote backend during
    // creation, which may fail when the remote is temporarily unreachable.
    await repo.createAppDataGroup(targetId, []);
  }

  // Attach through the live group instance: `addBackend` persists the
  // descriptor itself and wires the remote sync pair immediately, so the host
  // app can keep uploading without a reload.
  const targetGroup = await (repo as RepoWithAppDataGroups).getAppDataGroup(targetId);
  if (!targetGroup.listBackends().some((b) => b.id === found.backend.id)) {
    await targetGroup.addBackend(
      found.backend.id,
      found.backend.type,
      found.backend.options,
      found.backend.description,
    );
  }

  await removeAppDataGroup(repo, 'app-data');
  return { migrated: true, targetGroupId: targetId };
}

/**
 * Add a backend to a standalone data-sync group.
 */
export async function addDataBackend(
  dataGroup: AppDataGroup,
  id: string,
  type: string,
  options: Record<string, unknown>,
  description?: string,
): Promise<void> {
  await dataGroup.addBackend(id, type, options, description);
}

/**
 * Remove a backend from a standalone data-sync group.
 */
export async function removeDataBackend(dataGroup: AppDataGroup, id: string): Promise<void> {
  await dataGroup.removeBackend(id);
}

/**
 * List backends in a standalone data-sync group.
 *
 * The group's own `.meta/backends/` is the authority; `listBackends()` only
 * reflects the backends that managed to connect in this session. Prefer the
 * declared list so a temporarily unreachable backend still shows up.
 */
export function listDataBackends(dataGroup: AppDataGroup): BackendDescriptor[] {
  const declared = typeof dataGroup.listDeclaredBackends === 'function'
    ? dataGroup.listDeclaredBackends()
    : null;
  return declared && declared.length > 0 ? declared : dataGroup.listBackends();
}

// ── 本地数据组存储损坏：识别、提示、重建 ────────────────────────────

/** 面向用户的明确提示（页面直接展示，不再降级成“没有可用的数据同步组”）。 */
export const LOCAL_STORAGE_UNAVAILABLE_MESSAGE =
  '本地数据组存储已损坏，需要重建：该组的浏览器 IndexedDB 记录不可读。'
  + '重建会删除本地未同步的改动（远端数据不受影响），并从远端重新拉取。';

export interface DataGroupErrorInfo {
  kind: 'local-storage-unavailable' | 'other';
  /** 原始错误文本（含 name/code/message，不做概括）。 */
  message: string;
  /** 本地存储不可用时，可重建的目标库名。 */
  storeName?: string;
}

/** 把数据组实例化/读取错误分类：本地存储不可用必须可与普通错误区分。 */
export function describeDataGroupError(
  err: unknown,
  appId: string,
  groupId: string,
): DataGroupErrorInfo {
  if (isLocalStorageUnavailableError(err)) {
    return {
      kind: 'local-storage-unavailable',
      message: LOCAL_STORAGE_UNAVAILABLE_MESSAGE + '\n原始错误：' + errorText(err),
      storeName: dataGroupLocalStoreName(appId, groupId),
    };
  }
  return { kind: 'other', message: errorText(err) };
}

function errorText(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { name?: string; code?: string; message?: string; cause?: unknown };
    const head = [e.name, e.code, e.message].filter(Boolean).join(': ') || String(err);
    return e.cause ? head + ' ← ' + errorText(e.cause) : head;
  }
  return String(err);
}

export interface DataGroupFlushResult {
  attempted: boolean;
  ok: boolean;
  error: string | null;
}

/**
 * 重建前尽力把能推的推上去：只有数据组当前能实例化时才可能同步。
 * 不 dispose 已连好的组（避免在有活跃连接时删库）。
 */
export async function flushDataGroupBeforeRebuild(
  repo: IConfigRepo,
  groupId: string,
): Promise<DataGroupFlushResult> {
  const result: DataGroupFlushResult = { attempted: true, ok: false, error: null };
  try {
    const dg = await (repo as RepoWithAppDataGroups).getAppDataGroup(groupId);
    const syncNow = (dg as unknown as { syncNow?: () => Promise<unknown> }).syncNow;
    if (typeof syncNow !== 'function') {
      result.error = '该数据组没有 syncNow()，跳过重建前同步';
      return result;
    }
    await syncNow.call(dg);
    result.ok = true;
  } catch (err) {
    result.error = errorText(err);
  }
  return result;
}

const REBUILD_MARKER_PREFIX = 'zen-fs-config:rebuild-data-store:';

export interface PendingStoreRebuild {
  groupId: string;
  storeName: string;
  requestedAt: number;
}

/**
 * 登记“下次启动前重建该数据组本地存储”。
 *
 * 为什么不在当前页面直接删库：损坏的组在 init 时已经打开了 IndexedDB 连接，
 * 同一页面 deleteDatabase 会一直 `blocked`。刷新后旧连接随页面销毁，删除才会
 * 真正完成。页面应在挂载同步组组件**之前**调用
 * {@link runPendingDataGroupStorageRebuild}。
 */
export function scheduleDataGroupStorageRebuild(
  appId: string,
  groupId: string,
): PendingStoreRebuild {
  const pending: PendingStoreRebuild = {
    groupId,
    storeName: dataGroupLocalStoreName(appId, groupId),
    requestedAt: Date.now(),
  };
  const storage = safeLocalStorage();
  if (!storage) throw new Error('当前环境没有 localStorage：无法登记本地存储重建');
  storage.setItem(REBUILD_MARKER_PREFIX + appId + ':' + groupId, JSON.stringify(pending));
  return pending;
}

export interface StoreRebuildOutcome extends PendingStoreRebuild {
  deletion: LocalStoreDeletionResult;
  /** 删除完成后标记已清除（下次启动只需重新连接即可从远端拉取）。 */
  cleared: boolean;
}

/**
 * 启动时执行已登记的本地库删除（必须在任何组件连接该数据组之前调用）。
 * 只删本组独占库；被其它标签页占用时保留标记并如实返回 blocked。
 */
export async function runPendingDataGroupStorageRebuild(
  appId: string,
  options: { timeoutMs?: number } = {},
): Promise<StoreRebuildOutcome[]> {
  const storage = safeLocalStorage();
  if (!storage) return [];
  const prefix = REBUILD_MARKER_PREFIX + appId + ':';
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && key.startsWith(prefix)) keys.push(key);
  }
  const outcomes: StoreRebuildOutcome[] = [];
  for (const key of keys) {
    let pending: PendingStoreRebuild;
    try {
      pending = JSON.parse(storage.getItem(key) || '{}') as PendingStoreRebuild;
    } catch {
      storage.removeItem(key);
      continue;
    }
    if (!pending.groupId) {
      storage.removeItem(key);
      continue;
    }
    const deletion = await deleteDataGroupLocalStore(appId, pending.groupId, options);
    const cleared = deletion.deleted;
    if (cleared) storage.removeItem(key);
    outcomes.push({ ...pending, deletion, cleared });
  }
  return outcomes;
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
