import { describe, expect, it } from 'vitest';
import {
  CODE_ALPHABET,
  codeMatches,
  formatCode,
  generateCode,
  generateShortId,
  hmacCode,
  normalizeCode,
} from '../../src/domain/code.js';

const KEY = 'k'.repeat(40);
const ID = '0b6f0b6f-0000-4000-8000-000000000001';

describe('codes', () => {
  it('uses an alphabet without ambiguous characters', () => {
    expect(CODE_ALPHABET).not.toMatch(/[0O1IL]/);
    expect(new Set(CODE_ALPHABET).size).toBe(CODE_ALPHABET.length);
  });

  it.each([6, 9, 12])('generates codes of length %i from the alphabet', (length) => {
    for (let index = 0; index < 50; index += 1) {
      const code = generateCode(length);
      expect(code).toHaveLength(length);
      expect(code).toMatch(new RegExp(`^[${CODE_ALPHABET}]+$`));
    }
  });

  it('draws each character with the injected random source', () => {
    expect(generateCode(6, () => 0)).toBe('AAAAAA');
    expect(generateCode(6, (max) => max - 1)).toBe('999999');
  });

  it('generates short ids such as 8472-KQMX', () => {
    expect(generateShortId()).toMatch(/^\d{4}-[A-Z]{4}$/);
    expect(generateShortId(() => 0)).toBe('0000-AAAA');
  });

  it('normalizes case, spaces and dashes', () => {
    expect(normalizeCode(' k7m-4qx ')).toBe('K7M4QX');
    expect(normalizeCode('k7m 4q\tx')).toBe('K7M4QX');
  });

  it('formats by groups of three', () => {
    expect(formatCode('K7M4QX')).toBe('K7M-4QX');
    expect(formatCode('K7M4QXABCD')).toBe('K7M-4QX-ABC-D');
  });

  it('binds the HMAC to the request id and never equals the code', () => {
    const hmac = hmacCode(KEY, ID, 'K7M4QX');
    expect(hmac).toHaveLength(32);
    expect(hmac.toString('utf8')).not.toContain('K7M4QX');
    expect(hmac.equals(hmacCode(KEY, `${ID}x`, 'K7M4QX'))).toBe(false);
  });

  it('matches a normalized submission in constant time', () => {
    const stored = hmacCode(KEY, ID, 'K7M4QX');
    expect(codeMatches(KEY, ID, stored, 'k7m-4qx')).toBe(true);
    expect(codeMatches(KEY, ID, stored, 'K7M4QY')).toBe(false);
    expect(codeMatches(KEY, ID, Buffer.alloc(4), 'K7M4QX')).toBe(false);
  });
});
