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
    backendInfo?: BackendInfo;
  };
  'backend-added': { backendId: string; type: string; groupType: GroupMode };
  'backend-removed': { backendId: string };
  'data-group-created': { groupId: string; dataGroup?: unknown };
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
