import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApi, dayToIso, listQuery } from '../src/api';
import { formatDate, formatDateTime, formatRemaining } from '../src/format';
import { consumeHandoffToken } from '../src/handoff';
import { initI18n, pickLanguage, resources } from '../src/i18n';
import { EMPTY_FILTERS } from '../src/types';

function keys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('api client', () => {
  const ok = (body: unknown, status = 200) =>
    Promise.resolve(new Response(status === 204 ? null : JSON.stringify(body), { status }));

  it('posts the handoff token as JSON on the same origin', async () => {
    const fetchImpl = vi.fn(() => ok({ id: '42', name: 'Alice' }));
    const api = createApi(fetchImpl);
    await expect(api.handoff('jwt')).resolves.toEqual({ id: '42', name: 'Alice' });
    expect(fetchImpl).toHaveBeenCalledWith('/api/v1/dashboard/handoff', {
      credentials: 'same-origin',
      method: 'POST',
      body: '{"token":"jwt"}',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
    });
  });

  it('handles empty answers and errors', async () => {
    const fetchImpl = vi.fn(() => ok(null, 204));
    await expect(createApi(fetchImpl).logout()).resolves.toBeNull();
    const failing = createApi(() => ok({ error: 'UNAUTHORIZED' }, 401));
    await expect(failing.me()).rejects.toEqual(new ApiError(401));
    await expect(failing.me()).rejects.toMatchObject({ status: 401 });
  });

  it('builds list and detail URLs', async () => {
    const fetchImpl = vi.fn(() => ok({ items: [], nextCursor: null }));
    const api = createApi(fetchImpl);
    await api.list('approver', EMPTY_FILTERS, null);
    await api.detail('a/b');
    expect(fetchImpl.mock.calls.map((call) => (call as unknown as [string])[0])).toEqual([
      '/api/v1/dashboard/requests?role=approver',
      '/api/v1/dashboard/requests/a%2Fb',
    ]);
  });

  it('encodes every filter', () => {
    const query = new URLSearchParams(
      listQuery(
        'requester',
        {
          status: 'APPROVED',
          action: 'DO_IT',
          from: '2026-09-01',
          to: '2026-09-30',
          counterpart: 'Bruno',
        },
        'cursor-1',
      ),
    );
    expect(Object.fromEntries(query)).toEqual({
      role: 'requester',
      status: 'APPROVED',
      action: 'DO_IT',
      from: dayToIso('2026-09-01', false),
      to: dayToIso('2026-09-30', true),
      counterpart: 'Bruno',
      cursor: 'cursor-1',
    });
  });

  it('converts local days to instants', () => {
    expect(new Date(dayToIso('2026-09-01', false)).getHours()).toBe(0);
    const end = new Date(dayToIso('2026-09-01', true));
    expect([end.getHours(), end.getMinutes(), end.getMilliseconds()]).toEqual([23, 59, 999]);
  });
});

describe('handoff fragment', () => {
  function place(hash: string) {
    return {
      location: { hash, pathname: '/', search: '?x=1' },
      history: { replaceState: vi.fn() },
    };
  }

  it('reads the token then erases it from the address bar', () => {
    const target = place('#handoff=abc.def.ghi');
    expect(consumeHandoffToken(target)).toBe('abc.def.ghi');
    expect(target.history.replaceState).toHaveBeenCalledWith(null, '', '/?x=1');
  });

  it('erases an empty token and ignores other fragments', () => {
    const empty = place('#handoff=');
    expect(consumeHandoffToken(empty)).toBeNull();
    expect(empty.history.replaceState).toHaveBeenCalled();
    const other = place('#section');
    expect(consumeHandoffToken(other)).toBeNull();
    expect(other.history.replaceState).not.toHaveBeenCalled();
  });
});

describe('i18n', () => {
  it('has the same keys, all non-empty, in French and English', () => {
    const fr = keys(resources.fr.translation).sort();
    expect(keys(resources.en.translation).sort()).toEqual(fr);
    for (const language of [resources.fr, resources.en]) {
      for (const key of fr) {
        const value = key
          .split('.')
          .reduce<unknown>(
            (node, part) => (node as Record<string, unknown>)[part],
            language.translation,
          );
        expect(typeof value === 'string' && value.length > 0, key).toBe(true);
      }
    }
  });

  it('picks French for French browsers and English otherwise', async () => {
    expect(pickLanguage(['fr-CA', 'en'])).toBe('fr');
    expect(pickLanguage(['de-DE'])).toBe('en');
    expect(pickLanguage([])).toBe('en');
    const i18n = await initI18n('en');
    expect(i18n.t('tabs.requester')).toBe('My requests');
  });
});

describe('format', () => {
  it('formats dates in the given language', () => {
    expect(formatDate('2026-09-27T14:32:01.000Z', 'fr')).toContain('2026');
    expect(formatDateTime('2026-09-27T14:32:01.000Z', 'en')).toContain('2026');
  });

  it('formats the remaining time', () => {
    expect(formatRemaining(599_001)).toBe('10:00');
    expect(formatRemaining(61_000)).toBe('1:01');
    expect(formatRemaining(3_723_000)).toBe('1:02:03');
    expect(formatRemaining(-5)).toBe('0:00');
  });
});
