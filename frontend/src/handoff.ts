const PREFIX = '#handoff=';

export interface Place {
  location: Pick<Location, 'hash' | 'pathname' | 'search'>;
  history: Pick<History, 'replaceState'>;
}

/**
 * Reads the handoff token from the URL fragment (never sent to any server) and erases it
 * from the address bar and history immediately, before anything else runs.
 */
export function consumeHandoffToken(place: Place): string | null {
  const { hash, pathname, search } = place.location;
  if (!hash.startsWith(PREFIX)) return null;
  place.history.replaceState(null, '', `${pathname}${search}`);
  const token = hash.slice(PREFIX.length);
  return token === '' ? null : token;
}
