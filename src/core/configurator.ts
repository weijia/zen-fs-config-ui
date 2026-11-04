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
  SyncPairStatus,
} from 'zen-fs-config';
import { localPrimaryType } from 'zen-fs-config';
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
  detectLegacyAppDataGroup,
  migrateLegacyAppDataGroup,
  getConfigGroupDescriptor,
  updateConfigGroupName,
  updateDataGroupName,
  replaceConfigBackend,
  replaceDataGroupBackend,
  type LegacyAppDataGroupMatch,
} from './api.js';
import { validateGroupName, GROUP_NAME_MAX_LENGTH } from './group-name.js';
import { el, on, clear } from './render.js';
import { STYLES } from './styles.js';
import { openBackendForm } from './views/backend-form.js';
import { serializeBackend } from './config-string.js';

/** UI version — injected by tsup from package.json at build time. */
declare const __APP_VERSION__: string;

const LOCAL_BACKEND_TYPES = new Set(['IndexedDB', 'InMemory']);

const STORAGE_KEY = 'zenfs-config-ui:backend';

/** How often the per-group status lines are re-read from the live group. */
const STATUS_REFRESH_MS = 2000;

/** Format a timestamp as `hh:mm:ss` (local time, 24h). */
function fmtClock(ts?: number): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
  } catch {
    return '—';
  }
}

/**
 * Aggregate a group's sync-pair statuses into one compact line:
 * `同步对 N（监听 M） · 空闲/同步中 · 最近检查 hh:mm:ss · 累计 K 次 · 上轮 +a ~b -c skip:d · 冲突 n`.
 *
 * `lastError` is returned separately so the main line stays stable; it is a
 * sticky per-pair record (zen-fs-sync >= 0.4.17) and is not cleared by a
 * clean sync.
 */
function formatSyncStatuses(statuses: Map<string, SyncPairStatus>): {
  text: string;
  error?: { message: string; timestamp: number };
} {
  if (statuses.size === 0) {
    return { text: '同步对 0 · 无可用远端后端（仅本地）' };
  }
  let syncing = false;
  let watching = 0;
  let lastCheck = 0;
  let totalSyncs = 0;
  let created = 0;
  let updated = 0;
  let deleted = 0;
  let skipped = 0;
  let conflicts = 0;
  let lastError: { message: string; timestamp: number } | undefined;
  for (const st of statuses.values()) {
    if (String(st.state) === 'syncing') syncing = true;
    if (st.watching) watching += 1;
    if (st.lastCheckTime) lastCheck = Math.max(lastCheck, st.lastCheckTime);
    totalSyncs += st.totalSyncs || 0;
    const r = st.lastResult;
    if (r) {
      lastCheck = Math.max(lastCheck, r.timestamp || 0);
      created += r.filesCreated || 0;
      updated += r.filesUpdated || 0;
      deleted += r.filesDeleted || 0;
      skipped += r.filesSkipped || 0;
      conflicts += (r.conflicts || []).length;
    }
    if (st.lastError) lastError = st.lastError;
  }
  const text = [
    `同步对 ${statuses.size}（监听 ${watching}）`,
    syncing ? '同步中' : '空闲',
    `最近检查 ${fmtClock(lastCheck)}`,
    `累计 ${totalSyncs} 次`,
    `上轮 +${created} ~${updated} -${deleted} skip:${skipped}`,
    `冲突 ${conflicts}`,
  ].join(' · ');
  return { text, error: lastError };
}

/** One backend that could not be connected, so it has no sync pair. */
export interface FailedBackend {
  id: string;
  message: string;
}

export interface GroupStatusSnapshot {
  statuses: Map<string, SyncPairStatus>;
  failed: FailedBackend[];
}

/** Suffix shown on the status line when some descriptors have no pair. */
export function formatBackendFailureSummary(failed: FailedBackend[]): string {
  return failed.length === 0 ? '' : ` · ${failed.length} 个后端未建立同步对`;
}

/** Detail lines naming each backend that failed to connect. */
export function formatBackendFailureDetail(failed: FailedBackend[]): string {
  return failed
    .map((f) => `未建立同步对：${f.id} · ${String(f.message).slice(0, 120)}`)
    .join('\n');
}

interface StatusRowRef {
  textEl: HTMLElement;
  detailEl: HTMLElement;
  read: () => GroupStatusSnapshot | null;
  /** Set when the group has no live instance in this session. */
  unavailable?: string;
}

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
  /** Display name of the config-sync group (null → default title). */
  private configGroupName: string | null = null;
  /**
   * Inline display-name editor state. `target` is `'config'` for the
   * config-sync group or a data-group id. Kept in memory only.
   */
  private groupNameEdit: {
    target: string;
    value: string;
    error: string | null;
    saving: boolean;
  } | null = null;
  /**
   * Live data-group instances loaded by `connect()` (keyed by group id). Only
   * these can report real sync status; a descriptor without an entry is shown
   * as「未连接」— the UI never instantiates a group just to render a status.
   */
  private groupInstances: Map<string, AppDataGroup> = new Map();
  private groupUnavailable: Map<string, string> = new Map();
  private statusRefs: StatusRowRef[] = [];
  private statusTimer: number | null = null;
  /** Legacy `app-data` group created by older dir-struct-gen versions. */
  private legacyAppData: LegacyAppDataGroupMatch | null = null;

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
    this.stopStatusTimer();
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

      // Capture the live group instances that connect() already loaded. The UI
      // never instantiates a group on its own — missing groups render as
      //「未连接」with the actual reason instead of fabricated numbers.
      this.groupInstances = new Map();
      this.groupUnavailable = new Map();
      for (const g of result.appDataGroups ?? []) {
        if (g) this.groupInstances.set(g.groupId, g);
      }
      if (result.dataGroup) {
        this.groupInstances.set(result.dataGroup.groupId, result.dataGroup);
      }

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
    try {
      const descriptor = await getConfigGroupDescriptor(this.repo);
      this.configGroupName = descriptor?.name?.trim() || null;
    } catch {
      this.configGroupName = null;
    }
  }

  private async loadDataGroups(): Promise<void> {
    if (!this.repo) return;
    try {
      this.dataGroups = await getDataGroups(this.repo);
    } catch {
      this.dataGroups = [];
    }
    // Reconcile live instances with descriptors. Descriptors without a live
    // instance are reported as 未连接 (no stats) — never silently created here.
    const ids = new Set(this.dataGroups.map((d) => d.id));
    for (const id of [...this.groupInstances.keys()]) {
      if (!ids.has(id)) this.groupInstances.delete(id);
    }
    this.groupUnavailable = new Map();
    for (const d of this.dataGroups) {
      if (!this.groupInstances.has(d.id)) {
        this.groupUnavailable.set(
          d.id,
          '该组未在当前会话实例化（连接时加载失败或仅存在于描述符中），暂无实时状态',
        );
      }
    }
    this.legacyAppData = detectLegacyAppDataGroup(this.dataGroups);
  }

  /**
   * Explicit, user-triggered migration of the legacy `app-data` group.
   * Copies its RemoteStorage backend into `default`, then removes only the
   * `app-data` descriptor. Remote files are not deleted.
   */
  private async handleMigrateLegacyAppData(): Promise<void> {
    if (!this.repo || !this.legacyAppData) return;
    try {
      // Keep a local backup of the descriptor for manual recovery.
      try {
        localStorage.setItem(
          'zenfs-config-ui:legacy-app-data-backup',
          JSON.stringify({ at: Date.now(), match: this.legacyAppData }),
        );
      } catch {
        // storage may be unavailable; migration itself is still safe
      }
      const result = await migrateLegacyAppDataGroup(this.repo);
      await this.loadDataGroups();
      if (result.migrated) {
        this.error = null;
        console.log(
          `[zenfs-config-ui] legacy app-data group migrated to "${result.targetGroupId}" (remote files untouched)`,
        );
        // The host app may still hold the removed group's `fs`; re-emit the
        // connection so it can swap to the migrated group immediately.
        let migratedGroup: AppDataGroup | undefined;
        try {
          migratedGroup = await this.repo.getAppDataGroup(result.targetGroupId);
          if (migratedGroup) this.groupInstances.set(migratedGroup.groupId, migratedGroup);
        } catch {
          migratedGroup = undefined;
        }
        this.emit('connected', {
          groupType: this.mode,
          repo: this.repo,
          dataGroup: migratedGroup,
          backendInfo: this.props.backendInfo,
        });
      }
      this.render();
    } catch (err) {
      this.error = `清理旧版 app-data 组失败: ${err instanceof Error ? err.message : String(err)}`;
      console.error('[zenfs-config-ui] migrate legacy app-data FAILED:', err);
      this.render();
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
          this.groupInstances.set(created.groupId, created);
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
      // Prefer the live instance: removeBackend() drops the pair AND clears the
      // per-backend error state, so the status line stops reporting a backend
      // that is no longer listed. It also handles descriptors that never got a
      // pair (e.g. createBackend failed), which the descriptor-only path cannot.
      const live = this.groupInstances.get(groupId);
      if (live) {
        await live.removeBackend(backendId);
      } else {
        // Group is not instantiated in this session — edit the descriptor only.
        await removeAppDataGroupBackend(this.repo, groupId, backendId);
      }
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
      this.groupInstances.delete(groupId);
      this.groupUnavailable.delete(groupId);
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

  // ── Group display names (descriptor-only) ────────────────────────────

  private isEditingGroupName(target: string): boolean {
    return this.groupNameEdit?.target === target;
  }

  private startGroupNameEdit(target: string, current: string): void {
    this.error = null;
    this.groupNameEdit = { target, value: current, error: null, saving: false };
    this.render();
    const input = this.container.querySelector<HTMLInputElement>('.zfui-group-name-input');
    input?.focus();
    input?.select();
  }

  private cancelGroupNameEdit(): void {
    this.groupNameEdit = null;
    this.error = null;
    this.render();
  }

  /** Inline editor used by both the config-sync header and data-group cards. */
  private buildGroupNameEditor(target: string, current: string, label: string): HTMLElement {
    const edit = this.groupNameEdit;
    const wrap = el('div', { className: 'zfui-group-name-edit' });
    const input = el('input', {
      className: 'zfui-form-input zfui-group-name-input',
      type: 'text',
      maxlength: String(GROUP_NAME_MAX_LENGTH),
      placeholder: `组名（最多 ${GROUP_NAME_MAX_LENGTH} 个字符）`,
      'aria-label': label,
    });
    input.value = current;
    const errorEl = el('span', { className: 'zfui-group-name-error' }, edit?.error ?? '');
    const saveBtn = el('button', {
      className: 'zfui-btn zfui-btn-primary zfui-btn-sm',
      type: 'button',
    }, '保存') as HTMLButtonElement;
    const cancelBtn = el('button', {
      className: 'zfui-btn zfui-btn-secondary zfui-btn-sm',
      type: 'button',
    }, '取消') as HTMLButtonElement;
    if (edit?.saving) {
      saveBtn.disabled = true;
      cancelBtn.disabled = true;
      saveBtn.textContent = '保存中...';
    }
    const save = () => { void this.handleSaveGroupName(target, input.value, errorEl); };
    on(input, 'input', () => {
      if (this.groupNameEdit) this.groupNameEdit.value = input.value;
      errorEl.textContent = '';
    });
    on(input, 'keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      if (e.key === 'Escape') { e.preventDefault(); this.cancelGroupNameEdit(); }
    });
    on(saveBtn, 'click', save);
    on(cancelBtn, 'click', () => this.cancelGroupNameEdit());
    wrap.appendChild(input);
    wrap.appendChild(saveBtn);
    wrap.appendChild(cancelBtn);
    wrap.appendChild(errorEl);
    return wrap;
  }

  /**
   * Persist a display name. Only the descriptor changes (user requirement:
   * 只改描述符，不动 pair、不动本地/远端数据). Sync pairs, local stores and
   * remote data are untouched, so existing pairs keep working.
   */
  private async handleSaveGroupName(
    target: string,
    rawValue: string,
    errorEl?: HTMLElement,
  ): Promise<void> {
    if (!this.repo || !this.groupNameEdit) return;
    const validation = validateGroupName(rawValue);
    if (!validation.ok) {
      this.groupNameEdit.value = rawValue;
      this.groupNameEdit.error = validation.error;
      if (errorEl) errorEl.textContent = validation.error;
      return;
    }
    this.groupNameEdit.value = rawValue;
    this.groupNameEdit.saving = true;
    this.groupNameEdit.error = null;
    try {
      if (target === 'config') {
        await updateConfigGroupName(this.repo, validation.name);
        this.configGroupName = validation.name;
      } else {
        await updateDataGroupName(this.repo, target, validation.name);
        await this.loadDataGroups();
      }
      this.groupNameEdit = null;
      this.error = null;
      // Re-render this widget only — card titles and status rows update
      // immediately, without reloading the page.
      this.render();
    } catch (err) {
      const message = `保存组名失败：${err instanceof Error ? err.message : String(err)}`;
      console.error('[zenfs-config-ui] rename group FAILED:', err);
      this.error = message;
      if (this.groupNameEdit) {
        this.groupNameEdit.saving = false;
        this.groupNameEdit.error = message;
      }
      this.render();
    }
  }

  // ── Backend parameter editing (destructive: rebuilds the pair) ───────

  private openBackendParamEditor(
    kind: 'config' | 'data',
    groupId: string | null,
    backend: { id: string; type: string; options?: Record<string, unknown>; description?: string },
  ): void {
    const oldOptions = backend.options ?? {};
    const oldDescription = backend.description;
    openBackendForm({
      metadataList: this.metadata,
      defaultType: backend.type,
      initial: {
        id: backend.id,
        type: backend.type,
        options: oldOptions,
        description: oldDescription,
      },
      notice:
        '修改参数等于换一个远端目标：旧同步对会拆掉并重建；旧远端已有数据不会自动迁移到新目标；'
        + '保存后会立即对新目标做一次初始同步。后端 id 保持不变。'
        + '敏感字段默认脱敏（只显示后 4 位），直接输入可覆盖，留空表示保持原值。'
        + '若新参数与已有后端指向同一远端（类型+参数完全相同），保存会被拒绝并提示重复的后端 id。',
      confirm: { label: '我已知晓：改参数会重建同步对，旧远端数据不会自动迁移' },
      submitLabel: '确认修改并重建同步对',
      onSubmit: async (result) => {
        // Blank secret fields are omitted by the form, so merging keeps them.
        const merged = { ...oldOptions, ...result.options };
        const description = result.description || oldDescription;
        await this.handleSaveBackendParams(
          kind,
          groupId,
          backend.id,
          backend.type,
          merged,
          description,
        );
      },
      onCancel: () => { /* nothing to undo — cancel leaves everything as-is */ },
    });
  }

  private async handleSaveBackendParams(
    kind: 'config' | 'data',
    groupId: string | null,
    id: string,
    type: string,
    options: Record<string, unknown>,
    description?: string,
  ): Promise<void> {
    if (!this.repo) throw new Error('配置仓库未连接');
    if (kind === 'data' && !groupId) throw new Error('缺少数据组 id');
    try {
      if (kind === 'config') {
        await replaceConfigBackend(this.repo, id, type, options, description);
        await this.loadConfigBackends();
      } else {
        const updated = await replaceDataGroupBackend(
          this.repo,
          groupId!,
          id,
          type,
          options,
          description,
        );
        this.groupInstances.set(groupId!, updated);
        if (this.dataGroup && this.dataGroup.groupId === groupId) {
          this.dataGroup = updated;
          this.dataBackends = listDataBackends(updated);
        }
        await this.loadDataGroups();
      }
      this.error = null;
      // Refresh cards + status rows in place; no full page reload.
      this.render();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[zenfs-config-ui] update backend params FAILED:', err);
      this.error = `更新后端参数失败：${message}`;
      this.render();
      // Rethrow so the modal stays open and shows the error inline.
      throw err;
    }
  }

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
    // Rows from the previous render point at detached nodes; rebuild them.
    this.statusRefs = [];
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
    const titleText = this.mode === 'config-sync'
      ? (this.configGroupName ? `配置同步组 · ${this.configGroupName}` : '配置同步组')
      : this.mode === 'data-sync' ? '数据同步组' : '同步组';
    const titleRow = el('div', { className: 'zfui-title-row' });
    titleRow.appendChild(el('h1', { className: 'zfui-title' }, titleText));
    if (this.mode === 'config-sync' && !this.isEditingGroupName('config')) {
      const editBtn = el('button', {
        className: 'zfui-btn zfui-btn-secondary zfui-btn-sm zfui-group-name-btn',
        type: 'button',
        title: '编辑配置同步组的显示名称（只改描述符，不影响后端与同步）',
      }, '编辑');
      on(editBtn, 'click', () => this.startGroupNameEdit('config', this.configGroupName ?? ''));
      titleRow.appendChild(editBtn);
    }
    if (this.mode === 'config-sync' && this.isEditingGroupName('config')) {
      titleRow.appendChild(this.buildGroupNameEditor('config', this.configGroupName ?? '', '配置同步组名称'));
    }
    header.appendChild(el('div', {}, [
      titleRow,
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

    this.updateStatusRows();
    this.ensureStatusTimer();
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
    // Config-sync group's own status: repo.getSyncStatuses() covers its
    // replica pairs (local primary ↔ each config backend).
    syncSection.appendChild(this.buildStatusRow(
      () => (this.repo ? { statuses: this.repo.getSyncStatuses(), failed: [] } : null),
    ));

    const list = el('ul', { className: 'zfui-backend-list' });
    list.appendChild(this.buildLocalBackendItem());
    for (const b of this.configBackends) {
      list.appendChild(this.buildBackendItem(
        b.id, b.type, b.options ?? {}, b.description, true,
        undefined,
        undefined,
        () => this.openBackendParamEditor('config', null, b),
      ));
    }
    syncSection.appendChild(list);

    const addBtn = el('button', { className: 'zfui-btn zfui-btn-primary' }, '+ 添加后端');
    on(addBtn, 'click', () => { void this.handleAddBackend(); });
    syncSection.appendChild(addBtn);
    frag.appendChild(syncSection);

    if (this.legacyAppData) {
      const legacySection = el('div', {
        className: 'zfui-section',
        style: 'border:1px solid #f59e0b;background:#fffbeb;padding:12px;',
      });
      legacySection.appendChild(el('div', { className: 'zfui-section-title' }, '⚠️ 检测到旧版遗留数据组'));
      legacySection.appendChild(el('div', {
        style: 'font-size:12px;color:#92400e;line-height:1.6;margin-bottom:8px',
      }, '旧版 dir-struct-gen 自动创建的 app-data 组（后端 rs-app）仍保存在配置里。可将其后端迁移到 default 组后删除该组；只删除本地描述符，不会删除远端 app_data/folders 中的文件，上传仍可继续。'));
      const migrateBtn = el('button', { className: 'zfui-btn zfui-btn-danger' }, '迁移并清理');
      let confirming = false;
      on(migrateBtn, 'click', () => {
        if (confirming) {
          confirming = false;
          migrateBtn.textContent = '迁移并清理';
          void this.handleMigrateLegacyAppData();
        } else {
          confirming = true;
          migrateBtn.textContent = '确定迁移?';
          window.setTimeout(() => {
            confirming = false;
            migrateBtn.textContent = '迁移并清理';
          }, 3000);
        }
      });
      legacySection.appendChild(migrateBtn);
      frag.appendChild(legacySection);
    }

    const dgSection = el('div', { className: 'zfui-section' });
    dgSection.appendChild(el('div', { className: 'zfui-section-title' }, '📦 数据同步组'));

    if (this.dataGroups.length === 0) {
      dgSection.appendChild(el('div', { className: 'zfui-empty' }, '暂无数据同步组'));
    } else {
      for (const dg of this.dataGroups) {
        const card = el('div', { className: 'zfui-data-group' });
        // Card title row: display name (falls back to the stable id) plus the
        // inline「编辑」entry. Editing only rewrites the descriptor's name.
        const nameRow = el('div', { className: 'zfui-group-name-row' });
        if (this.isEditingGroupName(dg.id)) {
          nameRow.appendChild(el('div', { className: 'zfui-data-group-name' }, dg.name || dg.id));
          nameRow.appendChild(this.buildGroupNameEditor(dg.id, dg.name ?? '', '数据同步组名称'));
        } else {
          nameRow.appendChild(el('div', { className: 'zfui-data-group-name' }, dg.name || dg.id));
          if (dg.name) {
            nameRow.appendChild(el('span', { className: 'zfui-group-id' }, `id: ${dg.id}`));
          }
          const editNameBtn = el('button', {
            className: 'zfui-btn zfui-btn-secondary zfui-btn-sm zfui-group-name-btn',
            type: 'button',
            title: '编辑该组的显示名称（只改描述符，不影响后端与同步）',
          }, '编辑');
          on(editNameBtn, 'click', () => this.startGroupNameEdit(dg.id, dg.name ?? ''));
          nameRow.appendChild(editNameBtn);
        }
        card.appendChild(nameRow);
        // Per-backend state tells us whether each *listed* descriptor actually
        // got a sync pair (a backend whose options are invalid gets none).
        const liveAtRender = this.groupInstances.get(dg.id);
        const backendStates = liveAtRender?.getBackendSyncStates() ?? new Map();
        // Each data-group card reads its OWN live instance's status, so two
        // groups never share numbers (their sync engines are separate).
        card.appendChild(this.buildStatusRow(
          () => {
            const live = this.groupInstances.get(dg.id);
            if (!live) return null;
            const failed = [...live.getBackendSyncStates().values()]
              .filter((s) => s.error)
              .map((s) => ({ id: s.backendId, message: s.error!.message }));
            return { statuses: live.getSyncStatuses(), failed };
          },
          this.groupInstances.has(dg.id) ? undefined : this.groupUnavailable.get(dg.id),
        ));
        const dgList = el('ul', { className: 'zfui-backend-list' });
        if (dg.backends.length === 0) {
          dgList.appendChild(el('li', { className: 'zfui-backend-item', style: 'color:#9ca3af;font-size:12px' }, '（无后端）'));
        } else {
          for (const b of dg.backends) {
            // 每个后端显示只读配置串 + 📋复制配置串；removable=true 提供删除按钮，
            // 删除回调绑定所属数据组 id，删除的是数据组内的后端（非配置后端）。
            // 建连失败的后端仍可删除（zen-fs-config 的 removeBackend 支持无实例描述符）。
            dgList.appendChild(this.buildBackendItem(
              b.id, b.type, b.options ?? {}, b.description, true,
              () => void this.handleRemoveDataGroupBackend(dg.id, b.id),
              backendStates.get(b.id)?.error,
              () => this.openBackendParamEditor('data', dg.id, b),
            ));
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
    // Standalone data-sync group: its own sync engine's status.
    section.appendChild(this.buildStatusRow(
      () => (this.dataGroup ? { statuses: this.dataGroup.getSyncStatuses(), failed: [] } : null),
    ));

    const list = el('ul', { className: 'zfui-backend-list' });
    list.appendChild(this.buildLocalBackendItem());
    for (const b of this.dataBackends) {
      list.appendChild(this.buildBackendItem(
        b.id, b.type, b.options ?? {}, b.description, true,
        undefined,
        undefined,
        () => this.openBackendParamEditor('data', this.dataGroup?.groupId ?? 'default', b),
      ));
    }
    section.appendChild(list);

    const addBtn = el('button', { className: 'zfui-btn zfui-btn-primary' }, '+ 添加后端');
    on(addBtn, 'click', () => { void this.handleAddBackend(); });
    section.appendChild(addBtn);

    return section;
  }

  // ── Per-group sync status ────────────────────────────────────────────

  /**
   * Build a status row bound to one group. `read` is called repeatedly (timer
   * + manual refresh) and must never instantiate a group — it only reads from
   * an already-live instance, or returns null when there is none.
   */
  private buildStatusRow(
    read: () => GroupStatusSnapshot | null,
    unavailable?: string,
  ): HTMLElement {
    const wrap = el('div', { className: 'zfui-status-block' });
    const line = el('div', { className: 'zfui-status-line' });
    const textEl = el('span', {}, '读取同步状态…');
    const refreshBtn = el('button', {
      className: 'zfui-status-refresh',
      type: 'button',
      title: '重新读取本组同步状态（不会触发同步）',
    }, '↻ 刷新状态');
    on(refreshBtn, 'click', () => this.updateStatusRows());
    line.appendChild(textEl);
    line.appendChild(refreshBtn);
    const detailEl = el('div', { className: 'zfui-status-detail' });
    wrap.appendChild(line);
    wrap.appendChild(detailEl);
    this.statusRefs.push({ textEl, detailEl, read, unavailable });
    return wrap;
  }

  /** Refresh all visible status rows from their live group instances. */
  private updateStatusRows(): void {
    if (this.destroyed) return;
    for (const ref of this.statusRefs) {
      if (ref.unavailable) {
        ref.textEl.textContent = `未连接 · ${ref.unavailable}`;
        ref.textEl.parentElement?.classList.add('err');
        ref.detailEl.textContent = '';
        continue;
      }
      let snapshot: GroupStatusSnapshot | null = null;
      try {
        snapshot = ref.read();
      } catch (err) {
        ref.textEl.textContent = '同步状态读取失败 · '
          + (err instanceof Error ? err.message : String(err));
        ref.textEl.parentElement?.classList.add('err');
        ref.detailEl.textContent = '';
        continue;
      }
      if (!snapshot) {
        ref.textEl.textContent = '未连接 · 该组没有当前会话的实例，暂无实时状态';
        ref.textEl.parentElement?.classList.add('err');
        ref.detailEl.textContent = '';
        continue;
      }
      const { text, error } = formatSyncStatuses(snapshot.statuses);
      const failed = snapshot.failed;
      // A backend that failed to connect has no pair, so the pair count alone
      // would silently understate what the card lists. Name it explicitly.
      if (failed.length > 0) {
        ref.textEl.parentElement?.classList.add('err');
      } else {
        ref.textEl.parentElement?.classList.remove('err');
      }
      ref.textEl.textContent = text + formatBackendFailureSummary(failed);
      const detailParts: string[] = [];
      if (failed.length > 0) detailParts.push(formatBackendFailureDetail(failed));
      if (error) detailParts.push(`最后错误 ${fmtClock(error.timestamp)} · ${String(error.message).slice(0, 120)}`);
      ref.detailEl.textContent = detailParts.join('\n');
    }
  }

  private ensureStatusTimer(): void {
    if (this.statusTimer !== null || this.destroyed || this.statusRefs.length === 0) return;
    this.statusTimer = window.setInterval(() => this.updateStatusRows(), STATUS_REFRESH_MS);
  }

  private stopStatusTimer(): void {
    if (this.statusTimer !== null) {
      window.clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
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
      el('span', { className: 'zfui-backend-type' }, localPrimaryType()),
      el('span', { className: 'zfui-badge zfui-badge-primary', style: 'margin-left:8px' }, '隐式 source · 不参与同步'),
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
    syncError?: { message: string; timestamp: number },
    onEdit?: () => void,
  ): HTMLElement {
    const meta = this.metadata.find(m => m.type === type);
    const label = meta ? `${meta.icon} ${meta.label}` : type;

    const li = el('li', {
      className: syncError ? 'zfui-backend-item zfui-backend-item-error' : 'zfui-backend-item',
      title: syncError ? `未建立同步对：${syncError.message}` : undefined,
    });
    const info = el('div', {}, [
      el('span', { className: 'zfui-backend-name' }, id),
      el('span', { className: 'zfui-backend-type' }, label),
    ]);
    if (syncError) {
      info.appendChild(el('span', { className: 'zfui-badge zfui-badge-error' }, '⚠ 未建立同步对'));
    }
    if (description) {
      info.appendChild(el('div', { style: 'font-size:11px;color:#9ca3af;margin-top:2px' }, description));
    }
    if (syncError) {
      info.appendChild(el('div', {
        className: 'zfui-backend-error-detail',
        title: syncError.message,
      }, `未建立同步对：${String(syncError.message).slice(0, 160)}`));
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

    if (onEdit) {
      const editBtn = el('button', {
        className: 'zfui-btn zfui-btn-sm zfui-btn-secondary',
        title: '编辑后端参数（更换远端目标并重建同步对）',
      }, '编辑参数');
      on(editBtn, 'click', onEdit);
      actions.appendChild(editBtn);
    }

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
