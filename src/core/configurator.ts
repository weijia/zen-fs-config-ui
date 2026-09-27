/**
 * SyncGroupConfiguratorCore — the framework-agnostic heart of the widget.
 *
 * Manages state, talks to zen-fs-config, and renders DOM into the given
 * container. Used by both the Web Component and the React wrapper.
 */
import type {
  IConfigRepo,
  AppDataGroup,
  BackendDescriptor,
  AppDataGroupDescriptor,
} from 'zen-fs-config';
import type {
  CoreProps,
  GroupMode,
  CoreEventName,
  CoreEventMap,
  CoreEventListener,
  BackendMetadata,
  BackendInfo,
} from '../types.js';
import {
  connectGroup,
  getConfigBackends,
  addConfigBackend,
  removeConfigBackend,
  getDataGroups,
  addDataBackend,
  removeDataBackend,
  listDataBackends,
  getBackendMetadataList,
} from './api.js';
import { el, on, clear } from './render.js';
import { STYLES } from './styles.js';
import { openBackendForm } from './views/backend-form.js';
import { serializeBackend } from './config-string.js';

/** UI version — injected by tsup from package.json at build time. */
declare const __APP_VERSION__: string;

const LOCAL_BACKEND_TYPES = new Set(['IndexedDB', 'InMemory']);

const STORAGE_KEY = 'zenfs-config-ui:backend';

export class SyncGroupConfiguratorCore {
  private container: HTMLElement;
  private props: CoreProps;
  private destroyed = false;

  private mode: GroupMode = 'initial';
  private connecting = false;
  private backgroundConnecting = false;
  private error: string | null = null;

  private repo: IConfigRepo | null = null;
  private dataGroup: AppDataGroup | null = null;

  private configBackends: BackendDescriptor[] = [];
  private dataGroups: AppDataGroupDescriptor[] = [];
  private dataBackends: BackendDescriptor[] = [];

  private metadata: BackendMetadata[] = [];
  private styleEl: HTMLStyleElement | null = null;
  private showForm = false;
  private formContainer: HTMLElement | null = null;
  private formKind: 'backend' | 'data-group' = 'backend';

  private listeners: Map<CoreEventName, Set<CoreEventListener>> = new Map();

  constructor(container: HTMLElement, props: CoreProps) {
    this.container = container;
    this.container.classList.add('zfui-root');
    this.props = { ...props };
    this.injectStyles();
    this.logVersion();
  }

  // ── Version logging ──────────────────────────────────────────────────

  private logVersion(): void {
    const uiVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
    console.log(
      `%c[zen-fs-config-ui] v${uiVersion}%c (appId=${this.props.appId})`,
      'color:#2563eb;font-weight:bold',
      'color:inherit',
    );
  }

  // ── BackendInfo persistence ─────────────────────────────────────────
  // zen-fs-config saves backend descriptors on the remote itself
  // (/.meta/backends/*.json). The UI only needs to persist the
  // *connection info* (BackendInfo: type + options) so it knows which
  // remote to reconnect to after a page refresh.
  //
  // In sandbox iframes (about:srcdoc), localStorage is ephemeral — each
  // iframe recreation starts fresh. We try multiple storage layers:
  // localStorage → sessionStorage → cookie. If all fail, the user must
  // pass backend-type/backend-options as HTML attributes.

  private saveBackendInfo(info: BackendInfo): void {
    const str = JSON.stringify(info);
    // Layer 1: localStorage (works in production)
    try { localStorage.setItem(STORAGE_KEY, str); return; } catch { /* fall through */ }
    // Layer 2: sessionStorage (might survive in some sandboxes)
    try { sessionStorage.setItem(STORAGE_KEY, str); return; } catch { /* fall through */ }
    // Layer 3: cookie (limited size but might persist)
    try {
      document.cookie = `${STORAGE_KEY}=${encodeURIComponent(str)};path=/;max-age=31536000`;
      console.log('[zen-fs-config-ui] saved BackendInfo to cookie (localStorage unavailable)');
      return;
    } catch { /* give up */ }
    console.warn('[zen-fs-config-ui] no storage available — BackendInfo not persisted');
  }

  private loadBackendInfo(): BackendInfo | null {
    // Layer 1: localStorage
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return this.parseBackendInfo(raw);
    } catch { /* fall through */ }
    // Layer 2: sessionStorage
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) return this.parseBackendInfo(raw);
    } catch { /* fall through */ }
    // Layer 3: cookie
    try {
      const match = document.cookie.match(/zenfs-config-ui:backend=([^;]+)/);
      if (match) return this.parseBackendInfo(decodeURIComponent(match[1]));
    } catch { /* fall through */ }
    return null;
  }

  private parseBackendInfo(raw: string): BackendInfo | null {
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.type && parsed?.options) {
        console.log(`[zen-fs-config-ui] restored BackendInfo: type=${parsed.type}`);
        return parsed;
      }
    } catch { /* ignore */ }
    return null;
  }

  private clearBackendInfo(): void {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    try {
      document.cookie = `${STORAGE_KEY}=;path=/;max-age=0`;
    } catch { /* ignore */ }
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  async mount(): Promise<void> {
    this.metadata = getBackendMetadataList().filter(
      (m) => !LOCAL_BACKEND_TYPES.has(m.type),
    );
    if (this.props.backendInfo) {
      await this.connect(this.props.backendInfo);
    } else {
      const saved = this.loadBackendInfo();
      if (saved) {
        // Restore: connect in background, zen-fs-config will read the
        // full backend list from the remote's /.meta/backends/.
        this.backgroundConnecting = true;
        this.render();
        void this.connect(saved, true);
      } else {
        await this.connect(undefined);
      }
    }
  }

  update(props: Partial<CoreProps>): void {
    this.props = { ...this.props, ...props };
    if (props.backendInfo && this.mode === 'initial') {
      void this.connect(props.backendInfo);
    }
  }

  destroy(): void {
    this.destroyed = true;
    clear(this.container);
    if (this.styleEl) this.styleEl.remove();
    this.listeners.clear();
  }

  // ── Events ───────────────────────────────────────────────────────────

  on<K extends CoreEventName>(name: K, listener: CoreEventListener<K>): void {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name)!.add(listener as CoreEventListener);
  }

  off<K extends CoreEventName>(name: K, listener: CoreEventListener<K>): void {
    this.listeners.get(name)?.delete(listener as CoreEventListener);
  }

  private emit<K extends CoreEventName>(name: K, data: CoreEventMap[K]): void {
    this.listeners.get(name)?.forEach(fn => fn(data));
  }

  // ── Connection ───────────────────────────────────────────────────────

  private async connect(backendInfo?: BackendInfo, isBackground = false): Promise<void> {
    if (isBackground) {
      this.backgroundConnecting = true;
    } else {
      this.connecting = true;
    }
    this.error = null;
    this.render();

    try {
      const result = await connectGroup(this.props.appId, backendInfo, this.props.nodeId);

      if (result.repo) {
        this.repo = result.repo;
        this.mode = 'config-sync';
        await this.loadConfigBackends();
        await this.loadDataGroups();
        if (backendInfo) this.saveBackendInfo(backendInfo);
      } else if (result.dataGroup) {
        this.dataGroup = result.dataGroup;
        this.mode = 'data-sync';
        // zen-fs-config reads the backend list from the remote.
        this.dataBackends = listDataBackends(result.dataGroup);
        if (backendInfo) this.saveBackendInfo(backendInfo);
      }

      this.emit('connected', {
        groupType: this.mode,
        backendId: backendInfo ? this.dataBackends[0]?.id ?? this.configBackends[0]?.id : undefined,
      });
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      if (backendInfo && !isBackground) this.clearBackendInfo();
      this.emit('error', { message: this.error });
    } finally {
      this.connecting = false;
      this.backgroundConnecting = false;
      this.render();
    }
  }

  private async loadConfigBackends(): Promise<void> {
    if (!this.repo) return;
    try {
      this.configBackends = await getConfigBackends(this.repo);
    } catch {
      this.configBackends = [];
    }
  }

  private async loadDataGroups(): Promise<void> {
    if (!this.repo) return;
    try {
      this.dataGroups = await getDataGroups(this.repo);
    } catch {
      this.dataGroups = [];
    }
  }

  // ── Actions ──────────────────────────────────────────────────────────

  async handleAddBackend(): Promise<void> {
    this.metadata = getBackendMetadataList().filter(
      (m) => !LOCAL_BACKEND_TYPES.has(m.type),
    );
    this.formKind = 'backend';
    this.showForm = true;
    this.render();
  }

  private openInlineForm(): void {
    if (!this.formContainer) return;
    const isDataGroup = this.formKind === 'data-group';
    openBackendForm({
      metadataList: this.metadata,
      container: this.formContainer,
      mode: 'inline',
      title: isDataGroup ? '新增数据同步组' : '添加后端',
      onSubmit: async (result) => {
        if (isDataGroup) {
          if (!this.repo) return;
          await this.repo.createAppDataGroup(result.id, [{
            id: result.id,
            type: result.type,
            options: result.options,
            description: result.description,
          }]);
          await this.loadDataGroups();
          this.emit('data-group-created', { groupId: result.id });
        } else if (this.mode === 'config-sync' && this.repo) {
          await addConfigBackend(this.repo, result.id, result.type, result.options, result.description);
          await this.loadConfigBackends();
          this.emit('backend-added', { backendId: result.id, type: result.type, groupType: 'config-sync' });
        } else if (this.mode === 'data-sync' && this.dataGroup) {
          await addDataBackend(this.dataGroup, result.id, result.type, result.options, result.description);
          this.dataBackends = listDataBackends(this.dataGroup);
          this.emit('backend-added', { backendId: result.id, type: result.type, groupType: 'data-sync' });
        } else {
          // Initial mode: connect to the new backend.
          // zen-fs-config will save the backend list on the remote.
          const info: BackendInfo = { type: result.type, options: result.options };
          this.saveBackendInfo(info);
          this.mode = 'data-sync';
          this.showForm = false;
          this.dataBackends = [{ id: result.id, type: result.type, options: result.options, description: result.description }];
          this.render();
          void this.connect(info, true);
          return;
        }
        this.showForm = false;
        this.render();
      },
      onCancel: () => {
        this.showForm = false;
        this.render();
      },
    });
  }

  async handleRemoveBackend(id: string): Promise<void> {
    try {
      if (this.mode === 'config-sync' && this.repo) {
        await removeConfigBackend(this.repo, id);
        await this.loadConfigBackends();
        if (this.configBackends.length === 0) this.clearBackendInfo();
      } else if (this.mode === 'data-sync' && this.dataGroup) {
        await removeDataBackend(this.dataGroup, id);
        this.dataBackends = listDataBackends(this.dataGroup);
        if (this.dataBackends.length <= 1) {
          this.clearBackendInfo();
          this.mode = 'initial';
          this.dataGroup = null;
          this.dataBackends = [];
        }
      }
      this.emit('backend-removed', { backendId: id });
      this.render();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.render();
    }
  }

  async handleAddDataGroup(): Promise<void> {
    if (!this.repo) return;
    this.metadata = getBackendMetadataList().filter(
      (m) => !LOCAL_BACKEND_TYPES.has(m.type),
    );
    this.formKind = 'data-group';
    this.showForm = true;
    this.render();
  }

  // ── Rendering ────────────────────────────────────────────────────────

  private injectStyles(): void {
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = STYLES;
    const root = this.container.getRootNode();
    if (root instanceof Document) {
      root.head.appendChild(this.styleEl);
    } else {
      (root as ShadowRoot).prepend(this.styleEl);
    }
  }

  render(): void {
    if (this.destroyed) return;
    clear(this.container);

    if (this.connecting) {
      this.container.appendChild(el('div', { className: 'zfui-loading' }, '正在连接后端...'));
      return;
    }

    if (this.error && this.mode === 'initial') {
      this.container.appendChild(this.buildErrorView());
      return;
    }

    // Header
    const header = el('div', { className: 'zfui-header' });
    const titleText = this.mode === 'config-sync' ? '配置同步组'
      : this.mode === 'data-sync' ? '数据同步组' : '同步组';
    header.appendChild(el('div', {}, [
      el('h1', { className: 'zfui-title' }, titleText),
      el('div', { className: 'zfui-subtitle' }, this.getSubtitle()),
    ]));
    if (this.backgroundConnecting) {
      header.appendChild(el('span', {
        style: 'font-size:11px;color:#6b7280;flex-shrink:0',
      }, '⟳ 同步中...'));
    }
    this.container.appendChild(header);

    if (this.error) {
      this.container.appendChild(el('div', { className: 'zfui-error' }, this.error));
    }

    if (this.mode === 'config-sync') {
      this.container.appendChild(this.buildConfigSyncView());
    } else if (this.mode === 'data-sync') {
      this.container.appendChild(this.buildDataSyncView());
    } else {
      this.container.appendChild(this.buildInitialView());
    }

    // Inline form
    if (this.showForm) {
      this.formContainer = el('div', { className: 'zfui-form-slot' });
      this.container.appendChild(this.formContainer);
      this.openInlineForm();
    } else {
      this.formContainer = null;
    }
  }

  private getSubtitle(): string {
    if (this.mode === 'config-sync' && this.configBackends.length === 0) {
      return '当前仅本地存储 (IndexedDB)，未连接远程后端';
    }
    if (this.mode === 'data-sync' && this.dataBackends.length === 0) {
      return '本地存储模式，可添加远程后端进行数据同步';
    }
    return '';
  }

  // ── Views ────────────────────────────────────────────────────────────

  private buildInitialView(): HTMLElement {
    const section = el('div', { className: 'zfui-section' });
    section.appendChild(el('div', { className: 'zfui-section-title' }, '🔧 后端'));

    const list = el('ul', { className: 'zfui-backend-list' });
    list.appendChild(this.buildLocalBackendItem());
    section.appendChild(list);

    const addBtn = el('button', { className: 'zfui-btn zfui-btn-primary' }, '+ 添加后端');
    on(addBtn, 'click', () => { void this.handleAddBackend(); });
    section.appendChild(addBtn);

    return section;
  }

  private buildConfigSyncView(): HTMLElement {
    const frag = document.createDocumentFragment();

    const syncSection = el('div', { className: 'zfui-section' });
    syncSection.appendChild(el('div', { className: 'zfui-section-title' }, '🔧 同步后端'));

    const list = el('ul', { className: 'zfui-backend-list' });
    list.appendChild(this.buildLocalBackendItem());
    for (const b of this.configBackends) {
      list.appendChild(this.buildBackendItem(b.id, b.type, b.options ?? {}, b.description, true));
    }
    syncSection.appendChild(list);

    const addBtn = el('button', { className: 'zfui-btn zfui-btn-primary' }, '+ 添加后端');
    on(addBtn, 'click', () => { void this.handleAddBackend(); });
    syncSection.appendChild(addBtn);
    frag.appendChild(syncSection);

    const dgSection = el('div', { className: 'zfui-section' });
    dgSection.appendChild(el('div', { className: 'zfui-section-title' }, '📦 数据同步组'));

    if (this.dataGroups.length === 0) {
      dgSection.appendChild(el('div', { className: 'zfui-empty' }, '暂无数据同步组'));
    } else {
      for (const dg of this.dataGroups) {
        const card = el('div', { className: 'zfui-data-group' });
        card.appendChild(el('div', { className: 'zfui-data-group-name' }, dg.id));
        for (const b of dg.backends) {
          card.appendChild(el('div', { style: 'font-size:12px;color:#6b7280;padding:2px 0' },
            `${b.id} (${b.type})`));
        }
        dgSection.appendChild(card);
      }
    }

    const addDgBtn = el('button', { className: 'zfui-btn zfui-btn-primary' }, '+ 新增数据同步组');
    on(addDgBtn, 'click', () => { void this.handleAddDataGroup(); });
    dgSection.appendChild(addDgBtn);
    frag.appendChild(dgSection);

    return frag as unknown as HTMLElement;
  }

  private buildDataSyncView(): HTMLElement {
    const section = el('div', { className: 'zfui-section' });
    section.appendChild(el('div', { className: 'zfui-section-title' }, '🔗 同步后端'));

    const list = el('ul', { className: 'zfui-backend-list' });
    list.appendChild(this.buildLocalBackendItem());
    for (const b of this.dataBackends) {
      list.appendChild(this.buildBackendItem(b.id, b.type, b.options ?? {}, b.description, true));
    }
    section.appendChild(list);

    const addBtn = el('button', { className: 'zfui-btn zfui-btn-primary' }, '+ 添加后端');
    on(addBtn, 'click', () => { void this.handleAddBackend(); });
    section.appendChild(addBtn);

    return section;
  }

  private buildErrorView(): HTMLElement {
    const section = el('div', { className: 'zfui-section' });
    section.appendChild(el('div', { className: 'zfui-error' }, `连接失败: ${this.error}`));
    const actions = el('div', { className: 'zfui-error-actions' });
    const retryBtn = el('button', { className: 'zfui-btn zfui-btn-primary' }, '重试');
    on(retryBtn, 'click', () => { void this.connect(this.props.backendInfo); });
    actions.appendChild(retryBtn);
    section.appendChild(actions);
    return section;
  }

  // ── Shared builders ──────────────────────────────────────────────────

  private buildLocalBackendItem(): HTMLElement {
    const li = el('li', { className: 'zfui-backend-item zfui-backend-item-primary' });
    li.appendChild(el('div', {}, [
      el('span', { className: 'zfui-backend-name' }, 'local-idb'),
      el('span', { className: 'zfui-backend-type' }, 'IndexedDB'),
      el('span', { className: 'zfui-badge zfui-badge-primary', style: 'margin-left:8px' }, '本地主后端'),
    ]));
    return li;
  }

  private buildBackendItem(
    id: string,
    type: string,
    options: Record<string, unknown>,
    description: string | undefined,
    removable: boolean,
  ): HTMLElement {
    const meta = this.metadata.find(m => m.type === type);
    const label = meta ? `${meta.icon} ${meta.label}` : type;

    const li = el('li', { className: 'zfui-backend-item' });
    const info = el('div', {}, [
      el('span', { className: 'zfui-backend-name' }, id),
      el('span', { className: 'zfui-backend-type' }, label),
    ]);
    if (description) {
      info.appendChild(el('div', { style: 'font-size:11px;color:#9ca3af;margin-top:2px' }, description));
    }
    li.appendChild(info);

    const actions = el('div', { className: 'zfui-backend-item-actions' });

    const copyBtn = el('button', {
      className: 'zfui-btn zfui-btn-sm zfui-btn-secondary',
      title: '复制配置字符串',
    }, '📋');
    let hintEl: HTMLElement | null = null;
    on(copyBtn, 'click', async () => {
      const str = serializeBackend(type, id, options, description);
      try {
        await navigator.clipboard.writeText(str);
        copyBtn.textContent = '✓';
        setTimeout(() => { copyBtn.textContent = '📋'; }, 1500);
      } catch {
        if (!hintEl) {
          hintEl = el('div', { className: 'zfui-copy-hint' }, str);
          li.appendChild(hintEl);
          setTimeout(() => { hintEl?.remove(); hintEl = null; }, 5000);
        }
      }
    });
    actions.appendChild(copyBtn);

    if (removable) {
      let confirming = false;
      const removeBtn = el('button', { className: 'zfui-btn zfui-btn-sm zfui-btn-danger' }, '删除');
      on(removeBtn, 'click', () => {
        if (!confirming) {
          confirming = true;
          removeBtn.textContent = '确定?';
          removeBtn.classList.add('zfui-btn-danger-active');
          setTimeout(() => {
            confirming = false;
            removeBtn.textContent = '删除';
            removeBtn.classList.remove('zfui-btn-danger-active');
          }, 3000);
        } else {
          void this.handleRemoveBackend(id);
        }
      });
      actions.appendChild(removeBtn);
    }

    li.appendChild(actions);
    return li;
  }
}
