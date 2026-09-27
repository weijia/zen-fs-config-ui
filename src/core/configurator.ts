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

/**
 * Built-in local backend types that should never appear in the
 * "Add Backend" selector. The local IndexedDB is always the primary
 * backend (shown separately), and InMemory is a Node.js-only local.
 */
const LOCAL_BACKEND_TYPES = new Set(['IndexedDB', 'InMemory']);

export class SyncGroupConfiguratorCore {
  private container: HTMLElement;
  private props: CoreProps;
  private destroyed = false;

  private mode: GroupMode = 'initial';
  private connecting = false;
  private error: string | null = null;

  private repo: IConfigRepo | null = null;
  private dataGroup: AppDataGroup | null = null;

  private configBackends: BackendDescriptor[] = [];
  private dataGroups: AppDataGroupDescriptor[] = [];
  private dataBackends: BackendDescriptor[] = [];

  private metadata: BackendMetadata[] = [];
  private styleEl: HTMLStyleElement | null = null;

  private listeners: Map<CoreEventName, Set<CoreEventListener>> = new Map();

  constructor(container: HTMLElement, props: CoreProps) {
    this.container = container;
    this.container.classList.add('zfui-root');
    this.props = { ...props };
    this.injectStyles();
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  async mount(): Promise<void> {
    this.metadata = getBackendMetadataList().filter(
      (m) => !LOCAL_BACKEND_TYPES.has(m.type),
    );
    if (this.props.backendInfo) {
      await this.connect(this.props.backendInfo);
    } else {
      // No remote backend — start in local config-sync mode
      await this.connect(undefined);
    }
  }

  update(props: Partial<CoreProps>): void {
    this.props = { ...this.props, ...props };
    // If backendInfo changed and we're in initial mode, reconnect
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

  private async connect(backendInfo?: CoreProps['backendInfo']): Promise<void> {
    this.connecting = true;
    this.error = null;
    this.render();

    try {
      const result = await connectGroup(this.props.appId, backendInfo, this.props.nodeId);

      if (result.repo) {
        this.repo = result.repo;
        this.mode = 'config-sync';
        await this.loadConfigBackends();
        await this.loadDataGroups();
      } else if (result.dataGroup) {
        this.dataGroup = result.dataGroup;
        this.mode = 'data-sync';
        this.dataBackends = listDataBackends(result.dataGroup);
      }

      this.emit('connected', {
        groupType: this.mode,
        backendId: backendInfo ? this.configBackends[0]?.id : undefined,
      });
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.emit('error', { message: this.error });
    } finally {
      this.connecting = false;
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
    openBackendForm({
      metadataList: this.metadata,
      onSubmit: async (result) => {
        if (this.mode === 'config-sync' && this.repo) {
          await addConfigBackend(this.repo, result.id, result.type, result.options, result.description);
          await this.loadConfigBackends();
          this.emit('backend-added', { backendId: result.id, type: result.type, groupType: 'config-sync' });
        } else if (this.mode === 'data-sync' && this.dataGroup) {
          await addDataBackend(this.dataGroup, result.id, result.type, result.options, result.description);
          this.dataBackends = listDataBackends(this.dataGroup);
          this.emit('backend-added', { backendId: result.id, type: result.type, groupType: 'data-sync' });
        } else {
          // initial mode — connect with this backend
          await this.connect({ type: result.type, options: result.options });
        }
        this.render();
      },
      onCancel: () => { /* noop */ },
    });
  }

  async handleRemoveBackend(id: string): Promise<void> {
    try {
      if (this.mode === 'config-sync' && this.repo) {
        await removeConfigBackend(this.repo, id);
        await this.loadConfigBackends();
      } else if (this.mode === 'data-sync' && this.dataGroup) {
        await removeDataBackend(this.dataGroup, id);
        this.dataBackends = listDataBackends(this.dataGroup);
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
    openBackendForm({
      metadataList: this.metadata,
      title: '新增数据同步组',
      onSubmit: async (result) => {
        // createAppDataGroup expects an array of backends; we create with one
        await this.repo!.createAppDataGroup(result.id, [{
          id: result.id,
          type: result.type,
          options: result.options,
          description: result.description,
        }]);
        await this.loadDataGroups();
        this.emit('data-group-created', { groupId: result.id });
        this.render();
      },
      onCancel: () => { /* noop */ },
    });
  }

  // ── Rendering ────────────────────────────────────────────────────────

  private injectStyles(): void {
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = STYLES;
    const root = this.container.getRootNode();
    if (root instanceof Document) {
      root.head.appendChild(this.styleEl);
    } else {
      // ShadowRoot: prepend styles so they apply to the host content.
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
  }

  private getSubtitle(): string {
    if (this.mode === 'config-sync' && this.configBackends.length === 0) {
      return '当前仅本地存储 (IndexedDB)，未连接远程后端';
    }
    if (this.mode === 'data-sync' && this.dataBackends.length <= 1) {
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

    // Sync backends section
    const syncSection = el('div', { className: 'zfui-section' });
    syncSection.appendChild(el('div', { className: 'zfui-section-title' }, '🔧 同步后端'));

    const list = el('ul', { className: 'zfui-backend-list' });
    list.appendChild(this.buildLocalBackendItem());
    for (const b of this.configBackends) {
      list.appendChild(this.buildBackendItem(b.id, b.type, b.description, true));
    }
    syncSection.appendChild(list);

    const addBtn = el('button', { className: 'zfui-btn zfui-btn-primary' }, '+ 添加后端');
    on(addBtn, 'click', () => { void this.handleAddBackend(); });
    syncSection.appendChild(addBtn);
    frag.appendChild(syncSection);

    // Data sync groups section
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
      list.appendChild(this.buildBackendItem(b.id, b.type, b.description, true));
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
    const info = el('div', {}, [
      el('span', { className: 'zfui-backend-name' }, 'local-idb'),
      el('span', { className: 'zfui-backend-type' }, 'IndexedDB'),
      el('span', { className: 'zfui-badge zfui-badge-primary', style: 'margin-left:8px' }, '本地主后端'),
    ]);
    li.appendChild(info);
    return li;
  }

  private buildBackendItem(
    id: string,
    type: string,
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

    if (removable) {
      const removeBtn = el('button', { className: 'zfui-btn zfui-btn-sm zfui-btn-danger' }, '删除');
      on(removeBtn, 'click', () => {
        if (confirm(`确定删除后端 ${id} 吗？`)) {
          void this.handleRemoveBackend(id);
        }
      });
      li.appendChild(removeBtn);
    }

    return li;
  }
}
