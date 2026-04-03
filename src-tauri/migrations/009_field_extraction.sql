-- Migration 009: field extraction templates and document metadata

CREATE TABLE IF NOT EXISTS extraction_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    field_key TEXT NOT NULL UNIQUE,
    description TEXT,
    system_prompt TEXT NOT NULL,
    user_prompt TEXT NOT NULL,
    is_enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_extraction_templates_enabled
    ON extraction_templates(is_enabled, created_at);

CREATE TABLE IF NOT EXISTS document_metadata (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    field_key TEXT NOT NULL,
    field_value TEXT,
    provider_id TEXT,
    model_name TEXT,
    extracted_at TEXT NOT NULL DEFAULT (datetime('now')),
    error TEXT,
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
    UNIQUE(document_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_document_metadata_document
    ON document_metadata(document_id, extracted_at DESC);

CREATE INDEX IF NOT EXISTS idx_document_metadata_field
    ON document_metadata(field_key);
