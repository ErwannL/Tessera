import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { createApi } from './api';
import { App } from './App';
import { consumeHandoffToken } from './handoff';
import { initI18n, pickLanguage } from './i18n';
import './styles.css';

export interface BrowserEnvironment {
  location: Location;
  history: History;
  navigator: Pick<Navigator, 'languages'>;
  fetch: typeof fetch;
  document: Document;
}

/** Reads (and erases) the handoff fragment first, then renders the dashboard. */
export async function mount(env: BrowserEnvironment): Promise<void> {
  const handoffToken = consumeHandoffToken(env);
  const language = pickLanguage(env.navigator.languages);
  const i18n = await initI18n(language);
  env.document.documentElement.lang = language;
  const container = env.document.getElementById('root');
  if (container === null) throw new Error('Missing #root element');
  // Framed by the Orqea console: « Back to Orqea » makes no sense there.
  const view = env.document.defaultView;
  const framed = view !== null && view.self !== view.top;
  const api = createApi((input, init) => env.fetch(input, init));
  createRoot(container).render(
    <I18nextProvider i18n={i18n}>
      <App api={api} handoffToken={handoffToken} framed={framed} />
    </I18nextProvider>,
  );
}
