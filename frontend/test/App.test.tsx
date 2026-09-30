import { screen } from '@testing-library/react';
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
    expect(screen.getByRole('heading', { name: 'TESSERA par Orqea' })).toBeInTheDocument();
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

  it('has no sign-out button: a link back to Orqea instead, plus the byline and credits', async () => {
    const api = fakeApi();
    await renderWithI18n(<App api={api} handoffToken={null} />);
    await screen.findByText('Connecté en tant que Alice Martin');
    expect(screen.queryByRole('button', { name: 'Se déconnecter' })).toBeNull();
    expect(await screen.findByRole('link', { name: 'Revenir sur Orqea' })).toHaveAttribute(
      'href',
      'https://orqea.example/app',
    );
    expect(screen.getByRole('heading', { name: 'TESSERA par Orqea' })).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Développé par Erwann Laplante (nouvel onglet)' }),
    ).toHaveAttribute('href', 'https://github.com/ErwannL');
  });

  it('hides « Back to Orqea » inside an iframe, and does not even ask for it', async () => {
    const api = fakeApi();
    await renderWithI18n(<App api={api} handoffToken={null} framed />);
    await screen.findByText('Connecté en tant que Alice Martin');
    expect(screen.queryByRole('link', { name: 'Revenir sur Orqea' })).toBeNull();
    expect(api.config).not.toHaveBeenCalled();
  });

  it('keeps working when the Orqea URL cannot be read', async () => {
    const api = fakeApi({ config: vi.fn(() => Promise.reject(new ApiError(500))) });
    await renderWithI18n(<App api={api} handoffToken={null} />);
    await screen.findByText('Connecté en tant que Alice Martin');
    expect(screen.queryByRole('link', { name: 'Revenir sur Orqea' })).toBeNull();
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
