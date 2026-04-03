import type {
  BatchActionReport,
  Category,
  Chunk,
  Document,
  DocumentOutput,
  Folder,
  LlmSamplingConfig,
  MineruProcessedFile,
  ParseJob,
  ParsedContent,
  PermanentDeleteReport,
  Provider,
  ProviderModelConfig,
  ProviderModelType,
  Tag,
  TranslatedContent,
  TranslationJob,
} from "../../packages/types"
import { invoke } from "@tauri-apps/api/core"

const isTauri = () => Boolean((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)

async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new Error("Tauri backend not available. Running in browser mode.")
  }
  return invoke(cmd, args) as Promise<T>
}

const STORAGE_KEY_CHAT = "pdf-translate:chat-channels"
const STORAGE_KEY_TRANSLATE = "pdf-translate:translate-channels"
const STORAGE_KEY_EMBED = "pdf-translate:embed-channels"
const STORAGE_KEY_RERANK = "pdf-translate:rerank-channels"
const STORAGE_KEY_FAILOVER = "pdf-translate:failover-enabled"
const STORAGE_KEY_TRANSLATE_PROMPT = "pdf-translate:translate-prompt"
const STORAGE_KEY_PROVIDER_MIGRATED = "pdf-translate:providers-migrated-v2"

export interface TranslatePromptConfig {
  systemPrompt: string
  userPrompt: string
}

export type TranslationChunkStrategy = "token" | "parsed_content"

export interface TranslationRuntimeSettings {
  chunkStrategy: TranslationChunkStrategy
  chunkSize: number
  chunkOverlap: number
  maxConcurrentRequests: number
  maxRequestsPerMinute: number
  smartOptimizeEnabled: boolean
}

export interface RuntimeLogEntry {
  id: string
  level: string
  message: string
  context: string | null
  created_at: string
}

export const DEFAULT_TRANSLATION_RUNTIME_SETTINGS: TranslationRuntimeSettings = {
  chunkStrategy: "token",
  chunkSize: 4000,
  chunkOverlap: 0,
  maxConcurrentRequests: 3,
  maxRequestsPerMinute: 60,
  smartOptimizeEnabled: false,
}

export const DEFAULT_SYSTEM_PROMPT =
  `You are a professional translator. Translate the following text from {{source_lang}} to {{target_lang}}. ` +
  `Maintain the original formatting, tone, and meaning. Do not add explanations or notes.`

export const DEFAULT_USER_PROMPT =
  `{{text}}`

export interface ChannelConfig {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
  supportsVision: boolean
  maxRetries: number
  isActive: boolean
}

export interface ProviderModelInput {
  id?: string
  name: string
  modelType: ProviderModelType
  modelName: string
  supportsVision?: boolean
  isActive?: boolean
  priority?: number
  config?: ProviderModelConfig
}

export interface ProviderUpsertInput {
  name: string
  baseUrl: string
  apiKey: string
  maxRetries?: number
  priority?: number
  timeout?: number
  concurrency?: number
  isActive?: boolean
  models: ProviderModelInput[]
}

type LegacyChannelType = ProviderModelType
type LegacyProviderGroup = ProviderUpsertInput

function loadChannels(key: string): ChannelConfig[] {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveChannels(key: string, channels: ChannelConfig[]) {
  localStorage.setItem(key, JSON.stringify(channels))
}

export const channelStore = {
  getChatChannels: (): ChannelConfig[] => loadChannels(STORAGE_KEY_CHAT),
  saveChatChannels: (channels: ChannelConfig[]) => saveChannels(STORAGE_KEY_CHAT, channels),
  getTranslateChannels: (): ChannelConfig[] => loadChannels(STORAGE_KEY_TRANSLATE),
  saveTranslateChannels: (channels: ChannelConfig[]) => saveChannels(STORAGE_KEY_TRANSLATE, channels),
  getEmbedChannels: (): ChannelConfig[] => loadChannels(STORAGE_KEY_EMBED),
  saveEmbedChannels: (channels: ChannelConfig[]) => saveChannels(STORAGE_KEY_EMBED, channels),
  getRerankChannels: (): ChannelConfig[] => loadChannels(STORAGE_KEY_RERANK),
  saveRerankChannels: (channels: ChannelConfig[]) => saveChannels(STORAGE_KEY_RERANK, channels),
  getFailoverEnabled: (): boolean => {
    const val = localStorage.getItem(STORAGE_KEY_FAILOVER)
    return val === null ? true : val === "true"
  },
  setFailoverEnabled: (enabled: boolean) => {
    localStorage.setItem(STORAGE_KEY_FAILOVER, String(enabled))
  },
  getTranslatePrompt: (): TranslatePromptConfig => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_TRANSLATE_PROMPT)
      if (raw) return JSON.parse(raw)
    } catch {}
    return { systemPrompt: DEFAULT_SYSTEM_PROMPT, userPrompt: DEFAULT_USER_PROMPT }
  },
  saveTranslatePrompt: (config: TranslatePromptConfig) => {
    localStorage.setItem(STORAGE_KEY_TRANSLATE_PROMPT, JSON.stringify(config))
  },
}

function groupLegacyChannels(): LegacyProviderGroup[] {
  const typedChannels: Array<{ type: LegacyChannelType; channel: ChannelConfig; index: number }> = [
    ...channelStore.getChatChannels().map((channel, index) => ({ type: "chat" as const, channel, index })),
    ...channelStore.getTranslateChannels().map((channel, index) => ({ type: "translate" as const, channel, index })),
    ...channelStore.getEmbedChannels().map((channel, index) => ({ type: "embed" as const, channel, index })),
    ...channelStore.getRerankChannels().map((channel, index) => ({ type: "rerank" as const, channel, index })),
  ]

  const groups = new Map<string, LegacyProviderGroup>()

  for (const { type, channel, index } of typedChannels) {
    const key = [channel.name.trim(), channel.baseUrl.trim(), channel.apiKey.trim()].join("::")
    const existing = groups.get(key)

    const model: ProviderModelInput = {
      name: channel.model.trim(),
      modelType: type,
      modelName: channel.model.trim(),
      supportsVision: channel.supportsVision,
      isActive: channel.isActive,
      priority: index,
      config: {},
    }

    if (!existing) {
      groups.set(key, {
        name: channel.name.trim(),
        baseUrl: channel.baseUrl.trim(),
        apiKey: channel.apiKey.trim(),
        maxRetries: channel.maxRetries,
        priority: index,
        isActive: channel.isActive,
        models: [model],
      })
      continue
    }

    existing.priority = Math.min(existing.priority ?? index, index)
    existing.maxRetries = Math.max(existing.maxRetries ?? channel.maxRetries, channel.maxRetries)
    existing.isActive = existing.isActive || channel.isActive
    existing.models.push(model)
  }

  return [...groups.values()].filter(
    (group) =>
      group.name &&
      group.baseUrl &&
      group.apiKey &&
      group.models.some((model) => model.name && model.modelName)
  )
}

let legacyProviderMigrationPromise: Promise<void> | null = null

async function ensureLegacyProviderMigration() {
  if (!isTauri()) return

  const alreadyMigrated = localStorage.getItem(STORAGE_KEY_PROVIDER_MIGRATED) === "true"
  if (alreadyMigrated) return

  if (!legacyProviderMigrationPromise) {
    legacyProviderMigrationPromise = (async () => {
      const groups = groupLegacyChannels()
      if (groups.length === 0) {
        localStorage.setItem(STORAGE_KEY_PROVIDER_MIGRATED, "true")
        return
      }

      const existingProviders = await safeInvoke<Provider[]>("get_providers")
      if (existingProviders.length > 0) {
        localStorage.setItem(STORAGE_KEY_PROVIDER_MIGRATED, "true")
        return
      }

      for (const input of groups) {
        await safeInvoke<Provider>("create_provider", { input })
      }

      localStorage.setItem(STORAGE_KEY_PROVIDER_MIGRATED, "true")
    })().finally(() => {
      legacyProviderMigrationPromise = null
    })
  }

  await legacyProviderMigrationPromise
}

export async function loadLlmSamplingSettings() {
  const settings = await api.getAllAppSettings()
  const map = new Map(settings.map((item) => [item.key, item.value]))

  const readScope = (scope: "chat" | "translate"): LlmSamplingConfig => {
    const numberOrUndefined = (key: string) => {
      const raw = map.get(key)?.trim()
      if (!raw) return undefined
      const parsed = Number(raw)
      return Number.isFinite(parsed) ? parsed : undefined
    }

    return {
      temperature: numberOrUndefined(`llm.${scope}.temperature`),
      top_p: numberOrUndefined(`llm.${scope}.top_p`),
      top_k: numberOrUndefined(`llm.${scope}.top_k`),
      max_tokens: numberOrUndefined(`llm.${scope}.max_tokens`),
    }
  }

  return {
    chat: readScope("chat"),
    translate: readScope("translate"),
    failoverEnabled: map.get("llm.failover_enabled") !== "false",
  }
}

export async function loadTranslationRuntimeSettings(): Promise<TranslationRuntimeSettings> {
  const settings = await api.getAllAppSettings()
  const map = new Map(settings.map((item) => [item.key, item.value]))

  const numberOrDefault = (key: string, fallback: number) => {
    const raw = map.get(key)?.trim()
    if (!raw) return fallback
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : fallback
  }

  const booleanOrDefault = (key: string, fallback: boolean) => {
    const raw = map.get(key)?.trim().toLowerCase()
    if (!raw) return fallback
    if (raw === "true") return true
    if (raw === "false") return false
    return fallback
  }

  const chunkStrategy =
    map.get("translation.chunk_strategy")?.trim() === "parsed_content"
      ? "parsed_content"
      : DEFAULT_TRANSLATION_RUNTIME_SETTINGS.chunkStrategy

  return {
    chunkStrategy,
    chunkSize: numberOrDefault(
      "translation.chunk_size",
      DEFAULT_TRANSLATION_RUNTIME_SETTINGS.chunkSize
    ),
    chunkOverlap: numberOrDefault(
      "translation.chunk_overlap",
      DEFAULT_TRANSLATION_RUNTIME_SETTINGS.chunkOverlap
    ),
    maxConcurrentRequests: numberOrDefault(
      "translation.max_concurrent_requests",
      DEFAULT_TRANSLATION_RUNTIME_SETTINGS.maxConcurrentRequests
    ),
    maxRequestsPerMinute: numberOrDefault(
      "translation.max_requests_per_minute",
      DEFAULT_TRANSLATION_RUNTIME_SETTINGS.maxRequestsPerMinute
    ),
    smartOptimizeEnabled: booleanOrDefault(
      "translation.smart_optimize_enabled",
      DEFAULT_TRANSLATION_RUNTIME_SETTINGS.smartOptimizeEnabled
    ),
  }
}

export async function saveTranslationRuntimeSettings(settings: TranslationRuntimeSettings) {
  await api.setAppSetting("translation.chunk_strategy", settings.chunkStrategy)
  await api.setAppSetting("translation.chunk_size", String(settings.chunkSize))
  await api.setAppSetting("translation.chunk_overlap", String(settings.chunkOverlap))
  await api.setAppSetting(
    "translation.max_concurrent_requests",
    String(settings.maxConcurrentRequests)
  )
  await api.setAppSetting(
    "translation.max_requests_per_minute",
    String(settings.maxRequestsPerMinute)
  )
  await api.setAppSetting(
    "translation.smart_optimize_enabled",
    settings.smartOptimizeEnabled ? "true" : "false"
  )
}

export const api = {
  getDocuments: () => safeInvoke<Document[]>("get_documents"),
  getLibraryDocuments: () => safeInvoke<Document[]>("get_library_documents"),
  getDocumentById: (id: string) => safeInvoke<Document>("get_document_by_id", { id }),
  createDocument: (data: {
    title: string
    filename: string
    filePath: string
    fileSize: number
  }) =>
    safeInvoke<Document>("create_document", {
      title: data.title,
      filename: data.filename,
      filePath: data.filePath,
      fileSize: data.fileSize,
    }),
  updateDocument: (data: {
    id: string
    title?: string
    categoryId?: string
    sourceLanguage?: string
    targetLanguage?: string
  }) =>
    safeInvoke<Document>("update_document", {
      id: data.id,
      title: data.title,
      categoryId: data.categoryId,
      sourceLanguage: data.sourceLanguage,
      targetLanguage: data.targetLanguage,
    }),
  deleteDocument: (id: string) => safeInvoke<void>("delete_document", { id }),
  moveDocumentsToTrash: (documentIds: string[]) =>
    safeInvoke<BatchActionReport>("move_documents_to_trash", { documentIds }),
  restoreDocuments: (documentIds: string[]) =>
    safeInvoke<BatchActionReport>("restore_documents", { documentIds }),
  batchUpdateDocuments: (data: {
    documentIds: string[]
    categoryId?: string
    folderId?: string
  }) =>
    safeInvoke<BatchActionReport>("batch_update_documents", {
      documentIds: data.documentIds,
      categoryId: data.categoryId,
      folderId: data.folderId,
    }),
  permanentlyDeleteDocuments: (documentIds: string[]) =>
    safeInvoke<PermanentDeleteReport>("permanently_delete_documents", { documentIds }),
  emptyTrash: () => safeInvoke<PermanentDeleteReport>("empty_trash"),

  batchStartParseJobs: (documentIds: string[]) =>
    safeInvoke<BatchActionReport>("batch_start_parse_jobs", { documentIds }),
  batchStartTranslationJobs: (data: { documentIds: string[]; providerId: string }) =>
    safeInvoke<BatchActionReport>("batch_start_translation_jobs", {
      documentIds: data.documentIds,
      providerId: data.providerId,
    }),
  batchStartIndexJobs: (data: { documentIds: string[]; providerId: string }) =>
    safeInvoke<BatchActionReport>("batch_start_index_jobs", {
      documentIds: data.documentIds,
      providerId: data.providerId,
    }),
  batchAddTags: (data: { documentIds: string[]; tagIds: string[] }) =>
    safeInvoke<BatchActionReport>("batch_add_tags", {
      documentIds: data.documentIds,
      tagIds: data.tagIds,
    }),
  batchRemoveTags: (data: { documentIds: string[]; tagIds: string[] }) =>
    safeInvoke<BatchActionReport>("batch_remove_tags", {
      documentIds: data.documentIds,
      tagIds: data.tagIds,
    }),
  batchSetLanguage: (data: {
    documentIds: string[]
    sourceLanguage?: string
    targetLanguage?: string
  }) =>
    safeInvoke<BatchActionReport>("batch_set_language", {
      documentIds: data.documentIds,
      sourceLanguage: data.sourceLanguage,
      targetLanguage: data.targetLanguage,
    }),
  batchExportDocuments: (data: {
    documentIds: string[]
    format: string
    contentType: string
    outputDir: string
  }) =>
    safeInvoke<BatchActionReport>("batch_export_documents", {
      documentIds: data.documentIds,
      format: data.format,
      contentType: data.contentType,
      outputDir: data.outputDir,
    }),

  importPdf: (filePath: string) => safeInvoke<Document>("import_pdf", { filePath }),
  importDocument: (filePath: string, fileType: string) =>
    safeInvoke<Document>("import_document", { filePath, fileType }),
  duplicateDocument: (id: string) => safeInvoke<Document>("duplicate_document", { id }),
  revealInOs: (path: string) => safeInvoke<void>("reveal_in_os", { path }),

  startParseJob: (documentId: string) => safeInvoke<ParseJob>("start_parse_job", { documentId }),
  cancelParseJob: (jobId: string) => safeInvoke<void>("cancel_parse_job", { jobId }),
  deleteParseJob: (jobId: string) => safeInvoke<void>("delete_parse_job", { jobId }),
  getParseJob: (jobId: string) => safeInvoke<ParseJob>("get_parse_job", { jobId }),
  getAllParseJobs: () => safeInvoke<Array<{
    id: string; document_id: string; document_title: string; status: string;
    progress: number; error_message: string | null;
    started_at: string | null; completed_at: string | null;
    created_at: string; updated_at: string;
  }>>("get_all_parse_jobs"),
  getParsedContent: (documentId: string) => safeInvoke<ParsedContent>("get_parsed_content", { documentId }),
  getMineruProcessedFiles: (documentId: string) =>
    safeInvoke<MineruProcessedFile[]>("get_mineru_processed_files", { documentId }),

  startTranslationJob: (data: {
    documentId: string
    providerId: string
    sourceLanguage: string
    targetLanguage: string
  }) =>
    safeInvoke<TranslationJob>("start_translation_job", {
      documentId: data.documentId,
      providerId: data.providerId,
      sourceLanguage: data.sourceLanguage,
      targetLanguage: data.targetLanguage,
    }),
  cancelTranslationJob: (jobId: string) => safeInvoke<void>("cancel_translation_job", { jobId }),
  deleteTranslationJob: (jobId: string) => safeInvoke<void>("delete_translation_job", { jobId }),
  getTranslationJob: (jobId: string) => safeInvoke<TranslationJob>("get_translation_job", { jobId }),
  getAllTranslationJobs: () => safeInvoke<Array<{
    id: string; document_id: string; document_title: string; provider_id: string;
    status: string; progress: number; total_chunks: number; completed_chunks: number;
    failed_chunks: number; error_message: string | null; config: string;
    started_at: string | null; completed_at: string | null;
    created_at: string; updated_at: string;
  }>>("get_all_translation_jobs"),
  resumeTranslationJob: (jobId: string) => safeInvoke<TranslationJob>("resume_translation_job", { jobId }),
  retryFailedTranslationChunks: (jobId: string) => safeInvoke<TranslationJob>("retry_failed_translation_chunks", { jobId }),
  getTranslatedContent: (documentId: string) => safeInvoke<TranslatedContent>("get_translated_content", { documentId }),
  getDocumentOutputs: (documentId: string) => safeInvoke<DocumentOutput[]>("get_document_outputs", { documentId }),
  replaceOriginalDocumentFile: (documentId: string, filePath: string) =>
    safeInvoke<Document>("replace_original_document_file", { documentId, filePath }),
  replaceTranslatedPdf: (documentId: string, filePath: string) =>
    safeInvoke<DocumentOutput>("replace_translated_pdf", { documentId, filePath }),
  replaceParsedMarkdown: (documentId: string, filePath: string) =>
    safeInvoke<ParsedContent>("replace_parsed_markdown", { documentId, filePath }),

  startIndexJob: (documentId: string, providerId: string) => safeInvoke<string>("start_index_job", { documentId, providerId }),
  cancelIndexJob: (documentId: string) => safeInvoke<void>("cancel_index_job", { documentId }),
  getAllIndexJobs: () => safeInvoke<Array<{
    id: string; document_id: string; document_title: string; provider_id: string;
    status: string; progress: number; total_chunks: number; completed_chunks: number;
    error_message: string | null; config: string | null;
    started_at: string | null; completed_at: string | null;
    created_at: string; updated_at: string;
  }>>("get_all_index_jobs"),
  deleteIndexJob: (jobId: string) => safeInvoke<void>("delete_index_job", { jobId }),
  resumeIndexJob: (jobId: string) => safeInvoke<string>("resume_index_job", { jobId }),
  retryFailedIndexChunks: (jobId: string) => safeInvoke<string>("retry_failed_index_chunks", { jobId }),
  searchDocuments: (query: string, providerId: string, limit: number) =>
    safeInvoke<Array<{ chunk_id: string; document_id: string; content: string; score: number }>>(
      "search_documents",
      { query, providerId, limit }
    ),
  getZvecStatus: () =>
    safeInvoke<{
      enabled: boolean
      backend: string
      available: boolean
      platform_supported: boolean
      python_path: string
      collections_dir: string
      version: string | null
      message: string
    }>("get_zvec_status"),
  probeRerankerStatus: () =>
    safeInvoke<{
      available: boolean
      message: string
      hint: string | null
    }>("probe_reranker_status"),
  installRerankerDeps: () =>
    safeInvoke<string>("install_reranker_deps"),
  downloadRerankerModel: () =>
    safeInvoke<void>("download_reranker_model"),
  getRerankerModelStatus: () =>
    safeInvoke<{ status: string; message: string }>("get_reranker_model_status"),
  setupZvecVenv: () => safeInvoke<void>("setup_zvec_venv"),
  getZvecVenvStatus: () =>
    safeInvoke<{ status: string; message: string }>("get_zvec_venv_status"),
  checkZvecVenvExists: () => safeInvoke<boolean>("check_zvec_venv_exists"),

  testWebdavConnection: (data: { baseUrl: string; username: string; password: string }) =>
    safeInvoke<string>("test_webdav_connection", {
      baseUrl: data.baseUrl,
      username: data.username,
      password: data.password,
    }),
  syncDocument: (data: {
    documentId: string
    baseUrl: string
    username: string
    password: string
    remotePath: string
  }) =>
    safeInvoke<string>("sync_document", {
      documentId: data.documentId,
      baseUrl: data.baseUrl,
      username: data.username,
      password: data.password,
      remotePath: data.remotePath,
    }),

  exportDocument: (data: {
    documentId: string
    format: string
    contentType: string
    outputPath: string
  }) =>
    safeInvoke<string>("export_document", {
      documentId: data.documentId,
      format: data.format,
      contentType: data.contentType,
      outputPath: data.outputPath,
    }),
  exportDocumentAsset: (data: {
    documentId: string
    assetType: string
    outputPath: string
  }) =>
    safeInvoke<string>("export_document_asset", {
      documentId: data.documentId,
      assetType: data.assetType,
      outputPath: data.outputPath,
    }),

  getCategories: () => safeInvoke<Category[]>("get_categories"),
  createCategory: (data: {
    name: string
    description?: string
    parentId?: string
  }) =>
    safeInvoke<Category>("create_category", {
      name: data.name,
      description: data.description,
      parentId: data.parentId,
    }),
  updateCategory: (data: {
    id: string
    name?: string
    description?: string
    parentId?: string
  }) =>
    safeInvoke<Category>("update_category", {
      id: data.id,
      name: data.name,
      description: data.description,
      parentId: data.parentId,
    }),
  deleteCategory: (id: string) => safeInvoke<void>("delete_category", { id }),

  getFolders: () => safeInvoke<Folder[]>("get_folders"),
  createFolder: (data: { name: string; parentId?: string }) =>
    safeInvoke<Folder>("create_folder", {
      name: data.name,
      parentId: data.parentId,
    }),
  updateFolder: (data: { id: string; name?: string; parentId?: string }) =>
    safeInvoke<Folder>("update_folder", {
      id: data.id,
      name: data.name,
      parentId: data.parentId,
    }),
  deleteFolder: (id: string) => safeInvoke<void>("delete_folder", { id }),

  getTags: () => safeInvoke<Tag[]>("get_tags"),
  createTag: (data: { name: string; color?: string }) =>
    safeInvoke<Tag>("create_tag", {
      name: data.name,
      color: data.color,
    }),
  updateTag: (data: { id: string; name?: string; color?: string }) =>
    safeInvoke<Tag>("update_tag", {
      id: data.id,
      name: data.name,
      color: data.color,
    }),
  deleteTag: (id: string) => safeInvoke<void>("delete_tag", { id }),

  addDocumentTags: (documentId: string, tagIds: string[]) =>
    safeInvoke<void>("add_document_tags", { documentId, tagIds }),
  removeDocumentTag: (documentId: string, tagId: string) =>
    safeInvoke<void>("remove_document_tag", { documentId, tagId }),
  getDocumentTags: (documentId: string) =>
    safeInvoke<Tag[]>("get_document_tags", { documentId }),

  getDocumentFilePath: (id: string) =>
    safeInvoke<string>("get_document_file_path", { id }),

  getDocumentChunks: (documentId: string) =>
    safeInvoke<Chunk[]>("get_document_chunks", { documentId }),

  getProviders: async () => {
    await ensureLegacyProviderMigration()
    return safeInvoke<Provider[]>("get_providers")
  },
  createProvider: (input: ProviderUpsertInput) =>
    safeInvoke<Provider>("create_provider", { input }),
  updateProvider: (id: string, input: ProviderUpsertInput) =>
    safeInvoke<Provider>("update_provider", { id, input }),
  deleteProvider: (id: string) => safeInvoke<void>("delete_provider", { id }),
  testProviderConnection: (data: {
    baseUrl: string
    apiKey: string
    model?: string
  }) =>
    safeInvoke<string>("test_provider_connection", {
      baseUrl: data.baseUrl,
      apiKey: data.apiKey,
      model: data.model,
    }),
  testMinerUConnection: (data: {
    baseUrl?: string
    mode?: "external" | "official"
    apiToken?: string
  }) =>
    safeInvoke<string>("test_mineru_connection", {
      baseUrl: data.baseUrl,
      mode: data.mode,
      apiToken: data.apiToken,
    }),

  getAppSetting: (key: string) =>
    safeInvoke<string | null>("get_app_setting", { key }),
  setAppSetting: (key: string, value: string) =>
    safeInvoke<void>("set_app_setting", { key, value }),
  getAllAppSettings: () =>
    safeInvoke<Array<{ key: string; value: string }>>("get_all_app_settings"),
  syncWindowTheme: (theme: string) =>
    safeInvoke<void>("sync_window_theme", { theme }),

  getRuntimeLogs: (limit?: number, minLevel?: string, offset?: number) =>
    safeInvoke<RuntimeLogEntry[]>("get_runtime_logs", { limit, minLevel, offset }),
  exportRuntimeLogs: (
    filePath: string,
    options?: { minLevel?: string; days?: number }
  ) => safeInvoke<string>("export_runtime_logs", { filePath, options }),
  runCleanupNow: () => safeInvoke<string>("run_cleanup_now"),
  getMineruProcessedStorageDir: () =>
    safeInvoke<string>("get_mineru_processed_storage_dir"),

  startMinerU: () => safeInvoke<string>("start_mineru"),
  stopMinerU: () => safeInvoke<void>("stop_mineru"),
  getMinerUStatus: () =>
    safeInvoke<{ status: string; port: number | null; error: string | null }>("get_mineru_status"),

  setupMineruVenv: () => safeInvoke<void>("setup_mineru_venv"),
  getVenvStatus: () =>
    safeInvoke<{ status: string; message: string }>("get_venv_status"),
  checkVenvExists: () => safeInvoke<boolean>("check_venv_exists"),

  downloadMineruModels: () => safeInvoke<void>("download_mineru_models"),
  getModelDownloadStatus: () =>
    safeInvoke<{ status: string; message: string; progress: number }>("get_model_download_status"),

  collectBackupData: (scope: string, localConfig: Record<string, string>, source: string) =>
    safeInvoke<string>("collect_backup_data", { scope, localConfig, source }),
  applyBackupData: (backupJson: string) =>
    safeInvoke<{ scope: string; local_config: Record<string, string>; created_at: string }>("apply_backup_data", { backupJson }),
  validateBackup: (backupJson: string) =>
    safeInvoke<{
      version: number; scope: string; source: string; created_at: string;
      app_name: string; schema_version: number; settings_count: number; document_count: number;
    }>("validate_backup", { backupJson }),
  webdavUploadBackup: (data: {
    baseUrl: string; username: string; password: string;
    remotePath: string; scope: string; localConfig: Record<string, string>;
  }) =>
    safeInvoke<string>("webdav_upload_backup", {
      baseUrl: data.baseUrl, username: data.username, password: data.password,
      remotePath: data.remotePath, scope: data.scope, localConfig: data.localConfig,
    }),
  webdavDownloadBackup: (data: {
    baseUrl: string; username: string; password: string;
    remotePath: string; scope: string;
  }) =>
    safeInvoke<string>("webdav_download_backup", {
      baseUrl: data.baseUrl, username: data.username, password: data.password,
      remotePath: data.remotePath, scope: data.scope,
    }),
}
