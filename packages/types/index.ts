export interface Document {
  id: string
  title: string
  filename: string
  file_path: string
  file_size: number
  page_count: number
  source_language?: string
  target_language?: string
  category_id?: string
  folder_id?: string
  created_at: string
  updated_at: string
  deleted_at?: string
  parse_status: ParseStatus
  translation_status: TranslationStatus
  index_status: IndexStatus
  sync_status: SyncStatus
  category_name?: string
  folder_name?: string
  tags?: Tag[]
  is_file_missing?: boolean
}

export enum ParseStatus {
  PENDING = "pending",
  PARSING = "parsing",
  COMPLETED = "completed",
  FAILED = "failed",
}

export enum TranslationStatus {
  PENDING = "pending",
  TRANSLATING = "translating",
  COMPLETED = "completed",
  FAILED = "failed",
  PARTIAL = "partial",
}

export enum IndexStatus {
  PENDING = "pending",
  INDEXING = "indexing",
  COMPLETED = "completed",
  FAILED = "failed",
}

export enum SyncStatus {
  SYNCED = "synced",
  PENDING = "pending",
  SYNCING = "syncing",
  CONFLICT = "conflict",
  ERROR = "error",
}

export interface ParseJob {
  id: string
  document_id: string
  status: ParseStatus
  progress: number
  error_message?: string
  started_at?: string
  completed_at?: string
  created_at: string
  updated_at: string
}

export interface ParseJobWithTitle extends ParseJob {
  document_title: string
}

export interface TranslationJob {
  id: string
  document_id: string
  provider_id: string
  status: TranslationStatus
  progress: number
  total_chunks: number
  completed_chunks: number
  failed_chunks?: number
  error_message?: string
  config: TranslationConfig
  started_at?: string
  completed_at?: string
  created_at: string
  updated_at: string
}

export interface TranslationJobWithTitle extends Omit<TranslationJob, 'config'> {
  document_title: string
  failed_chunks: number
  config: string
}

export interface IndexJob {
  id: string
  document_id: string
  document_title: string
  provider_id: string
  status: string
  progress: number
  total_chunks: number
  completed_chunks: number
  error_message?: string
  config?: string
  started_at?: string
  completed_at?: string
  created_at: string
  updated_at: string
}

export interface TranslationConfig {
  source_language: string
  target_language: string
  model: string
  temperature: number
  max_tokens: number
  chunk_strategy: string
  concurrency: number
  preserve_terms: boolean
  use_glossary: boolean
  system_prompt?: string
  user_prompt_template?: string
  max_requests_per_minute?: number
  max_concurrent_requests?: number
}

export interface ParsedContent {
  id: string
  document_id: string
  version: number
  markdown_content: string
  json_content: string
  structure_tree: any
  markdown_file_path?: string | null
  asset_base_dir?: string | null
  created_at: string
}

export interface TranslatedContent {
  id: string
  document_id: string
  version: number
  content: string
  created_at: string
}

export type DocumentOutputType = "translated_pdf"

export interface DocumentOutput {
  id: string
  document_id: string
  output_type: DocumentOutputType
  file_path: string
  created_at: string
  updated_at: string
  is_file_missing?: boolean
}

export type MineruProcessedFileType =
  | "markdown"
  | "json"
  | "structure"
  | "archive"
  | "html"
  | "docx"
  | "latex"

export interface MineruProcessedFile {
  id: string
  document_id: string
  artifact_type: MineruProcessedFileType
  file_path: string
  created_at: string
  updated_at: string
  is_file_missing?: boolean
}

export interface Chunk {
  id: string
  document_id: string
  content: string
  translated_content?: string
  chunk_index: number
  page_number?: number
  section_title?: string
  metadata: Record<string, any>
  created_at: string
}

export interface Embedding {
  id: string
  chunk_id: string
  vector: number[]
  model: string
  created_at: string
}

export interface Category {
  id: string
  name: string
  description?: string
  parent_id?: string
  created_at: string
  updated_at: string
}

export interface Folder {
  id: string
  name: string
  parent_id?: string
  created_at: string
  updated_at: string
}

export interface Tag {
  id: string
  name: string
  color?: string
  created_at: string
}

export interface DocumentTag {
  document_id: string
  tag_id: string
  created_at: string
}

export type ProviderModelType = "chat" | "translate" | "embed" | "rerank"

export interface ProviderModelConfig {
  dimensions?: number
  rerank_top_n?: number
}

export interface ProviderModel {
  id: string
  provider_id: string
  name: string
  model_type: ProviderModelType
  model_name: string
  supports_vision: boolean
  is_active: boolean
  priority: number
  config?: ProviderModelConfig
  created_at: string
  updated_at: string
}

export interface LlmSamplingConfig {
  temperature?: number
  top_p?: number
  top_k?: number
  max_tokens?: number
}

export interface Provider {
  id: string
  name: string
  base_url: string
  api_key: string
  max_retries: number
  priority: number
  models: ProviderModel[]
  chat_model?: string
  translate_model?: string
  embedding_model?: string
  rerank_model?: string
  headers?: Record<string, string> | string
  organization?: string
  timeout?: number
  concurrency?: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ExtractionTemplate {
  id: string
  name: string
  field_key: string
  description?: string | null
  system_prompt: string
  user_prompt: string
  is_enabled: boolean
  is_builtin: boolean
  created_at: string
  updated_at: string
}

export interface ExtractionTemplateInput {
  name: string
  fieldKey: string
  description?: string
  systemPrompt: string
  userPrompt: string
  isEnabled?: boolean
}

export interface DocumentMetadataField {
  id: string
  document_id: string
  field_key: string
  field_value?: string | null
  provider_id?: string | null
  model_name?: string | null
  extracted_at: string
  error?: string | null
}

export interface ExtractionResult {
  document_id: string
  field_key: string
  field_value?: string | null
  provider_id: string
  model_name: string
  extracted_at: string
  error?: string | null
}

export interface SyncRecord {
  id: string
  resource_type: string
  resource_id: string
  action: "create" | "update" | "delete"
  status: SyncStatus
  error_message?: string
  synced_at?: string
  created_at: string
}

export interface AppSettings {
  id: string
  key: string
  value: string
  created_at: string
  updated_at: string
}

export interface ExportRecord {
  id: string
  document_id: string
  format: "markdown" | "txt" | "json" | "zip"
  content_type: "original" | "translated" | "bilingual" | "all"
  file_path: string
  created_at: string
}

export interface SearchResult {
  document_id: string
  chunk_id: string
  score: number
  content: string
  metadata: Record<string, any>
}

export interface SearchHit {
  chunk_id: string
  document_id: string
  content: string
  score: number
}

export interface SearchFilters {
  category_ids?: string[]
  tag_ids?: string[]
  languages?: string[]
  date_from?: string
  date_to?: string
  parse_status?: ParseStatus[]
  translation_status?: TranslationStatus[]
  file_size_min?: number
  file_size_max?: number
}

export interface BatchActionFailure {
  document_id: string
  reason: string
}

export interface BatchActionReport {
  requested: number
  succeeded: number
  failed: number
  failures: BatchActionFailure[]
}

export interface DocumentCleanupIssue {
  resource_type: string
  path?: string
  reason: string
}

export interface PermanentDeleteOutcome {
  document_id: string
  title: string
  deleted: boolean
  resources_deleted: number
  resources_missing: number
  issues: DocumentCleanupIssue[]
}

export interface PermanentDeleteReport {
  requested: number
  deleted: number
  failed: number
  outcomes: PermanentDeleteOutcome[]
}
