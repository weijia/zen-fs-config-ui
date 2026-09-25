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
