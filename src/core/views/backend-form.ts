/**
 * Backend configuration form.
 *
 * Supports two rendering modes:
 *  - 'modal'  (default): overlay appended to document.body
 *  - 'inline': rendered into the provided container element (no popup)
 *
 * The form includes an "Import from config string" feature that parses a
 * `type:id:key=value,...` string and fills all fields automatically.
 */
import type { BackendMetadata } from '../../types.js';
import { el, on, clear } from '../render.js';
import { STYLES } from '../styles.js';
import { deserializeBackend } from '../config-string.js';

let globalStylesInjected = false;
function injectGlobalStyles(): void {
  if (globalStylesInjected) return;
  const style = document.createElement('style');
  style.setAttribute('data-zfui', '');
  style.textContent = STYLES;
  document.head.appendChild(style);
  globalStylesInjected = true;
}

export interface BackendFormResult {
  id: string;
  type: string;
  options: Record<string, unknown>;
  description: string;
}

interface BackendFormOptions {
  metadataList: BackendMetadata[];
  defaultType?: string;
  title?: string;
  allowAccountReuse?: boolean;
  accountBackends?: { id: string; label: string }[];
  /** Render mode: 'modal' (default) or 'inline'. */
  mode?: 'modal' | 'inline';
  /** Required when mode === 'inline'. The form is rendered into this element. */
  container?: HTMLElement;
  onSubmit: (result: BackendFormResult) => Promise<void> | void;
  onCancel: () => void;
}

/**
 * Open a backend form. In 'inline' mode, returns the form's root element so
 * the caller can show/hide it. In 'modal' mode, returns null (modal is
 * self-managed).
 */
export function openBackendForm(opts: BackendFormOptions): HTMLElement | null {
  const { metadataList, defaultType, title, onSubmit, onCancel } = opts;
  const mode = opts.mode ?? 'modal';

  if (mode === 'modal') injectGlobalStyles();

  const root = mode === 'inline'
    ? el('div', { className: 'zfui-inline-form' })
    : el('div', { className: 'zfui-modal' });

  if (mode === 'modal') {
    const overlay = el('div', { className: 'zfui-modal-overlay' });
    overlay.appendChild(root);
    on(overlay, 'click', (e: MouseEvent) => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
  } else if (opts.container) {
    clear(opts.container);
    opts.container.appendChild(root);
  }

  const type = defaultType ?? metadataList[0]?.type ?? '';
  const state = {
    type,
    id: '',
    description: '',
    options: {} as Record<string, string>,
    accountBackendId: '' as string,
    importStr: '',
    importError: '',
  };

  const initialMeta = metadataList.find((m) => m.type === type);
  if (initialMeta) {
    state.options = { ...initialMeta.defaultOptions };
    state.id = `${type.toLowerCase()}-${Date.now().toString(36)}`;
  }

  function render(): void {
    clear(root);
    const meta = metadataList.find((m) => m.type === state.type);

    root.appendChild(el('div', { className: 'zfui-modal-title' }, title ?? '添加后端'));

    // ── Import from config string ──────────────────────────────────────
    const importGroup = el('div', { className: 'zfui-form-group' });
    importGroup.appendChild(el('label', { className: 'zfui-form-label' }, '从配置字符串导入（可选）'));
    const importRow = el('div', { className: 'zfui-form-row' });
    const importInput = el('input', {
      className: 'zfui-form-input',
      value: state.importStr,
      placeholder: 'type:id:key=value,key=value',
      style: 'font-family:monospace;font-size:12px;flex:1',
    });
    on(importInput, 'input', () => { state.importStr = importInput.value; });
    const importBtn = el('button', { className: 'zfui-btn zfui-btn-sm' }, '导入');
    on(importBtn, 'click', () => {
      const parsed = deserializeBackend(state.importStr, metadataList);
      if (!parsed) {
        state.importError = '格式无效或未知类型。示例: Gitee:my-repo:owner=weijia,repo=configs';
        render();
        return;
      }
      state.type = parsed.type;
      state.id = parsed.id;
      state.options = { ...parsed.options };
      state.description = parsed.description;
      state.importError = '';
      render();
    });
    importRow.appendChild(importInput);
    importRow.appendChild(importBtn);
    importGroup.appendChild(importRow);
    if (state.importError) {
      importGroup.appendChild(el('div', { className: 'zfui-form-error' }, state.importError));
    }
    root.appendChild(importGroup);

    root.appendChild(el('div', { className: 'zfui-divider' }));

    // ── Backend type selector ──────────────────────────────────────────
    const typeGroup = el('div', { className: 'zfui-form-group' });
    typeGroup.appendChild(el('label', { className: 'zfui-form-label' }, '后端类型'));
    const typeSelect = el('select', { className: 'zfui-form-select' });
    for (const m of metadataList) {
      const opt = el('option', { value: m.type }, `${m.icon} ${m.label}`);
      if (m.type === state.type) opt.setAttribute('selected', '');
      typeSelect.appendChild(opt);
    }
    on(typeSelect, 'change', () => {
      state.type = typeSelect.value;
      const newMeta = metadataList.find((m) => m.type === state.type);
      if (newMeta) {
        state.options = { ...newMeta.defaultOptions };
        if (!state.id || /^[a-z]+-[a-z0-9]+$/.test(state.id)) {
          state.id = `${newMeta.type.toLowerCase()}-${Date.now().toString(36)}`;
        }
      }
      render();
    });
    typeGroup.appendChild(typeSelect);
    root.appendChild(typeGroup);

    // ── ID ─────────────────────────────────────────────────────────────
    const idGroup = el('div', { className: 'zfui-form-group' });
    idGroup.appendChild(el('label', { className: 'zfui-form-label' }, 'ID'));
    const idInput = el('input', {
      className: 'zfui-form-input',
      value: state.id,
      placeholder: 'backend-id',
      style: 'font-family:monospace',
    });
    on(idInput, 'input', () => { state.id = idInput.value; });
    idGroup.appendChild(idInput);
    root.appendChild(idGroup);

    // ── Dynamic fields ─────────────────────────────────────────────────
    if (meta) {
      const accountFields = new Set(meta.accountFields ?? []);
      const hasAccountReuse = opts.allowAccountReuse && accountFields.size > 0 && (opts.accountBackends?.length ?? 0) > 0;

      if (hasAccountReuse) {
        const accGroup = el('div', { className: 'zfui-form-group' });
        accGroup.appendChild(el('label', { className: 'zfui-form-label' }, '复用账户（可选）'));
        const accSelect = el('select', { className: 'zfui-form-select' });
        accSelect.appendChild(el('option', { value: '' }, '— 不使用，手动填写 —'));
        for (const ab of opts.accountBackends ?? []) {
          accSelect.appendChild(el('option', { value: ab.id }, ab.label));
        }
        on(accSelect, 'change', () => { state.accountBackendId = accSelect.value; render(); });
        accGroup.appendChild(accSelect);
        root.appendChild(accGroup);
      }

      for (const field of meta.fields) {
        if (hasAccountReuse && state.accountBackendId && accountFields.has(field.key)) continue;

        const fg = el('div', { className: 'zfui-form-group' });
        const label = el('label', { className: 'zfui-form-label' }, field.label);
        if (field.required) label.appendChild(el('span', { className: 'zfui-req' }, ' *'));
        fg.appendChild(label);

        if (field.type === 'select') {
          const sel = el('select', { className: 'zfui-form-select' });
          for (const o of field.options ?? []) {
            const opt = el('option', { value: o.value }, o.label);
            if (state.options[field.key] === o.value) opt.setAttribute('selected', '');
            sel.appendChild(opt);
          }
          on(sel, 'change', () => { state.options[field.key] = sel.value; });
          fg.appendChild(sel);
        } else {
          const input = el('input', {
            className: 'zfui-form-input',
            type: field.type === 'password' ? 'password' : 'text',
            value: state.options[field.key] ?? '',
            placeholder: field.placeholder ?? '',
          });
          on(input, 'input', () => { state.options[field.key] = input.value; });
          fg.appendChild(input);
        }
        root.appendChild(fg);
      }
    }

    // ── Description ────────────────────────────────────────────────────
    const descGroup = el('div', { className: 'zfui-form-group' });
    descGroup.appendChild(el('label', { className: 'zfui-form-label' }, '描述（可选）'));
    const descInput = el('input', { className: 'zfui-form-input', value: state.description });
    on(descInput, 'input', () => { state.description = descInput.value; });
    descGroup.appendChild(descInput);
    root.appendChild(descGroup);

    // ── Actions ────────────────────────────────────────────────────────
    const actions = el('div', { className: 'zfui-actions' });
    const cancelBtn = el('button', { className: 'zfui-btn' }, '取消');
    on(cancelBtn, 'click', () => close());
    actions.appendChild(cancelBtn);
    const submitBtn = el('button', { className: 'zfui-btn zfui-btn-primary' }, '连接');
    on(submitBtn, 'click', async () => {
      if (!state.id.trim()) { alert('请填写后端 ID'); return; }
      if (!state.type) { alert('请选择后端类型'); return; }
      submitBtn.setAttribute('disabled', 'true');
      submitBtn.textContent = '连接中...';
      try {
        await onSubmit({
          id: state.id.trim(),
          type: state.type,
          options: { ...state.options },
          description: state.description.trim(),
        });
        close();
      } catch (err) {
        alert(err instanceof Error ? err.message : String(err));
        submitBtn.removeAttribute('disabled');
        submitBtn.textContent = '连接';
      }
    });
    actions.appendChild(submitBtn);
    root.appendChild(actions);
  }

  function close(): void {
    if (mode === 'modal') {
      root.parentElement?.remove();
    } else if (opts.container) {
      clear(opts.container);
    }
    onCancel();
  }

  render();
  return mode === 'inline' ? root : null;
}
