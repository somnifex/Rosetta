import 'i18next'
import type enCommon from './locales/en/common'
import type enDashboard from './locales/en/dashboard'
import type enLibrary from './locales/en/library'
import type enDocument from './locales/en/document'
import type enSearch from './locales/en/search'
import type enTasks from './locales/en/tasks'
import type enSettings from './locales/en/settings'
import type enChat from './locales/en/chat'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: {
      common: typeof enCommon
      dashboard: typeof enDashboard
      library: typeof enLibrary
      document: typeof enDocument
      search: typeof enSearch
      tasks: typeof enTasks
      settings: typeof enSettings
      chat: typeof enChat
    }
  }
}
