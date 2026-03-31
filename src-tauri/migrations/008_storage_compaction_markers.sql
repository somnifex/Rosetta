-- Migration 008: storage compaction markers and idempotent flags

CREATE TABLE IF NOT EXISTS migration_markers (
    marker_key TEXT PRIMARY KEY,
    marker_value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_migration_markers_updated_at
    ON migration_markers(updated_at);
