/**
 * SyncGroupConfiguratorElement — a Custom Element wrapping the core.
 *
 * Usage:
 *   <sync-group-configurator app-id="my-app"></sync-group-configurator>
 *   <sync-group-configurator
 *     app-id="my-app"
 *     backend-type="Gitee"
 *     backend-options='{"token":"xxx","owner":"weijia","repo":"configs"}'
 *   ></sync-group-configurator>
 *
 * Events: connected, backend-added, backend-removed, data-group-created, error
 */
import { SyncGroupConfiguratorCore } from '../core/configurator.js';
import type { BackendInfo, CoreEventMap, CoreEventName } from '../types.js';

const TAG = 'sync-group-configurator';

export class SyncGroupConfiguratorElement extends HTMLElement {
  private core: SyncGroupConfiguratorCore | null = null;
  private shadow: ShadowRoot;

  static get observedAttributes(): string[] {
    return ['app-id', 'node-id', 'backend-type', 'backend-options'];
  }

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    const appId = this.getAttribute('app-id');
    if (!appId) {
      this.shadow.innerHTML = '<div style="color:#dc2626;font-size:13px">[sync-group-configurator] app-id is required</div>';
      return;
    }

    const nodeId = this.getAttribute('node-id') ?? undefined;
    const backendType = this.getAttribute('backend-type') ?? undefined;
    const backendOptionsRaw = this.getAttribute('backend-options') ?? undefined;

    let backendInfo: BackendInfo | undefined;
    if (backendType) {
      let options: Record<string, unknown> = {};
      if (backendOptionsRaw) {
        try {
          options = JSON.parse(backendOptionsRaw);
        } catch {
          console.warn(`[${TAG}] invalid backend-options JSON, using empty options`);
        }
      }
      backendInfo = { type: backendType, options };
    }

    // Host the core inside a real div (ShadowRoot is not an HTMLElement).
    const host = document.createElement('div');
    this.shadow.appendChild(host);

    this.core = new SyncGroupConfiguratorCore(host, {
      appId,
      nodeId,
      backendInfo,
    });

    // Forward core events as CustomEvents
    const eventNames: CoreEventName[] = ['connected', 'backend-added', 'backend-removed', 'data-group-created', 'error'];
    for (const name of eventNames) {
      this.core.on(name, (data) => {
        this.dispatchEvent(new CustomEvent(name, { detail: data as CoreEventMap[typeof name], bubbles: true }));
      });
    }

    void this.core.mount();
  }

  disconnectedCallback(): void {
    this.core?.destroy();
    this.core = null;
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (!this.core || oldValue === newValue) return;

    if (name === 'backend-type' || name === 'backend-options') {
      const backendType = this.getAttribute('backend-type') ?? undefined;
      const backendOptionsRaw = this.getAttribute('backend-options') ?? undefined;
      let backendInfo: BackendInfo | undefined;
      if (backendType) {
        let options: Record<string, unknown> = {};
        if (backendOptionsRaw) {
          try { options = JSON.parse(backendOptionsRaw); } catch { /* ignore */ }
        }
        backendInfo = { type: backendType, options };
      }
      this.core.update({ backendInfo });
    }
  }
}

/** Register the custom element. Safe to call multiple times. */
export function defineSyncGroupConfigurator(): void {
  if (!customElements.get(TAG)) {
    customElements.define(TAG, SyncGroupConfiguratorElement);
  }
}
