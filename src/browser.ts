/**
 * Browser IIFE entry point.
 *
 * When loaded via a <script> tag, this:
 * 1. Auto-registers the <sync-group-configurator> custom element.
 * 2. Exposes `registerBackend`, `listBackendMetadata`, and `wrapZenFSFileSystem`
 *    on the global `ZenFSConfigUI` object so users can register backend types
 *    (Gitee, RemoteStorage, …) from other CDN scripts.
 *
 * Usage:
 *   <script src="https://unpkg.com/zen-fs-config-ui"></script>
 *   <script src="https://unpkg.com/zen-fs-gitee/dist/zen-fs-gitee.global.js"></script>
 *   <script>
 *     ZenFSConfigUI.registerBackend('Gitee', async (options) => {
 *       return ZenFSConfigUI.wrapZenFSFileSystem({ backend: ZenFSGitee.Gitee, ...options });
 *     }, { type: 'Gitee', label: 'Gitee', icon: '🐙', fields: [...] });
 *   </script>
 *   <sync-group-configurator app-id="my-app"></sync-group-configurator>
 */
import { registerBackend, listBackendMetadata, wrapZenFSFileSystem as _wrapZenFSFileSystem } from 'zen-fs-config';
import { serializeBackend, deserializeBackend } from './core/config-string.js';
import './web-component/index.js';

// FileSystem-like duck-typing: enough methods for the wrapper to work.
function isFileSystemLike(obj: unknown): boolean {
  if (obj == null || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.stat === 'function' &&
    typeof o.read === 'function' &&
    typeof o.write === 'function' &&
    typeof o.readdir === 'function' &&
    typeof o.exists === 'function'
  );
}

/**
 * Wraps a ZenFS FileSystem or BackendConfig into a zen-fs-config BackendInstance.
 *
 * Falls back to duck-typing when `resolveMountConfig` fails due to cross-package
 * `instanceof FileSystem` mismatch (e.g. RemoteStorage from a separate CDN bundle).
 */
async function wrapZenFSFileSystem(config: unknown) {
  try {
    return await _wrapZenFSFileSystem(config);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      (msg.includes('Invalid mount configuration') || msg.includes('Invalid single mount point')) &&
      isFileSystemLike(config)
    ) {
      // Cross-package FileSystem: bypass resolveMountConfig and wrap directly.
      const fs = config as Record<string, (...args: unknown[]) => unknown>;
      let changeCallback: (() => void) | null = null;
      const notifyChange = () => { if (changeCallback) changeCallback(); };

      const backend = {
        async readFile(path: string, ...args: unknown[]) {
          const st = await fs.stat(path) as { size: number };
          const buf = new Uint8Array(st.size);
          await fs.read(path, buf, 0, st.size);
          if (args[0] === 'utf-8') return new TextDecoder().decode(buf);
          return buf;
        },
        async writeFile(path: string, data: unknown, options?: { mtime?: number }) {
          const bytes = data instanceof ArrayBuffer ? new Uint8Array(data)
            : data instanceof Uint8Array ? data
            : new TextEncoder().encode(data as string);
          const parts = path.split('/').filter(Boolean);
          parts.pop();
          let dir = '';
          for (const p of parts) {
            dir += '/' + p;
            if (!(await fs.exists(dir))) {
              await fs.mkdir(dir, { uid: 0, gid: 0, mode: 0o755 });
            }
          }
          if (!(await fs.exists(path))) {
            await fs.createFile(path, { uid: 0, gid: 0, mode: 0o644 });
          }
          await fs.write(path, bytes, 0);
          try {
            await fs.touch(path, { size: bytes.byteLength, mtimeMs: options?.mtime ?? Date.now() });
          } catch { /* touch may not exist on all implementations */ }
          notifyChange();
        },
        async readdir(path: string) {
          return fs.readdir(path);
        },
        async stat(path: string) {
          const st = await fs.stat(path) as Record<string, unknown>;
          return {
            mode: typeof st.mode === 'number' ? st.mode : undefined,
            size: st.size as number,
            mtimeMs: (st.mtimeMs ?? st.mtime ?? 0) as number,
          };
        },
        async exists(path: string) {
          return fs.exists(path);
        },
        async mkdir(path: string, options?: unknown) {
          return fs.mkdir(path, options ?? { uid: 0, gid: 0, mode: 0o755 });
        },
        async unlink(path: string) {
          await fs.unlink(path);
          notifyChange();
        },
        async rmdir(path: string) {
          return fs.rmdir(path);
        },
        async rename(oldPath: string, newPath: string) {
          await fs.rename(oldPath, newPath);
          notifyChange();
        },
        onChange: (callback: () => void) => { changeCallback = callback; },
      };

      // Expose optional methods if they exist on the underlying FS.
      if (typeof fs.createSnapshot === 'function') {
        (backend as Record<string, unknown>).createSnapshot = (root: unknown, filter: unknown) =>
          fs.createSnapshot(root, filter);
      }
      if (typeof fs.writeFileWithMtime === 'function') {
        (backend as Record<string, unknown>).writeFileWithMtime = (path: string, data: unknown, mtimeMs: number) =>
          fs.writeFileWithMtime(path, data, mtimeMs);
      }

      return backend;
    }
    throw err;
  }
}

export {
  registerBackend,
  listBackendMetadata,
  wrapZenFSFileSystem,
  serializeBackend,
  deserializeBackend,
};
