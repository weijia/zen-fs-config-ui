/**
 * Display-name rules shared by both sync-group cards. Kept pure so the same
 * validation can be unit-tested and reused by the inline editor.
 */
export const GROUP_NAME_MAX_LENGTH = 40;

export type GroupNameValidation =
  | { ok: true; name: string }
  | { ok: false; error: string };

export function validateGroupName(raw: string): GroupNameValidation {
  const name = raw.trim();
  if (!name) {
    return { ok: false, error: '组名不能为空' };
  }
  if (name.length > GROUP_NAME_MAX_LENGTH) {
    return { ok: false, error: `组名最多 ${GROUP_NAME_MAX_LENGTH} 个字符` };
  }
  return { ok: true, name };
}
