import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/** Unambiguous when read aloud or handwritten: no 0/O, 1/I/L. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const SHORT_ID_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const DIGITS = '0123456789';

export type RandomInt = (maxExclusive: number) => number;

function pick(alphabet: string, count: number, random: RandomInt): string {
  return Array.from({ length: count }, () => alphabet.charAt(random(alphabet.length))).join('');
}

export function generateCode(length: number, random: RandomInt = randomInt): string {
  return pick(CODE_ALPHABET, length, random);
}

/** Human-friendly identifier such as `8472-KQMX`; random, unrelated to creation order. */
export function generateShortId(random: RandomInt = randomInt): string {
  return `${pick(DIGITS, 4, random)}-${pick(SHORT_ID_LETTERS, 4, random)}`;
}

export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]+/g, '');
}

export function formatCode(code: string): string {
  return code.replace(/(.{3})(?=.)/g, '$1-');
}

export function hmacCode(key: string, requestId: string, normalizedCode: string): Buffer {
  return createHmac('sha256', key).update(`${requestId}:${normalizedCode}`).digest();
}

/** Constant-time comparison of the stored HMAC with the HMAC of the submitted code. */
export function codeMatches(
  key: string,
  requestId: string,
  stored: Buffer,
  submitted: string,
): boolean {
  const candidate = hmacCode(key, requestId, normalizeCode(submitted));
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}
