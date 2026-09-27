/**
 * Backend configuration modal form.
 *
 * Renders a modal with a backend-type selector and dynamically generated
 * fields (from BackendMetadata.fields). On submit, calls the provided
 * handler with the collected { id, type, options, description }.
 */
import type { BackendMetadata } from '../../types.js';
import { el, on, clear } from '../render.js';
import { STYLES } from '../styles.js';

/**
 * The modal is appended to document.body (outside the shadow root), so the
 * shadow-DOM styles don't reach it. Inject the full stylesheet into
 * document.head once. The `zfui-` prefix keeps it from leaking into the host.
 */
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
  /** If true, include an "account backend" selector for account reuse. */
  allowAccountReuse?: boolean;
  /** Available account backends (id → label) for reuse. */
  accountBackends?: { id: string; label: string }[];
  onSubmit: (result: BackendFormResult) => Promise<void> | void;
  onCancel: () => void;
}

export function openBackendForm(opts: BackendFormOptions): void {
  const { metadataList, defaultType, title, onSubmit, onCancel } = opts;

  injectGlobalStyles();

  const overlay = el('div', { className: 'zfui-modal-overlay' });
  const modal = el('div', { className: 'zfui-modal' });
  overlay.appendChild(modal);

  const type = defaultType ?? metadataList[0]?.type ?? '';
  const state = {
    type,
    id: '',
    description: '',
    options: {} as Record<string, string>,
    accountBackendId: '' as string,
  };

  // Init default options for the default type
  const initialMeta = metadataList.find(m => m.type === type);
  if (initialMeta) {
    state.options = { ...initialMeta.defaultOptions };
    state.id = `${type.toLowerCase()}-${Date.now().toString(36)}`;
  }

  function render(): void {
    clear(modal);
    const meta = metadataList.find(m => m.type === state.type);

    modal.appendChild(el('div', { className: 'zfui-modal-title' }, title ?? '添加后端'));

    // Backend type selector
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
      const newMeta = metadataList.find(m => m.type === state.type);
      if (newMeta) {
        state.options = { ...newMeta.defaultOptions };
        if (!state.id || state.id.startsWith(type.toLowerCase())) {
          state.id = `${newMeta.type.toLowerCase()}-${Date.now().toString(36)}`;
        }
      }
      render();
    });
    typeGroup.appendChild(typeSelect);
    modal.appendChild(typeGroup);

    // ID
    const idGroup = el('div', { className: 'zfui-form-group' });
    idGroup.appendChild(el('label', { className: 'zfui-form-label' }, 'ID'));
    const idInput = el('input', {
      className: 'zfui-form-input',
      value: state.id,
      placeholder: 'backend-id',
    });
    on(idInput, 'input', () => { state.id = idInput.value; });
    idGroup.appendChild(idInput);
    modal.appendChild(idGroup);

    // Dynamic fields
    if (meta) {
      // Determine which fields are "account fields" (reusable) vs "storage fields"
      const accountFields = new Set(meta.accountFields ?? []);
      const hasAccountReuse = opts.allowAccountReuse && accountFields.size > 0 && (opts.accountBackends?.length ?? 0) > 0;

      // Account backend selector (only when reuse is available)
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
        modal.appendChild(accGroup);
      }

      // Field inputs
      for (const field of meta.fields) {
        // If reusing account, skip account fields
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
        modal.appendChild(fg);
      }
    }

    // Description
    const descGroup = el('div', { className: 'zfui-form-group' });
    descGroup.appendChild(el('label', { className: 'zfui-form-label' }, '描述（可选）'));
    const descInput = el('input', { className: 'zfui-form-input', value: state.description });
    on(descInput, 'input', () => { state.description = descInput.value; });
    descGroup.appendChild(descInput);
    modal.appendChild(descGroup);

    // Actions
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
    modal.appendChild(actions);
  }

  function close(): void {
    overlay.remove();
    onCancel();
  }

  on(overlay, 'click', (e: MouseEvent) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
  render();
}
