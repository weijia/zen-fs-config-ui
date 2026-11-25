/**
 * Public types for zen-fs-config-ui.
 */

/** Information needed to connect to a remote backend. */
export interface BackendInfo {
  type: string;
  options: Record<string, unknown>;
}

/** Props accepted by the core (and forwarded by WC / React wrappers). */
export interface CoreProps {
  /** Application identifier. */
  appId: string;
  /** Node identifier (auto-generated if omitted). */
  nodeId?: string;
  /** Optional remote backend to connect on mount. */
  backendInfo?: BackendInfo;
  /**
   * Optional AppRepo from connectV2(). When present, the core switches to the
   * V2 path and does not call connect() again.
   */
  repo?: import('./core/v2-api.js').AppRepoLike;
}

/** Sync group mode. */
export type GroupMode = 'initial' | 'config-sync' | 'data-sync';

/** Event callback map. */
export interface CoreEventMap {
  // `repo` (config-sync) / `dataGroup` (data-sync) / `backendInfo` carry the
  // live object references so a host app can grab the data group's `fs` and
  // programmatically manage the app's data-sync group (e.g. auto-create it
  // with a RemoteStorage backend). They are plain object references (not
  // cloned) because the event is dispatched in the same document.
  connected: {
    groupType: GroupMode;
    backendId?: string;
    repo?: unknown;
    dataGroup?: unknown;
    /** AppRepo from connectV2(), when the V2 path is active. */
    appRepo?: unknown;
    backendInfo?: BackendInfo;
  };
  'backend-added': { backendId: string; type: string; groupType: GroupMode };
  'backend-removed': { backendId: string };
  'data-group-created': { groupId: string; dataGroup?: unknown };
  /**
   * 同步对完成/失败（来自 zen-fs-config 的 `onSyncEvent`）。
   * `sync:end` 每轮都会发，包含零变更轮；用 `result` 计数过滤真实变更。
   */
  'sync': {
    type: 'sync:start' | 'sync:progress' | 'sync:end' | 'sync:error' | 'conflict';
    groupKind: 'config' | 'data';
    groupId: string;
    backendId: string;
    pairId: string;
    timestamp: number;
    result?: {
      filesCreated?: number;
      filesUpdated?: number;
      filesDeleted?: number;
      filesSkipped?: number;
      conflicts?: unknown[];
      errors?: { path?: string; message: string }[];
      durationMs?: number;
      timestamp?: number;
    };
    error?: string;
    progress?: {
      processed: number;
      total?: number;
      currentPath?: string;
      phase?: string;
    };
    conflict?: unknown;
  };
  error: { message: string };
}

export type CoreEventName = keyof CoreEventMap;

/** Event listener signature. */
export type CoreEventListener<K extends CoreEventName = CoreEventName> = (
  data: CoreEventMap[K],
) => void;

/** Backend metadata subset we use from zen-fs-config. */
export interface BackendParamDef {
  key: string;
  label: string;
  type: 'text' | 'password' | 'select';
  placeholder?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
}

export interface BackendMetadata {
  type: string;
  label: string;
  icon: string;
  fields: BackendParamDef[];
  defaultOptions: Record<string, string>;
  accountFields?: string[];
}
