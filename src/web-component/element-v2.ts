/**
 * <sync-group-configurator-v2> — V2 custom element.
 *
 * Uses connectV2() when `repo` is not supplied; otherwise it reuses the host's
 * AppRepo via getUiConnection(). The `repo-ready` event carries the AppRepo,
 * and getAppRepo() returns it on demand.
 */
import { SyncGroupConfiguratorCore } from '../core/configurator.js';
import type { AppRepoLike } from '../core/v2-api.js';
import type { BackendInfo, CoreEventMap, CoreEventName } from '../types.js';

const TAG = 'sync-group-configurator-v2';

function readBackendInfo(el: HTMLElement): BackendInfo | undefined {
  const backendType = el.getAttribute('backend-type') ?? undefined;
  if (!backendType) return undefined;
  let options: Record<string, unknown> = {};
  const raw = el.getAttribute('backend-options');
  if (raw) {
    try {
      options = JSON.parse(raw);
    } catch {
      console.warn(`[${TAG}] invalid backend-options JSON, using empty options`);
    }
  }
  return { type: backendType, options };
}

export class SyncGroupConfiguratorV2Element extends HTMLElement {
  /** Host-provided AppRepo; may be assigned before or after connecting. */
  repo?: AppRepoLike;

  private core: SyncGroupConfiguratorCore | null = null;
  private shadow: ShadowRoot;
  private lastConnected: unknown = null;
  private lastRepo: AppRepoLike | null = null;

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
      this.shadow.innerHTML = '<div style="color:#dc2626;font-size:13px">[sync-group-configurator-v2] app-id is required</div>';
      return;
    }

    const host = document.createElement('div');
    this.shadow.appendChild(host);

    this.core = new SyncGroupConfiguratorCore(host, {
      appId,
      nodeId: this.getAttribute('node-id') ?? undefined,
      backendInfo: readBackendInfo(this),
      repo: this.repo,
    });

    const eventNames: CoreEventName[] = [
      'connected',
      'backend-added',
      'backend-removed',
      'data-group-created',
      'sync',
      'error',
    ];
    for (const name of eventNames) {
      this.core.on(name, (data) => {
        if (name === 'connected') this.lastConnected = data;
        this.dispatchEvent(
          new CustomEvent(name, {
            detail: data as CoreEventMap[typeof name],
            bubbles: true,
          }),
        );
      });
    }

    void this.core.mountV2(this.repo).then((repo) => {
      if (!repo) return;
      this.lastRepo = repo;
      this.dispatchEvent(
        new CustomEvent('repo-ready', { detail: repo, bubbles: true }),
      );
    });
  }

  disconnectedCallback(): void {
    this.core?.destroy();
    this.core = null;
  }

  /** Last `connected` payload (repo / dataGroup / appRepo / backendInfo). */
  getConnection(): unknown {
    return this.lastConnected;
  }

  /** AppRepo returned by connectV2() or the host-provided one. */
  getAppRepo(): AppRepoLike | null {
    return this.core?.getAppRepo() ?? this.lastRepo;
  }

  /** Re-read the backend/group descriptors and re-render. */
  refresh(): Promise<void> {
    return this.core?.refresh() ?? Promise.resolve();
  }

  attributeChangedCallback(
    name: string,
    oldValue: string | null,
    newValue: string | null,
  ): void {
    if (!this.core || oldValue === newValue) return;
    if (name === 'backend-type' || name === 'backend-options') {
      this.core.update({ backendInfo: readBackendInfo(this) });
    }
  }
}

/** Register the V2 custom element. Safe to call multiple times. */
export function defineSyncGroupConfiguratorV2(): void {
  if (!customElements.get(TAG)) {
    customElements.define(TAG, SyncGroupConfiguratorV2Element);
  }
}
