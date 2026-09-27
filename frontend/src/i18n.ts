import i18next, { type i18n } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './locales/en';
import { fr } from './locales/fr';

export const resources = { fr: { translation: fr }, en: { translation: en } };

/** French for French-speaking browsers, English otherwise. */
export function pickLanguage(languages: readonly string[]): 'fr' | 'en' {
  return languages[0]?.toLowerCase().startsWith('fr') === true ? 'fr' : 'en';
}

export async function initI18n(language: 'fr' | 'en'): Promise<i18n> {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instance;
}
