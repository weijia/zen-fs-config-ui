import { describe, it, expect } from 'vitest';
import {
  formatBackendFailureSummary,
  formatBackendFailureDetail,
} from '../configurator';

describe('backend failure status text', () => {
  it('adds nothing when every listed backend has a pair', () => {
    expect(formatBackendFailureSummary([])).toBe('');
    expect(formatBackendFailureDetail([])).toBe('');
  });

  it('names the backend that has no sync pair', () => {
    const failed = [{ id: 'gitee-mw06t65y', message: 'Missing required option: token' }];
    expect(formatBackendFailureSummary(failed)).toBe(' · 1 个后端未建立同步对');
    expect(formatBackendFailureDetail(failed)).toContain('gitee-mw06t65y');
    expect(formatBackendFailureDetail(failed)).toContain('Missing required option: token');
  });

  it('counts multiple failures', () => {
    const failed = [
      { id: 'a', message: 'Missing required option: token' },
      { id: 'b', message: 'Unknown backend type: Foo' },
    ];
    expect(formatBackendFailureSummary(failed)).toBe(' · 2 个后端未建立同步对');
  });
});
