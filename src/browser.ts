/**
 * Browser IIFE entry point.
 *
 * When loaded via a <script> tag, this:
 * 1. Auto-registers the <sync-group-configurator> custom element.
 * 2. Exposes `registerBackend` and `listBackendMetadata` on the global
 *    `ZenFSConfigUI` object so users can register backend types
 *    (Gitee, GitHub, WebDAV, …) from other CDN scripts.
 *
 * Usage:
 *   <script src="https://unpkg.com/zen-fs-config-ui"></script>
 *   <script>
 *     // Register a backend type from another CDN module
 *     const { factory, metadata } = await import('https://esm.sh/zen-fs-config-gitee');
 *     ZenFSConfigUI.registerBackend('Gitee', factory, metadata);
 *   </script>
 *   <sync-group-configurator app-id="my-app"></sync-group-configurator>
 */
import { registerBackend, listBackendMetadata } from 'zen-fs-config';
import './web-component/index.js';

export { registerBackend, listBackendMetadata };
