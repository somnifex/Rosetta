use rusqlite::{Connection, Result};
use std::path::Path;

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn new(db_path: &Path) -> Result<Self> {
        let conn = Connection::open(db_path)?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        Ok(Database { conn })
    }

    pub fn init(&self) -> Result<()> {
        let schemas = [
            include_str!("../migrations/001_initial_schema.sql"),
            include_str!("../migrations/002_vector_indexes.sql"),
        ];

        for schema in schemas {
            self.conn.execute_batch(schema)?;
        }

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

        self.conn.execute(
            "UPDATE translation_jobs
             SET status = 'failed',
                 error_message = COALESCE(error_message, 'Task interrupted because the application restarted'),
                 completed_at = COALESCE(completed_at, datetime('now')),
                 updated_at = datetime('now')
             WHERE status IN ('pending', 'translating')",
            [],
        )?;

        self.conn.execute(
            "UPDATE documents
             SET translation_status = CASE
                 WHEN EXISTS (
                     SELECT 1 FROM translated_contents tc WHERE tc.document_id = documents.id
                 ) THEN 'completed'
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

        Ok(())
    }
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
