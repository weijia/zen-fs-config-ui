/**
 * 空库初始化确认框。
 *
 * 远端根既没有 group.json、也没有 group-type 标记时，connect() 会抛
 * `NeedsInitError`；此时必须由用户显式选择「配置组 / 数据组 / 取消」，
 * 不能由代码猜一个类型建组（见 SYNC-GROUP-DESIGN §3.1.1）。
 */
import { el, on } from '../render.js';
import { STYLES } from '../styles.js';
import type { SyncGroupType } from 'zen-fs-config';

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  const style = document.createElement('style');
  style.setAttribute('data-zfui', '');
  style.textContent = STYLES;
  document.head.appendChild(style);
  stylesInjected = true;
}

export interface InitConfirmOptions {
  /** 提示用的远端类型，例如 Gitee / RemoteStorage。 */
  backendType: string;
  /** 远端根的路径提示（不含凭证）。 */
  rootHint?: string;
}

/** 返回用户选择；取消/关闭返回 null（调用方不得建任何组）。 */
export function openInitConfirm(opts: InitConfirmOptions): Promise<SyncGroupType | null> {
  injectStyles();

  return new Promise((resolve) => {
    const overlay = el('div', { className: 'zfui-modal-overlay' });
    const root = el('div', { className: 'zfui-modal' });
    overlay.appendChild(root);

    const finished = (value: SyncGroupType | null) => {
      try { document.body.removeChild(overlay); } catch { /* already removed */ }
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };

    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') finished(null); };
    document.addEventListener('keydown', onKey);
    on(overlay, 'click', (e: MouseEvent) => { if (e.target === overlay) finished(null); });

    root.appendChild(el('div', { className: 'zfui-modal-title' }, '这个远端根还没有初始化'));
    root.appendChild(el(
      'div',
      { className: 'zfui-form-notice' },
      `远端（${opts.backendType}${opts.rootHint ? ` ${opts.rootHint}` : ''}）既没有组描述符，也没有 group-type 标记。`
      + '初始化会把根下已有的文件并入组并同步到所有副本，还会写入一个不可逆的组身份；'
      + '所以必须由你确认类型。',
    ));

    const row = el('div', { className: 'zfui-form-row', style: 'justify-content:flex-end;gap:8px;margin-top:16px' });
    const cancel = el('button', { className: 'zfui-btn zfui-btn-sm' }, '取消（不建组）');
    on(cancel, 'click', () => finished(null));
    const data = el('button', { className: 'zfui-btn zfui-btn-sm' }, '初始化为数据组');
    on(data, 'click', () => finished('data-sync'));
    const config = el('button', { className: 'zfui-btn zfui-btn-primary zfui-btn-sm' }, '初始化为配置组');
    on(config, 'click', () => finished('config-sync'));

    row.appendChild(cancel);
    row.appendChild(data);
    row.appendChild(config);
    root.appendChild(row);

    document.body.appendChild(overlay);
    config.focus();
  });
}
