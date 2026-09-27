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
import { registerBackend, listBackendMetadata, wrapZenFSFileSystem } from 'zen-fs-config';
import './web-component/index.js';

export { registerBackend, listBackendMetadata, wrapZenFSFileSystem };
