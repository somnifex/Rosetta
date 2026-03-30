CREATE TABLE IF NOT EXISTS document_outputs (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    output_type TEXT NOT NULL CHECK(output_type IN ('translated_pdf')),
    file_path TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
    UNIQUE(document_id, output_type)
);

CREATE INDEX IF NOT EXISTS idx_document_outputs_document ON document_outputs(document_id);
CREATE INDEX IF NOT EXISTS idx_document_outputs_type ON document_outputs(output_type);
