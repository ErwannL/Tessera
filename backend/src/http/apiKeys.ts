import { createHash, timingSafeEqual } from 'node:crypto';

const sha256 = (value: string): Buffer => createHash('sha256').update(value).digest();

/**
 * Only SHA-256 digests of the configured keys are kept. Every candidate is compared in
 * constant time against every key (no early exit) so timing reveals nothing.
 */
export function createApiKeyVerifier(keys: readonly string[]) {
  const digests = keys.map(sha256);
  return (authorization: string | undefined): boolean => {
    const match = /^Bearer (.+)$/.exec(authorization ?? '');
    const candidate = sha256(match?.[1] ?? '');
    return digests.reduce((found, digest) => timingSafeEqual(digest, candidate) || found, false);
  };
}
