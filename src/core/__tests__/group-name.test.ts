import { describe, it, expect } from 'vitest';
import { GROUP_NAME_MAX_LENGTH, validateGroupName } from '../group-name.js';

describe('validateGroupName', () => {
  it('trims surrounding whitespace', () => {
    expect(validateGroupName('  云端文件  ')).toEqual({ ok: true, name: '云端文件' });
  });

  it('rejects empty and whitespace-only names', () => {
    expect(validateGroupName('')).toEqual({ ok: false, error: '组名不能为空' });
    expect(validateGroupName('   ')).toEqual({ ok: false, error: '组名不能为空' });
  });

  it('rejects names longer than the limit', () => {
    const tooLong = 'x'.repeat(GROUP_NAME_MAX_LENGTH + 1);
    expect(validateGroupName(tooLong)).toEqual({
      ok: false,
      error: `组名最多 ${GROUP_NAME_MAX_LENGTH} 个字符`,
    });
  });

  it('accepts a name exactly at the limit', () => {
    const max = 'x'.repeat(GROUP_NAME_MAX_LENGTH);
    expect(validateGroupName(max)).toEqual({ ok: true, name: max });
  });
});
