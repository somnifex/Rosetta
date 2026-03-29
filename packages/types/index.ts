// Core types for the PDF Translation Toolbox

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
  created_at: string
  updated_at: string
  deleted_at?: string
  parse_status: ParseStatus
  translation_status: TranslationStatus
  index_status: IndexStatus
  sync_status: SyncStatus
  tags?: Tag[]
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

export interface TranslationJob {
  id: string
  document_id: string
  provider_id: string
  status: TranslationStatus
  progress: number
  total_chunks: number
  completed_chunks: number
  error_message?: string
  config: TranslationConfig
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
}

export interface ParsedContent {
  id: string
  document_id: string
  version: number
  markdown_content: string
  json_content: string
  structure_tree: any
  created_at: string
}

export interface TranslatedContent {
  id: string
  document_id: string
  version: number
  content: string
  created_at: string
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

export type ProviderType = "chat" | "embedding"

export interface Provider {
  id: string
  name: string
  provider_type: ProviderType
  base_url: string
  api_key: string
  model: string
  chat_model?: string
  embedding_model?: string
  rerank_model?: string
  supports_vision: boolean
  max_retries: number
  priority: number
  headers?: Record<string, string>
  organization?: string
  max_tokens?: number
  temperature?: number
  timeout?: number
  concurrency?: number
  is_active: boolean
  created_at: string
  updated_at: string
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
