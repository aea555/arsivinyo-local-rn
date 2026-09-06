import * as Localization from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Import all translations
import ar from './locales/ar.json';
import de from './locales/de.json';
import en from './locales/en.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import it from './locales/it.json';
import pl from './locales/pl.json';
import pt from './locales/pt.json';
import ru from './locales/ru.json';
import tr from './locales/tr.json';

// Supported languages
export const supportedLanguages = {
    en: { name: 'English', nativeName: 'English' },
    tr: { name: 'Turkish', nativeName: 'Türkçe' },
    de: { name: 'German', nativeName: 'Deutsch' },
    fr: { name: 'French', nativeName: 'Français' },
    es: { name: 'Spanish', nativeName: 'Español' },
    pt: { name: 'Portuguese', nativeName: 'Português' },
    ru: { name: 'Russian', nativeName: 'Русский' },
    ar: { name: 'Arabic', nativeName: 'العربية' },
    it: { name: 'Italian', nativeName: 'Italiano' },
    pl: { name: 'Polish', nativeName: 'Polski' },
} as const;

export type SupportedLanguage = keyof typeof supportedLanguages;

// Get device language, fallback to 'en'
const getDeviceLanguage = (): SupportedLanguage => {
    const deviceLocale = Localization.getLocales()[0]?.languageCode ?? 'en';
    if (deviceLocale in supportedLanguages) {
        return deviceLocale as SupportedLanguage;
    }
    return 'en';
};

// Resources object
const resources = {
    en: { translation: en },
    tr: { translation: tr },
    de: { translation: de },
    fr: { translation: fr },
    es: { translation: es },
    pt: { translation: pt },
    ru: { translation: ru },
    ar: { translation: ar },
    it: { translation: it },
    pl: { translation: pl },
};

// Initialize i18next
i18n.use(initReactI18next).init({
    resources,
    lng: getDeviceLanguage(),
    fallbackLng: 'en',
    interpolation: {
        escapeValue: false, // React Native already escapes
    },
    react: {
        useSuspense: false, // Avoid suspense issues in React Native
    },
});

export default i18n;
