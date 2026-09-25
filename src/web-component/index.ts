/**
 * Web Component entry point.
 *
 * Importing this file auto-registers the <sync-group-configurator> element.
 */
export { SyncGroupConfiguratorElement, defineSyncGroupConfigurator } from './element.js';
import { defineSyncGroupConfigurator } from './element.js';

// Auto-register when this module is loaded (e.g. via <script> tag).
if (typeof customElements !== 'undefined') {
  defineSyncGroupConfigurator();
}
