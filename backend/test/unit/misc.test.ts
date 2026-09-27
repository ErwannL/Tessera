import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from '../../src/domain/cursor.js';
import { DomainError } from '../../src/domain/errors.js';
import { createApiKeyVerifier } from '../../src/http/apiKeys.js';
import { serializeError } from '../../src/logger.js';
import { uniqueViolation } from '../../src/services/requests.js';

describe('cursor', () => {
  it('round-trips and rejects garbage', () => {
    const cursor = { createdAt: new Date('2026-01-01T00:00:00.000Z'), id: crypto.randomUUID() };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    expect(decodeCursor('not-a-cursor')).toBeNull();
  });
});

describe('api keys', () => {
  const keys = ['a'.repeat(32), 'b'.repeat(32)];
  const verify = createApiKeyVerifier(keys);
  it('accepts every configured key (rotation) and nothing else', () => {
    expect(verify(`Bearer ${keys[0]!}`)).toBe(true);
    expect(verify(`Bearer ${keys[1]!}`)).toBe(true);
    expect(verify(`Bearer ${'c'.repeat(32)}`)).toBe(false);
    expect(verify(keys[0])).toBe(false);
    expect(verify(undefined)).toBe(false);
  });
});

describe('serializeError', () => {
  it('keeps only safe fields, dropping driver details', () => {
    const error = Object.assign(new Error('boom'), {
      code: '23514',
      detail: 'Failing row (secret)',
    });
    const serialized = serializeError(error);
    expect(serialized).toMatchObject({ type: 'Error', message: 'boom', code: '23514' });
    expect(JSON.stringify(serialized)).not.toContain('secret');
    expect(serializeError(null)).toEqual({
      type: undefined,
      message: undefined,
      code: undefined,
      stack: undefined,
    });
  });
});

describe('DomainError', () => {
  it('maps codes to HTTP statuses and bodies', () => {
    const error = new DomainError('INVALID_CODE', { attemptsRemaining: 2 });
    expect(error.status).toBe(422);
    expect(error.toBody()).toEqual({ error: 'INVALID_CODE', attemptsRemaining: 2 });
    expect(new DomainError('LOCKED').toBody()).toEqual({ error: 'LOCKED' });
  });
});

describe('uniqueViolation', () => {
  it('returns the violated constraint name only for unique violations', () => {
    expect(uniqueViolation({ code: '23505', constraint: 'x_key' })).toBe('x_key');
    expect(uniqueViolation({ code: '23514' })).toBeUndefined();
  });
});
