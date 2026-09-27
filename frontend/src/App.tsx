import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, type Api } from './api';
import { Dashboard } from './components/Dashboard';
import { Logo } from './components/Logo';
import type { Me } from './types';

type View =
  | { kind: 'loading' }
  | { kind: 'noSession' }
  | { kind: 'handoffError' }
  | { kind: 'error' }
  | { kind: 'ready'; me: Me };

export interface AppProps {
  api: Api;
  /** Handoff token read (and erased) from the URL fragment before rendering, if any. */
  handoffToken: string | null;
}

async function resolveView(api: Api, token: string | null): Promise<View> {
  if (token !== null) {
    try {
      await api.handoff(token);
    } catch {
      return { kind: 'handoffError' };
    }
  }
  try {
    return { kind: 'ready', me: await api.me() };
  } catch (error) {
    return error instanceof ApiError && error.status === 401
      ? { kind: 'noSession' }
      : { kind: 'error' };
  }
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <section className="message">
      <h2>{title}</h2>
      <p>{body}</p>
    </section>
  );
}

export function App({ api, handoffToken }: AppProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<View>({ kind: 'loading' });

  useEffect(() => {
    void resolveView(api, handoffToken).then(setView);
  }, [api, handoffToken]);

  const logout = () => {
    const signedOut = () => {
      setView({ kind: 'noSession' });
    };
    api.logout().then(signedOut, signedOut);
  };

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <Logo />
          <div>
            <h1>{t('app.name')}</h1>
            <p className="tagline">{t('app.tagline')}</p>
          </div>
        </div>
        {view.kind === 'ready' && (
          <div className="user">
            <span>{t('app.signedInAs', { name: view.me.name })}</span>
            <button type="button" className="button" onClick={logout}>
              {t('app.logout')}
            </button>
          </div>
        )}
      </header>
      <main className="main">
        {view.kind === 'loading' && <p className="muted">{t('app.loading')}</p>}
        {view.kind === 'noSession' && (
          <Message title={t('noSession.title')} body={t('noSession.body')} />
        )}
        {view.kind === 'handoffError' && (
          <Message title={t('handoffError.title')} body={t('handoffError.body')} />
        )}
        {view.kind === 'error' && (
          <p role="alert" className="error">
            {t('app.error')}
          </p>
        )}
        {view.kind === 'ready' && <Dashboard api={api} me={view.me} />}
      </main>
      <footer className="footer">
        <h2>{t('about.title')}</h2>
        <p>{t('about.body')}</p>
      </footer>
    </div>
  );
}
