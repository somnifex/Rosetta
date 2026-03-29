import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

// zh-CN
import zhCNCommon from './locales/zh-CN/common'
import zhCNDashboard from './locales/zh-CN/dashboard'
import zhCNLibrary from './locales/zh-CN/library'
import zhCNDocument from './locales/zh-CN/document'
import zhCNSearch from './locales/zh-CN/search'
import zhCNTasks from './locales/zh-CN/tasks'
import zhCNSettings from './locales/zh-CN/settings'
import zhCNChat from './locales/zh-CN/chat'

// en
import enCommon from './locales/en/common'
import enDashboard from './locales/en/dashboard'
import enLibrary from './locales/en/library'
import enDocument from './locales/en/document'
import enSearch from './locales/en/search'
import enTasks from './locales/en/tasks'
import enSettings from './locales/en/settings'
import enChat from './locales/en/chat'

// es
import esCommon from './locales/es/common'
import esDashboard from './locales/es/dashboard'
import esLibrary from './locales/es/library'
import esDocument from './locales/es/document'
import esSearch from './locales/es/search'
import esTasks from './locales/es/tasks'
import esSettings from './locales/es/settings'
import esChat from './locales/es/chat'

// fr
import frCommon from './locales/fr/common'
import frDashboard from './locales/fr/dashboard'
import frLibrary from './locales/fr/library'
import frDocument from './locales/fr/document'
import frSearch from './locales/fr/search'
import frTasks from './locales/fr/tasks'
import frSettings from './locales/fr/settings'
import frChat from './locales/fr/chat'

// ar
import arCommon from './locales/ar/common'
import arDashboard from './locales/ar/dashboard'
import arLibrary from './locales/ar/library'
import arDocument from './locales/ar/document'
import arSearch from './locales/ar/search'
import arTasks from './locales/ar/tasks'
import arSettings from './locales/ar/settings'
import arChat from './locales/ar/chat'

// ru
import ruCommon from './locales/ru/common'
import ruDashboard from './locales/ru/dashboard'
import ruLibrary from './locales/ru/library'
import ruDocument from './locales/ru/document'
import ruSearch from './locales/ru/search'
import ruTasks from './locales/ru/tasks'
import ruSettings from './locales/ru/settings'
import ruChat from './locales/ru/chat'

export const SUPPORTED_LOCALES = [
  { code: 'zh-CN', label: '中文 (简体)', dir: 'ltr' as const },
  { code: 'en', label: 'English', dir: 'ltr' as const },
  { code: 'es', label: 'Español', dir: 'ltr' as const },
  { code: 'fr', label: 'Français', dir: 'ltr' as const },
  { code: 'ar', label: 'العربية', dir: 'rtl' as const },
  { code: 'ru', label: 'Русский', dir: 'ltr' as const },
] as const

export type LocaleCode = typeof SUPPORTED_LOCALES[number]['code']

const LOCALE_STORAGE_KEY = 'pdf-translate:locale'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      'zh-CN': {
        common: zhCNCommon,
        dashboard: zhCNDashboard,
        library: zhCNLibrary,
        document: zhCNDocument,
        search: zhCNSearch,
        tasks: zhCNTasks,
        settings: zhCNSettings,
        chat: zhCNChat,
      },
      en: {
        common: enCommon,
        dashboard: enDashboard,
        library: enLibrary,
        document: enDocument,
        search: enSearch,
        tasks: enTasks,
        settings: enSettings,
        chat: enChat,
      },
      es: {
        common: esCommon,
        dashboard: esDashboard,
        library: esLibrary,
        document: esDocument,
        search: esSearch,
        tasks: esTasks,
        settings: esSettings,
        chat: esChat,
      },
      fr: {
        common: frCommon,
        dashboard: frDashboard,
        library: frLibrary,
        document: frDocument,
        search: frSearch,
        tasks: frTasks,
        settings: frSettings,
        chat: frChat,
      },
      ar: {
        common: arCommon,
        dashboard: arDashboard,
        library: arLibrary,
        document: arDocument,
        search: arSearch,
        tasks: arTasks,
        settings: arSettings,
        chat: arChat,
      },
      ru: {
        common: ruCommon,
        dashboard: ruDashboard,
        library: ruLibrary,
        document: ruDocument,
        search: ruSearch,
        tasks: ruTasks,
        settings: ruSettings,
        chat: ruChat,
      },
    },
    supportedLngs: ['zh-CN', 'en', 'es', 'fr', 'ar', 'ru'],
    fallbackLng: 'zh-CN',
    defaultNS: 'common',
    ns: ['common', 'dashboard', 'library', 'document', 'search', 'tasks', 'settings', 'chat'],
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LOCALE_STORAGE_KEY,
      caches: ['localStorage'],
    },
    interpolation: {
      escapeValue: false,
    },
  })

export default i18n
