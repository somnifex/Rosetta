import type {
  BatchActionReport,
  Category,
  Chunk,
  Document,
  DocumentOutput,
  Folder,
  ParseJob,
  ParsedContent,
  PermanentDeleteReport,
  Provider,
  ProviderType,
  Tag,
  TranslatedContent,
  TranslationJob,
} from "../../packages/types"

// Check if running inside Tauri
const isTauri = () => !!(window as any).__TAURI_INTERNALS__

let invokeModule: any = null

async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new Error("Tauri backend not available. Running in browser mode.")
  }
  if (!invokeModule) {
    invokeModule = await import("@tauri-apps/api/core")
  }
  return (invokeModule.invoke as Function)(cmd, args) as Promise<T>
}

// --- LocalStorage-based provider management (works without Tauri) ---

const STORAGE_KEY_CHAT = "pdf-translate:chat-channels"
const STORAGE_KEY_TRANSLATE = "pdf-translate:translate-channels"
const STORAGE_KEY_EMBED = "pdf-translate:embed-channels"
const STORAGE_KEY_RERANK = "pdf-translate:rerank-channels"
const STORAGE_KEY_FAILOVER = "pdf-translate:failover-enabled"
const STORAGE_KEY_TRANSLATE_PROMPT = "pdf-translate:translate-prompt"

export interface TranslatePromptConfig {
  systemPrompt: string
  userPrompt: string
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

// --- Tauri API calls ---

export const api = {
  // Documents
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
  importPdf: (filePath: string) => safeInvoke<Document>("import_pdf", { filePath }),
  importDocument: (filePath: string, fileType: string) =>
    safeInvoke<Document>("import_document", { filePath, fileType }),

  // Parse Jobs
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

  // Translation Jobs
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
    error_message: string | null; config: string;
    started_at: string | null; completed_at: string | null;
    created_at: string; updated_at: string;
  }>>("get_all_translation_jobs"),
  getTranslatedContent: (documentId: string) => safeInvoke<TranslatedContent>("get_translated_content", { documentId }),
  getDocumentOutputs: (documentId: string) => safeInvoke<DocumentOutput[]>("get_document_outputs", { documentId }),
  replaceOriginalDocumentFile: (documentId: string, filePath: string) =>
    safeInvoke<Document>("replace_original_document_file", { documentId, filePath }),
  replaceTranslatedPdf: (documentId: string, filePath: string) =>
    safeInvoke<DocumentOutput>("replace_translated_pdf", { documentId, filePath }),
  replaceParsedMarkdown: (documentId: string, filePath: string) =>
    safeInvoke<ParsedContent>("replace_parsed_markdown", { documentId, filePath }),

  // RAG & Search
  startIndexJob: (documentId: string, providerId: string) => safeInvoke<string>("start_index_job", { documentId, providerId }),
  cancelIndexJob: (documentId: string) => safeInvoke<void>("cancel_index_job", { documentId }),
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

  // WebDAV Sync
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

  // Export
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

  // Categories
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

  // Folders
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

  // Tags
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

  // Document Tags
  addDocumentTags: (documentId: string, tagIds: string[]) =>
    safeInvoke<void>("add_document_tags", { documentId, tagIds }),
  removeDocumentTag: (documentId: string, tagId: string) =>
    safeInvoke<void>("remove_document_tag", { documentId, tagId }),
  getDocumentTags: (documentId: string) =>
    safeInvoke<Tag[]>("get_document_tags", { documentId }),

  // Document File Path
  getDocumentFilePath: (id: string) =>
    safeInvoke<string>("get_document_file_path", { id }),

  // Document Chunks
  getDocumentChunks: (documentId: string) =>
    safeInvoke<Chunk[]>("get_document_chunks", { documentId }),

  // Providers
  getProviders: () => safeInvoke<Provider[]>("get_providers"),
  createProvider: (data: {
    name: string
    baseUrl: string
    apiKey: string
    providerType: ProviderType
    model: string
    supportsVision?: boolean
    maxRetries?: number
    chatModel?: string
    embeddingModel?: string
  }) =>
    safeInvoke<Provider>("create_provider", {
      name: data.name,
      baseUrl: data.baseUrl,
      apiKey: data.apiKey,
      providerType: data.providerType,
      model: data.model,
      supportsVision: data.supportsVision,
      maxRetries: data.maxRetries,
      chatModel: data.chatModel,
      embeddingModel: data.embeddingModel,
    }),
  updateProvider: (data: {
    id: string
    name?: string
    baseUrl?: string
    apiKey?: string
    isActive?: boolean
  }) =>
    safeInvoke<void>("update_provider", {
      id: data.id,
      name: data.name,
      baseUrl: data.baseUrl,
      apiKey: data.apiKey,
      isActive: data.isActive,
    }),
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
  testMinerUConnection: (baseUrl: string) =>
    safeInvoke<string>("test_mineru_connection", { baseUrl }),

  // App Settings
  getAppSetting: (key: string) =>
    safeInvoke<string | null>("get_app_setting", { key }),
  setAppSetting: (key: string, value: string) =>
    safeInvoke<void>("set_app_setting", { key, value }),
  getAllAppSettings: () =>
    safeInvoke<Array<{ key: string; value: string }>>("get_all_app_settings"),

  // MinerU Lifecycle
  startMinerU: () => safeInvoke<string>("start_mineru"),
  stopMinerU: () => safeInvoke<void>("stop_mineru"),
  getMinerUStatus: () =>
    safeInvoke<{ status: string; port: number | null; error: string | null }>("get_mineru_status"),

  // MinerU Venv Management
  setupMineruVenv: () => safeInvoke<void>("setup_mineru_venv"),
  getVenvStatus: () =>
    safeInvoke<{ status: string; message: string }>("get_venv_status"),
  checkVenvExists: () => safeInvoke<boolean>("check_venv_exists"),

  // MinerU Model Download
  downloadMineruModels: () => safeInvoke<void>("download_mineru_models"),
  getModelDownloadStatus: () =>
    safeInvoke<{ status: string; message: string; progress: number }>("get_model_download_status"),

  // Sync & Backup
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
