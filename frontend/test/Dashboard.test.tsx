import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Dashboard, visibleRoles } from '../src/components/Dashboard';
import type { Role } from '../src/types';
import { aliceMe, detailOf, fakeApi, makeRequest, page, renderWithI18n } from './helpers';

describe('tab rule', () => {
  it.each([
    [true, true, ['requester', 'approver']],
    [true, false, ['requester']],
    [false, true, ['approver']],
    [false, false, []],
  ])('hasRequested=%s hasToApprove=%s → %j', (hasRequested, hasToApprove, expected) => {
    expect(visibleRoles({ ...aliceMe, hasRequested, hasToApprove })).toEqual(expected);
  });

  it('shows both tabs when both have requests and switches between them', async () => {
    const list = vi.fn((role: Role) =>
      Promise.resolve(page([makeRequest({ action: role === 'requester' ? 'MINE' : 'THEIRS' })])),
    );
    await renderWithI18n(<Dashboard api={fakeApi({ list })} me={aliceMe} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Mes demandes', 'À approuver']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('MINE')).toBeInTheDocument();
    await userEvent.click(tabs[1]!);
    expect(await screen.findByText('THEIRS')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'À approuver' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'tab-approver');
  });

  it('shows only the non-empty one, without a tab bar', async () => {
    await renderWithI18n(<Dashboard api={fakeApi()} me={{ ...aliceMe, hasRequested: false }} />);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByRole('heading', { name: 'À approuver' })).toBeInTheDocument();
    expect(screen.queryByText('Mes demandes')).toBeNull();
  });

  it('shows only a message when nothing concerns the user', async () => {
    const api = fakeApi();
    const { container } = await renderWithI18n(
      <Dashboard api={api} me={{ ...aliceMe, hasRequested: false, hasToApprove: false }} />,
    );
    expect(container).toHaveTextContent(/^Aucune demande ne vous concerne$/);
  });

  it('opens a detail and comes back to the list; switching tab closes it', async () => {
    const request = makeRequest({ shortId: '8472-KQMX' });
    const api = fakeApi({
      list: vi.fn(() => Promise.resolve(page([request]))),
      detail: vi.fn(() => Promise.resolve(detailOf(request))),
    });
    await renderWithI18n(<Dashboard api={api} me={aliceMe} />);
    await userEvent.click(await screen.findByRole('button', { name: /8472-KQMX/ }));
    expect(await screen.findByRole('heading', { name: 'Demande 8472-KQMX' })).toBeInTheDocument();
    expect(api.detail).toHaveBeenCalledWith(request.id);
    await userEvent.click(screen.getByRole('button', { name: 'Retour à la liste' }));
    expect(await screen.findByRole('button', { name: /8472-KQMX/ })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: /8472-KQMX/ }));
    await userEvent.click(screen.getByRole('tab', { name: 'À approuver' }));
    const panel = screen.getByRole('tabpanel');
    expect(await within(panel).findByRole('button', { name: /8472-KQMX/ })).toBeInTheDocument();
  });
});
