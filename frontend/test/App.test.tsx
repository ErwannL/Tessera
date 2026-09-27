import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api';
import { App } from '../src/App';
import { aliceMe, fakeApi, renderWithI18n } from './helpers';

describe('App', () => {
  it('exchanges the handoff token, then shows the dashboard', async () => {
    const api = fakeApi();
    await renderWithI18n(<App api={api} handoffToken="jwt" />);
    expect(screen.getByText('Chargement…')).toBeInTheDocument();
    expect(await screen.findByText('Connecté en tant que Alice Martin')).toBeInTheDocument();
    expect(api.handoff).toHaveBeenCalledWith('jwt');
    expect(screen.getByRole('tab', { name: 'Mes demandes' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'TESSERA' })).toBeInTheDocument();
    expect(screen.getByText(/Demandez-lui sa tessera/)).toBeInTheDocument();
  });

  it('uses an existing session without a token', async () => {
    const api = fakeApi();
    await renderWithI18n(<App api={api} handoffToken={null} />);
    await screen.findByText('Connecté en tant que Alice Martin');
    expect(api.handoff).not.toHaveBeenCalled();
  });

  it('shows a neutral screen without session, and no login form', async () => {
    const api = fakeApi({ me: vi.fn(() => Promise.reject(new ApiError(401))) });
    const { container } = await renderWithI18n(<App api={api} handoffToken={null} />);
    expect(await screen.findByText('Ouvrez Tessera depuis votre application.')).toBeInTheDocument();
    expect(container.querySelector('input, form')).toBeNull();
  });

  it('explains a refused handoff', async () => {
    const api = fakeApi({ handoff: vi.fn(() => Promise.reject(new ApiError(401))) });
    await renderWithI18n(<App api={api} handoffToken="replayed" />);
    expect(await screen.findByText('Lien expiré ou déjà utilisé.')).toBeInTheDocument();
    expect(api.me).not.toHaveBeenCalled();
  });

  it('reports other failures', async () => {
    for (const failure of [new ApiError(500), new TypeError('offline')]) {
      const api = fakeApi({ me: vi.fn(() => Promise.reject(failure)) });
      const view = await renderWithI18n(<App api={api} handoffToken={null} />, 'en');
      expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
      view.unmount();
    }
  });

  it('signs out, even when the server call fails', async () => {
    for (const logout of [() => Promise.resolve(null), () => Promise.reject(new ApiError(500))]) {
      const api = fakeApi({ logout: vi.fn(logout) });
      const view = await renderWithI18n(<App api={api} handoffToken={null} />);
      await userEvent.click(await screen.findByRole('button', { name: 'Se déconnecter' }));
      await waitFor(() => {
        expect(screen.getByText('Ouvrez Tessera depuis votre application.')).toBeInTheDocument();
      });
      view.unmount();
    }
  });

  it('shows the single message when nothing concerns the user', async () => {
    const api = fakeApi({
      me: vi.fn(() => Promise.resolve({ ...aliceMe, hasRequested: false, hasToApprove: false })),
    });
    await renderWithI18n(<App api={api} handoffToken={null} />);
    expect(await screen.findByText('Aucune demande ne vous concerne')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(api.list).not.toHaveBeenCalled();
  });
});
