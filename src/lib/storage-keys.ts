// Centralized localStorage / sessionStorage key constants.
// All keys use the "rosetta:" prefix. Legacy "pdf-translate:" keys
// are migrated at startup via migrateStorageKeys().

// ── Channel & provider configuration ────────────────────────────
export const SK_CHAT_CHANNELS = "rosetta:chat-channels"
export const SK_TRANSLATE_CHANNELS = "rosetta:translate-channels"
export const SK_EMBED_CHANNELS = "rosetta:embed-channels"
export const SK_RERANK_CHANNELS = "rosetta:rerank-channels"
export const SK_FAILOVER_ENABLED = "rosetta:failover-enabled"
export const SK_TRANSLATE_PROMPT = "rosetta:translate-prompt"
export const SK_PROVIDERS_MIGRATED = "rosetta:providers-migrated-v2"

// ── Theme & locale ──────────────────────────────────────────────
export const SK_THEME = "rosetta:theme"
export const SK_LOCALE = "rosetta:locale"

// ── WebDAV / sync ───────────────────────────────────────────────
export const SK_WEBDAV_CONFIG = "rosetta:webdav-config"
export const SK_LAST_SYNC = "rosetta:last-sync"
export const SK_SYNC_DEFAULTS = "rosetta:sync-defaults"

// ── Chat ────────────────────────────────────────────────────────
export const SK_CHAT_CONVERSATIONS = "rosetta:chat-conversations:v2"
export const SK_CHAT_ACTIVE_ID = "rosetta:chat-active-id"           // sessionStorage
export const SK_CHAT_PREVIEW_PANEL_WIDTH = "rosetta:chat-preview-panel-width"

// ── Document chat sidebar ───────────────────────────────────────
export const SK_DOCUMENT_CHAT_PREFIX = "rosetta:document-chat:"
export const SK_DOCUMENT_CHAT_SIDEBAR_WIDTH = "rosetta:document-chat-sidebar-width"

// ── Reader ──────────────────────────────────────────────────────
export const SK_READER_STATE_PREFIX = "rosetta:reader-state:"
export const SK_READER_ASK_PANEL_WIDTH = "rosetta:reader-ask-panel-width"
export const SK_READER_CHAT_PREFIX = "rosetta:reader-chat:"

// ── Library ─────────────────────────────────────────────────────
export const SK_LIBRARY_VIEW_STATE = "rosetta:library-view-state"
export const SK_SIDEBAR_COLLAPSED = "rosetta:sidebar-collapsed"

// ── PDF viewer ──────────────────────────────────────────────────
export const SK_PDF_ANNOTATIONS_PREFIX = "rosetta:pdf-annotations:"

// ── Backup: keys to include when exporting local config ─────────
export const BACKUP_STORAGE_KEYS = [
  SK_CHAT_CHANNELS,
  SK_TRANSLATE_CHANNELS,
  SK_EMBED_CHANNELS,
  SK_RERANK_CHANNELS,
  SK_FAILOVER_ENABLED,
  SK_TRANSLATE_PROMPT,
  SK_LOCALE,
  SK_THEME,
  SK_WEBDAV_CONFIG,
  SK_SYNC_DEFAULTS,
] as const

// ── Legacy key migration ────────────────────────────────────────
const LEGACY_KEY_MAP: ReadonlyArray<[string, string]> = [
  ["pdf-translate:chat-channels", SK_CHAT_CHANNELS],
  ["pdf-translate:translate-channels", SK_TRANSLATE_CHANNELS],
  ["pdf-translate:embed-channels", SK_EMBED_CHANNELS],
  ["pdf-translate:rerank-channels", SK_RERANK_CHANNELS],
  ["pdf-translate:failover-enabled", SK_FAILOVER_ENABLED],
  ["pdf-translate:translate-prompt", SK_TRANSLATE_PROMPT],
  ["pdf-translate:providers-migrated-v2", SK_PROVIDERS_MIGRATED],
  ["pdf-translate:theme", SK_THEME],
  ["pdf-translate:locale", SK_LOCALE],
  ["pdf-translate:webdav-config", SK_WEBDAV_CONFIG],
  ["pdf-translate:last-sync", SK_LAST_SYNC],
  ["pdf-translate:sync-defaults", SK_SYNC_DEFAULTS],
]

const MIGRATION_DONE_KEY = "rosetta:storage-keys-migrated"

export function migrateStorageKeys(): void {
  try {
    if (localStorage.getItem(MIGRATION_DONE_KEY)) return

    for (const [oldKey, newKey] of LEGACY_KEY_MAP) {
      const value = localStorage.getItem(oldKey)
      if (value !== null && localStorage.getItem(newKey) === null) {
        localStorage.setItem(newKey, value)
      }
      if (value !== null) {
        localStorage.removeItem(oldKey)
      }
    }

    // Migrate document-chat prefix keys
    const keysToMigrate: Array<[string, string]> = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith("pdf-translate:document-chat:")) {
        const suffix = key.slice("pdf-translate:document-chat:".length)
        keysToMigrate.push([key, SK_DOCUMENT_CHAT_PREFIX + suffix])
      }
    }
    for (const [oldKey, newKey] of keysToMigrate) {
      const value = localStorage.getItem(oldKey)
      if (value !== null && localStorage.getItem(newKey) === null) {
        localStorage.setItem(newKey, value)
      }
      localStorage.removeItem(oldKey)
    }

    localStorage.setItem(MIGRATION_DONE_KEY, "1")
  } catch {
    // localStorage may be unavailable
  }
}
