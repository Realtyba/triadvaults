import esTranslations from '../locales/es.json';
import enTranslations from '../locales/en.json';

export class I18nManager {
  constructor() {
    this.currentLang = localStorage.getItem('triad_lang') || 'es';
    this.translations = {
      es: esTranslations,
      en: enTranslations
    };
  }

  setLanguage(lang) {
    if (this.translations[lang]) {
      this.currentLang = lang;
      localStorage.setItem('triad_lang', lang);
    }
  }

  t(key, fallback = '') {
    const dict = this.translations[this.currentLang] || this.translations.es;
    return dict[key] || fallback || key;
  }
}
