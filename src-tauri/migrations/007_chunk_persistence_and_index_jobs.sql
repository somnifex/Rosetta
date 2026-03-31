-- Migration 007: Chunk persistence for breakpoint resume and index jobs table

-- Translation chunks table: per-chunk persistence for translation jobs
CREATE TABLE IF NOT EXISTS translation_chunks (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    source_text TEXT NOT NULL,
    translated_text TEXT,
    start_pos INTEGER NOT NULL,
    end_pos INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'completed', 'failed')),
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (job_id) REFERENCES translation_jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
    UNIQUE(job_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_translation_chunks_job ON translation_chunks(job_id);
CREATE INDEX IF NOT EXISTS idx_translation_chunks_status ON translation_chunks(job_id, status);

-- Index jobs table: proper job tracking for indexing (replaces synthetic index tasks)
CREATE TABLE IF NOT EXISTS index_jobs (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'indexing', 'completed', 'failed', 'partial')),
    progress REAL DEFAULT 0,
    total_chunks INTEGER DEFAULT 0,
    completed_chunks INTEGER DEFAULT 0,
    error_message TEXT,
    config TEXT,
    content_hash TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_index_jobs_document ON index_jobs(document_id);
CREATE INDEX IF NOT EXISTS idx_index_jobs_status ON index_jobs(status);

-- Index chunks table: per-chunk persistence for index jobs
CREATE TABLE IF NOT EXISTS index_chunks (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    embedding BLOB,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'completed', 'failed')),
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (job_id) REFERENCES index_jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
    UNIQUE(job_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_index_chunks_job ON index_chunks(job_id);
CREATE INDEX IF NOT EXISTS idx_index_chunks_status ON index_chunks(job_id, status);
