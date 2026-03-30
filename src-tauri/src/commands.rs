use crate::file_handler::FileHandler;
use crate::models::*;
use crate::AppState;
use chrono::Utc;
use rusqlite::OptionalExtension;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};
use uuid::Uuid;

const TASK_CANCELLED_BY_USER: &str = "Cancelled by user";
const TASK_REMOVED_BY_USER: &str = "Removed by user";
const TASK_CANCELLED_BECAUSE_DOCUMENT_WAS_DELETED: &str =
    "Cancelled because the document was deleted";
const DOCUMENT_SELECT_FIELDS: &str = "d.id, d.title, d.filename, d.file_path, d.file_size, d.page_count, d.source_language, d.target_language, d.category_id, df.folder_id, d.created_at, d.updated_at, d.deleted_at, d.parse_status, d.translation_status, d.index_status, d.sync_status, c.name, f.name";
const PROVIDER_MODEL_TYPE_CHAT: &str = "chat";
const PROVIDER_MODEL_TYPE_TRANSLATE: &str = "translate";
const PROVIDER_MODEL_TYPE_EMBED: &str = "embed";
const PROVIDER_MODEL_TYPE_RERANK: &str = "rerank";

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
    pub dimensions: Option<usize>,
}

#[derive(Debug, Clone)]
struct ProviderRecord {
    id: String,
    name: String,
    base_url: String,
    api_key: String,
    max_retries: i32,
    priority: i32,
    headers: Option<String>,
    organization: Option<String>,
    timeout: Option<i32>,
    concurrency: i32,
    is_active: bool,
    created_at: String,
    updated_at: String,
    legacy_temperature: Option<f64>,
    legacy_max_tokens: Option<i32>,
}

fn provider_select_sql() -> &'static str {
    "SELECT
        id,
        name,
        base_url,
        api_key,
        COALESCE(max_retries, 3) AS max_retries,
        COALESCE(priority, 0) AS priority,
        headers,
        organization,
        timeout,
        COALESCE(concurrency, 3) AS concurrency,
        is_active,
        created_at,
        updated_at,
        temperature,
        max_tokens
     FROM providers"
}

fn normalize_provider_model_type(value: &str) -> Option<&'static str> {
    match value.trim().to_lowercase().as_str() {
        "chat" => Some(PROVIDER_MODEL_TYPE_CHAT),
        "translate" => Some(PROVIDER_MODEL_TYPE_TRANSLATE),
        "embed" | "embedding" => Some(PROVIDER_MODEL_TYPE_EMBED),
        "rerank" | "reranker" => Some(PROVIDER_MODEL_TYPE_RERANK),
        _ => None,
    }
}

fn parse_optional_f64(value: Option<String>) -> Option<f64> {
    value
        .map(|raw| raw.trim().to_string())
        .filter(|raw| !raw.is_empty())
        .and_then(|raw| raw.parse::<f64>().ok())
}

fn parse_optional_i32(value: Option<String>) -> Option<i32> {
    value
        .map(|raw| raw.trim().to_string())
        .filter(|raw| !raw.is_empty())
        .and_then(|raw| raw.parse::<i32>().ok())
}

fn get_setting_value(conn: &rusqlite::Connection, key: &str) -> Result<Option<String>, String> {
    conn.query_row("SELECT value FROM app_settings WHERE key = ?1", [key], |row| {
        row.get::<_, String>(0)
    })
    .optional()
    .map_err(|e| e.to_string())
}

pub(crate) fn load_llm_sampling_config(
    conn: &rusqlite::Connection,
    scope: &str,
) -> Result<LlmSamplingConfig, String> {
    Ok(LlmSamplingConfig {
        temperature: parse_optional_f64(get_setting_value(conn, &format!("llm.{scope}.temperature"))?),
        top_p: parse_optional_f64(get_setting_value(conn, &format!("llm.{scope}.top_p"))?),
        top_k: parse_optional_i32(get_setting_value(conn, &format!("llm.{scope}.top_k"))?),
        max_tokens: parse_optional_i32(get_setting_value(conn, &format!("llm.{scope}.max_tokens"))?),
    })
}

fn serialize_provider_model_config(config: Option<&ProviderModelConfig>) -> Result<Option<String>, String> {
    let Some(config) = config else {
        return Ok(None);
    };

    if config.dimensions.is_none() && config.rerank_top_n.is_none() {
        return Ok(None);
    }

    serde_json::to_string(config)
        .map(Some)
        .map_err(|e| e.to_string())
}

fn parse_provider_model_config(raw: Option<String>) -> Result<Option<ProviderModelConfig>, String> {
    let Some(raw) = raw else {
        return Ok(None);
    };

    if raw.trim().is_empty() {
        return Ok(None);
    }

    serde_json::from_str::<ProviderModelConfig>(&raw)
        .map(Some)
        .map_err(|e| format!("Invalid provider model config: {e}"))
}

fn load_provider_models_map(
    conn: &rusqlite::Connection,
    provider_ids: &[String],
) -> Result<HashMap<String, Vec<ProviderModel>>, String> {
    let mut model_map: HashMap<String, Vec<ProviderModel>> = HashMap::new();

    if provider_ids.is_empty() {
        return Ok(model_map);
    }

    let placeholders = (1..=provider_ids.len())
        .map(|idx| format!("?{idx}"))
        .collect::<Vec<_>>()
        .join(", ");

    let sql = format!(
        "SELECT
            id,
            provider_id,
            name,
            model_type,
            model_name,
            supports_vision,
            is_active,
            priority,
            config,
            created_at,
            updated_at
         FROM provider_models
         WHERE provider_id IN ({placeholders})
         ORDER BY provider_id, priority ASC, created_at ASC"
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(provider_ids.iter()), |row| {
            let raw_config: Option<String> = row.get(8)?;
            let config = parse_provider_model_config(raw_config)
                .map_err(|error| rusqlite::Error::FromSqlConversionFailure(
                    8,
                    rusqlite::types::Type::Text,
                    Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
                ))?;

            Ok(ProviderModel {
                id: row.get(0)?,
                provider_id: row.get(1)?,
                name: row.get(2)?,
                model_type: row.get(3)?,
                model_name: row.get(4)?,
                supports_vision: row.get::<_, i32>(5)? != 0,
                is_active: row.get::<_, i32>(6)? != 0,
                priority: row.get(7)?,
                config,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    for model in rows {
        model_map
            .entry(model.provider_id.clone())
            .or_default()
            .push(model);
    }

    Ok(model_map)
}

fn primary_model_name_for_type(models: &[ProviderModel], model_type: &str) -> Option<String> {
    models
        .iter()
        .filter(|model| model.is_active && model.model_type == model_type)
        .min_by_key(|model| (model.priority, model.created_at.clone()))
        .map(|model| model.model_name.clone())
}

fn build_provider(record: ProviderRecord, models: Vec<ProviderModel>) -> Provider {
    Provider {
        id: record.id,
        name: record.name,
        base_url: record.base_url,
        api_key: record.api_key,
        max_retries: record.max_retries,
        priority: record.priority,
        models: models.clone(),
        chat_model: primary_model_name_for_type(&models, PROVIDER_MODEL_TYPE_CHAT),
        translate_model: primary_model_name_for_type(&models, PROVIDER_MODEL_TYPE_TRANSLATE),
        embedding_model: primary_model_name_for_type(&models, PROVIDER_MODEL_TYPE_EMBED),
        rerank_model: primary_model_name_for_type(&models, PROVIDER_MODEL_TYPE_RERANK),
        headers: record.headers,
        organization: record.organization,
        timeout: record.timeout,
        concurrency: record.concurrency,
        is_active: record.is_active,
        created_at: record.created_at,
        updated_at: record.updated_at,
    }
}

fn load_provider_records(conn: &rusqlite::Connection) -> Result<Vec<ProviderRecord>, String> {
    let sql = format!("{} ORDER BY priority ASC, created_at ASC, name ASC", provider_select_sql());
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
        Ok(ProviderRecord {
            id: row.get(0)?,
            name: row.get(1)?,
            base_url: row.get(2)?,
            api_key: row.get(3)?,
            max_retries: row.get(4)?,
            priority: row.get(5)?,
            headers: row.get(6)?,
            organization: row.get(7)?,
            timeout: row.get(8)?,
            concurrency: row.get(9)?,
            is_active: row.get::<_, i32>(10)? != 0,
            created_at: row.get(11)?,
            updated_at: row.get(12)?,
            legacy_temperature: row.get(13)?,
            legacy_max_tokens: row.get(14)?,
        })
    })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn load_provider_record_by_id(
    conn: &rusqlite::Connection,
    provider_id: &str,
) -> Result<ProviderRecord, String> {
    let sql = format!("{} WHERE id = ?1", provider_select_sql());
    conn.query_row(&sql, [provider_id], |row| {
        Ok(ProviderRecord {
            id: row.get(0)?,
            name: row.get(1)?,
            base_url: row.get(2)?,
            api_key: row.get(3)?,
            max_retries: row.get(4)?,
            priority: row.get(5)?,
            headers: row.get(6)?,
            organization: row.get(7)?,
            timeout: row.get(8)?,
            concurrency: row.get(9)?,
            is_active: row.get::<_, i32>(10)? != 0,
            created_at: row.get(11)?,
            updated_at: row.get(12)?,
            legacy_temperature: row.get(13)?,
            legacy_max_tokens: row.get(14)?,
        })
    })
    .map_err(|e| e.to_string())
}

fn load_provider_models_for_provider(
    conn: &rusqlite::Connection,
    provider_id: &str,
) -> Result<Vec<ProviderModel>, String> {
    let mut model_map = load_provider_models_map(conn, &[provider_id.to_string()])?;
    Ok(model_map.remove(provider_id).unwrap_or_default())
}

fn find_primary_model_for_type(
    models: &[ProviderModel],
    model_type: &str,
) -> Option<ProviderModel> {
    models
        .iter()
        .filter(|model| model.is_active && model.model_type == model_type)
        .min_by_key(|model| (model.priority, model.created_at.clone()))
        .cloned()
}

fn sync_provider_models(
    conn: &rusqlite::Connection,
    provider_id: &str,
    models: &[ProviderModelInput],
    now: &str,
) -> Result<(), String> {
    let existing_ids = {
        let mut stmt = conn
            .prepare("SELECT id FROM provider_models WHERE provider_id = ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([provider_id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    let mut kept_ids = Vec::with_capacity(models.len());

    for (index, model) in models.iter().enumerate() {
        let model_name = model.model_name.trim();
        let display_name = model.name.trim();
        let Some(model_type) = normalize_provider_model_type(&model.model_type) else {
            return Err(format!("Unsupported model type: {}", model.model_type));
        };

        if display_name.is_empty() {
            return Err("Model name is required".to_string());
        }
        if model_name.is_empty() {
            return Err("Model identifier is required".to_string());
        }

        let model_id = model
            .id
            .clone()
            .filter(|id| existing_ids.iter().any(|existing| existing == id))
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        kept_ids.push(model_id.clone());

        let config_json = serialize_provider_model_config(model.config.as_ref())?;
        let priority = model.priority.unwrap_or(index as i32);

        conn.execute(
            "INSERT INTO provider_models (
                id,
                provider_id,
                name,
                model_type,
                model_name,
                supports_vision,
                is_active,
                priority,
                config,
                created_at,
                updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
             ON CONFLICT(id) DO UPDATE SET
                provider_id = excluded.provider_id,
                name = excluded.name,
                model_type = excluded.model_type,
                model_name = excluded.model_name,
                supports_vision = excluded.supports_vision,
                is_active = excluded.is_active,
                priority = excluded.priority,
                config = excluded.config,
                updated_at = excluded.updated_at",
            (
                &model_id,
                provider_id,
                display_name,
                model_type,
                model_name,
                if model.supports_vision.unwrap_or(false) { 1 } else { 0 },
                if model.is_active.unwrap_or(true) { 1 } else { 0 },
                priority,
                config_json,
                now,
            ),
        )
        .map_err(|e| e.to_string())?;
    }

    for existing_id in existing_ids {
        if !kept_ids.iter().any(|id| id == &existing_id) {
            conn.execute("DELETE FROM provider_models WHERE id = ?1", [&existing_id])
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

fn openai_compatible_url(base_url: &str, path: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/v1") {
        format!("{trimmed}/{path}")
    } else {
        format!("{trimmed}/v1/{path}")
    }
}

#[derive(Debug, Clone)]
struct ManagedFileTarget {
    resource_type: String,
    path: String,
}

#[derive(Debug, Clone)]
struct DocumentDeletionPlan {
    document: Document,
    parse_job_ids: Vec<String>,
    translation_job_ids: Vec<String>,
    managed_files: Vec<ManagedFileTarget>,
}

fn map_document_row(row: &rusqlite::Row<'_>) -> Result<Document, rusqlite::Error> {
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
        folder_id: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        deleted_at: row.get(12)?,
        parse_status: row.get(13)?,
        translation_status: row.get(14)?,
        index_status: row.get(15)?,
        sync_status: row.get(16)?,
        category_name: row.get(17)?,
        folder_name: row.get(18)?,
        tags: None,
        is_file_missing: None,
    })
}

fn path_is_within(base_dir: &Path, candidate: &Path) -> bool {
    candidate.is_absolute() && candidate.starts_with(base_dir)
}

fn load_document_tags_map(
    conn: &rusqlite::Connection,
    document_ids: &[String],
) -> Result<HashMap<String, Vec<Tag>>, String> {
    if document_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let placeholders = (1..=document_ids.len())
        .map(|idx| format!("?{idx}"))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "SELECT dt.document_id, t.id, t.name, t.color, t.created_at
         FROM document_tags dt
         JOIN tags t ON t.id = dt.tag_id
         WHERE dt.document_id IN ({placeholders})
         ORDER BY t.name"
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(document_ids.iter()), |row| {
            Ok((
                row.get::<_, String>(0)?,
                Tag {
                    id: row.get(1)?,
                    name: row.get(2)?,
                    color: row.get(3)?,
                    created_at: row.get(4)?,
                },
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut tag_map: HashMap<String, Vec<Tag>> = HashMap::new();
    for (document_id, tag) in rows {
        tag_map.entry(document_id).or_default().push(tag);
    }

    Ok(tag_map)
}

fn enrich_documents(
    conn: &rusqlite::Connection,
    documents: &mut [Document],
) -> Result<(), String> {
    let ids = documents
        .iter()
        .map(|document| document.id.clone())
        .collect::<Vec<_>>();
    let mut tag_map = load_document_tags_map(conn, &ids)?;

    for document in documents.iter_mut() {
        document.tags = tag_map.remove(&document.id);
        document.is_file_missing = Some(!Path::new(&document.file_path).exists());
    }

    Ok(())
}

fn load_documents_with_scope(
    conn: &rusqlite::Connection,
    include_deleted: bool,
) -> Result<Vec<Document>, String> {
    let where_sql = if include_deleted {
        ""
    } else {
        "WHERE d.deleted_at IS NULL"
    };
    let sql = format!(
        "SELECT {DOCUMENT_SELECT_FIELDS}
         FROM documents d
         LEFT JOIN document_folders df ON df.document_id = d.id
         LEFT JOIN categories c ON c.id = d.category_id
         LEFT JOIN folders f ON f.id = df.folder_id
         {where_sql}
         ORDER BY d.updated_at DESC, d.created_at DESC"
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut documents = stmt
        .query_map([], map_document_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    enrich_documents(conn, &mut documents)?;
    Ok(documents)
}

fn load_document_by_id_internal(
    conn: &rusqlite::Connection,
    id: &str,
    include_deleted: bool,
) -> Result<Document, String> {
    let deleted_clause = if include_deleted {
        String::new()
    } else {
        "AND d.deleted_at IS NULL".to_string()
    };
    let sql = format!(
        "SELECT {DOCUMENT_SELECT_FIELDS}
         FROM documents d
         LEFT JOIN document_folders df ON df.document_id = d.id
         LEFT JOIN categories c ON c.id = d.category_id
         LEFT JOIN folders f ON f.id = df.folder_id
         WHERE d.id = ?1 {deleted_clause}"
    );

    let mut document = conn
        .query_row(&sql, [id], map_document_row)
        .map_err(|e| e.to_string())?;

    let mut single = vec![document];
    enrich_documents(conn, &mut single)?;
    document = single
        .into_iter()
        .next()
        .ok_or_else(|| "Document not found".to_string())?;

    Ok(document)
}

fn map_document_output_row(row: &rusqlite::Row<'_>) -> Result<DocumentOutput, rusqlite::Error> {
    Ok(DocumentOutput {
        id: row.get(0)?,
        document_id: row.get(1)?,
        output_type: row.get(2)?,
        file_path: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
        is_file_missing: None,
    })
}

fn load_document_outputs_internal(
    conn: &rusqlite::Connection,
    document_id: &str,
) -> Result<Vec<DocumentOutput>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, document_id, output_type, file_path, created_at, updated_at
             FROM document_outputs
             WHERE document_id = ?1
             ORDER BY output_type",
        )
        .map_err(|e| e.to_string())?;

    let mut outputs = stmt
        .query_map([document_id], map_document_output_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    for output in outputs.iter_mut() {
        output.is_file_missing = Some(!Path::new(&output.file_path).exists());
    }

    Ok(outputs)
}

fn next_content_version(
    conn: &rusqlite::Connection,
    table_name: &str,
    document_id: &str,
) -> Result<i32, String> {
    let sql = format!(
        "SELECT COALESCE(MAX(version), 0) + 1 FROM {table_name} WHERE document_id = ?1"
    );
    conn.query_row(&sql, [document_id], |row| row.get::<_, i32>(0))
        .map_err(|e| e.to_string())
}

fn delete_document_output_record_and_file(
    conn: &rusqlite::Connection,
    output_type: &str,
    document_id: &str,
) -> Result<(), String> {
    let existing = conn
        .query_row(
            "SELECT file_path FROM document_outputs WHERE document_id = ?1 AND output_type = ?2",
            (document_id, output_type),
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if let Some(file_path) = existing {
        if Path::new(&file_path).exists() {
            let _ = std::fs::remove_file(&file_path);
        }
        conn.execute(
            "DELETE FROM document_outputs WHERE document_id = ?1 AND output_type = ?2",
            (document_id, output_type),
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn clear_document_derived_data(
    conn: &rusqlite::Connection,
    app_dir: Option<&Path>,
    document_id: &str,
    remove_parsed_content: bool,
    now: &str,
) -> Result<(), String> {
    if let Some(app_dir) = app_dir {
        remove_document_from_vector_store(conn, app_dir, document_id)?;
    } else {
        conn.execute(
            "DELETE FROM document_vector_indexes WHERE document_id = ?1",
            [document_id],
        )
        .map_err(|e| e.to_string())?;
    }

    conn.execute(
        "DELETE FROM embeddings WHERE chunk_id IN (SELECT id FROM chunks WHERE document_id = ?1)",
        [document_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM chunks WHERE document_id = ?1", [document_id])
        .map_err(|e| e.to_string())?;

    if remove_parsed_content {
        conn.execute("DELETE FROM parsed_contents WHERE document_id = ?1", [document_id])
            .map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE documents
             SET parse_status = 'pending', translation_status = 'pending', index_status = 'pending', updated_at = ?1
             WHERE id = ?2",
            (now, document_id),
        )
        .map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "UPDATE documents
             SET translation_status = 'pending', index_status = 'pending', updated_at = ?1
             WHERE id = ?2",
            (now, document_id),
        )
        .map_err(|e| e.to_string())?;
    }

    conn.execute(
        "DELETE FROM translated_contents WHERE document_id = ?1",
        [document_id],
    )
    .map_err(|e| e.to_string())?;
    delete_document_output_record_and_file(conn, "translated_pdf", document_id)?;

    Ok(())
}

fn collect_document_deletion_plan(
    conn: &rusqlite::Connection,
    app_dir: &Path,
    id: &str,
) -> Result<DocumentDeletionPlan, String> {
    let document = load_document_by_id_internal(conn, id, true)?;

    let mut parse_stmt = conn
        .prepare(
            "SELECT id FROM parse_jobs WHERE document_id = ?1 AND status IN ('pending', 'parsing')",
        )
        .map_err(|e| e.to_string())?;
    let parse_job_ids = parse_stmt
        .query_map([id], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut translation_stmt = conn
        .prepare(
            "SELECT id FROM translation_jobs WHERE document_id = ?1 AND status IN ('pending', 'translating')",
        )
        .map_err(|e| e.to_string())?;
    let translation_job_ids = translation_stmt
        .query_map([id], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut managed_files = vec![ManagedFileTarget {
        resource_type: "original_file".to_string(),
        path: document.file_path.clone(),
    }];

    let mut export_stmt = conn
        .prepare("SELECT file_path FROM export_records WHERE document_id = ?1")
        .map_err(|e| e.to_string())?;
    let export_paths = export_stmt
        .query_map([id], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    for export_path in export_paths {
        let path = Path::new(&export_path);
        if path_is_within(app_dir, path) {
            managed_files.push(ManagedFileTarget {
                resource_type: "export_cache".to_string(),
                path: export_path,
            });
        }
    }

    let mut output_stmt = conn
        .prepare("SELECT output_type, file_path FROM document_outputs WHERE document_id = ?1")
        .map_err(|e| e.to_string())?;
    let output_paths = output_stmt
        .query_map([id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    for (output_type, output_path) in output_paths {
        let path = Path::new(&output_path);
        if path_is_within(app_dir, path) {
            managed_files.push(ManagedFileTarget {
                resource_type: format!("output_{output_type}"),
                path: output_path,
            });
        }
    }

    Ok(DocumentDeletionPlan {
        document,
        parse_job_ids,
        translation_job_ids,
        managed_files,
    })
}

fn cancel_document_workflows(
    state: &AppState,
    app_dir: &Path,
    document_id: &str,
) -> Result<(), String> {
    let plan = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();
        collect_document_deletion_plan(conn, app_dir, document_id)?
    };

    for job_id in plan.parse_job_ids.iter() {
        let _ = cancel_parse_job_internal(state, job_id, TASK_CANCELLED_BY_USER)?;
    }
    for job_id in plan.translation_job_ids.iter() {
        let _ = cancel_translation_job_internal(state, job_id, TASK_CANCELLED_BY_USER)?;
    }
    if plan.document.index_status == "indexing" {
        let _ = cancel_index_job_internal(state, app_dir, document_id)?;
    }

    Ok(())
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

    let chunk_ids = crate::zvec::load_document_chunk_ids(conn, document_id)?;

    // Clean vec0 table before index record is deleted
    if let Some(dim) = record.vector_dimension {
        if !chunk_ids.is_empty() {
            let _ = crate::zvec::vec0_delete_by_chunk_ids(conn, dim, &chunk_ids);
        }
    }

    if record.backend.eq_ignore_ascii_case("zvec") {
        if let Some(collection_key) = record.collection_key.as_deref() {
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
        "DELETE FROM document_folders WHERE document_id = ?1",
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
        "UPDATE documents
         SET index_status = 'failed', updated_at = ?1
         WHERE id = ?2 AND deleted_at IS NULL",
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

    load_documents_with_scope(conn, false)
}

#[tauri::command]
pub fn get_library_documents(state: State<AppState>) -> Result<Vec<Document>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    load_documents_with_scope(conn, true)
}

#[tauri::command]
pub fn get_document_by_id(state: State<AppState>, id: String) -> Result<Document, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    load_document_by_id_internal(conn, &id, false)
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
            if c.is_empty() {
                updates.push("category_id = NULL");
            } else {
                updates.push("category_id = ?");
                params.push(Box::new(c));
            }
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
    let report = move_documents_to_trash_internal(&app, state.inner(), &[id])?;
    if report.failed > 0 {
        let reason = report
            .failures
            .first()
            .map(|failure| failure.reason.clone())
            .unwrap_or_else(|| "Failed to move document to trash".to_string());
        return Err(reason);
    }

    Ok(())
}

fn unique_document_ids(document_ids: &[String]) -> Vec<String> {
    let mut seen = HashMap::new();
    let mut unique_ids = Vec::new();

    for document_id in document_ids {
        if seen.insert(document_id.clone(), true).is_none() {
            unique_ids.push(document_id.clone());
        }
    }

    unique_ids
}

fn move_documents_to_trash_internal(
    app: &AppHandle,
    state: &AppState,
    document_ids: &[String],
) -> Result<BatchActionReport, String> {
    let app_dir = crate::app_dirs::runtime_app_dir(app)?;
    let unique_ids = unique_document_ids(document_ids);
    let mut failures = Vec::new();
    let mut succeeded = 0usize;

    for document_id in unique_ids.iter() {
        let plan = {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            let conn = db.get_connection();
            collect_document_deletion_plan(conn, &app_dir, document_id)
        };

        let plan = match plan {
            Ok(plan) => plan,
            Err(error) => {
                failures.push(BatchActionFailure {
                    document_id: document_id.clone(),
                    reason: error,
                });
                continue;
            }
        };

        if plan.document.deleted_at.is_some() {
            failures.push(BatchActionFailure {
                document_id: document_id.clone(),
                reason: "Document is already in trash".to_string(),
            });
            continue;
        }

        let mut failed_reason = None;

        for job_id in &plan.parse_job_ids {
            if let Err(error) = cancel_parse_job_internal(
                state,
                job_id,
                TASK_CANCELLED_BECAUSE_DOCUMENT_WAS_DELETED,
            ) {
                failed_reason = Some(error);
                break;
            }
        }

        if failed_reason.is_none() {
            for job_id in &plan.translation_job_ids {
                if let Err(error) = cancel_translation_job_internal(
                    state,
                    job_id,
                    TASK_CANCELLED_BECAUSE_DOCUMENT_WAS_DELETED,
                ) {
                    failed_reason = Some(error);
                    break;
                }
            }
        }

        if failed_reason.is_none() {
            if let Err(error) = cancel_index_job_internal(state, &app_dir, document_id) {
                failed_reason = Some(error);
            }
        }

        if let Some(reason) = failed_reason {
            failures.push(BatchActionFailure {
                document_id: document_id.clone(),
                reason,
            });
            continue;
        }

        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();
        let now = Utc::now().to_rfc3339();
        let updated = conn
            .execute(
                "UPDATE documents
                 SET deleted_at = ?1, updated_at = ?1
                 WHERE id = ?2 AND deleted_at IS NULL",
                (&now, document_id),
            )
            .map_err(|e| e.to_string())?;

        if updated == 0 {
            failures.push(BatchActionFailure {
                document_id: document_id.clone(),
                reason: "Document could not be moved to trash".to_string(),
            });
            continue;
        }

        succeeded += 1;
    }

    Ok(BatchActionReport {
        requested: unique_ids.len(),
        succeeded,
        failed: failures.len(),
        failures,
    })
}

fn restore_documents_internal(
    state: &AppState,
    document_ids: &[String],
) -> Result<BatchActionReport, String> {
    let unique_ids = unique_document_ids(document_ids);
    let mut failures = Vec::new();
    let mut succeeded = 0usize;

    for document_id in unique_ids.iter() {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();
        let now = Utc::now().to_rfc3339();
        let updated = conn
            .execute(
                "UPDATE documents
                 SET deleted_at = NULL, updated_at = ?1
                 WHERE id = ?2 AND deleted_at IS NOT NULL",
                (&now, document_id),
            )
            .map_err(|e| e.to_string())?;

        if updated == 0 {
            failures.push(BatchActionFailure {
                document_id: document_id.clone(),
                reason: "Document is not in trash".to_string(),
            });
            continue;
        }

        succeeded += 1;
    }

    Ok(BatchActionReport {
        requested: unique_ids.len(),
        succeeded,
        failed: failures.len(),
        failures,
    })
}

fn apply_folder_assignment(
    conn: &rusqlite::Connection,
    document_id: &str,
    folder_id: &str,
    now: &str,
) -> Result<(), String> {
    if folder_id.is_empty() {
        conn.execute(
            "DELETE FROM document_folders WHERE document_id = ?1",
            [document_id],
        )
        .map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "INSERT INTO document_folders (document_id, folder_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?3)
             ON CONFLICT(document_id) DO UPDATE SET
                 folder_id = excluded.folder_id,
                 updated_at = excluded.updated_at",
            (document_id, folder_id, now),
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn batch_update_documents_internal(
    state: &AppState,
    document_ids: &[String],
    category_id: Option<String>,
    folder_id: Option<String>,
) -> Result<BatchActionReport, String> {
    if category_id.is_none() && folder_id.is_none() {
        return Ok(BatchActionReport {
            requested: 0,
            succeeded: 0,
            failed: 0,
            failures: Vec::new(),
        });
    }

    let unique_ids = unique_document_ids(document_ids);
    let mut failures = Vec::new();
    let mut succeeded = 0usize;

    for document_id in unique_ids.iter() {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();
        let now = Utc::now().to_rfc3339();

        let exists = conn
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM documents WHERE id = ?1 AND deleted_at IS NULL
                )",
                [document_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|e| e.to_string())?
            != 0;

        if !exists {
            failures.push(BatchActionFailure {
                document_id: document_id.clone(),
                reason: "Document is not available for editing".to_string(),
            });
            continue;
        }

        if let Some(category_id) = category_id.as_ref() {
            if category_id.is_empty() {
                conn.execute(
                    "UPDATE documents SET category_id = NULL, updated_at = ?1 WHERE id = ?2",
                    (&now, document_id),
                )
                .map_err(|e| e.to_string())?;
            } else {
                conn.execute(
                    "UPDATE documents SET category_id = ?1, updated_at = ?2 WHERE id = ?3",
                    (category_id, &now, document_id),
                )
                .map_err(|e| e.to_string())?;
            }
        }

        if let Some(folder_id) = folder_id.as_ref() {
            apply_folder_assignment(conn, document_id, folder_id, &now)?;
            conn.execute(
                "UPDATE documents SET updated_at = ?1 WHERE id = ?2",
                (&now, document_id),
            )
            .map_err(|e| e.to_string())?;
        }

        succeeded += 1;
    }

    Ok(BatchActionReport {
        requested: unique_ids.len(),
        succeeded,
        failed: failures.len(),
        failures,
    })
}

fn delete_managed_files(
    file_handler: &FileHandler,
    managed_files: &[ManagedFileTarget],
) -> (usize, usize, Vec<DocumentCleanupIssue>) {
    let mut deleted = 0usize;
    let mut missing = 0usize;
    let mut issues = Vec::new();

    for target in managed_files {
        let path = Path::new(&target.path);
        if !path.exists() {
            missing += 1;
            continue;
        }

        if let Err(error) = file_handler.delete_file(path) {
            issues.push(DocumentCleanupIssue {
                resource_type: target.resource_type.clone(),
                path: Some(target.path.clone()),
                reason: error,
            });
            continue;
        }

        deleted += 1;
    }

    (deleted, missing, issues)
}

fn permanently_delete_documents_internal(
    app: &AppHandle,
    state: &AppState,
    document_ids: &[String],
) -> Result<PermanentDeleteReport, String> {
    let app_dir = crate::app_dirs::runtime_app_dir(app)?;
    let file_handler = FileHandler::new(&app_dir)?;
    let unique_ids = unique_document_ids(document_ids);
    let mut outcomes = Vec::new();

    for document_id in unique_ids.iter() {
        let plan = {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            let conn = db.get_connection();
            collect_document_deletion_plan(conn, &app_dir, document_id)
        };

        let plan = match plan {
            Ok(plan) => plan,
            Err(error) => {
                outcomes.push(PermanentDeleteOutcome {
                    document_id: document_id.clone(),
                    title: "Unknown document".to_string(),
                    deleted: false,
                    resources_deleted: 0,
                    resources_missing: 0,
                    issues: vec![DocumentCleanupIssue {
                        resource_type: "document".to_string(),
                        path: None,
                        reason: error,
                    }],
                });
                continue;
            }
        };

        if plan.document.deleted_at.is_none() {
            outcomes.push(PermanentDeleteOutcome {
                document_id: plan.document.id.clone(),
                title: plan.document.title.clone(),
                deleted: false,
                resources_deleted: 0,
                resources_missing: 0,
                issues: vec![DocumentCleanupIssue {
                    resource_type: "document".to_string(),
                    path: None,
                    reason: "Document must be moved to trash before permanent deletion".to_string(),
                }],
            });
            continue;
        }

        let mut issues = Vec::new();

        for job_id in &plan.parse_job_ids {
            if let Err(error) = cancel_parse_job_internal(
                state,
                job_id,
                TASK_CANCELLED_BECAUSE_DOCUMENT_WAS_DELETED,
            ) {
                issues.push(DocumentCleanupIssue {
                    resource_type: "parse_job".to_string(),
                    path: None,
                    reason: error,
                });
            }
        }

        for job_id in &plan.translation_job_ids {
            if let Err(error) = cancel_translation_job_internal(
                state,
                job_id,
                TASK_CANCELLED_BECAUSE_DOCUMENT_WAS_DELETED,
            ) {
                issues.push(DocumentCleanupIssue {
                    resource_type: "translation_job".to_string(),
                    path: None,
                    reason: error,
                });
            }
        }

        if let Err(error) = cancel_index_job_internal(state, &app_dir, document_id) {
            issues.push(DocumentCleanupIssue {
                resource_type: "index_job".to_string(),
                path: None,
                reason: error,
            });
        }

        let (resources_deleted, resources_missing, file_issues) =
            delete_managed_files(&file_handler, &plan.managed_files);
        issues.extend(file_issues);

        if issues.is_empty() {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            let conn = db.get_connection();

            if let Err(error) = remove_document_from_vector_store(conn, &app_dir, document_id) {
                issues.push(DocumentCleanupIssue {
                    resource_type: "vector_index".to_string(),
                    path: None,
                    reason: error,
                });
            }

            if issues.is_empty() {
                if let Err(error) = cleanup_document_records(conn, document_id) {
                    issues.push(DocumentCleanupIssue {
                        resource_type: "database".to_string(),
                        path: None,
                        reason: error,
                    });
                }
            }
        }

        outcomes.push(PermanentDeleteOutcome {
            document_id: plan.document.id.clone(),
            title: plan.document.title.clone(),
            deleted: issues.is_empty(),
            resources_deleted,
            resources_missing,
            issues,
        });
    }

    let deleted = outcomes.iter().filter(|outcome| outcome.deleted).count();

    Ok(PermanentDeleteReport {
        requested: unique_ids.len(),
        deleted,
        failed: unique_ids.len().saturating_sub(deleted),
        outcomes,
    })
}

#[tauri::command]
pub fn move_documents_to_trash(
    app: AppHandle,
    state: State<AppState>,
    document_ids: Vec<String>,
) -> Result<BatchActionReport, String> {
    move_documents_to_trash_internal(&app, state.inner(), &document_ids)
}

#[tauri::command]
pub fn restore_documents(
    state: State<AppState>,
    document_ids: Vec<String>,
) -> Result<BatchActionReport, String> {
    restore_documents_internal(state.inner(), &document_ids)
}

#[tauri::command]
pub fn batch_update_documents(
    state: State<AppState>,
    document_ids: Vec<String>,
    category_id: Option<String>,
    folder_id: Option<String>,
) -> Result<BatchActionReport, String> {
    batch_update_documents_internal(state.inner(), &document_ids, category_id, folder_id)
}

#[tauri::command]
pub fn permanently_delete_documents(
    app: AppHandle,
    state: State<AppState>,
    document_ids: Vec<String>,
) -> Result<PermanentDeleteReport, String> {
    permanently_delete_documents_internal(&app, state.inner(), &document_ids)
}

#[tauri::command]
pub fn empty_trash(
    app: AppHandle,
    state: State<AppState>,
) -> Result<PermanentDeleteReport, String> {
    let document_ids = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();
        let mut stmt = conn
            .prepare("SELECT id FROM documents WHERE deleted_at IS NOT NULL ORDER BY updated_at DESC")
            .map_err(|e| e.to_string())?;
        let document_ids = stmt.query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        document_ids
    };

    permanently_delete_documents_internal(&app, state.inner(), &document_ids)
}

#[tauri::command]
pub fn get_folders(state: State<AppState>) -> Result<Vec<Folder>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    let mut stmt = conn
        .prepare("SELECT id, name, parent_id, created_at, updated_at FROM folders ORDER BY name")
        .map_err(|e| e.to_string())?;

    let folders = stmt.query_map([], |row| {
        Ok(Folder {
            id: row.get(0)?,
            name: row.get(1)?,
            parent_id: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
        })
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;

    Ok(folders)
}

#[tauri::command]
pub fn create_folder(
    state: State<AppState>,
    name: String,
    parent_id: Option<String>,
) -> Result<Folder, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();
    let now = Utc::now().to_rfc3339();
    let id = Uuid::new_v4().to_string();
    let normalized_parent = parent_id.filter(|value| !value.trim().is_empty());

    conn.execute(
        "INSERT INTO folders (id, name, parent_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)",
        (&id, &name, &normalized_parent, &now),
    )
    .map_err(|e| e.to_string())?;

    conn.query_row(
        "SELECT id, name, parent_id, created_at, updated_at FROM folders WHERE id = ?1",
        [&id],
        |row| {
            Ok(Folder {
                id: row.get(0)?,
                name: row.get(1)?,
                parent_id: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_folder(
    state: State<AppState>,
    id: String,
    name: Option<String>,
    parent_id: Option<String>,
) -> Result<Folder, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();
    let now = Utc::now().to_rfc3339();

    let mut updates = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(name) = name {
        updates.push("name = ?");
        params.push(Box::new(name));
    }

    if let Some(parent_id) = parent_id {
        if parent_id.is_empty() {
            updates.push("parent_id = NULL");
        } else {
            updates.push("parent_id = ?");
            params.push(Box::new(parent_id));
        }
    }

    if !updates.is_empty() {
        updates.push("updated_at = ?");
        params.push(Box::new(now));
        params.push(Box::new(id.clone()));
        let sql = format!("UPDATE folders SET {} WHERE id = ?", updates.join(", "));
        let params_refs: Vec<&dyn rusqlite::ToSql> =
            params.iter().map(|param| param.as_ref()).collect();
        conn.execute(&sql, params_refs.as_slice())
            .map_err(|e| e.to_string())?;
    }

    conn.query_row(
        "SELECT id, name, parent_id, created_at, updated_at FROM folders WHERE id = ?1",
        [&id],
        |row| {
            Ok(Folder {
                id: row.get(0)?,
                name: row.get(1)?,
                parent_id: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_folder(state: State<AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    conn.execute("DELETE FROM folders WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;

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

    let records = load_provider_records(conn)?;
    let ids = records
        .iter()
        .map(|record| record.id.clone())
        .collect::<Vec<_>>();
    let model_map = load_provider_models_map(conn, &ids)?;

    Ok(records
        .into_iter()
        .map(|record| {
            let models = model_map.get(&record.id).cloned().unwrap_or_default();
            build_provider(record, models)
        })
        .collect())
}

#[tauri::command]
pub fn create_provider(
    state: State<AppState>,
    input: ProviderUpsertInput,
) -> Result<Provider, String> {
    if input.name.trim().is_empty() {
        return Err("Channel name is required".to_string());
    }
    if input.base_url.trim().is_empty() {
        return Err("Base URL is required".to_string());
    }
    if input.api_key.trim().is_empty() {
        return Err("API key is required".to_string());
    }

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    conn.execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;
    let result = (|| {
        conn.execute(
            "INSERT INTO providers (
                id,
                name,
                base_url,
                api_key,
                headers,
                organization,
                timeout,
                concurrency,
                is_active,
                created_at,
                updated_at,
                max_retries,
                priority
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, ?11, ?12)",
            (
                &id,
                input.name.trim(),
                input.base_url.trim(),
                input.api_key.trim(),
                input.headers.as_deref(),
                input.organization.as_deref(),
                input.timeout,
                input.concurrency.unwrap_or(3),
                if input.is_active.unwrap_or(true) { 1 } else { 0 },
                &now,
                input.max_retries.unwrap_or(3),
                input.priority.unwrap_or(0),
            ),
        )
        .map_err(|e| e.to_string())?;

        sync_provider_models(conn, &id, &input.models, &now)?;
        Ok(())
    })();

    if let Err(error) = result {
        let _ = conn.execute_batch("ROLLBACK");
        return Err(error);
    }

    conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;

    let record = load_provider_record_by_id(conn, &id)?;
    let models = load_provider_models_for_provider(conn, &id)?;
    Ok(build_provider(record, models))
}

#[tauri::command]
pub fn update_provider(
    state: State<AppState>,
    id: String,
    input: ProviderUpsertInput,
) -> Result<Provider, String> {
    if input.name.trim().is_empty() {
        return Err("Channel name is required".to_string());
    }
    if input.base_url.trim().is_empty() {
        return Err("Base URL is required".to_string());
    }
    if input.api_key.trim().is_empty() {
        return Err("API key is required".to_string());
    }

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();
    let now = Utc::now().to_rfc3339();

    conn.execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;
    let result = (|| {
        let updated = conn
            .execute(
                "UPDATE providers
                 SET name = ?1,
                     base_url = ?2,
                     api_key = ?3,
                     headers = ?4,
                     organization = ?5,
                     timeout = ?6,
                     concurrency = ?7,
                     is_active = ?8,
                     updated_at = ?9,
                     max_retries = ?10,
                     priority = ?11
                 WHERE id = ?12",
                (
                    input.name.trim(),
                    input.base_url.trim(),
                    input.api_key.trim(),
                    input.headers.as_deref(),
                    input.organization.as_deref(),
                    input.timeout,
                    input.concurrency.unwrap_or(3),
                    if input.is_active.unwrap_or(true) { 1 } else { 0 },
                    &now,
                    input.max_retries.unwrap_or(3),
                    input.priority.unwrap_or(0),
                    &id,
                ),
            )
            .map_err(|e| e.to_string())?;

        if updated == 0 {
            return Err("Provider not found".to_string());
        }

        sync_provider_models(conn, &id, &input.models, &now)?;
        Ok(())
    })();

    if let Err(error) = result {
        let _ = conn.execute_batch("ROLLBACK");
        return Err(error);
    }

    conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;

    let record = load_provider_record_by_id(conn, &id)?;
    let models = load_provider_models_for_provider(conn, &id)?;
    Ok(build_provider(record, models))
}

#[tauri::command]
pub fn delete_provider(state: State<AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    conn.execute("DELETE FROM provider_models WHERE provider_id = ?1", [&id])
        .map_err(|e| e.to_string())?;
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
    app_dir: Option<PathBuf>,
    document_id: &str,
    mark_document_parsing: bool,
) -> Result<ParseJob, String> {
    let job_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    let job = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();
        let exists = conn
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM documents WHERE id = ?1 AND deleted_at IS NULL
                )",
                [document_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|e| e.to_string())?
            != 0;

        if !exists {
            return Err("Document not found".to_string());
        }

        conn.execute(
            "INSERT INTO parse_jobs (id, document_id, status, progress, created_at, updated_at) VALUES (?1, ?2, 'pending', 0, ?3, ?4)",
            (&job_id, document_id, &now, &now),
        )
        .map_err(|e| e.to_string())?;

        if mark_document_parsing {
            conn.execute(
                "UPDATE documents
                 SET parse_status = 'parsing', updated_at = ?1
                 WHERE id = ?2 AND deleted_at IS NULL",
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
    let app_dir_clone = app_dir.clone();

    let handle = tauri::async_runtime::spawn(async move {
        let result = execute_parse_job(
            &state_clone,
            app_dir_clone.as_deref(),
            &job_id_clone,
            &document_id_clone,
        )
        .await;
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
    app: AppHandle,
    state: State<'_, AppState>,
    document_id: String,
) -> Result<ParseJob, String> {
    let app_dir = crate::app_dirs::runtime_app_dir(&app)?;
    enqueue_parse_job(state.inner(), Some(app_dir), &document_id, true)
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
    app_dir: Option<&Path>,
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
            "UPDATE documents
             SET parse_status = 'parsing', updated_at = ?1
             WHERE id = ?2 AND deleted_at IS NULL",
            (&now, document_id),
        )
        .map_err(|e| e.to_string())?;

        conn.query_row(
            "SELECT file_path FROM documents WHERE id = ?1 AND deleted_at IS NULL",
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
            let version = next_content_version(conn, "parsed_contents", document_id)?;
            clear_document_derived_data(conn, app_dir, document_id, false, &now)?;

            conn.execute(
                "INSERT INTO parsed_contents (id, document_id, version, markdown_content, json_content, structure_tree, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                (&content_id, document_id, &version, &parse_result.markdown, &parse_result.json, &parse_result.structure.to_string(), &now),
            ).map_err(|e| e.to_string())?;

            conn.execute(
                "UPDATE parse_jobs SET status = 'completed', progress = 100, completed_at = ?, updated_at = ? WHERE id = ?",
                (&now, &now, job_id),
            ).map_err(|e| e.to_string())?;

            conn.execute(
                "UPDATE documents
                 SET parse_status = 'completed', translation_status = 'pending', index_status = 'pending', updated_at = ?1
                 WHERE id = ?2 AND deleted_at IS NULL",
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
                "UPDATE documents
                 SET parse_status = 'failed', updated_at = ?1
                 WHERE id = ?2 AND deleted_at IS NULL",
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
        "SELECT id FROM documents WHERE id = ?1 AND deleted_at IS NULL",
        [&document_id],
        |row| row.get::<_, String>(0),
    )
    .map_err(|e| e.to_string())?;

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
    app: AppHandle,
    state: State<'_, AppState>,
    document_id: String,
    provider_id: String,
    source_language: String,
    target_language: String,
) -> Result<TranslationJob, String> {
    let app_dir = crate::app_dirs::runtime_app_dir(&app)?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();
    let exists = conn
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM documents WHERE id = ?1 AND deleted_at IS NULL
            )",
            [&document_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())?
        != 0;

    if !exists {
        return Err("Document not found".to_string());
    }

    let provider_record = load_provider_record_by_id(conn, &provider_id)?;
    let provider_models = load_provider_models_for_provider(conn, &provider_id)?;
    let translate_model = find_primary_model_for_type(&provider_models, PROVIDER_MODEL_TYPE_TRANSLATE)
        .ok_or_else(|| format!("Channel \"{}\" has no active translate model", provider_record.name))?;
    let mut sampling = load_llm_sampling_config(conn, "translate")?;
    if sampling.temperature.is_none() {
        sampling.temperature = provider_record.legacy_temperature;
    }
    if sampling.max_tokens.is_none() {
        sampling.max_tokens = provider_record.legacy_max_tokens;
    }

    let job_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let config = serde_json::json!({
        "source_language": source_language,
        "target_language": target_language,
        "provider_name": provider_record.name,
        "model_id": translate_model.id,
        "model_name": translate_model.model_name,
        "sampling": {
            "temperature": sampling.temperature,
            "top_p": sampling.top_p,
            "top_k": sampling.top_k,
            "max_tokens": sampling.max_tokens,
        },
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
    let app_dir_clone = app_dir.clone();

    let handle = tauri::async_runtime::spawn(async move {
        let result = execute_translation_job(
            &state_clone,
            Some(app_dir_clone.as_path()),
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
    app_dir: Option<&Path>,
    job_id: &str,
    document_id: &str,
    provider_id: &str,
    source_language: &str,
    target_language: &str,
) -> Result<(), String> {
    let (provider_record, translate_model, sampling, markdown_content) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();
        let now = Utc::now().to_rfc3339();

        conn.execute(
            "UPDATE translation_jobs SET status = 'translating', started_at = ?, updated_at = ? WHERE id = ?",
            (&now, &now, job_id),
        ).map_err(|e| e.to_string())?;

        conn.execute(
            "UPDATE documents
             SET translation_status = 'translating', updated_at = ?1
             WHERE id = ?2 AND deleted_at IS NULL",
            (&now, document_id),
        )
        .map_err(|e| e.to_string())?;

        let provider_record = load_provider_record_by_id(conn, provider_id)?;
        let provider_models = load_provider_models_for_provider(conn, provider_id)?;
        let translate_model = find_primary_model_for_type(&provider_models, PROVIDER_MODEL_TYPE_TRANSLATE)
            .ok_or_else(|| format!("Channel \"{}\" has no active translate model", provider_record.name))?;
        let mut sampling = load_llm_sampling_config(conn, "translate")?;
        if sampling.temperature.is_none() {
            sampling.temperature = provider_record.legacy_temperature;
        }
        if sampling.max_tokens.is_none() {
            sampling.max_tokens = provider_record.legacy_max_tokens;
        }

        let markdown_content: String = conn.query_row(
            "SELECT pc.markdown_content
             FROM parsed_contents pc
             JOIN documents d ON d.id = pc.document_id
             WHERE pc.document_id = ?1 AND d.deleted_at IS NULL
             ORDER BY pc.version DESC
             LIMIT 1",
            [document_id],
            |row| row.get(0),
        ).map_err(|e| e.to_string())?;

        (provider_record, translate_model, sampling, markdown_content)
    };

    let translator = crate::translator::Translator::new(
        provider_record.base_url,
        provider_record.api_key,
        translate_model.model_name,
        sampling,
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
            let version = next_content_version(conn, "translated_contents", document_id)?;
            clear_document_derived_data(conn, app_dir, document_id, false, &now)?;

            conn.execute(
                "INSERT INTO translated_contents (id, document_id, version, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                (&content_id, document_id, &version, &translated_text, &now),
            ).map_err(|e| e.to_string())?;

            conn.execute(
                "UPDATE translation_jobs SET status = 'completed', progress = 100, completed_at = ?, updated_at = ? WHERE id = ?",
                (&now, &now, job_id),
            ).map_err(|e| e.to_string())?;

            conn.execute(
                "UPDATE documents
                 SET translation_status = 'completed', target_language = ?1, updated_at = ?2
                 WHERE id = ?3 AND deleted_at IS NULL",
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
                "UPDATE documents
                 SET translation_status = 'failed', updated_at = ?1
                 WHERE id = ?2 AND deleted_at IS NULL",
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
        "SELECT id FROM documents WHERE id = ?1 AND deleted_at IS NULL",
        [&document_id],
        |row| row.get::<_, String>(0),
    )
    .map_err(|e| e.to_string())?;

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
pub fn get_document_outputs(
    state: State<AppState>,
    document_id: String,
) -> Result<Vec<DocumentOutput>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    conn.query_row(
        "SELECT id FROM documents WHERE id = ?1 AND deleted_at IS NULL",
        [&document_id],
        |row| row.get::<_, String>(0),
    )
    .map_err(|e| e.to_string())?;

    load_document_outputs_internal(conn, &document_id)
}

#[tauri::command]
pub async fn replace_original_document_file(
    app: AppHandle,
    state: State<'_, AppState>,
    document_id: String,
    file_path: String,
) -> Result<Document, String> {
    let app_dir = crate::app_dirs::runtime_app_dir(&app)?;
    let source_path = Path::new(&file_path);
    let extension = source_path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    if extension != "pdf" {
        return Err("Only PDF files can replace the original document".to_string());
    }

    cancel_document_workflows(state.inner(), &app_dir, &document_id)?;

    let file_handler = FileHandler::new(&app_dir)?;
    let new_path = file_handler.import_pdf(source_path)?;
    let new_file_size = FileHandler::get_file_size(&new_path)? as i64;
    let new_filename = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Invalid filename")?
        .to_string();

    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();
        let old_path = conn
            .query_row(
                "SELECT file_path FROM documents WHERE id = ?1 AND deleted_at IS NULL",
                [&document_id],
                |row| row.get::<_, String>(0),
            )
            .map_err(|e| e.to_string())?;
        let now = Utc::now().to_rfc3339();

        clear_document_derived_data(conn, Some(&app_dir), &document_id, true, &now)?;

        conn.execute(
            "UPDATE documents
             SET filename = ?1, file_path = ?2, file_size = ?3, page_count = 0, parse_status = 'pending',
                 translation_status = 'pending', index_status = 'pending', updated_at = ?4
             WHERE id = ?5 AND deleted_at IS NULL",
            (
                &new_filename,
                new_path
                    .to_str()
                    .ok_or("File path contains invalid characters")?,
                &new_file_size,
                &now,
                &document_id,
            ),
        )
        .map_err(|e| e.to_string())?;

        let old_path_ref = Path::new(&old_path);
        if path_is_within(&app_dir, old_path_ref) {
            let _ = file_handler.delete_file(old_path_ref);
        }
    }

    let _ = enqueue_parse_job(state.inner(), Some(app_dir.clone()), &document_id, true)?;

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();
    load_document_by_id_internal(conn, &document_id, false)
}

#[tauri::command]
pub async fn replace_translated_pdf(
    app: AppHandle,
    state: State<'_, AppState>,
    document_id: String,
    file_path: String,
) -> Result<DocumentOutput, String> {
    let app_dir = crate::app_dirs::runtime_app_dir(&app)?;
    let source_path = Path::new(&file_path);
    let extension = source_path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    if extension != "pdf" {
        return Err("Only PDF files can be used as translated output".to_string());
    }

    let file_handler = FileHandler::new(&app_dir)?;
    let stored_path = file_handler.import_output_file(source_path, "translated_pdf")?;
    let now = Utc::now().to_rfc3339();
    let output_id = Uuid::new_v4().to_string();

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    conn.query_row(
        "SELECT id FROM documents WHERE id = ?1 AND deleted_at IS NULL",
        [&document_id],
        |row| row.get::<_, String>(0),
    )
    .map_err(|e| e.to_string())?;

    delete_document_output_record_and_file(conn, "translated_pdf", &document_id)?;

    conn.execute(
        "INSERT INTO document_outputs (id, document_id, output_type, file_path, created_at, updated_at)
         VALUES (?1, ?2, 'translated_pdf', ?3, ?4, ?5)",
        (
            &output_id,
            &document_id,
            stored_path
                .to_str()
                .ok_or("File path contains invalid characters")?,
            &now,
            &now,
        ),
    )
    .map_err(|e| e.to_string())?;

    load_document_outputs_internal(conn, &document_id)?
        .into_iter()
        .find(|output| output.output_type == "translated_pdf")
        .ok_or_else(|| "Translated PDF output was not created".to_string())
}

#[tauri::command]
pub async fn replace_parsed_markdown(
    app: AppHandle,
    state: State<'_, AppState>,
    document_id: String,
    file_path: String,
) -> Result<ParsedContent, String> {
    let app_dir = crate::app_dirs::runtime_app_dir(&app)?;
    let source_path = Path::new(&file_path);
    let extension = source_path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    if !matches!(extension.as_str(), "md" | "markdown" | "txt") {
        return Err("Only Markdown or text files can replace parsed content".to_string());
    }

    cancel_document_workflows(state.inner(), &app_dir, &document_id)?;

    let markdown_content = FileHandler::read_text_file(source_path)?;
    let now = Utc::now().to_rfc3339();
    let content_id = Uuid::new_v4().to_string();

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    conn.query_row(
        "SELECT id FROM documents WHERE id = ?1 AND deleted_at IS NULL",
        [&document_id],
        |row| row.get::<_, String>(0),
    )
    .map_err(|e| e.to_string())?;

    clear_document_derived_data(conn, Some(&app_dir), &document_id, false, &now)?;
    let version = next_content_version(conn, "parsed_contents", &document_id)?;

    conn.execute(
        "INSERT INTO parsed_contents (id, document_id, version, markdown_content, json_content, structure_tree, created_at)
         VALUES (?1, ?2, ?3, ?4, '{}', NULL, ?5)",
        (&content_id, &document_id, &version, &markdown_content, &now),
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE documents
         SET parse_status = 'completed', translation_status = 'pending', index_status = 'pending', updated_at = ?1
         WHERE id = ?2 AND deleted_at IS NULL",
        (&now, &document_id),
    )
    .map_err(|e| e.to_string())?;

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
        let updated = conn
            .execute(
                "UPDATE documents
                 SET index_status = 'indexing', updated_at = ?1
                 WHERE id = ?2 AND deleted_at IS NULL",
                (&now, &document_id),
            )
            .map_err(|e| e.to_string())?;

        if updated == 0 {
            return Err("Document not found".to_string());
        }
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
        let provider_record = load_provider_record_by_id(conn, provider_id)?;
        let provider_models = load_provider_models_for_provider(conn, provider_id)?;
        let embed_model = find_primary_model_for_type(&provider_models, PROVIDER_MODEL_TYPE_EMBED)
            .ok_or_else(|| format!("Channel \"{}\" has no active embedding model", provider_record.name))?;

        DirectEmbeddingProvider {
            base_url: provider_record.base_url,
            api_key: provider_record.api_key,
            embedding_model: embed_model.model_name,
            dimensions: embed_model.config.and_then(|config| config.dimensions),
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
            "SELECT pc.markdown_content
             FROM parsed_contents pc
             JOIN documents d ON d.id = pc.document_id
             WHERE pc.document_id = ?1 AND d.deleted_at IS NULL
             ORDER BY pc.version DESC
             LIMIT 1",
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
        provider.dimensions,
    );

    let embeddings = embedder.embed(chunks.clone()).await?;
    let vector_dimension = embeddings
        .first()
        .map(|embedding| embedding.len())
        .ok_or_else(|| "Embedding provider returned no vectors".to_string())?;

    let use_zvec = crate::zvec::should_use_zvec(
        &rag_settings,
        app_dir,
        &zvec_settings,
        &state.zvec_availability_cache,
    );
    if crate::zvec::vector_backend_is_zvec(&rag_settings) && !use_zvec {
        log::warn!(
            "zvec configured but unavailable; falling back to sqlite-vec for document {}",
            document_id
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

    // Ensure vec0 table exists for this dimension
    crate::zvec::ensure_vec0_table(conn, vector_dimension)?;

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

        // Always write to SQLite embeddings BLOB table for fallback
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

        // Always write to vec0 table for sqlite-vec KNN search
        crate::zvec::vec0_insert(conn, vector_dimension, &indexed_chunk.id, &embedding_bytes, &embedding_model)?;
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
            log::warn!("ZVEC upsert failed, sqlite-vec fallback data retained: {error}");
            // Downgrade index record to sqlite since sqlite-vec data is already written
            crate::zvec::upsert_document_index_record(
                conn,
                document_id,
                "sqlite",
                None,
                &embedding_model,
                vector_dimension,
                &now,
            )?;
        }
    }

    conn.execute(
        "UPDATE documents
         SET index_status = 'completed', updated_at = ?1
         WHERE id = ?2 AND deleted_at IS NULL",
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
        let provider_record = load_provider_record_by_id(conn, &provider_id)?;
        let provider_models = load_provider_models_for_provider(conn, &provider_id)?;
        let embed_model = find_primary_model_for_type(&provider_models, PROVIDER_MODEL_TYPE_EMBED)
            .ok_or_else(|| format!("Channel \"{}\" has no active embedding model", provider_record.name))?;
        let rag_settings = crate::zvec::load_rag_settings(conn)?;
        let zvec_settings = crate::zvec::load_zvec_settings(conn, &app_dir)?;

        (
            DirectEmbeddingProvider {
                base_url: provider_record.base_url,
                api_key: provider_record.api_key,
                embedding_model: embed_model.model_name,
                dimensions: embed_model.config.and_then(|config| config.dimensions),
            },
            rag_settings,
            zvec_settings,
        )
    };

    let embedding_model = provider.embedding_model.clone();

    let embedder = crate::embedder::Embedder::new(
        provider.base_url,
        provider.api_key,
        embedding_model.clone(),
        provider.dimensions,
    );

    let query_embeddings = embedder.embed(vec![query]).await?;
    let query_embedding = &query_embeddings[0];
    let requested_limit = limit.unwrap_or(10).max(1) as usize;

    let use_zvec_search = crate::zvec::should_use_zvec(
        &rag_settings,
        &app_dir,
        &zvec_settings,
        &state.zvec_availability_cache,
    );

    if use_zvec_search {
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
            "SELECT c.id, c.document_id, c.content
             FROM chunks c
             JOIN documents d ON d.id = c.document_id
             WHERE c.id IN ({placeholders}) AND d.deleted_at IS NULL"
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

    // sqlite-vec KNN search (fallback from zvec or explicit sqlite backend)
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    let dimension = query_embedding.len();
    let query_bytes: Vec<u8> = query_embedding
        .iter()
        .flat_map(|f| f.to_le_bytes())
        .collect();

    // Try vec0 KNN search first
    if crate::zvec::ensure_vec0_table(conn, dimension).is_ok() {
        if let Ok(hits) = crate::zvec::vec0_search(
            conn,
            dimension,
            &query_bytes,
            &embedding_model,
            requested_limit,
        ) {
            if !hits.is_empty() {
                let chunk_ids: Vec<String> = hits.iter().map(|(id, _)| id.clone()).collect();
                let placeholders = (1..=chunk_ids.len())
                    .map(|idx| format!("?{idx}"))
                    .collect::<Vec<_>>()
                    .join(", ");
                let sql = format!(
                    "SELECT c.id, c.document_id, c.content
                     FROM chunks c
                     JOIN documents d ON d.id = c.document_id
                     WHERE c.id IN ({placeholders}) AND d.deleted_at IS NULL"
                );
                let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
                let rows = stmt
                    .query_map(rusqlite::params_from_iter(chunk_ids.iter()), |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    })
                    .map_err(|e| e.to_string())?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| e.to_string())?;

                let chunk_map: HashMap<String, (String, String)> = rows
                    .into_iter()
                    .map(|(chunk_id, document_id, content)| (chunk_id, (document_id, content)))
                    .collect();

                let results: Vec<SearchResult> = hits
                    .into_iter()
                    .filter_map(|(chunk_id, distance)| {
                        chunk_map.get(&chunk_id).map(|(document_id, content)| SearchResult {
                            chunk_id: chunk_id.clone(),
                            document_id: document_id.clone(),
                            content: content.clone(),
                            score: 1.0 - distance, // cosine distance to similarity
                        })
                    })
                    .take(requested_limit)
                    .collect();

                return Ok(results);
            }
        }
    }

    // Final fallback: brute-force cosine similarity on embeddings BLOBs
    let mut stmt = conn
        .prepare(
            "SELECT c.id, c.document_id, c.content, e.vector
             FROM chunks c
             JOIN embeddings e ON c.id = e.chunk_id
             JOIN documents d ON d.id = c.document_id
             WHERE d.deleted_at IS NULL
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
            "SELECT file_path FROM documents WHERE id = ?1 AND deleted_at IS NULL",
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
        "UPDATE documents
         SET sync_status = 'synced', updated_at = ?1
         WHERE id = ?2 AND deleted_at IS NULL",
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

        conn.query_row(
            "SELECT id FROM documents WHERE id = ?1 AND deleted_at IS NULL",
            [&document_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|e| e.to_string())?;

        match content_type.as_str() {
            "original" => {
                conn.query_row(
                    "SELECT pc.markdown_content
                     FROM parsed_contents pc
                     JOIN documents d ON d.id = pc.document_id
                     WHERE pc.document_id = ?1 AND d.deleted_at IS NULL
                     ORDER BY pc.version DESC
                     LIMIT 1",
                    [&document_id],
                    |row| row.get::<_, String>(0),
                ).map_err(|e| e.to_string())?
            }
            "translated" => {
                conn.query_row(
                    "SELECT tc.content
                     FROM translated_contents tc
                     JOIN documents d ON d.id = tc.document_id
                     WHERE tc.document_id = ?1 AND d.deleted_at IS NULL
                     ORDER BY tc.version DESC
                     LIMIT 1",
                    [&document_id],
                    |row| row.get::<_, String>(0),
                ).map_err(|e| e.to_string())?
            }
            "bilingual" => {
                let original: String = conn.query_row(
                    "SELECT pc.markdown_content
                     FROM parsed_contents pc
                     JOIN documents d ON d.id = pc.document_id
                     WHERE pc.document_id = ?1 AND d.deleted_at IS NULL
                     ORDER BY pc.version DESC
                     LIMIT 1",
                    [&document_id],
                    |row| row.get(0),
                ).map_err(|e| e.to_string())?;

                let translated: String = conn.query_row(
                    "SELECT tc.content
                     FROM translated_contents tc
                     JOIN documents d ON d.id = tc.document_id
                     WHERE tc.document_id = ?1 AND d.deleted_at IS NULL
                     ORDER BY tc.version DESC
                     LIMIT 1",
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

#[tauri::command]
pub async fn export_document_asset(
    state: State<'_, AppState>,
    document_id: String,
    asset_type: String,
    output_path: String,
) -> Result<String, String> {
    let source_path = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();

        conn.query_row(
            "SELECT id FROM documents WHERE id = ?1 AND deleted_at IS NULL",
            [&document_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|e| e.to_string())?;

        match asset_type.as_str() {
            "original_pdf" => conn
                .query_row(
                    "SELECT file_path FROM documents WHERE id = ?1 AND deleted_at IS NULL",
                    [&document_id],
                    |row| row.get::<_, String>(0),
                )
                .map_err(|e| e.to_string())?,
            "translated_pdf" => conn
                .query_row(
                    "SELECT file_path FROM document_outputs WHERE document_id = ?1 AND output_type = 'translated_pdf'",
                    [&document_id],
                    |row| row.get::<_, String>(0),
                )
                .map_err(|e| e.to_string())?,
            _ => return Err("Invalid asset type".to_string()),
        }
    };

    tokio::fs::copy(&source_path, &output_path)
        .await
        .map_err(|e| format!("Failed to export asset: {}", e))?;

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
        if let Err(e) = enqueue_parse_job(state.inner(), Some(app_dir.clone()), &id, true) {
            log::error!("Failed to auto-start parse job for document {}: {}", id, e);
        }
    }

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();
    load_document_by_id_internal(conn, &id, true)
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

#[tauri::command]
pub fn duplicate_document(
    app: AppHandle,
    state: State<AppState>,
    id: String,
) -> Result<Document, String> {
    let app_dir = crate::app_dirs::runtime_app_dir(&app)?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    let doc = load_document_by_id_internal(conn, &id, false)?;
    
    let new_id = Uuid::new_v4().to_string();
    let source_path = Path::new(&doc.file_path);
    let extension = source_path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let mut new_filename = doc.filename.clone();
    
    if extension.is_empty() {
        new_filename = format!("{} 副本", new_filename);
    } else {
        if let Some(stem) = source_path.file_stem().and_then(|s| s.to_str()) {
            new_filename = format!("{} 副本.{}", stem, extension);
        }
    }

    let target_dir = app_dir.join("library");
    std::fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
    
    let dest_path = if extension.is_empty() {
        target_dir.join(&new_id)
    } else {
        target_dir.join(format!("{}.{}", new_id, extension))
    };
    
    std::fs::copy(&source_path, &dest_path).map_err(|e| format!("Failed to copy file: {}", e))?;

    let now = Utc::now().to_rfc3339();
    let new_title = format!("{} (副本)", doc.title);
    
    let dest_path_str = dest_path.to_str().ok_or("Invalid path")?;
    
    conn.execute(
        "INSERT INTO documents (id, title, filename, file_path, file_size, source_language, target_language, category_id, parse_status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        (
            &new_id,
            &new_title,
            &new_filename,
            dest_path_str,
            &doc.file_size,
            &doc.source_language,
            &doc.target_language,
            &doc.category_id,
            "pending",
            &now,
            &now,
        ),
    ).map_err(|e| e.to_string())?;

    if let Some(folder_id) = doc.folder_id {
        conn.execute(
            "INSERT INTO document_folders (document_id, folder_id, created_at) VALUES (?1, ?2, ?3)",
            (&new_id, &folder_id, &now),
        ).map_err(|e| e.to_string())?;
    }

    if let Some(tags) = doc.tags {
        for tag in tags {
            conn.execute(
                "INSERT INTO document_tags (document_id, tag_id, created_at) VALUES (?1, ?2, ?3)",
                (&new_id, &tag.id, &now),
            ).map_err(|e| e.to_string())?;
        }
    }

    let is_text = doc.filename.ends_with(".md") || doc.filename.ends_with(".txt") || doc.filename.ends_with(".csv");
    if is_text {
        if let Ok(content) = FileHandler::read_text_file(&dest_path) {
            let content_id = Uuid::new_v4().to_string();
            let _ = conn.execute(
                "INSERT INTO parsed_contents (id, document_id, version, markdown_content, json_content, created_at) VALUES (?1, ?2, 1, ?3, '{}', ?4)",
                (&content_id, &new_id, &content, &now),
            );
            let _ = conn.execute(
                "UPDATE documents SET parse_status = 'completed' WHERE id = ?1",
                [&new_id],
            );
        }
    }

    load_document_by_id_internal(conn, &new_id, false)
}

#[tauri::command]
pub fn reveal_in_os(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    #[cfg(target_os = "linux")]
    {
        let p = Path::new(&path);
        let parent = p.parent().unwrap_or(p);
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

// --- Get Document Chunks ---

#[tauri::command]
pub fn get_document_chunks(
    state: State<AppState>,
    document_id: String,
) -> Result<Vec<Chunk>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    conn.query_row(
        "SELECT id FROM documents WHERE id = ?1 AND deleted_at IS NULL",
        [&document_id],
        |row| row.get::<_, String>(0),
    )
    .map_err(|e| e.to_string())?;

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
