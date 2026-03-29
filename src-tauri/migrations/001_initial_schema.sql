-- PDF Translation Toolbox Database Schema
-- SQLite Database

-- Documents table
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    page_count INTEGER DEFAULT 0,
    source_language TEXT,
    target_language TEXT,
    category_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT,
    parse_status TEXT NOT NULL DEFAULT 'pending' CHECK(parse_status IN ('pending', 'parsing', 'completed', 'failed')),
    translation_status TEXT NOT NULL DEFAULT 'pending' CHECK(translation_status IN ('pending', 'translating', 'completed', 'failed', 'partial')),
    index_status TEXT NOT NULL DEFAULT 'pending' CHECK(index_status IN ('pending', 'indexing', 'completed', 'failed')),
    sync_status TEXT NOT NULL DEFAULT 'pending' CHECK(sync_status IN ('synced', 'pending', 'syncing', 'conflict', 'error')),
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category_id);
CREATE INDEX IF NOT EXISTS idx_documents_parse_status ON documents(parse_status);
CREATE INDEX IF NOT EXISTS idx_documents_translation_status ON documents(translation_status);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at);
CREATE INDEX IF NOT EXISTS idx_documents_deleted_at ON documents(deleted_at);

-- Full-text search for documents
CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
    document_id UNINDEXED,
    title,
    filename,
    content='documents',
    content_rowid='rowid'
);

-- Parse jobs table
CREATE TABLE IF NOT EXISTS parse_jobs (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'parsing', 'completed', 'failed')),
    progress REAL DEFAULT 0,
    error_message TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_parse_jobs_document ON parse_jobs(document_id);
CREATE INDEX IF NOT EXISTS idx_parse_jobs_status ON parse_jobs(status);

-- Translation jobs table
CREATE TABLE IF NOT EXISTS translation_jobs (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'translating', 'completed', 'failed', 'partial')),
    progress REAL DEFAULT 0,
    total_chunks INTEGER DEFAULT 0,
    completed_chunks INTEGER DEFAULT 0,
    error_message TEXT,
    config TEXT NOT NULL, -- JSON
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
    FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_translation_jobs_document ON translation_jobs(document_id);
CREATE INDEX IF NOT EXISTS idx_translation_jobs_status ON translation_jobs(status);

-- Parsed content table (versioned)
CREATE TABLE IF NOT EXISTS parsed_contents (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    markdown_content TEXT NOT NULL,
    json_content TEXT NOT NULL, -- JSON structure
    structure_tree TEXT, -- JSON tree
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
    UNIQUE(document_id, version)
);

CREATE INDEX IF NOT EXISTS idx_parsed_contents_document ON parsed_contents(document_id);

-- Translated content table (versioned)
CREATE TABLE IF NOT EXISTS translated_contents (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
    UNIQUE(document_id, version)
);

CREATE INDEX IF NOT EXISTS idx_translated_contents_document ON translated_contents(document_id);

-- Chunks table
CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    content TEXT NOT NULL,
    translated_content TEXT,
    chunk_index INTEGER NOT NULL,
    page_number INTEGER,
    section_title TEXT,
    metadata TEXT, -- JSON
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_index ON chunks(chunk_index);

-- Full-text search for chunks
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    chunk_id UNINDEXED,
    content,
    translated_content,
    section_title,
    content='chunks',
    content_rowid='rowid'
);

-- Embeddings table
CREATE TABLE IF NOT EXISTS embeddings (
    id TEXT PRIMARY KEY,
    chunk_id TEXT NOT NULL,
    vector BLOB NOT NULL, -- Stored as binary
    model TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_embeddings_chunk ON embeddings(chunk_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_model ON embeddings(model);

-- Categories table
CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    parent_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);

-- Tags table
CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Document tags junction table
CREATE TABLE IF NOT EXISTS document_tags (
    document_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (document_id, tag_id),
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_document_tags_document ON document_tags(document_id);
CREATE INDEX IF NOT EXISTS idx_document_tags_tag ON document_tags(tag_id);

-- Providers table
CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    base_url TEXT NOT NULL,
    api_key TEXT NOT NULL,
    chat_model TEXT,
    embedding_model TEXT,
    rerank_model TEXT,
    headers TEXT, -- JSON
    organization TEXT,
    max_tokens INTEGER,
    temperature REAL,
    timeout INTEGER,
    concurrency INTEGER DEFAULT 3,
    is_active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sync records table
CREATE TABLE IF NOT EXISTS sync_records (
    id TEXT PRIMARY KEY,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('create', 'update', 'delete')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('synced', 'pending', 'syncing', 'conflict', 'error')),
    error_message TEXT,
    synced_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sync_records_resource ON sync_records(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_sync_records_status ON sync_records(status);

-- App settings table
CREATE TABLE IF NOT EXISTS app_settings (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Export records table
CREATE TABLE IF NOT EXISTS export_records (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    format TEXT NOT NULL CHECK(format IN ('markdown', 'txt', 'json', 'zip')),
    content_type TEXT NOT NULL CHECK(content_type IN ('original', 'translated', 'bilingual', 'all')),
    file_path TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_export_records_document ON export_records(document_id);

-- Logs table
CREATE TABLE IF NOT EXISTS logs (
    id TEXT PRIMARY KEY,
    level TEXT NOT NULL CHECK(level IN ('debug', 'info', 'warn', 'error')),
    message TEXT NOT NULL,
    context TEXT, -- JSON
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at);
