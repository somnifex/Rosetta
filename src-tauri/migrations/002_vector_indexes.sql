CREATE TABLE IF NOT EXISTS document_vector_indexes (
    document_id TEXT PRIMARY KEY,
    backend TEXT NOT NULL CHECK(backend IN ('sqlite', 'zvec')),
    collection_key TEXT,
    embedding_model TEXT,
    vector_dimension INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_document_vector_indexes_backend
    ON document_vector_indexes(backend);

CREATE INDEX IF NOT EXISTS idx_document_vector_indexes_collection
    ON document_vector_indexes(collection_key);
