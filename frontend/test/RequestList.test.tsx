import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequestList } from '../src/components/RequestList';
import { RequestRow } from '../src/components/RequestRow';
import { EMPTY_FILTERS, type Page } from '../src/types';
import { deferred, fakeApi, makeRequest, page, renderWithI18n } from './helpers';

afterEach(() => {
  vi.useRealTimers();
});

describe('RequestRow', () => {
  it('shows the counterpart direction, the action, the text and the creation date', async () => {
    const request = makeRequest({ shortId: '8472-KQMX' });
    await renderWithI18n(
      <ul>
        <RequestRow request={request} role="requester" onOpen={vi.fn()} />
        <RequestRow request={request} role="approver" onOpen={vi.fn()} />
      </ul>,
    );
    expect(screen.getByText('→ Bruno Keller')).toBeInTheDocument();
    expect(screen.getByText('← Alice Martin')).toBeInTheDocument();
    expect(screen.getAllByText('CHANGE_PROJECT_PRIORITY')).toHaveLength(2);
    expect(screen.getAllByText(/Créée le .*2026/)).toHaveLength(2);
  });

  it.each([
    ['APPROVED', { approvedAt: '2026-09-27T14:33:18.000Z' }, /Approuvée le .*2026/],
    ['CANCELLED', { cancelledAt: '2026-09-27T14:33:18.000Z' }, /Annulée le .*2026/],
    ['EXPIRED', { expiredAt: '2026-09-27T14:42:01.000Z' }, /Expirée le .*2026/],
    ['LOCKED', { lockedAt: '2026-09-27T14:35:00.000Z' }, /Verrouillée le .*2026/],
    ['LOCKED', {}, /^Verrouillée$/],
  ] as const)('shows the badge and the closing date for %s', async (status, dates, expected) => {
    await renderWithI18n(
      <ul>
        <RequestRow request={makeRequest({ status, ...dates })} role="requester" onOpen={vi.fn()} />
      </ul>,
    );
    expect(screen.getAllByText(expected).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Expire dans/)).toBeNull();
  });

  it('counts down to the deadline of a pending request', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(new Date('2026-09-27T14:40:00.000Z'));
    await renderWithI18n(
      <ul>
        <RequestRow request={makeRequest()} role="requester" onOpen={vi.fn()} />
      </ul>,
    );
    expect(screen.getByText('Expire dans 2:01')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('Expire dans 1:01')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(62_000);
    });
    expect(screen.getByText('Échéance atteinte')).toBeInTheDocument();
  });

  it('renders HTML from the App as plain text', async () => {
    const payload = '<script>alert(1)</script><img src=x onerror=alert(2)>';
    const { container } = await renderWithI18n(
      <ul>
        <RequestRow
          request={makeRequest({ displayText: payload })}
          role="requester"
          onOpen={vi.fn()}
        />
      </ul>,
    );
    expect(screen.getByText(payload)).toBeInTheDocument();
    expect(container.querySelector('script, img')).toBeNull();
  });

  it('opens the request on click', async () => {
    const onOpen = vi.fn();
    const request = makeRequest({ shortId: '1234-ABCD' });
    await renderWithI18n(
      <ul>
        <RequestRow request={request} role="requester" onOpen={onOpen} />
      </ul>,
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Voir le détail de la demande 1234-ABCD' }),
    );
    expect(onOpen).toHaveBeenCalledWith(request.id);
  });
});

describe('RequestList', () => {
  it('loads the list for the role and paginates', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce(page([makeRequest({ action: 'FIRST' })], 'cursor-1'))
      .mockResolvedValueOnce(page([makeRequest({ action: 'SECOND' })]));
    await renderWithI18n(<RequestList api={fakeApi({ list })} role="approver" onOpen={vi.fn()} />);
    expect(screen.getByText('Chargement…')).toBeInTheDocument();
    expect(await screen.findByText('FIRST')).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith('approver', EMPTY_FILTERS, null);
    await userEvent.click(screen.getByRole('button', { name: 'Afficher plus' }));
    expect(await screen.findByText('SECOND')).toBeInTheDocument();
    expect(screen.getByText('FIRST')).toBeInTheDocument();
    expect(list).toHaveBeenLastCalledWith('approver', EMPTY_FILTERS, 'cursor-1');
    expect(screen.queryByRole('button', { name: 'Afficher plus' })).toBeNull();
  });

  it('disables the button while loading more, and reports a failure', async () => {
    const more = deferred<Page>();
    const list = vi
      .fn()
      .mockResolvedValueOnce(page([makeRequest()], 'cursor-1'))
      .mockReturnValueOnce(more.promise);
    await renderWithI18n(<RequestList api={fakeApi({ list })} role="requester" onOpen={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Afficher plus' }));
    expect(screen.getByRole('button', { name: 'Afficher plus' })).toBeDisabled();
    await act(async () => {
      more.reject(new Error('offline'));
      await more.promise.catch(() => undefined);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Une erreur est survenue.');
  });

  it('applies and resets filters', async () => {
    const list = vi.fn(() => Promise.resolve(page([])));
    await renderWithI18n(<RequestList api={fakeApi({ list })} role="requester" onOpen={vi.fn()} />);
    expect(await screen.findByText('Aucune demande ne vous concerne')).toBeInTheDocument();
    const form = screen.getByRole('form', { name: 'Filtres' });
    await userEvent.selectOptions(within(form).getByLabelText('État'), 'APPROVED');
    await userEvent.type(within(form).getByLabelText('Action'), ' change_x ');
    await userEvent.type(within(form).getByLabelText('Du'), '2026-09-01');
    await userEvent.type(within(form).getByLabelText('Au'), '2026-09-30');
    await userEvent.type(within(form).getByLabelText('Personne'), ' Bruno ');
    await userEvent.click(within(form).getByRole('button', { name: 'Filtrer' }));
    expect(list).toHaveBeenLastCalledWith(
      'requester',
      {
        status: 'APPROVED',
        action: 'CHANGE_X',
        from: '2026-09-01',
        to: '2026-09-30',
        counterpart: 'Bruno',
      },
      null,
    );
    expect(
      await screen.findByText('Aucune demande ne correspond à ces filtres.'),
    ).toBeInTheDocument();
    await userEvent.click(within(form).getByRole('button', { name: 'Réinitialiser' }));
    expect(list).toHaveBeenLastCalledWith('requester', EMPTY_FILTERS, null);
    expect(within(form).getByLabelText('Personne')).toHaveValue('');
  });

  it('reports a loading failure and retries', async () => {
    const list = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(page([makeRequest({ action: 'BACK' })]));
    await renderWithI18n(<RequestList api={fakeApi({ list })} role="requester" onOpen={vi.fn()} />);
    const alert = await screen.findByRole('alert');
    await userEvent.click(within(alert).getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('BACK')).toBeInTheDocument();
  });

  it('ignores answers that arrive after unmounting', async () => {
    for (const settle of ['resolve', 'reject'] as const) {
      const pending = deferred<Page>();
      const view = await renderWithI18n(
        <RequestList
          api={fakeApi({ list: vi.fn(() => pending.promise) })}
          role="requester"
          onOpen={vi.fn()}
        />,
      );
      view.unmount();
      await act(async () => {
        if (settle === 'resolve') pending.resolve(page([]));
        else pending.reject(new Error('late'));
        await pending.promise.catch(() => undefined);
      });
      expect(view.container).toBeEmptyDOMElement();
    }
  });
});
