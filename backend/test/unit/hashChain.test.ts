import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  computeEventHash,
  verifyChain,
  type ChainLink,
} from '../../src/domain/hashChain.js';

const at = new Date('2026-09-27T14:32:01.000Z');

function chain(): (ChainLink & { hash: Buffer })[] {
  const first: ChainLink = {
    requestId: 'r',
    type: 'CREATED',
    at,
    meta: { ip: '1' },
    prevHash: null,
  };
  const firstHash = computeEventHash(first);
  const second: ChainLink = { requestId: 'r', type: 'APPROVED', at, meta: {}, prevHash: firstHash };
  return [
    { ...first, hash: firstHash },
    { ...second, hash: computeEventHash(second) },
  ];
}

describe('canonicalJson', () => {
  it('sorts keys recursively and keeps arrays in order', () => {
    expect(canonicalJson({ b: 1, a: [{ d: null, c: 'x' }, 2] })).toBe(
      '{"a":[{"c":"x","d":null},2],"b":1}',
    );
  });
});

describe('verifyChain', () => {
  it('accepts an empty and an intact chain', () => {
    expect(verifyChain([])).toBe(true);
    expect(verifyChain(chain())).toBe(true);
  });

  it('detects altered content', () => {
    const events = chain();
    events[1] = { ...events[1]!, meta: { forged: true } };
    expect(verifyChain(events)).toBe(false);
  });

  it('detects a first event pointing to a predecessor', () => {
    const events = chain();
    events[0] = { ...events[0]!, prevHash: Buffer.alloc(32) };
    expect(verifyChain(events)).toBe(false);
  });

  it('detects a removed or unlinked event', () => {
    const events = chain();
    expect(verifyChain([events[1]!])).toBe(false);
    events[1] = { ...events[1]!, prevHash: null };
    expect(verifyChain(events)).toBe(false);
  });
});
