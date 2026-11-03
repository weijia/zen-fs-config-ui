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
  SyncGroupType,
  ConnectResult,
} from 'zen-fs-config';
import {
  connect,
  listBackendMetadata,
  type BackendMetadata,
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
  return meta?.backends ?? [];
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
 */
export function listDataBackends(dataGroup: AppDataGroup): BackendDescriptor[] {
  return dataGroup.listBackends();
}
