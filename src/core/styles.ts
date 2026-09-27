/**
 * Inline CSS injected into the container / shadow root.
 * Uses the `zfui-` prefix to avoid collisions with host styles.
 */
export const STYLES = `
.zfui-root {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  font-size: 14px;
  color: #1f2937;
  line-height: 1.5;
  box-sizing: border-box;
}
.zfui-root *, .zfui-root *::before, .zfui-root *::after { box-sizing: border-box; }

.zfui-header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 16px;
}
.zfui-title { font-size: 16px; font-weight: 600; margin: 0; }
.zfui-subtitle { font-size: 12px; color: #6b7280; margin-top: 2px; }

.zfui-section {
  border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px;
  margin-bottom: 16px; background: #fff;
}
.zfui-section-title {
  font-size: 13px; font-weight: 600; color: #374151;
  margin: 0 0 12px 0; display: flex; align-items: center; gap: 6px;
}

.zfui-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 6px 14px; border-radius: 6px; border: 1px solid #d1d5db;
  background: #fff; color: #374151; font-size: 13px; cursor: pointer;
  transition: background .15s;
}
.zfui-btn:hover { background: #f9fafb; }
.zfui-btn-primary { background: #2563eb; border-color: #2563eb; color: #fff; }
.zfui-btn-primary:hover { background: #1d4ed8; }
.zfui-btn-secondary { background: #f3f4f6; border-color: #d1d5db; color: #374151; }
.zfui-btn-secondary:hover { background: #e5e7eb; }
.zfui-btn-danger { color: #dc2626; border-color: #fecaca; }
.zfui-btn-danger:hover { background: #fef2f2; }
.zfui-btn-danger-active { background: #dc2626; color: #fff; border-color: #dc2626; }
.zfui-btn-danger-active:hover { background: #b91c1c; }
.zfui-btn-sm { padding: 3px 10px; font-size: 12px; }
.zfui-btn:disabled { opacity: .5; cursor: not-allowed; }

.zfui-backend-list { list-style: none; padding: 0; margin: 0 0 12px 0; }
.zfui-backend-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 12px; border: 1px solid #e5e7eb; border-radius: 6px;
  margin-bottom: 8px; background: #fafafa;
}
.zfui-backend-item-primary { border-left: 3px solid #10b981; }
.zfui-backend-name { font-weight: 500; font-family: monospace; font-size: 13px; }
.zfui-backend-type { font-size: 12px; color: #6b7280; margin-left: 8px; }
.zfui-badge {
  display: inline-block; padding: 1px 8px; border-radius: 10px;
  font-size: 11px; font-weight: 500;
}
.zfui-badge-primary { background: #d1fae5; color: #065f46; }

.zfui-empty {
  text-align: center; color: #9ca3af; font-size: 13px;
  padding: 20px; border: 1px dashed #e5e7eb; border-radius: 6px;
  margin-bottom: 12px;
}

.zfui-modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,.4);
  display: flex; align-items: center; justify-content: center; z-index: 1000;
}
.zfui-modal {
  background: #fff; border-radius: 10px; padding: 24px; width: 90%;
  max-width: 480px; max-height: 90vh; overflow-y: auto;
}
.zfui-modal-title { font-size: 16px; font-weight: 600; margin: 0 0 16px 0; }

.zfui-form-group { margin-bottom: 14px; }
.zfui-form-label {
  display: block; font-size: 13px; font-weight: 500; color: #374151;
  margin-bottom: 4px;
}
.zfui-form-label .zfui-req { color: #dc2626; }
.zfui-form-input, .zfui-form-select {
  width: 100%; padding: 8px 10px; border: 1px solid #d1d5db;
  border-radius: 6px; font-size: 13px; font-family: inherit;
}
.zfui-form-input:focus, .zfui-form-select:focus {
  outline: none; border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,.15);
}

.zfui-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }

.zfui-form-row { display: flex; gap: 8px; align-items: center; }
.zfui-form-error { color: #dc2626; font-size: 12px; margin-top: 4px; }
.zfui-divider { height: 1px; background: #e5e7eb; margin: 16px 0; }

.zfui-inline-form {
  border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px;
  background: #fff; margin-top: 12px;
}
.zfui-backend-item-actions { display: flex; gap: 4px; align-items: center; }
.zfui-copy-hint {
  font-size: 11px; color: #6b7280; margin-top: 4px;
  font-family: monospace; word-break: break-all;
}

.zfui-loading { text-align: center; color: #6b7280; padding: 40px; }
.zfui-error {
  background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c;
  padding: 12px; border-radius: 6px; margin-bottom: 16px; font-size: 13px;
}
.zfui-error-actions { margin-top: 8px; }

.zfui-data-group {
  border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px;
  margin-bottom: 10px; background: #f9fafb;
}
.zfui-data-group-name { font-weight: 600; font-size: 13px; margin-bottom: 8px; }
`;
