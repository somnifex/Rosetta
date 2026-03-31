use rusqlite::{Connection, Result};
use std::path::Path;
use std::sync::Once;

static SQLITE_VEC_INIT: Once = Once::new();

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn new(db_path: &Path) -> Result<Self> {
        SQLITE_VEC_INIT.call_once(|| unsafe {
            rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute(
                sqlite_vec::sqlite3_vec_init as *const (),
            )));
        });

        let conn = Connection::open(db_path)?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        Ok(Database { conn })
    }

    pub fn init(&self) -> Result<()> {
        let schemas = [
            include_str!("../migrations/001_initial_schema.sql"),
            include_str!("../migrations/002_vector_indexes.sql"),
            include_str!("../migrations/003_library_upgrade.sql"),
            include_str!("../migrations/004_document_outputs.sql"),
            include_str!("../migrations/005_provider_models.sql"),
            include_str!("../migrations/006_mineru_processed_files.sql"),
            include_str!("../migrations/007_chunk_persistence_and_index_jobs.sql"),
            include_str!("../migrations/008_storage_compaction_markers.sql"),
        ];

        for schema in schemas {
            self.conn.execute_batch(schema)?;
        }

        ensure_table_column(
            &self.conn,
            "providers",
            "max_retries",
            "ALTER TABLE providers ADD COLUMN max_retries INTEGER DEFAULT 3",
        )?;
        ensure_table_column(
            &self.conn,
            "providers",
            "priority",
            "ALTER TABLE providers ADD COLUMN priority INTEGER DEFAULT 0",
        )?;
        ensure_table_column(
            &self.conn,
            "translation_jobs",
            "content_hash",
            "ALTER TABLE translation_jobs ADD COLUMN content_hash TEXT",
        )?;
        ensure_table_column(
            &self.conn,
            "translation_jobs",
            "failed_chunks",
            "ALTER TABLE translation_jobs ADD COLUMN failed_chunks INTEGER DEFAULT 0",
        )?;

        Ok(())
    }

    pub fn get_connection(&self) -> &Connection {
        &self.conn
    }

    pub fn recover_incomplete_tasks(&self) -> Result<()> {
        self.conn.execute(
            "UPDATE parse_jobs
             SET status = 'failed',
                 error_message = COALESCE(error_message, 'Task interrupted because the application restarted'),
                 completed_at = COALESCE(completed_at, datetime('now')),
                 updated_at = datetime('now')
             WHERE status IN ('pending', 'parsing')",
            [],
        )?;

        self.conn.execute(
            "UPDATE documents
             SET parse_status = CASE
                 WHEN EXISTS (
                     SELECT 1 FROM parsed_contents pc WHERE pc.document_id = documents.id
                 ) THEN 'completed'
                 ELSE 'pending'
             END,
                 updated_at = datetime('now')
             WHERE parse_status = 'parsing'",
            [],
        )?;

        // Mark interrupted translation jobs with completed chunks as 'partial' (resumable)
        self.conn.execute(
            "UPDATE translation_jobs
             SET status = 'partial',
                 error_message = COALESCE(error_message, 'Task interrupted - can be resumed'),
                 completed_at = COALESCE(completed_at, datetime('now')),
                 updated_at = datetime('now')
             WHERE status IN ('pending', 'translating')
               AND id IN (SELECT DISTINCT job_id FROM translation_chunks WHERE status = 'completed')",
            [],
        )?;

        // Mark interrupted translation jobs with NO completed chunks as 'failed'
        self.conn.execute(
            "UPDATE translation_jobs
             SET status = 'failed',
                 error_message = COALESCE(error_message, 'Task interrupted because the application restarted'),
                 completed_at = COALESCE(completed_at, datetime('now')),
                 updated_at = datetime('now')
             WHERE status IN ('pending', 'translating')
               AND id NOT IN (SELECT DISTINCT job_id FROM translation_chunks WHERE status = 'completed')",
            [],
        )?;

        self.conn.execute(
            "UPDATE documents
             SET translation_status = CASE
                 WHEN EXISTS (
                     SELECT 1 FROM translated_contents tc WHERE tc.document_id = documents.id
                 ) THEN 'completed'
                 WHEN EXISTS (
                     SELECT 1 FROM translation_jobs tj WHERE tj.document_id = documents.id AND tj.status = 'partial'
                 ) THEN 'partial'
                 ELSE 'pending'
             END,
                 updated_at = datetime('now')
             WHERE translation_status = 'translating'",
            [],
        )?;

        self.conn.execute(
            "UPDATE documents
             SET index_status = 'pending',
                 updated_at = datetime('now')
             WHERE index_status = 'indexing'",
            [],
        )?;

        // Mark interrupted index jobs with completed chunks as 'partial' (resumable)
        self.conn.execute(
            "UPDATE index_jobs
             SET status = 'partial',
                 error_message = COALESCE(error_message, 'Task interrupted - can be resumed'),
                 completed_at = COALESCE(completed_at, datetime('now')),
                 updated_at = datetime('now')
             WHERE status IN ('pending', 'indexing')
               AND id IN (SELECT DISTINCT job_id FROM index_chunks WHERE status = 'completed')",
            [],
        )?;

        // Mark interrupted index jobs with NO completed chunks as 'failed'
        self.conn.execute(
            "UPDATE index_jobs
             SET status = 'failed',
                 error_message = COALESCE(error_message, 'Task interrupted because the application restarted'),
                 completed_at = COALESCE(completed_at, datetime('now')),
                 updated_at = datetime('now')
             WHERE status IN ('pending', 'indexing')
               AND id NOT IN (SELECT DISTINCT job_id FROM index_chunks WHERE status = 'completed')",
            [],
        )?;

        Ok(())
    }

    pub fn apply_optional_storage_compaction(&self, enable: bool) -> Result<bool> {
        if !enable {
            return Ok(false);
        }

        let marker_key = "storage.compaction.v1";
        if self.has_migration_marker(marker_key)? {
            return Ok(false);
        }

        let tx = self.conn.unchecked_transaction()?;

        // Rebuild parsed_contents/translated_contents to reclaim pages left by old large TEXT rows.
        if table_exists(&tx, "parsed_contents")? {
            tx.execute_batch(
                "CREATE TABLE parsed_contents_new (
                    id TEXT PRIMARY KEY,
                    document_id TEXT NOT NULL,
                    version INTEGER NOT NULL DEFAULT 1,
                    markdown_content TEXT NOT NULL,
                    json_content TEXT NOT NULL,
                    structure_tree TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
                    UNIQUE(document_id, version)
                );
                INSERT INTO parsed_contents_new (id, document_id, version, markdown_content, json_content, structure_tree, created_at)
                SELECT id, document_id, version, markdown_content, json_content, structure_tree, created_at
                FROM parsed_contents;
                DROP TABLE parsed_contents;
                ALTER TABLE parsed_contents_new RENAME TO parsed_contents;
                CREATE INDEX IF NOT EXISTS idx_parsed_contents_document ON parsed_contents(document_id);",
            )?;
        }

        if table_exists(&tx, "translated_contents")? {
            tx.execute_batch(
                "CREATE TABLE translated_contents_new (
                    id TEXT PRIMARY KEY,
                    document_id TEXT NOT NULL,
                    version INTEGER NOT NULL DEFAULT 1,
                    content TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
                    UNIQUE(document_id, version)
                );
                INSERT INTO translated_contents_new (id, document_id, version, content, created_at)
                SELECT id, document_id, version, content, created_at
                FROM translated_contents;
                DROP TABLE translated_contents;
                ALTER TABLE translated_contents_new RENAME TO translated_contents;
                CREATE INDEX IF NOT EXISTS idx_translated_contents_document ON translated_contents(document_id);",
            )?;
        }

        // These tables are now migrated to file/system settings and can be removed.
        tx.execute_batch("DROP TABLE IF EXISTS app_settings; DROP TABLE IF EXISTS logs;")?;

        let now = chrono::Utc::now().to_rfc3339();
        tx.execute(
            "INSERT INTO migration_markers(marker_key, marker_value, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(marker_key) DO UPDATE
             SET marker_value = excluded.marker_value,
                 updated_at = excluded.updated_at",
            [marker_key, &now, &now],
        )?;

        tx.commit()?;
        Ok(true)
    }

    fn has_migration_marker(&self, marker_key: &str) -> Result<bool> {
        if !table_exists(&self.conn, "migration_markers")? {
            return Ok(false);
        }

        let exists = self
            .conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM migration_markers WHERE marker_key = ?1)",
                [marker_key],
                |row| row.get::<_, i64>(0),
            )?
            != 0;
        Ok(exists)
    }
}

fn table_exists(conn: &Connection, table: &str) -> Result<bool> {
    let exists = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?1)",
        [table],
        |row| row.get::<_, i64>(0),
    )? != 0;
    Ok(exists)
}

fn ensure_table_column(conn: &Connection, table: &str, column: &str, alter_sql: &str) -> Result<()> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>>>()?;

    if !columns.iter().any(|existing| existing == column) {
        conn.execute_batch(alter_sql)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_database_init() {
        let db = Database::new(Path::new(":memory:")).unwrap();
        assert!(db.init().is_ok());
    }
}
