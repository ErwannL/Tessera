import { createHash } from 'node:crypto';

/** Deterministic JSON: object keys sorted recursively. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const body = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${body.join(',')}}`;
  }
  return JSON.stringify(value);
}

export interface ChainLink {
  requestId: string;
  type: string;
  at: Date;
  meta: Record<string, unknown>;
  prevHash: Buffer | null;
}

export function computeEventHash(link: ChainLink): Buffer {
  const parts = [
    link.prevHash?.toString('hex') ?? '',
    link.requestId,
    link.type,
    link.at.toISOString(),
    canonicalJson(link.meta),
  ];
  return createHash('sha256').update(parts.join('\n')).digest();
}

/** True when every event points to its predecessor and its hash matches its content. */
export function verifyChain(events: readonly (ChainLink & { hash: Buffer })[]): boolean {
  let previous: Buffer | null = null;
  for (const event of events) {
    const linked =
      previous === null ? event.prevHash === null : event.prevHash?.equals(previous) === true;
    if (!linked || !computeEventHash(event).equals(event.hash)) return false;
    previous = event.hash;
  }
  return true;
}
