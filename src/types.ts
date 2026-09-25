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
  connected: { groupType: GroupMode; backendId?: string };
  'backend-added': { backendId: string; type: string; groupType: GroupMode };
  'backend-removed': { backendId: string };
  'data-group-created': { groupId: string };
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
