import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RequestDetail } from '../src/components/RequestDetail';
import type { Detail } from '../src/types';
import { deferred, detailOf, fakeApi, makeRequest, renderWithI18n } from './helpers';

describe('RequestDetail', () => {
  it('shows every field, the context as text and the history', async () => {
    const request = makeRequest({
      shortId: '8472-KQMX',
      status: 'CANCELLED',
      cancelledAt: '2026-09-27T14:35:00.000Z',
      cancelReason: 'Plus nécessaire',
      attempts: 1,
      context: { html: '<b>bold</b>', nested: { value: 1 } },
    });
    const { container } = await renderWithI18n(
      <RequestDetail
        api={fakeApi({ detail: vi.fn(() => Promise.resolve(detailOf(request))) })}
        id={request.id}
        onBack={vi.fn()}
      />,
    );
    expect(await screen.findByRole('heading', { name: 'Demande 8472-KQMX' })).toBeInTheDocument();
    expect(screen.getByText('Alice Martin (42)')).toBeInTheDocument();
    expect(screen.getByText('Bruno Keller (7)')).toBeInTheDocument();
    expect(screen.getByText('Plus nécessaire')).toBeInTheDocument();
    expect(screen.getByText('1 sur 5')).toBeInTheDocument();
    expect(screen.getByText('3600 s')).toBeInTheDocument();
    expect(screen.getByText('Annulée')).toBeInTheDocument();
    expect(container.querySelector('pre')?.textContent).toBe(
      JSON.stringify(request.context, null, 2),
    );
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getByText('Demande créée')).toBeInTheDocument();
    expect(screen.getByText('Code incorrect')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Historique intègre');
    expect(screen.getByText(/trace technique de validation/)).toBeInTheDocument();
  });

  it('flags an altered history and shows empty values', async () => {
    const request = makeRequest({ authorizationDurationSeconds: null });
    const detail: Detail = {
      ...detailOf(request, false),
      events: [{ id: '9', type: 'SOMETHING_NEW', at: request.createdAt, meta: {} }],
    };
    await renderWithI18n(
      <RequestDetail
        api={fakeApi({ detail: vi.fn(() => Promise.resolve(detail)) })}
        id={request.id}
        onBack={vi.fn()}
      />,
      'en',
    );
    expect(await screen.findByRole('status')).toHaveTextContent('History altered');
    expect(screen.getByText('SOMETHING_NEW')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(5);
  });

  it('reports errors and goes back', async () => {
    const onBack = vi.fn();
    await renderWithI18n(
      <RequestDetail
        api={fakeApi({ detail: vi.fn(() => Promise.reject(new Error('404'))) })}
        id="x"
        onBack={onBack}
      />,
    );
    expect(screen.getByText('Chargement…')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retour à la liste' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('ignores answers that arrive after unmounting', async () => {
    for (const settle of ['resolve', 'reject'] as const) {
      const pending = deferred<Detail>();
      const view = await renderWithI18n(
        <RequestDetail
          api={fakeApi({ detail: vi.fn(() => pending.promise) })}
          id="x"
          onBack={vi.fn()}
        />,
      );
      view.unmount();
      await act(async () => {
        if (settle === 'resolve') pending.resolve(detailOf(makeRequest()));
        else pending.reject(new Error('late'));
        await pending.promise.catch(() => undefined);
      });
      expect(view.container).toBeEmptyDOMElement();
    }
  });
});
