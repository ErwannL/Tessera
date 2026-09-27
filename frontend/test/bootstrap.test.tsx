import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type BrowserEnvironment } from '../src/bootstrap';

afterEach(() => {
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/');
});

function environment(fetchImpl: typeof fetch, languages: string[]): BrowserEnvironment {
  return {
    location: window.location,
    history: window.history,
    navigator: { languages },
    fetch: fetchImpl,
    document,
  };
}

describe('mount', () => {
  it('erases the fragment before any network call, then renders', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    window.history.replaceState(null, '', '/#handoff=header.payload.signature');
    const seen: string[] = [];
    const fetchImpl = vi.fn((input: string) => {
      seen.push(`${input} ${window.location.hash}`);
      const body = input.endsWith('/handoff')
        ? { id: '42', name: 'Alice' }
        : { id: '42', name: 'Alice', hasRequested: false, hasToApprove: false };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    });
    await mount(environment(fetchImpl as unknown as typeof fetch, ['en-US']));
    expect(window.location.hash).toBe('');
    expect(await screen.findByText('No request concerns you')).toBeInTheDocument();
    expect(seen).toEqual(['/api/v1/dashboard/handoff ', '/api/v1/dashboard/me ']);
    expect(document.documentElement.lang).toBe('en');
  });

  it('requires a #root element', async () => {
    await expect(mount(environment(vi.fn(), ['fr']))).rejects.toThrow('Missing #root element');
  });
});
