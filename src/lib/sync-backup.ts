/**
 * Sync & Backup service layer.
 *
 * Abstracts data collection, local export/import, and WebDAV sync
 * so the UI never handles serialization or complex orchestration.
 */
import { api } from "./api"
import { getStoredTheme, setStoredTheme } from "./theme"

// ---- Types ----

export type SyncScope = "full" | "config"
export type SyncMode = "auto" | "upload" | "download"

export interface WebDAVConfig {
  baseUrl: string
  username: string
  password: string
  remotePath: string
}

export interface LastSyncInfo {
  time: string
  mode: SyncMode
  scope: SyncScope
  result: "success" | "error"
  message?: string
}

export interface BackupSummary {
  version: number
  scope: string
  source: string
  created_at: string
  app_name: string
  schema_version: number
  settings_count: number
  document_count: number
}

// ---- localStorage keys ----

const STORAGE_KEY_WEBDAV_CONFIG = "pdf-translate:webdav-config"
const STORAGE_KEY_LAST_SYNC = "pdf-translate:last-sync"
const STORAGE_KEY_SYNC_DEFAULTS = "pdf-translate:sync-defaults"

// ---- Config persistence (WebDAV) ----

export function loadWebDAVConfig(): WebDAVConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_WEBDAV_CONFIG)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        baseUrl: parsed.baseUrl || parsed.base_url || "",
        username: parsed.username || "",
        password: parsed.password || "",
        remotePath: parsed.remotePath || parsed.remote_path || "/pdf-translate",
      }
    }
  } catch {}
  return { baseUrl: "", username: "", password: "", remotePath: "/pdf-translate" }
}

export function saveWebDAVConfig(config: WebDAVConfig) {
  localStorage.setItem(STORAGE_KEY_WEBDAV_CONFIG, JSON.stringify(config))
}

export function isWebDAVConfigured(): boolean {
  const cfg = loadWebDAVConfig()
  return !!(cfg.baseUrl && cfg.username && cfg.password)
}

// ---- Last sync info ----

export function loadLastSyncInfo(): LastSyncInfo | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LAST_SYNC)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function saveLastSyncInfo(info: LastSyncInfo) {
  localStorage.setItem(STORAGE_KEY_LAST_SYNC, JSON.stringify(info))
}

// ---- Sync defaults ----

export function loadSyncDefaults(): { mode: SyncMode; scope: SyncScope } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SYNC_DEFAULTS)
    if (raw) return JSON.parse(raw)
  } catch {}
  return { mode: "auto", scope: "full" }
}

export function saveSyncDefaults(mode: SyncMode, scope: SyncScope) {
  localStorage.setItem(STORAGE_KEY_SYNC_DEFAULTS, JSON.stringify({ mode, scope }))
}

// ---- Collect all localStorage config for backup ----

function collectLocalConfig(): Record<string, string> {
  const keys = [
    "pdf-translate:chat-channels",
    "pdf-translate:translate-channels",
    "pdf-translate:embed-channels",
    "pdf-translate:rerank-channels",
    "pdf-translate:failover-enabled",
    "pdf-translate:translate-prompt",
    "pdf-translate:locale",
    "pdf-translate:theme",
    "pdf-translate:webdav-config",
    "pdf-translate:sync-defaults",
  ]
  const config: Record<string, string> = {}
  for (const key of keys) {
    const val = localStorage.getItem(key)
    if (val !== null) config[key] = val
  }
  return config
}

function applyLocalConfig(config: Record<string, string>) {
  for (const [key, value] of Object.entries(config)) {
    if (key.startsWith("pdf-translate:")) {
      localStorage.setItem(key, value)
    }
  }
  setStoredTheme(getStoredTheme())
}

// ---- Local Backup Export ----

export async function exportBackup(scope: SyncScope): Promise<void> {
  const localConfig = collectLocalConfig()
  const json = await api.collectBackupData(scope, localConfig, "local-export")

  // Trigger browser download
  const date = new Date().toISOString().slice(0, 10)
  const filename = `app-backup-${scope}-${date}.json`
  const blob = new Blob([json], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ---- Local Backup Import ----

export async function readBackupFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error("Failed to read file"))
    reader.readAsText(file)
  })
}

export async function validateBackupFile(json: string): Promise<BackupSummary> {
  return api.validateBackup(json)
}

export async function importBackup(json: string): Promise<void> {
  const result = await api.applyBackupData(json)
  if (result.local_config) {
    applyLocalConfig(result.local_config)
  }
}

// ---- WebDAV Sync ----

export async function testWebDAVConnection(config: WebDAVConfig): Promise<string> {
  return api.testWebdavConnection({
    baseUrl: config.baseUrl,
    username: config.username,
    password: config.password,
  })
}

export async function syncWebDAV(
  config: WebDAVConfig,
  mode: SyncMode,
  scope: SyncScope,
): Promise<void> {
  const localConfig = collectLocalConfig()

  if (mode === "upload") {
    await api.webdavUploadBackup({
      baseUrl: config.baseUrl,
      username: config.username,
      password: config.password,
      remotePath: config.remotePath,
      scope,
      localConfig,
    })
  } else if (mode === "download") {
    const json = await api.webdavDownloadBackup({
      baseUrl: config.baseUrl,
      username: config.username,
      password: config.password,
      remotePath: config.remotePath,
      scope,
    })
    const result = await api.applyBackupData(json)
    if (result.local_config) {
      applyLocalConfig(result.local_config)
    }
  } else {
    // "auto" mode: upload local first (local-wins strategy with timestamp)
    // Try download first to check remote timestamp
    let remoteNewer = false
    try {
      const remoteJson = await api.webdavDownloadBackup({
        baseUrl: config.baseUrl,
        username: config.username,
        password: config.password,
        remotePath: config.remotePath,
        scope,
      })
      const remoteSummary = await api.validateBackup(remoteJson)
      const lastSync = loadLastSyncInfo()

      if (lastSync && remoteSummary.created_at > lastSync.time) {
        // Remote is newer than our last sync - apply remote
        remoteNewer = true
        const result = await api.applyBackupData(remoteJson)
        if (result.local_config) {
          applyLocalConfig(result.local_config)
        }
      }
    } catch {
      // No remote data yet or download failed - will upload
    }

    if (!remoteNewer) {
      // Upload local data
      await api.webdavUploadBackup({
        baseUrl: config.baseUrl,
        username: config.username,
        password: config.password,
        remotePath: config.remotePath,
        scope,
        localConfig,
      })
    }
  }

  saveLastSyncInfo({
    time: new Date().toISOString(),
    mode,
    scope,
    result: "success",
  })
}
