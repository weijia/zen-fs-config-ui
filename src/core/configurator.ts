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
  createDataGroup,
  removeAppDataGroupBackend,
  addAppDataGroupBackend,
  removeAppDataGroup,
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
  private formKind: 'backend' | 'data-group' | 'data-group-backend' = 'backend';
  private formTargetDataGroup: string | null = null;

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
    const key = STORAGE_KEY;
    // Layer 1: localStorage (works in production)
    try {
      localStorage.setItem(key, str);
      console.log(`[zen-fs-config-ui] saveBackendInfo: saved to localStorage (key=${key}, type=${info.type}, ${str.length} chars)`);
      return;
    } catch (e) {
      console.log(`[zen-fs-config-ui] saveBackendInfo: localStorage failed (${e instanceof Error ? e.message : e}), trying sessionStorage`);
    }
    // Layer 2: sessionStorage (might survive in some sandboxes)
    try {
      sessionStorage.setItem(key, str);
      console.log(`[zen-fs-config-ui] saveBackendInfo: saved to sessionStorage (key=${key}, type=${info.type}, ${str.length} chars)`);
      return;
    } catch (e) {
      console.log(`[zen-fs-config-ui] saveBackendInfo: sessionStorage failed (${e instanceof Error ? e.message : e}), trying cookie`);
    }
    // Layer 3: cookie (limited size but might persist)
    try {
      document.cookie = `${key}=${encodeURIComponent(str)};path=/;max-age=31536000`;
      console.log(`[zen-fs-config-ui] saveBackendInfo: saved to cookie (key=${key}, type=${info.type}, ${str.length} chars)`);
      return;
    } catch (e) {
      console.log(`[zen-fs-config-ui] saveBackendInfo: cookie failed (${e instanceof Error ? e.message : e})`);
    }
    console.warn(`[zen-fs-config-ui] saveBackendInfo: ALL storage layers failed — BackendInfo (type=${info.type}) NOT persisted`);
  }

  private loadBackendInfo(): BackendInfo | null {
    const key = STORAGE_KEY;
    // Layer 1: localStorage
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        console.log(`[zen-fs-config-ui] loadBackendInfo: found in localStorage (key=${key}, ${raw.length} chars)`);
        return this.parseBackendInfo(raw, 'localStorage');
      }
      console.log(`[zen-fs-config-ui] loadBackendInfo: localStorage empty (key=${key})`);
    } catch (e) {
      console.log(`[zen-fs-config-ui] loadBackendInfo: localStorage access failed (${e instanceof Error ? e.message : e})`);
    }
    // Layer 2: sessionStorage
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        console.log(`[zen-fs-config-ui] loadBackendInfo: found in sessionStorage (key=${key}, ${raw.length} chars)`);
        return this.parseBackendInfo(raw, 'sessionStorage');
      }
      console.log(`[zen-fs-config-ui] loadBackendInfo: sessionStorage empty (key=${key})`);
    } catch (e) {
      console.log(`[zen-fs-config-ui] loadBackendInfo: sessionStorage access failed (${e instanceof Error ? e.message : e})`);
    }
    // Layer 3: cookie
    try {
      const match = document.cookie.match(/zenfs-config-ui:backend=([^;]+)/);
      if (match) {
        const raw = decodeURIComponent(match[1]);
        console.log(`[zen-fs-config-ui] loadBackendInfo: found in cookie (key=${key}, ${raw.length} chars)`);
        return this.parseBackendInfo(raw, 'cookie');
      }
      console.log(`[zen-fs-config-ui] loadBackendInfo: cookie not found (key=${key})`);
    } catch (e) {
      console.log(`[zen-fs-config-ui] loadBackendInfo: cookie access failed (${e instanceof Error ? e.message : e})`);
    }
    console.log(`[zen-fs-config-ui] loadBackendInfo: no saved BackendInfo found in any storage layer`);
    return null;
  }

  private parseBackendInfo(raw: string, source: string): BackendInfo | null {
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.type && parsed?.options) {
        console.log(`[zen-fs-config-ui] loadBackendInfo: parsed OK (source=${source}, type=${parsed.type})`);
        return parsed;
      }
      console.warn(`[zen-fs-config-ui] loadBackendInfo: parsed data invalid (source=${source}, missing type/options)`, parsed);
    } catch (e) {
      console.warn(`[zen-fs-config-ui] loadBackendInfo: JSON parse failed (source=${source}, ${e instanceof Error ? e.message : e})`);
    }
    return null;
  }

  private clearBackendInfo(): void {
    const key = STORAGE_KEY;
    console.log(`[zen-fs-config-ui] clearBackendInfo: clearing all storage layers (key=${key})`);
    try { localStorage.removeItem(key); console.log(`  localStorage: cleared`); } catch (e) { console.log(`  localStorage: failed (${e instanceof Error ? e.message : e})`); }
    try { sessionStorage.removeItem(key); console.log(`  sessionStorage: cleared`); } catch (e) { console.log(`  sessionStorage: failed (${e instanceof Error ? e.message : e})`); }
    try {
      document.cookie = `${key}=;path=/;max-age=0`;
      console.log(`  cookie: cleared`);
    } catch (e) { console.log(`  cookie: failed (${e instanceof Error ? e.message : e})`); }
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
        this.waitForBackendRegistration(saved.type).then(() => {
          void this.connect(saved, true);
        });
      } else {
        await this.connect(undefined);
      }
    }
  }

  /**
   * Polls until the backend type is registered, then resolves.
   * In browser <script> usage, registration may happen after mount()
   * due to script load timing. Times out after 10s.
   */
  private waitForBackendRegistration(type: string): Promise<void> {
    const check = () => {
      const all = getBackendMetadataList();
      if (all.some(m => m.type === type)) return true;
      // Also check internal registry (includes InMemory, IndexedDB)
      return all.some(m => m.type === type);
    };
    if (check()) {
      console.log(`[zen-fs-config-ui] waitForBackendRegistration: type=${type} already registered`);
      return Promise.resolve();
    }
    console.log(`[zen-fs-config-ui] waitForBackendRegistration: type=${type} not registered yet, polling...`);
    return new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (check()) {
          clearInterval(interval);
          clearTimeout(timeout);
          console.log(`[zen-fs-config-ui] waitForBackendRegistration: type=${type} now registered`);
          resolve();
        }
      }, 100);
      const timeout = setTimeout(() => {
        clearInterval(interval);
        console.warn(`[zen-fs-config-ui] waitForBackendRegistration: timed out waiting for type=${type}`);
        resolve(); // resolve anyway so connect() can attempt (and show error if truly unregistered)
      }, 10000);
    });
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
        // Live object references for host apps (e.g. dir-struct-gen) to
        // grab the data group's `fs` and manage the app's data-sync group.
        repo: this.repo ?? undefined,
        dataGroup: this.dataGroup ?? undefined,
        backendInfo: backendInfo ?? this.props.backendInfo ?? undefined,
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

  /** Add a remote backend to an existing data-sync group (config-sync view). */
  async handleAddDataGroupBackend(): Promise<void> {
    this.metadata = getBackendMetadataList().filter(
      (m) => !LOCAL_BACKEND_TYPES.has(m.type),
    );
    this.formKind = 'data-group-backend';
    this.showForm = true;
    this.render();
  }

  private openInlineForm(): void {
    if (!this.formContainer) return;
    const isDataGroup = this.formKind === 'data-group';
    const isGroupBackend = this.formKind === 'data-group-backend';
    const formTitle = isDataGroup
      ? '新增数据同步组'
      : isGroupBackend
        ? `添加后端到 ${this.formTargetDataGroup ?? ''}`
        : '添加后端';
    openBackendForm({
      metadataList: this.metadata,
      container: this.formContainer,
      mode: 'inline',
      title: formTitle,
      onSubmit: async (result) => {
        if (isDataGroup) {
          if (!this.repo) return;
          const created = await this.repo.createAppDataGroup(result.id, [{
            id: result.id,
            type: result.type,
            options: result.options,
            description: result.description,
          }]);
          await this.loadDataGroups();
          this.emit('data-group-created', { groupId: result.id, dataGroup: created });
        } else if (isGroupBackend && this.repo && this.formTargetDataGroup) {
          await addAppDataGroupBackend(this.repo, this.formTargetDataGroup, result.id, result.type, result.options, result.description);
          await this.loadDataGroups();
          this.emit('backend-added', { backendId: result.id, type: result.type, groupType: 'data-sync' });
        } else if (this.mode === 'config-sync' && this.repo) {
          await addConfigBackend(this.repo, result.id, result.type, result.options, result.description);
          await this.loadConfigBackends();
          // Save BackendInfo if this is the first remote backend.
          if (this.configBackends.length === 1) {
            this.saveBackendInfo({ type: result.type, options: result.options });
          }
          this.emit('backend-added', { backendId: result.id, type: result.type, groupType: 'config-sync' });
        } else if (this.mode === 'data-sync' && this.dataGroup) {
          await addDataBackend(this.dataGroup, result.id, result.type, result.options, result.description);
          this.dataBackends = listDataBackends(this.dataGroup);
          // Save BackendInfo so we can reconnect after refresh.
          // The first remote backend added becomes the connection point.
          this.saveBackendInfo({ type: result.type, options: result.options });
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

  /** Remove a backend from a data-sync group while in config-sync overview. */
  private async handleRemoveDataGroupBackend(groupId: string, backendId: string): Promise<void> {
    try {
      if (!this.repo) return;
      console.log('[zenfs-config-ui] remove data-group backend:', groupId, backendId);
      const dgs = await getDataGroups(this.repo);
      const dg = dgs.find((d) => d.id === groupId);
      if (!dg) {
        this.error = `数据同步组 ${groupId} 不存在`;
        this.render();
        return;
      }
      // Operate on the descriptor directly instead of re-instantiating the
      // group. Re-instantiating then calling removeBackend() fails when the
      // backend cannot be re-created (init() skips failed backends, so
      // removeBackend() throws "Backend not found").
      await removeAppDataGroupBackend(this.repo, groupId, backendId);
      console.log('[zenfs-config-ui] descriptor updated, backends now:', dg.backends.filter(b => b.id !== backendId).map(b => b.id));
      await this.loadDataGroups();
      this.render();
    } catch (err) {
      console.error('[zenfs-config-ui] remove data-group backend FAILED:', err);
      this.error = err instanceof Error ? err.message : String(err);
      this.render();
    }
  }

  /** Delete an entire data-sync group (dispose instance + remove descriptor). */
  private async handleRemoveDataGroup(groupId: string): Promise<void> {
    try {
      if (!this.repo) return;
      console.log('[zenfs-config-ui] remove data-group:', groupId);
      await removeAppDataGroup(this.repo, groupId);
      await this.loadDataGroups();
      this.render();
    } catch (err) {
      console.error('[zenfs-config-ui] remove data-group FAILED:', err);
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

    if (this.backgroundConnecting && this.mode === 'initial') {
      this.container.appendChild(el('div', { className: 'zfui-loading' }, '正在恢复后端连接...'));
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
        const dgList = el('ul', { className: 'zfui-backend-list' });
        if (dg.backends.length === 0) {
          dgList.appendChild(el('li', { className: 'zfui-backend-item', style: 'color:#9ca3af;font-size:12px' }, '（无后端）'));
        } else {
          for (const b of dg.backends) {
            // 每个后端显示只读配置串 + 📋复制配置串；removable=true 提供删除按钮，
            // 删除回调绑定所属数据组 id，删除的是数据组内的后端（非配置后端）。
            dgList.appendChild(this.buildBackendItem(b.id, b.type, b.options ?? {}, b.description, true, () => void this.handleRemoveDataGroupBackend(dg.id, b.id)));
          }
        }
        card.appendChild(dgList);
        // Let users add more remote backends to this specific data group.
        const addDgBackendBtn = el('button', { className: 'zfui-btn zfui-btn-primary' }, '+ 添加后端');
        on(addDgBackendBtn, 'click', () => {
          this.formTargetDataGroup = dg.id;
          void this.handleAddDataGroupBackend();
        });
        card.appendChild(addDgBackendBtn);
        // Delete the whole data group (dispose instance + remove descriptor).
        const removeGroupBtn = el('button', { className: 'zfui-btn zfui-btn-danger' }, '🗑 删除组');
        let confirmingGroup = false;
        on(removeGroupBtn, 'click', () => {
          if (confirmingGroup) {
            confirmingGroup = false;
            removeGroupBtn.textContent = '🗑 删除组';
            void this.handleRemoveDataGroup(dg.id);
          } else {
            confirmingGroup = true;
            removeGroupBtn.textContent = '确定?';
            window.setTimeout(() => {
              confirmingGroup = false;
              removeGroupBtn.textContent = '🗑 删除组';
            }, 3000);
          }
        });
        card.appendChild(removeGroupBtn);
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
    onRemove?: (id: string) => void,
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

    const cfgStr = serializeBackend(type, id, options, description);

    // 始终展示可分享的配置串（只读），方便手动复制 / 在另一端粘贴重连。
    const strInput = el('input', {
      className: 'zfui-cfg-str',
      type: 'text',
    }) as HTMLInputElement;
    strInput.value = cfgStr;
    strInput.readOnly = true;
    strInput.spellcheck = false;
    strInput.title = '配置字符串：可分享或在另一端粘贴以重连';
    li.appendChild(strInput);

    const copyBtn = el('button', {
      className: 'zfui-btn zfui-btn-sm zfui-btn-secondary',
      title: '复制配置字符串（连接信息，可分享/重连）',
    }, '📋 复制配置串');
    let hintEl: HTMLElement | null = null;
    on(copyBtn, 'click', async () => {
      try {
        await navigator.clipboard.writeText(cfgStr);
        copyBtn.textContent = '✓ 已复制';
        setTimeout(() => { copyBtn.textContent = '📋 复制配置串'; }, 1500);
      } catch {
        if (!hintEl) {
          hintEl = el('div', { className: 'zfui-copy-hint' }, cfgStr);
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
          if (onRemove) onRemove(id);
          else void this.handleRemoveBackend(id);
        }
      });
      actions.appendChild(removeBtn);
    }

    li.appendChild(actions);
    return li;
  }
}
