import { z } from 'zod';

const decoded = z.tuple([z.iso.datetime(), z.uuid()]);

export interface Cursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.id}`).toString('base64url');
}

export function decodeCursor(value: string): Cursor | null {
  const parts = Buffer.from(value, 'base64url').toString('utf8').split('|');
  const parsed = decoded.safeParse(parts);
  return parsed.success ? { createdAt: new Date(parsed.data[0]), id: parsed.data[1] } : null;
}
