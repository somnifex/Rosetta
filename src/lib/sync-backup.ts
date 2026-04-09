import { api } from "./api"
import { getStoredTheme, setStoredTheme } from "./theme"
import { loadJSON, saveJSON } from "./utils"
import {
  SK_WEBDAV_CONFIG,
  SK_LAST_SYNC,
  SK_SYNC_DEFAULTS,
  BACKUP_STORAGE_KEYS,
} from "./storage-keys"

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

export function loadWebDAVConfig(): WebDAVConfig {
  try {
    const raw = localStorage.getItem(SK_WEBDAV_CONFIG)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        baseUrl: parsed.baseUrl || parsed.base_url || "",
        username: parsed.username || "",
        password: parsed.password || "",
        remotePath: parsed.remotePath || parsed.remote_path || "/Rosseta",
      }
    }
  } catch {}
  return { baseUrl: "", username: "", password: "", remotePath: "/Rosseta" }
}

export function saveWebDAVConfig(config: WebDAVConfig) {
  localStorage.setItem(SK_WEBDAV_CONFIG, JSON.stringify(config))
}

export function isWebDAVConfigured(): boolean {
  const cfg = loadWebDAVConfig()
  return !!(cfg.baseUrl && cfg.username && cfg.password)
}

export function loadLastSyncInfo(): LastSyncInfo | null {
  return loadJSON<LastSyncInfo | null>(SK_LAST_SYNC, null)
}

export function saveLastSyncInfo(info: LastSyncInfo) {
  saveJSON(SK_LAST_SYNC, info)
}

export function loadSyncDefaults(): { mode: SyncMode; scope: SyncScope } {
  return loadJSON(SK_SYNC_DEFAULTS, { mode: "auto" as SyncMode, scope: "full" as SyncScope })
}

export function saveSyncDefaults(mode: SyncMode, scope: SyncScope) {
  saveJSON(SK_SYNC_DEFAULTS, { mode, scope })
}

function collectLocalConfig(): Record<string, string> {
  const config: Record<string, string> = {}
  for (const key of BACKUP_STORAGE_KEYS) {
    const val = localStorage.getItem(key)
    if (val !== null) config[key] = val
  }
  return config
}

function applyLocalConfig(config: Record<string, string>) {
  for (const [key, value] of Object.entries(config)) {
    if (key.startsWith("rosetta:") || key.startsWith("pdf-translate:")) {
      localStorage.setItem(key, value)
    }
  }
  setStoredTheme(getStoredTheme())
}

async function applyBackupJson(json: string): Promise<void> {
  const result = await api.applyBackupData(json)
  if (result.local_config) {
    applyLocalConfig(result.local_config)
  }
}

export async function exportBackup(scope: SyncScope): Promise<void> {
  const localConfig = collectLocalConfig()
  const json = await api.collectBackupData(scope, localConfig, "local-export")

  const date = new Date().toISOString().slice(0, 10)
  const filename = `app-backup-${scope}-${date}.json`
  const blob = new Blob([json], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

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
  await applyBackupJson(json)
}

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
    await applyBackupJson(json)
  } else {
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
        remoteNewer = true
        await applyBackupJson(remoteJson)
      }
    } catch {
    }

    if (!remoteNewer) {
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
