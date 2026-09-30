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

const AUTHOR_URL = 'https://github.com/ErwannL';

export interface AppProps {
  api: Api;
  /** Handoff token read (and erased) from the URL fragment before rendering, if any. */
  handoffToken: string | null;
  /** True when the page runs inside an <iframe> (the Orqea console): no « Back to Orqea ». */
  framed?: boolean;
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

export function App({ api, handoffToken, framed = false }: AppProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<View>({ kind: 'loading' });

  useEffect(() => {
    void resolveView(api, handoffToken).then(setView);
  }, [api, handoffToken]);

  const [orqeaUrl, setOrqeaUrl] = useState<string | null>(null);
  useEffect(() => {
    void api.config().then(
      (config) => {
        setOrqeaUrl(config.orqeaUrl);
      },
      () => undefined,
    );
  }, [api]);

  return (
    <div className="app">
      <header className="header">
        {/* The block: logo + name « par Orqea », then two credit lines under the name. The logo
            animates on hover and keyboard focus of the whole block (.brand, focus-within).
            « Propulsé par Orqea » leads to the Orqea that OPENED Tessera (signed claim, else
            TESSERA_ORQEA_URL), in the top window: from inside the console's iframe it must
            leave the frame. The logo link only duplicates it for the pointer. */}
        <div className="brand">
          <a
            className="brand-logo"
            href={orqeaUrl ?? '/'}
            target={orqeaUrl === null ? undefined : '_top'}
            tabIndex={-1}
            aria-hidden="true"
          >
            <Logo />
          </a>
          <div>
            <h1>
              {t('app.name')} <span className="byline">{t('app.byline')}</span>
            </h1>
            <p className="brand-credits">
              <a
                className="credit-owner"
                href={orqeaUrl ?? '/'}
                target={orqeaUrl === null ? undefined : '_top'}
              >
                {t('app.poweredBy')}
              </a>
              <a
                className="credit-author"
                href={AUTHOR_URL}
                target="_blank"
                rel="noreferrer noopener"
              >
                {t('app.author')}
              </a>
            </p>
            <p className="tagline">{t('app.tagline')}</p>
          </div>
        </div>
        <div className="user">
          {view.kind === 'ready' && <span>{t('app.signedInAs', { name: view.me.name })}</span>}
          {!framed && orqeaUrl !== null && (
            <a className="button" href={orqeaUrl} target="_top">
              {t('app.backToOrqea')}
            </a>
          )}
        </div>
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
