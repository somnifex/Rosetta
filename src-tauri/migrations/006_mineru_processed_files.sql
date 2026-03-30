CREATE TABLE IF NOT EXISTS mineru_processed_files (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    artifact_type TEXT NOT NULL CHECK(artifact_type IN ('markdown', 'json', 'structure')),
    file_path TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
    UNIQUE(document_id, artifact_type)
);

CREATE INDEX IF NOT EXISTS idx_mineru_processed_files_document ON mineru_processed_files(document_id);
CREATE INDEX IF NOT EXISTS idx_mineru_processed_files_type ON mineru_processed_files(artifact_type);
