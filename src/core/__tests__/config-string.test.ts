import { describe, it, expect } from 'vitest';
import { deserializeBackend, serializeBackend } from '../config-string.js';
import type { BackendMetadata } from '../../types.js';

// Only the fields used by the parser are needed here.
const gitee: BackendMetadata = {
  type: 'Gitee',
  label: 'Gitee',
  icon: '',
  fields: [
    { key: 'owner', label: 'Owner', type: 'text' },
    { key: 'repo', label: 'Repo', type: 'text' },
    { key: 'branch', label: 'Branch', type: 'text' },
    { key: 'token', label: 'Token', type: 'password' },
  ],
  defaultOptions: {},
} as BackendMetadata;

const metadata = [gitee];

describe('config-string deserializeBackend', () => {
  it('splits the trailing :desc= segment from the last option', () => {
    // Token redacted on purpose: never persist real credentials in fixtures.
    const token = 'e43a0000000000000000000000000000';
    const parsed = deserializeBackend(
      `Gitee:gitee:owner=weijia432,repo=folders,branch=master,token=${token}:desc=Gitee 仓库`,
      metadata,
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe('Gitee');
    expect(parsed!.id).toBe('gitee');
    expect(parsed!.options.owner).toBe('weijia432');
    expect(parsed!.options.repo).toBe('folders');
    expect(parsed!.options.branch).toBe('master');
    expect(parsed!.options.token).toBe(token);
    expect(parsed!.description).toBe('Gitee 仓库');
  });

  it('keeps the original behaviour for strings without a description', () => {
    const parsed = deserializeBackend('Gitee:id1:owner=o,repo=r,branch=main,token=t', metadata);
    expect(parsed!.options.token).toBe('t');
    expect(parsed!.description).toBe('');
  });

  it('accepts a description containing colons, commas, spaces and CJK text', () => {
    const parsed = deserializeBackend(
      'Gitee:id2:owner=o,repo=r:desc=备注: a,b 中文，空格',
      metadata,
    );
    expect(parsed!.options.repo).toBe('r');
    expect(parsed!.description).toBe('备注: a,b 中文，空格');
  });

  it('treats an empty :desc= as an empty description without error', () => {
    const parsed = deserializeBackend('Gitee:id3:owner=o,repo=r:desc=', metadata);
    expect(parsed!.description).toBe('');
    expect(parsed!.options.repo).toBe('r');
  });

  it('round-trips through serializeBackend', () => {
    const original =
      'Gitee:gitee:owner=weijia432,repo=folders,branch=master,token=e43a0000000000000000000000000000:desc=Gitee 仓库';
    const parsed = deserializeBackend(original, metadata)!;
    const serialized = serializeBackend(parsed.type, parsed.id, parsed.options, parsed.description);
    expect(serialized).toBe(original);

    const reparsed = deserializeBackend(serialized, metadata)!;
    expect(reparsed.options).toEqual(parsed.options);
    expect(reparsed.description).toBe(parsed.description);
  });

  it('still rejects invalid strings instead of silently returning a backend', () => {
    // Unknown type.
    expect(deserializeBackend('Unknown:id1:owner=o', metadata)).toBeNull();
    // Missing id.
    expect(deserializeBackend('Gitee::owner=o', metadata)).toBeNull();
    // Missing separator.
    expect(deserializeBackend('Gitee', metadata)).toBeNull();
  });
});
