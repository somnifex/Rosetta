use crate::file_handler::FileHandler;
use crate::models::*;
use crate::AppState;
use chrono::Utc;
use rusqlite::OptionalExtension;
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use tauri::{AppHandle, State};
use uuid::Uuid;

const TASK_CANCELLED_BY_USER: &str = "Cancelled by user";
const TASK_REMOVED_BY_USER: &str = "Removed by user";
const TASK_CANCELLED_BECAUSE_DOCUMENT_WAS_DELETED: &str =
    "Cancelled because the document was deleted";

struct IndexedChunk {
    id: String,
    content: String,
    chunk_index: i32,
    embedding: Vec<f32>,
}

#[derive(Debug, Clone)]
pub(crate) struct DirectEmbeddingProvider {
    pub base_url: String,
    pub api_key: String,
    pub embedding_model: String,
}

fn openai_compatible_url(base_url: &str, path: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/v1") {
        format!("{trimmed}/{path}")
    } else {
        format!("{trimmed}/v1/{path}")
    }
}

fn take_parse_job_handle(
    state: &AppState,
    job_id: &str,
) -> Result<Option<tauri::async_runtime::JoinHandle<()>>, String> {
    let mut handles = state.parse_job_handles.lock().map_err(|e| e.to_string())?;
    Ok(handles.remove(job_id))
}

fn take_translation_job_handle(
    state: &AppState,
    job_id: &str,
) -> Result<Option<tauri::async_runtime::JoinHandle<()>>, String> {
    let mut handles = state
        .translation_job_handles
        .lock()
        .map_err(|e| e.to_string())?;
    Ok(handles.remove(job_id))
}

fn take_index_job_handle(
    state: &AppState,
    document_id: &str,
) -> Result<Option<tauri::async_runtime::JoinHandle<()>>, String> {
    let mut handles = state.index_job_handles.lock().map_err(|e| e.to_string())?;
    Ok(handles.remove(document_id))
}

fn reset_parse_document_status(
    conn: &rusqlite::Connection,
    document_id: &str,
    now: &str,
) -> Result<(), String> {
    let has_active_job = conn
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM parse_jobs
                WHERE document_id = ?1 AND status IN ('pending', 'parsing')
            )",
            [document_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())?
        != 0;
    let has_parsed_content = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM parsed_contents WHERE document_id = ?1)",
            [document_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())?
        != 0;

    let next_status = if has_active_job {
        "parsing"
    } else if has_parsed_content {
        "completed"
    } else {
        "pending"
    };

    conn.execute(
        "UPDATE documents SET parse_status = ?1, updated_at = ?2 WHERE id = ?3",
        (next_status, now, document_id),
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn reset_translation_document_status(
    conn: &rusqlite::Connection,
    document_id: &str,
    now: &str,
) -> Result<(), String> {
    let has_active_job = conn
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM translation_jobs
                WHERE document_id = ?1 AND status IN ('pending', 'translating')
            )",
            [document_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())?
        != 0;
    let has_translation = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM translated_contents WHERE document_id = ?1)",
            [document_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())?
        != 0;

    let next_status = if has_active_job {
        "translating"
    } else if has_translation {
        "completed"
    } else {
        "pending"
    };

    conn.execute(
        "UPDATE documents SET translation_status = ?1, updated_at = ?2 WHERE id = ?3",
        (next_status, now, document_id),
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

pub(crate) fn remove_document_from_vector_store(
    conn: &rusqlite::Connection,
    app_dir: &Path,
    document_id: &str,
) -> Result<(), String> {
    let Some(record) = crate::zvec::load_document_index_record(conn, document_id)? else {
        return Ok(());
    };

    if record.backend.eq_ignore_ascii_case("zvec") {
        if let Some(collection_key) = record.collection_key.as_deref() {
            let chunk_ids = crate::zvec::load_document_chunk_ids(conn, document_id)?;

            if !chunk_ids.is_empty() {
                let zvec_settings = crate::zvec::load_zvec_settings(conn, app_dir)?;

                if let Err(error) = crate::zvec::delete_embeddings(
                    app_dir,
                    &zvec_settings,
                    collection_key,
                    &chunk_ids,
                ) {
                    log::warn!(
                        "Failed to delete ZVEC entries for document {} from collection {}: {}",
                        document_id,
                        collection_key,
                        error
                    );
                }
            }
        }
    }

    crate::zvec::delete_document_index_record(conn, document_id)?;
    Ok(())
}

fn cleanup_document_records(conn: &rusqlite::Connection, document_id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM embeddings WHERE chunk_id IN (SELECT id FROM chunks WHERE document_id = ?1)",
        [document_id],
    )
    .map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM chunks WHERE document_id = ?1", [document_id])
        .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM translated_contents WHERE document_id = ?1",
        [document_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM parsed_contents WHERE document_id = ?1",
        [document_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM translation_jobs WHERE document_id = ?1",
        [document_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM parse_jobs WHERE document_id = ?1",
        [document_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM document_tags WHERE document_id = ?1",
        [document_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM export_records WHERE document_id = ?1",
        [document_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM sync_records WHERE resource_type = 'document' AND resource_id = ?1",
        [document_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM document_vector_indexes WHERE document_id = ?1",
        [document_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM documents WHERE id = ?1", [document_id])
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn cancel_parse_job_internal(state: &AppState, job_id: &str, reason: &str) -> Result<bool, String> {
    if let Some(handle) = take_parse_job_handle(state, job_id)? {
        handle.abort();
    }

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();
    let now = Utc::now().to_rfc3339();

    let Some(document_id) = conn
        .query_row(
            "SELECT document_id FROM parse_jobs WHERE id = ?1",
            [job_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
    else {
        return Ok(false);
    };

    let updated = conn
        .execute(
            "UPDATE parse_jobs
             SET status = 'failed', error_message = ?1, completed_at = ?2, updated_at = ?2
             WHERE id = ?3 AND status IN ('pending', 'parsing')",
            (reason, &now, job_id),
        )
        .map_err(|e| e.to_string())?;

    if updated > 0 {
        reset_parse_document_status(conn, &document_id, &now)?;
    }

    Ok(updated > 0)
}

fn cancel_translation_job_internal(
    state: &AppState,
    job_id: &str,
    reason: &str,
) -> Result<bool, String> {
    if let Some(handle) = take_translation_job_handle(state, job_id)? {
        handle.abort();
    }

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();
    let now = Utc::now().to_rfc3339();

    let Some(document_id) = conn
        .query_row(
            "SELECT document_id FROM translation_jobs WHERE id = ?1",
            [job_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
    else {
        return Ok(false);
    };

    let updated = conn
        .execute(
            "UPDATE translation_jobs
             SET status = 'failed', error_message = ?1, completed_at = ?2, updated_at = ?2
             WHERE id = ?3 AND status IN ('pending', 'translating')",
            (reason, &now, job_id),
        )
        .map_err(|e| e.to_string())?;

    if updated > 0 {
        reset_translation_document_status(conn, &document_id, &now)?;
    }

    Ok(updated > 0)
}

fn mark_index_job_failed(state: &AppState, document_id: &str, message: &str) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();
    let now = Utc::now().to_rfc3339();

    conn.execute(
        "UPDATE documents SET index_status = 'failed', updated_at = ?1 WHERE id = ?2",
        (&now, document_id),
    )
    .map_err(|e| e.to_string())?;

    log::error!("Index job for document {} failed: {}", document_id, message);
    Ok(())
}

fn cancel_index_job_internal(
    state: &AppState,
    app_dir: &Path,
    document_id: &str,
) -> Result<bool, String> {
    let had_handle = if let Some(handle) = take_index_job_handle(state, document_id)? {
        handle.abort();
        true
    } else {
        false
    };

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();
    let now = Utc::now().to_rfc3339();

    let current_status = conn
        .query_row(
            "SELECT index_status FROM documents WHERE id = ?1",
            [document_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if current_status.as_deref() != Some("indexing") {
        return Ok(had_handle);
    }

    remove_document_from_vector_store(conn, app_dir, document_id)?;

    conn.execute(
        "DELETE FROM embeddings WHERE chunk_id IN (SELECT id FROM chunks WHERE document_id = ?1)",
        [document_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM chunks WHERE document_id = ?1", [document_id])
        .map_err(|e| e.to_string())?;

    let updated = conn
        .execute(
            "UPDATE documents SET index_status = 'pending', updated_at = ?1 WHERE id = ?2 AND index_status = 'indexing'",
            (&now, document_id),
        )
        .map_err(|e| e.to_string())?;

    Ok(had_handle || updated > 0)
}

#[tauri::command]
pub fn get_documents(state: State<AppState>) -> Result<Vec<Document>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    let mut stmt = conn
        .prepare("SELECT * FROM documents WHERE deleted_at IS NULL ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;

    let documents = stmt
        .query_map([], |row| {
            Ok(Document {
                id: row.get(0)?,
                title: row.get(1)?,
                filename: row.get(2)?,
                file_path: row.get(3)?,
                file_size: row.get(4)?,
                page_count: row.get(5)?,
                source_language: row.get(6)?,
                target_language: row.get(7)?,
                category_id: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
                deleted_at: row.get(11)?,
                parse_status: row.get(12)?,
                translation_status: row.get(13)?,
                index_status: row.get(14)?,
                sync_status: row.get(15)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(documents)
}

#[tauri::command]
pub fn get_document_by_id(state: State<AppState>, id: String) -> Result<Document, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    let document = conn
        .query_row(
            "SELECT * FROM documents WHERE id = ?1 AND deleted_at IS NULL",
            [&id],
            |row| {
                Ok(Document {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    filename: row.get(2)?,
                    file_path: row.get(3)?,
                    file_size: row.get(4)?,
                    page_count: row.get(5)?,
                    source_language: row.get(6)?,
                    target_language: row.get(7)?,
                    category_id: row.get(8)?,
                    created_at: row.get(9)?,
                    updated_at: row.get(10)?,
                    deleted_at: row.get(11)?,
                    parse_status: row.get(12)?,
                    translation_status: row.get(13)?,
                    index_status: row.get(14)?,
                    sync_status: row.get(15)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    Ok(document)
}

#[tauri::command]
pub fn create_document(
    state: State<AppState>,
    title: String,
    filename: String,
    file_path: String,
    file_size: i64,
) -> Result<Document, String> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();

        conn.execute(
            "INSERT INTO documents (id, title, filename, file_path, file_size, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            (&id, &title, &filename, &file_path, &file_size, &now, &now),
        )
        .map_err(|e| e.to_string())?;
    }

    get_document_by_id(state, id)
}

#[tauri::command]
pub fn update_document(
    state: State<AppState>,
    id: String,
    title: Option<String>,
    category_id: Option<String>,
    source_language: Option<String>,
    target_language: Option<String>,
) -> Result<Document, String> {
    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();
        let now = Utc::now().to_rfc3339();

        let mut updates = vec![];
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![];

        if let Some(t) = title {
            updates.push("title = ?");
            params.push(Box::new(t));
        }
        if let Some(c) = category_id {
            updates.push("category_id = ?");
            params.push(Box::new(c));
        }
        if let Some(s) = source_language {
            updates.push("source_language = ?");
            params.push(Box::new(s));
        }
        if let Some(t) = target_language {
            updates.push("target_language = ?");
            params.push(Box::new(t));
        }

        if updates.is_empty() {
            // no-op, just fall through to get_document_by_id
        } else {
            updates.push("updated_at = ?");
            params.push(Box::new(now));
            params.push(Box::new(id.clone()));

            let sql = format!("UPDATE documents SET {} WHERE id = ?", updates.join(", "));
            let params_refs: Vec<&dyn rusqlite::ToSql> =
                params.iter().map(|p| p.as_ref()).collect();

            conn.execute(&sql, params_refs.as_slice())
                .map_err(|e| e.to_string())?;
        }
    }

    get_document_by_id(state, id)
}

#[tauri::command]
pub fn delete_document(app: AppHandle, state: State<AppState>, id: String) -> Result<(), String> {
    let (file_path, parse_job_ids, translation_job_ids) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();

        let file_path = conn
            .query_row(
                "SELECT file_path FROM documents WHERE id = ?1 AND deleted_at IS NULL",
                [&id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Document not found".to_string())?;

        let mut parse_stmt = conn
            .prepare(
                "SELECT id FROM parse_jobs WHERE document_id = ?1 AND status IN ('pending', 'parsing')",
            )
            .map_err(|e| e.to_string())?;
        let parse_job_ids = parse_stmt
            .query_map([&id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        let mut translation_stmt = conn
            .prepare(
                "SELECT id FROM translation_jobs WHERE document_id = ?1 AND status IN ('pending', 'translating')",
            )
            .map_err(|e| e.to_string())?;
        let translation_job_ids = translation_stmt
            .query_map([&id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        (file_path, parse_job_ids, translation_job_ids)
    };

    for job_id in &parse_job_ids {
        let _ = cancel_parse_job_internal(
            state.inner(),
            job_id,
            TASK_CANCELLED_BECAUSE_DOCUMENT_WAS_DELETED,
        )?;
    }

    for job_id in &translation_job_ids {
        let _ = cancel_translation_job_internal(
            state.inner(),
            job_id,
            TASK_CANCELLED_BECAUSE_DOCUMENT_WAS_DELETED,
        )?;
    }

    let app_dir = crate::app_dirs::runtime_app_dir(&app)?;

    let _ = cancel_index_job_internal(state.inner(), &app_dir, &id)?;

    let file_handler = FileHandler::new(&app_dir)?;
    file_handler.delete_file(Path::new(&file_path))?;

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();
    remove_document_from_vector_store(conn, &app_dir, &id)?;
    cleanup_document_records(conn, &id)?;

    Ok(())
}

#[tauri::command]
pub fn get_categories(state: State<AppState>) -> Result<Vec<Category>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    let mut stmt = conn
        .prepare("SELECT * FROM categories ORDER BY name")
        .map_err(|e| e.to_string())?;

    let categories = stmt
        .query_map([], |row| {
            Ok(Category {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                parent_id: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(categories)
}

#[tauri::command]
pub fn create_category(
    state: State<AppState>,
    name: String,
    description: Option<String>,
    parent_id: Option<String>,
) -> Result<Category, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO categories (id, name, description, parent_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        (&id, &name, &description, &parent_id, &now, &now),
    )
    .map_err(|e| e.to_string())?;

    Ok(Category {
        id,
        name,
        description,
        parent_id,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn get_tags(state: State<AppState>) -> Result<Vec<Tag>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    let mut stmt = conn
        .prepare("SELECT * FROM tags ORDER BY name")
        .map_err(|e| e.to_string())?;

    let tags = stmt
        .query_map([], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(tags)
}

#[tauri::command]
pub fn create_tag(
    state: State<AppState>,
    name: String,
    color: Option<String>,
) -> Result<Tag, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO tags (id, name, color, created_at) VALUES (?1, ?2, ?3, ?4)",
        (&id, &name, &color, &now),
    )
    .map_err(|e| e.to_string())?;

    Ok(Tag {
        id,
        name,
        color,
        created_at: now,
    })
}

#[tauri::command]
pub fn get_providers(state: State<AppState>) -> Result<Vec<Provider>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    let mut stmt = conn
        .prepare("SELECT * FROM providers ORDER BY name")
        .map_err(|e| e.to_string())?;

    let providers = stmt
        .query_map([], |row| {
            Ok(Provider {
                id: row.get(0)?,
                name: row.get(1)?,
                base_url: row.get(2)?,
                api_key: row.get(3)?,
                chat_model: row.get(4)?,
                embedding_model: row.get(5)?,
                rerank_model: row.get(6)?,
                headers: row.get(7)?,
                organization: row.get(8)?,
                max_tokens: row.get(9)?,
                temperature: row.get(10)?,
                timeout: row.get(11)?,
                concurrency: row.get(12)?,
                is_active: row.get::<_, i32>(13)? != 0,
                created_at: row.get(14)?,
                updated_at: row.get(15)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(providers)
}

#[tauri::command]
pub fn create_provider(
    state: State<AppState>,
    name: String,
    base_url: String,
    api_key: String,
    chat_model: Option<String>,
    embedding_model: Option<String>,
) -> Result<Provider, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO providers (id, name, base_url, api_key, chat_model, embedding_model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        (&id, &name, &base_url, &api_key, &chat_model, &embedding_model, &now, &now),
    )
    .map_err(|e| e.to_string())?;

    Ok(Provider {
        id,
        name,
        base_url,
        api_key,
        chat_model,
        embedding_model,
        rerank_model: None,
        headers: None,
        organization: None,
        max_tokens: None,
        temperature: None,
        timeout: None,
        concurrency: 3,
        is_active: true,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn update_provider(
    state: State<AppState>,
    id: String,
    name: Option<String>,
    base_url: Option<String>,
    api_key: Option<String>,
    is_active: Option<bool>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();
    let now = Utc::now().to_rfc3339();

    let mut updates = vec![];
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![];

    if let Some(n) = name {
        updates.push("name = ?");
        params.push(Box::new(n));
    }
    if let Some(b) = base_url {
        updates.push("base_url = ?");
        params.push(Box::new(b));
    }
    if let Some(a) = api_key {
        updates.push("api_key = ?");
        params.push(Box::new(a));
    }
    if let Some(active) = is_active {
        updates.push("is_active = ?");
        params.push(Box::new(if active { 1 } else { 0 }));
    }

    if updates.is_empty() {
        return Ok(());
    }

    updates.push("updated_at = ?");
    params.push(Box::new(now));
    params.push(Box::new(id));

    let sql = format!("UPDATE providers SET {} WHERE id = ?", updates.join(", "));
    let params_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    conn.execute(&sql, params_refs.as_slice())
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn delete_provider(state: State<AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    conn.execute("DELETE FROM providers WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn test_provider_connection(
    base_url: String,
    api_key: String,
    _model: Option<String>,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let url = openai_compatible_url(&base_url, "models");

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;

    if response.status().is_success() {
        Ok("Connection successful".to_string())
    } else {
        Err(format!(
            "Connection failed with status: {}",
            response.status()
        ))
    }
}

#[tauri::command]
pub async fn import_pdf(
    app: AppHandle,
    state: State<'_, AppState>,
    file_path: String,
) -> Result<Document, String> {
    import_document(app, state, file_path, "pdf".to_string()).await
}

fn enqueue_parse_job(
    state: &AppState,
    document_id: &str,
    mark_document_parsing: bool,
) -> Result<ParseJob, String> {
    let job_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    let job = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();

        conn.execute(
            "INSERT INTO parse_jobs (id, document_id, status, progress, created_at, updated_at) VALUES (?1, ?2, 'pending', 0, ?3, ?4)",
            (&job_id, document_id, &now, &now),
        )
        .map_err(|e| e.to_string())?;

        if mark_document_parsing {
            conn.execute(
                "UPDATE documents SET parse_status = 'parsing', updated_at = ? WHERE id = ?",
                (&now, document_id),
            )
            .map_err(|e| e.to_string())?;
        }

        conn.query_row("SELECT * FROM parse_jobs WHERE id = ?1", [&job_id], |row| {
            Ok(ParseJob {
                id: row.get(0)?,
                document_id: row.get(1)?,
                status: row.get(2)?,
                progress: row.get(3)?,
                error_message: row.get(4)?,
                started_at: row.get(5)?,
                completed_at: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?
    };

    let job_id_clone = job_id.clone();
    let document_id_clone = document_id.to_string();
    let state_clone = state.clone();

    let handle = tauri::async_runtime::spawn(async move {
        let result = execute_parse_job(&state_clone, &job_id_clone, &document_id_clone).await;
        if let Ok(mut handles) = state_clone.parse_job_handles.lock() {
            handles.remove(&job_id_clone);
        }
        if let Err(e) = result {
            log::error!("Parse job {} failed: {}", job_id_clone, e);
        }
    });

    let mut handles = state.parse_job_handles.lock().map_err(|e| e.to_string())?;
    handles.insert(job_id.clone(), handle);

    Ok(job)
}

#[tauri::command]
pub async fn start_parse_job(
    _app: AppHandle,
    state: State<'_, AppState>,
    document_id: String,
) -> Result<ParseJob, String> {
    enqueue_parse_job(state.inner(), &document_id, true)
}

#[tauri::command]
pub fn cancel_parse_job(state: State<AppState>, job_id: String) -> Result<(), String> {
    cancel_parse_job_internal(state.inner(), &job_id, TASK_CANCELLED_BY_USER)?;
    Ok(())
}

#[tauri::command]
pub fn delete_parse_job(state: State<AppState>, job_id: String) -> Result<(), String> {
    let _ = cancel_parse_job_internal(state.inner(), &job_id, TASK_REMOVED_BY_USER)?;

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();
    conn.execute("DELETE FROM parse_jobs WHERE id = ?1", [&job_id])
        .map_err(|e| e.to_string())?;

    Ok(())
}

async fn execute_parse_job(
    state: &AppState,
    job_id: &str,
    document_id: &str,
) -> Result<(), String> {
    let file_path = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();
        let now = Utc::now().to_rfc3339();

        conn.execute(
            "UPDATE parse_jobs SET status = 'parsing', started_at = ?, updated_at = ? WHERE id = ?",
            (&now, &now, job_id),
        )
        .map_err(|e| e.to_string())?;

        conn.execute(
            "UPDATE documents SET parse_status = 'parsing', updated_at = ? WHERE id = ?",
            (&now, document_id),
        )
        .map_err(|e| e.to_string())?;

        conn.query_row(
            "SELECT file_path FROM documents WHERE id = ?",
            [document_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|e| e.to_string())?
    };

    let mineru_url = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        state.mineru_manager.get_effective_url(&db)?
    };
    let client = if let Some(profile) = state.mineru_manager.get_active_runtime_profile()? {
        crate::mineru::MinerUClient::new(mineru_url).with_parse_backend(profile.backend)
    } else {
        crate::mineru::MinerUClient::new(mineru_url)
    };

    let result = client.parse_pdf(Path::new(&file_path)).await;

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();
    let now = Utc::now().to_rfc3339();

    match result {
        Ok(parse_result) => {
            let content_id = Uuid::new_v4().to_string();

            conn.execute(
                "INSERT INTO parsed_contents (id, document_id, version, markdown_content, json_content, structure_tree, created_at) VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6)",
                (&content_id, document_id, &parse_result.markdown, &parse_result.json, &parse_result.structure.to_string(), &now),
            ).map_err(|e| e.to_string())?;

            conn.execute(
                "UPDATE parse_jobs SET status = 'completed', progress = 100, completed_at = ?, updated_at = ? WHERE id = ?",
                (&now, &now, job_id),
            ).map_err(|e| e.to_string())?;

            conn.execute(
                "UPDATE documents SET parse_status = 'completed', updated_at = ? WHERE id = ?",
                (&now, document_id),
            )
            .map_err(|e| e.to_string())?;

            Ok(())
        }
        Err(e) => {
            conn.execute(
                "UPDATE parse_jobs SET status = 'failed', error_message = ?, completed_at = ?, updated_at = ? WHERE id = ?",
                (&e, &now, &now, job_id),
            ).map_err(|e| e.to_string())?;

            conn.execute(
                "UPDATE documents SET parse_status = 'failed', updated_at = ? WHERE id = ?",
                (&now, document_id),
            )
            .map_err(|e| e.to_string())?;

            Err(e)
        }
    }
}

#[tauri::command]
pub fn get_parse_job(state: State<AppState>, job_id: String) -> Result<ParseJob, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    conn.query_row("SELECT * FROM parse_jobs WHERE id = ?1", [&job_id], |row| {
        Ok(ParseJob {
            id: row.get(0)?,
            document_id: row.get(1)?,
            status: row.get(2)?,
            progress: row.get(3)?,
            error_message: row.get(4)?,
            started_at: row.get(5)?,
            completed_at: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        })
    })
    .map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
pub struct ParseJobWithDoc {
    pub id: String,
    pub document_id: String,
    pub document_title: String,
    pub status: String,
    pub progress: f64,
    pub error_message: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub fn get_all_parse_jobs(state: State<AppState>) -> Result<Vec<ParseJobWithDoc>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    let mut stmt = conn
        .prepare(
            "SELECT pj.id, pj.document_id, d.title, pj.status, pj.progress, pj.error_message,
                    pj.started_at, pj.completed_at, pj.created_at, pj.updated_at
             FROM parse_jobs pj
             JOIN documents d ON pj.document_id = d.id
             WHERE d.deleted_at IS NULL
             ORDER BY pj.created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let jobs = stmt
        .query_map([], |row| {
            Ok(ParseJobWithDoc {
                id: row.get(0)?,
                document_id: row.get(1)?,
                document_title: row.get(2)?,
                status: row.get(3)?,
                progress: row.get(4)?,
                error_message: row.get(5)?,
                started_at: row.get(6)?,
                completed_at: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(jobs)
}

#[derive(Debug, Serialize)]
pub struct TranslationJobWithDoc {
    pub id: String,
    pub document_id: String,
    pub document_title: String,
    pub provider_id: String,
    pub status: String,
    pub progress: f64,
    pub total_chunks: i32,
    pub completed_chunks: i32,
    pub error_message: Option<String>,
    pub config: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub fn get_all_translation_jobs(
    state: State<AppState>,
) -> Result<Vec<TranslationJobWithDoc>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    let mut stmt = conn
        .prepare(
            "SELECT tj.id, tj.document_id, d.title, tj.provider_id, tj.status, tj.progress,
                    tj.total_chunks, tj.completed_chunks, tj.error_message, tj.config,
                    tj.started_at, tj.completed_at, tj.created_at, tj.updated_at
             FROM translation_jobs tj
             JOIN documents d ON tj.document_id = d.id
             WHERE d.deleted_at IS NULL
             ORDER BY tj.created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let jobs = stmt
        .query_map([], |row| {
            Ok(TranslationJobWithDoc {
                id: row.get(0)?,
                document_id: row.get(1)?,
                document_title: row.get(2)?,
                provider_id: row.get(3)?,
                status: row.get(4)?,
                progress: row.get(5)?,
                total_chunks: row.get(6)?,
                completed_chunks: row.get(7)?,
                error_message: row.get(8)?,
                config: row.get(9)?,
                started_at: row.get(10)?,
                completed_at: row.get(11)?,
                created_at: row.get(12)?,
                updated_at: row.get(13)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(jobs)
}

#[tauri::command]
pub fn get_parsed_content(
    state: State<AppState>,
    document_id: String,
) -> Result<ParsedContent, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    conn.query_row(
        "SELECT * FROM parsed_contents WHERE document_id = ?1 ORDER BY version DESC LIMIT 1",
        [&document_id],
        |row| {
            Ok(ParsedContent {
                id: row.get(0)?,
                document_id: row.get(1)?,
                version: row.get(2)?,
                markdown_content: row.get(3)?,
                json_content: row.get(4)?,
                structure_tree: row.get(5)?,
                created_at: row.get(6)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn test_mineru_connection(base_url: String) -> Result<String, String> {
    let client = crate::mineru::MinerUClient::new(base_url);
    match client.health_check().await {
        Ok(true) => Ok("MinerU service is healthy".to_string()),
        Ok(false) => Err("MinerU service is not responding".to_string()),
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn start_translation_job(
    _app: AppHandle,
    state: State<'_, AppState>,
    document_id: String,
    provider_id: String,
    source_language: String,
    target_language: String,
) -> Result<TranslationJob, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    let job_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let config = serde_json::json!({
        "source_language": source_language,
        "target_language": target_language,
    })
    .to_string();

    conn.execute(
        "INSERT INTO translation_jobs (id, document_id, provider_id, status, progress, config, created_at, updated_at) VALUES (?1, ?2, ?3, 'pending', 0, ?4, ?5, ?6)",
        (&job_id, &document_id, &provider_id, &config, &now, &now),
    ).map_err(|e| e.to_string())?;

    let job = conn
        .query_row(
            "SELECT * FROM translation_jobs WHERE id = ?1",
            [&job_id],
            |row| {
                Ok(TranslationJob {
                    id: row.get(0)?,
                    document_id: row.get(1)?,
                    provider_id: row.get(2)?,
                    status: row.get(3)?,
                    progress: row.get(4)?,
                    total_chunks: row.get(5)?,
                    completed_chunks: row.get(6)?,
                    error_message: row.get(7)?,
                    config: row.get(8)?,
                    started_at: row.get(9)?,
                    completed_at: row.get(10)?,
                    created_at: row.get(11)?,
                    updated_at: row.get(12)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    let job_id_clone = job_id.clone();
    let document_id_clone = document_id.clone();
    let provider_id_clone = provider_id.clone();
    let source_language_clone = source_language.clone();
    let target_language_clone = target_language.clone();
    let state_clone = state.inner().clone();

    let handle = tauri::async_runtime::spawn(async move {
        let result = execute_translation_job(
            &state_clone,
            &job_id_clone,
            &document_id_clone,
            &provider_id_clone,
            &source_language_clone,
            &target_language_clone,
        )
        .await;
        if let Ok(mut handles) = state_clone.translation_job_handles.lock() {
            handles.remove(&job_id_clone);
        }
        if let Err(e) = result {
            log::error!("Translation job {} failed: {}", job_id_clone, e);
        }
    });

    let mut handles = state
        .translation_job_handles
        .lock()
        .map_err(|e| e.to_string())?;
    handles.insert(job_id.clone(), handle);

    Ok(job)
}

#[tauri::command]
pub fn cancel_translation_job(state: State<AppState>, job_id: String) -> Result<(), String> {
    cancel_translation_job_internal(state.inner(), &job_id, TASK_CANCELLED_BY_USER)?;
    Ok(())
}

#[tauri::command]
pub fn delete_translation_job(state: State<AppState>, job_id: String) -> Result<(), String> {
    let _ = cancel_translation_job_internal(state.inner(), &job_id, TASK_REMOVED_BY_USER)?;

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();
    conn.execute("DELETE FROM translation_jobs WHERE id = ?1", [&job_id])
        .map_err(|e| e.to_string())?;

    Ok(())
}

async fn execute_translation_job(
    state: &AppState,
    job_id: &str,
    document_id: &str,
    provider_id: &str,
    source_language: &str,
    target_language: &str,
) -> Result<(), String> {
    let (provider, markdown_content) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();
        let now = Utc::now().to_rfc3339();

        conn.execute(
            "UPDATE translation_jobs SET status = 'translating', started_at = ?, updated_at = ? WHERE id = ?",
            (&now, &now, job_id),
        ).map_err(|e| e.to_string())?;

        conn.execute(
            "UPDATE documents SET translation_status = 'translating', updated_at = ? WHERE id = ?",
            (&now, document_id),
        )
        .map_err(|e| e.to_string())?;

        let provider: (String, String, Option<String>, Option<f64>, Option<i32>) = conn.query_row(
            "SELECT base_url, api_key, chat_model, temperature, max_tokens FROM providers WHERE id = ?",
            [provider_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        ).map_err(|e| e.to_string())?;

        let markdown_content: String = conn.query_row(
            "SELECT markdown_content FROM parsed_contents WHERE document_id = ? ORDER BY version DESC LIMIT 1",
            [document_id],
            |row| row.get(0),
        ).map_err(|e| e.to_string())?;

        (provider, markdown_content)
    };

    let translator = crate::translator::Translator::new(
        provider.0,
        provider.1,
        provider.2.unwrap_or_else(|| "gpt-4".to_string()),
        provider.3.unwrap_or(0.3),
        provider.4,
    );

    let result = translator
        .translate(&markdown_content, source_language, target_language)
        .await;

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();
    let now = Utc::now().to_rfc3339();

    match result {
        Ok(translated_text) => {
            let content_id = Uuid::new_v4().to_string();

            conn.execute(
                "INSERT INTO translated_contents (id, document_id, version, content, created_at) VALUES (?1, ?2, 1, ?3, ?4)",
                (&content_id, document_id, &translated_text, &now),
            ).map_err(|e| e.to_string())?;

            conn.execute(
                "UPDATE translation_jobs SET status = 'completed', progress = 100, completed_at = ?, updated_at = ? WHERE id = ?",
                (&now, &now, job_id),
            ).map_err(|e| e.to_string())?;

            conn.execute(
                "UPDATE documents SET translation_status = 'completed', target_language = ?, updated_at = ? WHERE id = ?",
                (target_language, &now, document_id),
            ).map_err(|e| e.to_string())?;

            Ok(())
        }
        Err(e) => {
            conn.execute(
                "UPDATE translation_jobs SET status = 'failed', error_message = ?, completed_at = ?, updated_at = ? WHERE id = ?",
                (&e, &now, &now, job_id),
            ).map_err(|e| e.to_string())?;

            conn.execute(
                "UPDATE documents SET translation_status = 'failed', updated_at = ? WHERE id = ?",
                (&now, document_id),
            )
            .map_err(|e| e.to_string())?;

            Err(e)
        }
    }
}

#[tauri::command]
pub fn get_translation_job(
    state: State<AppState>,
    job_id: String,
) -> Result<TranslationJob, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    conn.query_row(
        "SELECT * FROM translation_jobs WHERE id = ?1",
        [&job_id],
        |row| {
            Ok(TranslationJob {
                id: row.get(0)?,
                document_id: row.get(1)?,
                provider_id: row.get(2)?,
                status: row.get(3)?,
                progress: row.get(4)?,
                total_chunks: row.get(5)?,
                completed_chunks: row.get(6)?,
                error_message: row.get(7)?,
                config: row.get(8)?,
                started_at: row.get(9)?,
                completed_at: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_translated_content(
    state: State<AppState>,
    document_id: String,
) -> Result<TranslatedContent, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    conn.query_row(
        "SELECT * FROM translated_contents WHERE document_id = ?1 ORDER BY version DESC LIMIT 1",
        [&document_id],
        |row| {
            Ok(TranslatedContent {
                id: row.get(0)?,
                document_id: row.get(1)?,
                version: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn start_index_job(
    app: AppHandle,
    state: State<'_, AppState>,
    document_id: String,
    provider_id: String,
) -> Result<String, String> {
    let app_dir = crate::app_dirs::runtime_app_dir(&app)?;

    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();
        let now = Utc::now().to_rfc3339();

        conn.execute(
            "UPDATE documents SET index_status = 'indexing', updated_at = ? WHERE id = ?",
            (&now, &document_id),
        )
        .map_err(|e| e.to_string())?;
    }

    let document_id_clone = document_id.clone();
    let provider_id_clone = provider_id.clone();
    let state_clone = state.inner().clone();
    let app_dir_clone = app_dir.clone();

    let handle = tauri::async_runtime::spawn(async move {
        let result = execute_index_job(
            &state_clone,
            &app_dir_clone,
            &document_id_clone,
            &provider_id_clone,
        )
        .await;
        if let Ok(mut handles) = state_clone.index_job_handles.lock() {
            handles.remove(&document_id_clone);
        }
        if let Err(e) = result {
            let _ = mark_index_job_failed(&state_clone, &document_id_clone, &e);
        }
    });

    let mut handles = state.index_job_handles.lock().map_err(|e| e.to_string())?;
    handles.insert(document_id.clone(), handle);

    Ok("Indexing started".to_string())
}

#[tauri::command]
pub fn cancel_index_job(
    app: AppHandle,
    state: State<AppState>,
    document_id: String,
) -> Result<(), String> {
    let app_dir = crate::app_dirs::runtime_app_dir(&app)?;
    cancel_index_job_internal(state.inner(), &app_dir, &document_id)?;
    Ok(())
}

async fn execute_index_job(
    state: &AppState,
    app_dir: &Path,
    document_id: &str,
    provider_id: &str,
) -> Result<(), String> {
    let provider = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();

        let provider: (String, String, Option<String>) = conn
            .query_row(
                "SELECT base_url, api_key, embedding_model FROM providers WHERE id = ?",
                [provider_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(|e| e.to_string())?;

        DirectEmbeddingProvider {
            base_url: provider.0,
            api_key: provider.1,
            embedding_model: provider
                .2
                .unwrap_or_else(|| "text-embedding-ada-002".to_string()),
        }
    };

    execute_index_job_with_embedding_provider(state, app_dir, document_id, &provider).await
}

pub(crate) async fn execute_index_job_with_embedding_provider(
    state: &AppState,
    app_dir: &Path,
    document_id: &str,
    provider: &DirectEmbeddingProvider,
) -> Result<(), String> {
    let (markdown_content, rag_settings, zvec_settings) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();

        let markdown_content: String = conn.query_row(
            "SELECT markdown_content FROM parsed_contents WHERE document_id = ? ORDER BY version DESC LIMIT 1",
            [document_id],
            |row| row.get(0),
        ).map_err(|e| e.to_string())?;

        let rag_settings = crate::zvec::load_rag_settings(conn)?;
        let zvec_settings = crate::zvec::load_zvec_settings(conn, app_dir)?;

        (markdown_content, rag_settings, zvec_settings)
    };

    let embedding_model = provider.embedding_model.clone();

    let chunks = crate::embedder::chunk_text(
        &markdown_content,
        rag_settings.chunk_size,
        rag_settings.chunk_overlap,
    );

    if chunks.is_empty() {
        return Err("No text was available to index".to_string());
    }

    let embedder = crate::embedder::Embedder::new(
        provider.base_url.clone(),
        provider.api_key.clone(),
        embedding_model.clone(),
    );

    let embeddings = embedder.embed(chunks.clone()).await?;
    let vector_dimension = embeddings
        .first()
        .map(|embedding| embedding.len())
        .ok_or_else(|| "Embedding provider returned no vectors".to_string())?;

    let use_zvec = crate::zvec::vector_backend_is_zvec(&rag_settings);
    if use_zvec && !crate::zvec::platform_supported() {
        return Err(
            "ZVEC backend is enabled, but the current platform is not supported by the configured runtime."
                .to_string(),
        );
    }

    let collection_key = if use_zvec {
        Some(crate::zvec::collection_key_for_model(
            &embedding_model,
            vector_dimension,
        ))
    } else {
        None
    };

    let indexed_chunks = chunks
        .into_iter()
        .zip(embeddings.into_iter())
        .enumerate()
        .map(|(idx, (content, embedding))| IndexedChunk {
            id: Uuid::new_v4().to_string(),
            content,
            chunk_index: idx as i32,
            embedding,
        })
        .collect::<Vec<_>>();

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();
    let now = Utc::now().to_rfc3339();

    remove_document_from_vector_store(conn, app_dir, document_id)?;

    conn.execute(
        "DELETE FROM embeddings WHERE chunk_id IN (SELECT id FROM chunks WHERE document_id = ?1)",
        [document_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM chunks WHERE document_id = ?1", [document_id])
        .map_err(|e| e.to_string())?;

    crate::zvec::upsert_document_index_record(
        conn,
        document_id,
        if use_zvec {
            "zvec"
        } else {
            "sqlite"
        },
        collection_key.as_deref(),
        &embedding_model,
        vector_dimension,
        &now,
    )?;

    for indexed_chunk in &indexed_chunks {
        conn.execute(
            "INSERT INTO chunks (id, document_id, content, chunk_index, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            (
                &indexed_chunk.id,
                document_id,
                &indexed_chunk.content,
                indexed_chunk.chunk_index,
                &now,
            ),
        ).map_err(|e| e.to_string())?;

        if !use_zvec {
            let embedding_id = Uuid::new_v4().to_string();
            let embedding_bytes: Vec<u8> = indexed_chunk
                .embedding
                .iter()
                .flat_map(|f| f.to_le_bytes())
                .collect();

            conn.execute(
                "INSERT INTO embeddings (id, chunk_id, vector, model, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                (
                    &embedding_id,
                    &indexed_chunk.id,
                    &embedding_bytes,
                    &embedding_model,
                    &now,
                ),
            ).map_err(|e| e.to_string())?;
        }
    }

    if use_zvec {
        let collection_key = collection_key
            .as_deref()
            .ok_or_else(|| "Missing ZVEC collection key".to_string())?;
        let vectors = indexed_chunks
            .iter()
            .map(|chunk| (chunk.id.as_str(), chunk.embedding.as_slice()))
            .collect::<Vec<_>>();

        if let Err(error) =
            crate::zvec::upsert_embeddings(app_dir, &zvec_settings, collection_key, &vectors)
        {
            remove_document_from_vector_store(conn, app_dir, document_id)?;
            conn.execute("DELETE FROM chunks WHERE document_id = ?1", [document_id])
                .map_err(|e| e.to_string())?;

            return Err(format!("Failed to write embeddings into ZVEC: {error}"));
        }
    }

    conn.execute(
        "UPDATE documents SET index_status = 'completed', updated_at = ? WHERE id = ?",
        (&now, document_id),
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn search_documents(
    app: AppHandle,
    state: State<'_, AppState>,
    query: String,
    provider_id: String,
    limit: Option<i32>,
) -> Result<Vec<SearchResult>, String> {
    let app_dir = crate::app_dirs::runtime_app_dir(&app)?;

    let (provider, rag_settings, zvec_settings) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();

        let provider = conn
            .query_row(
                "SELECT base_url, api_key, embedding_model FROM providers WHERE id = ?",
                [&provider_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .map_err(|e| e.to_string())?;
        let rag_settings = crate::zvec::load_rag_settings(conn)?;
        let zvec_settings = crate::zvec::load_zvec_settings(conn, &app_dir)?;

        (provider, rag_settings, zvec_settings)
    };

    let embedding_model = provider
        .2
        .clone()
        .unwrap_or_else(|| "text-embedding-ada-002".to_string());

    let embedder = crate::embedder::Embedder::new(
        provider.0,
        provider.1,
        embedding_model.clone(),
    );

    let query_embeddings = embedder.embed(vec![query]).await?;
    let query_embedding = &query_embeddings[0];
    let requested_limit = limit.unwrap_or(10).max(1) as usize;

    if crate::zvec::vector_backend_is_zvec(&rag_settings) {
        if !crate::zvec::platform_supported() {
            return Err(
                "ZVEC backend is enabled, but the current platform is not supported by the configured runtime."
                    .to_string(),
            );
        }

        let collection_key =
            crate::zvec::collection_key_for_model(&embedding_model, query_embedding.len());
        let hits = crate::zvec::search_embeddings(
            &app_dir,
            &zvec_settings,
            &collection_key,
            query_embedding,
            requested_limit.saturating_mul(4),
        )?;

        if hits.is_empty() {
            return Ok(Vec::new());
        }

        let hit_ids = hits.iter().map(|hit| hit.id.clone()).collect::<Vec<_>>();

        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();
        let placeholders = (1..=hit_ids.len())
            .map(|idx| format!("?{idx}"))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "SELECT id, document_id, content FROM chunks WHERE id IN ({placeholders})"
        );

        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(hit_ids.iter()), |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        let chunk_map = rows
            .into_iter()
            .map(|(chunk_id, document_id, content)| (chunk_id, (document_id, content)))
            .collect::<HashMap<_, _>>();

        let results = hits
            .into_iter()
            .filter_map(|hit| {
                chunk_map.get(&hit.id).map(|(document_id, content)| SearchResult {
                    chunk_id: hit.id.clone(),
                    document_id: document_id.clone(),
                    content: content.clone(),
                    score: hit.score.unwrap_or(0.0),
                })
            })
            .take(requested_limit)
            .collect::<Vec<_>>();

        return Ok(results);
    }

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    let mut stmt = conn
        .prepare(
            "SELECT c.id, c.document_id, c.content, e.vector FROM chunks c
         JOIN embeddings e ON c.id = e.chunk_id
         ORDER BY c.created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let chunks: Vec<(String, String, String, Vec<u8>)> = stmt
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut results: Vec<SearchResult> = chunks
        .into_iter()
        .map(|(chunk_id, document_id, content, vector_bytes)| {
            let embedding: Vec<f32> = vector_bytes
                .chunks_exact(4)
                .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                .collect();

            let score = cosine_similarity(query_embedding, &embedding);

            SearchResult {
                chunk_id,
                document_id,
                content,
                score,
            }
        })
        .collect();

    results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    results.truncate(requested_limit);

    Ok(results)
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    dot / (norm_a * norm_b)
}

#[derive(Debug, Serialize)]
pub struct SearchResult {
    pub chunk_id: String,
    pub document_id: String,
    pub content: String,
    pub score: f32,
}

#[tauri::command]
pub async fn test_webdav_connection(
    base_url: String,
    username: String,
    password: String,
) -> Result<String, String> {
    let client = crate::webdav::WebDAVClient::new(base_url, username, password);
    match client.test_connection().await {
        Ok(true) => Ok("WebDAV connection successful".to_string()),
        Ok(false) => Err("WebDAV connection failed".to_string()),
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn sync_document(
    _app: AppHandle,
    state: State<'_, AppState>,
    document_id: String,
    base_url: String,
    username: String,
    password: String,
    remote_path: String,
) -> Result<String, String> {
    let file_path = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();

        conn.query_row(
            "SELECT file_path FROM documents WHERE id = ?",
            [&document_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|e| e.to_string())?
    };

    let content = tokio::fs::read(&file_path)
        .await
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let client = crate::webdav::WebDAVClient::new(base_url, username, password);
    client.upload_file(&remote_path, content).await?;

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();
    let now = Utc::now().to_rfc3339();

    conn.execute(
        "UPDATE documents SET sync_status = 'synced', updated_at = ? WHERE id = ?",
        (&now, &document_id),
    )
    .map_err(|e| e.to_string())?;

    Ok("Document synced successfully".to_string())
}

#[tauri::command]
pub async fn export_document(
    state: State<'_, AppState>,
    document_id: String,
    format: String,
    content_type: String,
    output_path: String,
) -> Result<String, String> {
    let content = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();

        match content_type.as_str() {
            "original" => {
                conn.query_row(
                    "SELECT markdown_content FROM parsed_contents WHERE document_id = ? ORDER BY version DESC LIMIT 1",
                    [&document_id],
                    |row| row.get::<_, String>(0),
                ).map_err(|e| e.to_string())?
            }
            "translated" => {
                conn.query_row(
                    "SELECT content FROM translated_contents WHERE document_id = ? ORDER BY version DESC LIMIT 1",
                    [&document_id],
                    |row| row.get::<_, String>(0),
                ).map_err(|e| e.to_string())?
            }
            "bilingual" => {
                let original: String = conn.query_row(
                    "SELECT markdown_content FROM parsed_contents WHERE document_id = ? ORDER BY version DESC LIMIT 1",
                    [&document_id],
                    |row| row.get(0),
                ).map_err(|e| e.to_string())?;

                let translated: String = conn.query_row(
                    "SELECT content FROM translated_contents WHERE document_id = ? ORDER BY version DESC LIMIT 1",
                    [&document_id],
                    |row| row.get(0),
                ).map_err(|e| e.to_string())?;

                format!("# Original\n\n{}\n\n# Translation\n\n{}", original, translated)
            }
            _ => return Err("Invalid content type".to_string()),
        }
    };

    tokio::fs::write(&output_path, content.as_bytes())
        .await
        .map_err(|e| format!("Failed to write file: {}", e))?;

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();
    let now = Utc::now().to_rfc3339();
    let export_id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO export_records (id, document_id, format, content_type, file_path, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        (&export_id, &document_id, &format, &content_type, &output_path, &now),
    ).map_err(|e| e.to_string())?;

    Ok(output_path)
}

// --- Tag-Document Operations ---

#[tauri::command]
pub fn add_document_tags(
    state: State<AppState>,
    document_id: String,
    tag_ids: Vec<String>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();
    let now = Utc::now().to_rfc3339();

    for tag_id in &tag_ids {
        conn.execute(
            "INSERT OR IGNORE INTO document_tags (document_id, tag_id, created_at) VALUES (?1, ?2, ?3)",
            (&document_id, tag_id, &now),
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn remove_document_tag(
    state: State<AppState>,
    document_id: String,
    tag_id: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    conn.execute(
        "DELETE FROM document_tags WHERE document_id = ?1 AND tag_id = ?2",
        (&document_id, &tag_id),
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn get_document_tags(state: State<AppState>, document_id: String) -> Result<Vec<Tag>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    let mut stmt = conn
        .prepare(
            "SELECT t.id, t.name, t.color, t.created_at FROM tags t
             JOIN document_tags dt ON t.id = dt.tag_id
             WHERE dt.document_id = ?1 ORDER BY t.name",
        )
        .map_err(|e| e.to_string())?;

    let tags = stmt
        .query_map([&document_id], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(tags)
}

// --- Category CRUD ---

#[tauri::command]
pub fn update_category(
    state: State<AppState>,
    id: String,
    name: Option<String>,
    description: Option<String>,
    parent_id: Option<String>,
) -> Result<Category, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();
    let now = Utc::now().to_rfc3339();

    let mut updates = vec![];
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![];

    if let Some(n) = name {
        updates.push("name = ?");
        params.push(Box::new(n));
    }
    if let Some(d) = description {
        updates.push("description = ?");
        params.push(Box::new(d));
    }
    if let Some(p) = parent_id {
        updates.push("parent_id = ?");
        params.push(Box::new(if p.is_empty() {
            None::<String>
        } else {
            Some(p)
        }));
    }

    if updates.is_empty() {
        return conn
            .query_row("SELECT * FROM categories WHERE id = ?1", [&id], |row| {
                Ok(Category {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    parent_id: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string());
    }

    updates.push("updated_at = ?");
    params.push(Box::new(now));
    params.push(Box::new(id.clone()));

    let sql = format!("UPDATE categories SET {} WHERE id = ?", updates.join(", "));
    let params_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    conn.execute(&sql, params_refs.as_slice())
        .map_err(|e| e.to_string())?;

    conn.query_row("SELECT * FROM categories WHERE id = ?1", [&id], |row| {
        Ok(Category {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            parent_id: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        })
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_category(state: State<AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    conn.execute("DELETE FROM categories WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    Ok(())
}

// --- Tag CRUD ---

#[tauri::command]
pub fn update_tag(
    state: State<AppState>,
    id: String,
    name: Option<String>,
    color: Option<String>,
) -> Result<Tag, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    let mut updates = vec![];
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![];

    if let Some(n) = name {
        updates.push("name = ?");
        params.push(Box::new(n));
    }
    if let Some(c) = color {
        updates.push("color = ?");
        params.push(Box::new(c));
    }

    if updates.is_empty() {
        return conn
            .query_row("SELECT * FROM tags WHERE id = ?1", [&id], |row| {
                Ok(Tag {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                    created_at: row.get(3)?,
                })
            })
            .map_err(|e| e.to_string());
    }

    params.push(Box::new(id.clone()));

    let sql = format!("UPDATE tags SET {} WHERE id = ?", updates.join(", "));
    let params_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    conn.execute(&sql, params_refs.as_slice())
        .map_err(|e| e.to_string())?;

    conn.query_row("SELECT * FROM tags WHERE id = ?1", [&id], |row| {
        Ok(Tag {
            id: row.get(0)?,
            name: row.get(1)?,
            color: row.get(2)?,
            created_at: row.get(3)?,
        })
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_tag(state: State<AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    conn.execute("DELETE FROM tags WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    Ok(())
}

// --- Multi-format Import ---

#[tauri::command]
pub async fn import_document(
    app: AppHandle,
    state: State<'_, AppState>,
    file_path: String,
    file_type: String,
) -> Result<Document, String> {
    let app_dir = crate::app_dirs::runtime_app_dir(&app)?;
    let file_handler = FileHandler::new(&app_dir)?;
    let normalized_file_type = file_type.to_ascii_lowercase();

    let source_path = Path::new(&file_path);
    let dest_path = if normalized_file_type == "pdf" {
        file_handler.import_pdf(source_path)?
    } else {
        file_handler.import_document(source_path)?
    };
    let file_size = FileHandler::get_file_size(&dest_path)?;

    let filename = source_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid filename")?;

    let _extension = source_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    let title = filename
        .rsplit_once('.')
        .map(|(name, _)| name)
        .unwrap_or(filename);

    let id = Uuid::new_v4().to_string();

    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();
        let now = Utc::now().to_rfc3339();

        // For text-based formats, set parse_status to completed immediately
        let parse_status = match normalized_file_type.as_str() {
            "md" | "txt" => "completed",
            _ => "pending",
        };

        conn.execute(
            "INSERT INTO documents (id, title, filename, file_path, file_size, parse_status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            (&id, title, filename, dest_path.to_str().ok_or("File path contains invalid characters")?, &(file_size as i64), parse_status, &now, &now),
        )
        .map_err(|e| e.to_string())?;

        // For text-based formats, read content and insert parsed_contents directly
        if normalized_file_type == "md" || normalized_file_type == "txt" {
            let content = FileHandler::read_text_file(source_path)?;
            let content_id = Uuid::new_v4().to_string();

            conn.execute(
                "INSERT INTO parsed_contents (id, document_id, version, markdown_content, json_content, created_at) VALUES (?1, ?2, 1, ?3, '{}', ?4)",
                (&content_id, &id, &content, &now),
            )
            .map_err(|e| e.to_string())?;
        }
    }

    if normalized_file_type == "pdf" {
        if let Err(e) = enqueue_parse_job(state.inner(), &id, true) {
            log::error!("Failed to auto-start parse job for document {}: {}", id, e);
        }
    }

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    conn.query_row("SELECT * FROM documents WHERE id = ?1", [&id], |row| {
        Ok(Document {
            id: row.get(0)?,
            title: row.get(1)?,
            filename: row.get(2)?,
            file_path: row.get(3)?,
            file_size: row.get(4)?,
            page_count: row.get(5)?,
            source_language: row.get(6)?,
            target_language: row.get(7)?,
            category_id: row.get(8)?,
            created_at: row.get(9)?,
            updated_at: row.get(10)?,
            deleted_at: row.get(11)?,
            parse_status: row.get(12)?,
            translation_status: row.get(13)?,
            index_status: row.get(14)?,
            sync_status: row.get(15)?,
        })
    })
    .map_err(|e| e.to_string())
}

// --- Get Document File Path ---

#[tauri::command]
pub fn get_document_file_path(state: State<AppState>, id: String) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    conn.query_row(
        "SELECT file_path FROM documents WHERE id = ?1 AND deleted_at IS NULL",
        [&id],
        |row| row.get::<_, String>(0),
    )
    .map_err(|e| e.to_string())
}

// --- Get Document Chunks ---

#[tauri::command]
pub fn get_document_chunks(
    state: State<AppState>,
    document_id: String,
) -> Result<Vec<Chunk>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    let mut stmt = conn
        .prepare(
            "SELECT id, document_id, content, translated_content, chunk_index, page_number, section_title, metadata, created_at
             FROM chunks WHERE document_id = ?1 ORDER BY chunk_index",
        )
        .map_err(|e| e.to_string())?;

    let chunks = stmt
        .query_map([&document_id], |row| {
            Ok(Chunk {
                id: row.get(0)?,
                document_id: row.get(1)?,
                content: row.get(2)?,
                translated_content: row.get(3)?,
                chunk_index: row.get(4)?,
                page_number: row.get(5)?,
                section_title: row.get(6)?,
                metadata: row.get(7)?,
                created_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(chunks)
}
