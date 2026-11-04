/**
 * Backend configuration form.
 *
 * Supports two rendering modes:
 *  - 'modal'  (default): overlay appended to document.body
 *  - 'inline': rendered into the provided container element (no popup)
 *
 * The form includes an "Import from config string" feature that parses a
 * `type:id:key=value,...` string and fills all fields automatically.
 *
 * When `initial` is provided the form edits an existing backend: the id and
 * type are locked, secret fields are shown masked (blank = keep the stored
 * value), and a notice + optional confirmation checkbox explain that changing
 * parameters switches the remote target.
 */
import type { BackendMetadata } from '../../types.js';
import { el, on, clear } from '../render.js';
import { STYLES } from '../styles.js';
import { deserializeBackend } from '../config-string.js';
import { maskSecret } from '../secret.js';

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
  /** Pre-fill and lock id/type when editing an existing backend. */
  initial?: { id: string; type: string; options: Record<string, unknown>; description?: string };
  /** Explanatory block (e.g. changing parameters switches the remote target). */
  notice?: string;
  /** Require an explicit checkbox before submitting (destructive edits). */
  confirm?: { label: string };
  submitLabel?: string;
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

  const editing = opts.initial;
  const type = editing?.type ?? defaultType ?? metadataList[0]?.type ?? '';
  const state = {
    type,
    id: editing?.id ?? '',
    description: editing?.description ?? '',
    options: {} as Record<string, string>,
    accountBackendId: '' as string,
    importStr: '',
    importError: '',
    submitError: '',
    confirmChecked: false,
  };

  const initialMeta = metadataList.find((m) => m.type === type);
  if (editing) {
    // Keep non-secret values; secret fields start blank so「留空=保持原值」
    // works and the old value is never rendered in clear text.
    for (const [key, value] of Object.entries(editing.options ?? {})) {
      state.options[key] = value == null ? '' : String(value);
    }
    for (const field of initialMeta?.fields ?? []) {
      if (field.type === 'password') delete state.options[field.key];
    }
  } else if (initialMeta) {
    state.options = { ...initialMeta.defaultOptions };
    state.id = `${type.toLowerCase()}-${Date.now().toString(36)}`;
  }

  function render(): void {
    clear(root);
    const meta = metadataList.find((m) => m.type === state.type);

    root.appendChild(el(
      'div',
      { className: 'zfui-modal-title' },
      title ?? (editing ? `编辑后端参数 · ${state.id}` : '添加后端'),
    ));

    // ── Edit notice (semantics of changing parameters) ────────────────
    if (opts.notice) {
      root.appendChild(el('div', { className: 'zfui-form-notice' }, opts.notice));
    }

    // ── Import from config string (only when creating) ────────────────
    if (!editing) {
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
    }

    // ── Backend type selector ──────────────────────────────────────────
    const typeGroup = el('div', { className: 'zfui-form-group' });
    typeGroup.appendChild(el('label', { className: 'zfui-form-label' }, '后端类型'));
    const typeSelect = el('select', { className: 'zfui-form-select' });
    for (const m of metadataList) {
      const opt = el('option', { value: m.type }, `${m.icon} ${m.label}`);
      if (m.type === state.type) opt.setAttribute('selected', '');
      typeSelect.appendChild(opt);
    }
    if (editing) {
      // Type is part of the backend identity and never changes on edit.
      typeSelect.disabled = true;
      typeSelect.title = '编辑时不能更改后端类型';
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
    if (editing) {
      idInput.readOnly = true;
      idInput.title = '后端 id 保持不变';
    }
    on(idInput, 'input', () => { if (!editing) state.id = idInput.value; });
    idGroup.appendChild(idInput);
    root.appendChild(idGroup);

    // ── Dynamic fields ─────────────────────────────────────────────────
    if (meta) {
      const accountFields = new Set(meta.accountFields ?? []);
      const hasAccountReuse = !editing && opts.allowAccountReuse && accountFields.size > 0 && (opts.accountBackends?.length ?? 0) > 0;

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
          const storedSecret = editing ? editing.options?.[field.key] : undefined;
          const isSecret = field.type === 'password';
          const maskedHint = isSecret && storedSecret != null && storedSecret !== ''
            ? `已保存 ${maskSecret(storedSecret)}（留空保持不变）`
            : field.placeholder ?? '';
          const input = el('input', {
            className: 'zfui-form-input',
            type: isSecret ? 'password' : 'text',
            value: state.options[field.key] ?? '',
            placeholder: maskedHint,
          });
          if (isSecret && storedSecret != null && storedSecret !== '') {
            input.title = '敏感字段默认脱敏；直接输入可覆盖，留空表示保持原值';
          }
          on(input, 'input', () => { state.options[field.key] = input.value; });
          fg.appendChild(input);
          if (isSecret && editing) {
            fg.appendChild(el('div', { className: 'zfui-form-hint' }, '留空 = 保持原值（不会以明文显示已保存的 token）'));
          }
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

    // ── Explicit confirmation (destructive parameter changes) ─────────
    if (opts.confirm) {
      const confirmGroup = el('div', { className: 'zfui-form-group zfui-confirm-group' });
      const confirmLabel = el('label', { className: 'zfui-confirm-label' });
      const confirmBox = el('input', { type: 'checkbox' }) as HTMLInputElement;
      confirmBox.checked = state.confirmChecked;
      on(confirmBox, 'change', () => { state.confirmChecked = confirmBox.checked; });
      confirmLabel.appendChild(confirmBox);
      confirmLabel.appendChild(el('span', {}, opts.confirm.label));
      confirmGroup.appendChild(confirmLabel);
      root.appendChild(confirmGroup);
    }

    // ── Submit error (inline, no alert) ────────────────────────────────
    if (state.submitError) {
      root.appendChild(el('div', { className: 'zfui-form-error' }, state.submitError));
    }

    // ── Actions ────────────────────────────────────────────────────────
    const actions = el('div', { className: 'zfui-actions' });
    const cancelBtn = el('button', { className: 'zfui-btn' }, '取消');
    on(cancelBtn, 'click', () => close());
    actions.appendChild(cancelBtn);
    const submitBtn = el('button', { className: 'zfui-btn zfui-btn-primary' }, opts.submitLabel ?? '连接');
    on(submitBtn, 'click', async () => {
      state.submitError = '';
      if (opts.confirm && !state.confirmChecked) {
        state.submitError = '请先勾选确认后再保存';
        render();
        return;
      }
      if (!state.id.trim()) { state.submitError = '请填写后端 ID'; render(); return; }
      if (!state.type) { state.submitError = '请选择后端类型'; render(); return; }
      submitBtn.setAttribute('disabled', 'true');
      submitBtn.textContent = editing ? '保存中...' : '连接中...';
      try {
        await onSubmit({
          id: state.id.trim(),
          type: state.type,
          options: { ...state.options },
          description: state.description.trim(),
        });
        close();
      } catch (err) {
        state.submitError = err instanceof Error ? err.message : String(err);
        submitBtn.removeAttribute('disabled');
        submitBtn.textContent = opts.submitLabel ?? '连接';
        render();
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
