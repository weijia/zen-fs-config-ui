/**
 * Web Component entry point.
 *
 * Importing this file auto-registers the <sync-group-configurator> element.
 */
export { SyncGroupConfiguratorElement, defineSyncGroupConfigurator } from './element.js';
export { SyncGroupConfiguratorV2Element, defineSyncGroupConfiguratorV2 } from './element-v2.js';
import { defineSyncGroupConfigurator } from './element.js';
import { defineSyncGroupConfiguratorV2 } from './element-v2.js';

// Auto-register when this module is loaded (e.g. via <script> tag).
if (typeof customElements !== 'undefined') {
  defineSyncGroupConfigurator();
  defineSyncGroupConfiguratorV2();
}
