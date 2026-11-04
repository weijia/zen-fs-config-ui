import { describe, it, expect } from 'vitest';
import { maskSecret } from '../secret.js';

describe('maskSecret', () => {
  it('keeps only the last four characters', () => {
    expect(maskSecret('e43a392a87e6270e8d866b6cea8e3e2d')).toBe('••••3e2d');
  });

  it('hides short values completely', () => {
    expect(maskSecret('abc')).toBe('••••');
    expect(maskSecret('abcd')).toBe('••••');
  });

  it('returns an empty string for empty/undefined values', () => {
    expect(maskSecret('')).toBe('');
    expect(maskSecret(undefined)).toBe('');
    expect(maskSecret(null)).toBe('');
  });
});
