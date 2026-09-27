/**
 * Config string serialization / deserialization for backend descriptors.
 *
 * Ported from zen-fs-config-admin so the UI widget can share the same
 * portable string format: `type:id:key=value,key=value,desc=...`
 *
 * Example: GitHub:my-repo:owner=weijia,repo=zen-fs-config,branch=main
 */
import type { BackendMetadata } from '../types.js';

export interface SerializedBackend {
  type: string;
  id: string;
  options: Record<string, string>;
  description: string;
}

/**
 * Serialize a backend descriptor into a one-line config string.
 * Format: `type:id:key=value,key=value,desc=description`
 */
export function serializeBackend(
  type: string,
  id: string,
  options: Record<string, unknown>,
  description?: string,
): string {
  const opts = Object.entries(options ?? {})
    .filter(([, v]) => v !== '' && v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(',');
  const parts = [type, id];
  if (opts) parts.push(opts);
  if (description) parts.push(`desc=${description}`);
  return parts.join(':');
}

/**
 * Deserialize a config string into a partial backend descriptor.
 * Returns null if the string is invalid or the type is not registered.
 *
 * `metadataList` is the list of registered backend metadata (used to
 * validate the type and merge default options).
 */
export function deserializeBackend(
  str: string,
  metadataList: BackendMetadata[],
): SerializedBackend | null {
  const trimmed = str.trim();
  if (!trimmed) return null;

  const firstColon = trimmed.indexOf(':');
  if (firstColon < 0) return null;
  const type = trimmed.slice(0, firstColon);
  const meta = metadataList.find((m) => m.type === type);
  if (!meta) return null;

  const rest = trimmed.slice(firstColon + 1);
  const secondColon = rest.indexOf(':');
  let id: string;
  let optionsStr: string;
  if (secondColon < 0) {
    id = rest;
    optionsStr = '';
  } else {
    id = rest.slice(0, secondColon);
    optionsStr = rest.slice(secondColon + 1);
  }

  if (!id.trim()) return null;

  const options: Record<string, string> = { ...(meta.defaultOptions ?? {}) };
  let description = '';
  if (optionsStr) {
    for (const pair of optionsStr.split(',')) {
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const key = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (key === 'desc') {
        description = value;
      } else {
        options[key] = value;
      }
    }
  }

  return { type, id: id.trim(), options, description };
}
