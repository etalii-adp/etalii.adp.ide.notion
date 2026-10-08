import { createHash as nodeHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createHash } from '../../src/shims/node-crypto';

// The digest of the browser bundle gives what Node's own gives, so a history made in one host reads in another.
describe('the digest in the place of node:crypto', () => {
  const text = (value: string): Uint8Array => new TextEncoder().encode(value);
  const inputs: [string, Uint8Array][] = [
    ['nothing', new Uint8Array(0)],
    ['abc', text('abc')],
    ['text beyond ASCII', text('Steam engine · Plateau\r\n')],
    // 55, 56 and 64 bytes are where the padding takes one block more.
    ...[55, 56, 63, 64, 65, 119, 120].map((length): [string, Uint8Array] => [`${length} bytes`, new Uint8Array(length).fill(0x61)]),
    ['every byte value, many blocks', Uint8Array.from({ length: 100_000 }, (_, index) => index % 256)],
  ];

  it.each(inputs)('gives Node\'s SHA-256 of %s', (_name, bytes) => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(nodeHash('sha256').update(bytes).digest('hex'));
  });

  it('takes its bytes in several updates', () => {
    expect(createHash('sha256').update(text('ab')).update(text('c')).digest('hex')).toBe(nodeHash('sha256').update('abc').digest('hex'));
  });

  it('refuses another digest', () => {
    expect(() => createHash('md5')).toThrow('md5');
  });
});
