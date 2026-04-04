use crate::file_handler::FileHandler;
use crate::models::*;
use crate::AppState;
use chrono::Utc;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Cursor, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};
use uuid::Uuid;
use zip::ZipArchive;

const TASK_CANCELLED_BY_USER: &str = "Cancelled by user";
const TASK_REMOVED_BY_USER: &str = "Removed by user";
const TASK_CANCELLED_BECAUSE_DOCUMENT_WAS_DELETED: &str =
    "Cancelled because the document was deleted";
const DOCUMENT_SELECT_FIELDS: &str = "d.id, d.title, d.filename, d.file_path, d.file_size, d.page_count, d.source_language, d.target_language, d.category_id, df.folder_id, d.created_at, d.updated_at, d.deleted_at, d.parse_status, d.translation_status, d.index_status, d.sync_status, c.name, f.name";
const PROVIDER_MODEL_TYPE_CHAT: &str = "chat";
const PROVIDER_MODEL_TYPE_TRANSLATE: &str = "translate";
const PROVIDER_MODEL_TYPE_EMBED: &str = "embed";
const PROVIDER_MODEL_TYPE_RERANK: &str = "rerank";
const DEFAULT_TRANSLATION_CHUNK_SIZE: usize = 4000;
const DEFAULT_TRANSLATION_CHUNK_OVERLAP: usize = 0;
const DEFAULT_TRANSLATION_MAX_CONCURRENT_REQUESTS: usize = 3;
const DEFAULT_TRANSLATION_MAX_REQUESTS_PER_MINUTE: u32 = 60;
const DEFAULT_TRANSLATION_CHUNK_STRATEGY: &str = "token";
const DEFAULT_LOG_RETENTION_DAYS: i64 = 30;
const EXTRACTION_PROVIDER_SETTING_KEY: &str = "extraction.provider_id";
const EXTRACTION_BUILTIN_STATE_SETTING_KEY: &str = "extraction.builtin_template_states";

#[derive(Debug, Clone, Serialize)]
pub struct RuntimeLogEntry {
    pub id: String,
    pub level: String,
    pub message: String,
    pub context: Option<String>,
    pub created_at: String,
}

fn parse_log_rank(level: &str) -> i32 {
    match level {
        "error" => 1,
        "warn" => 2,
        "info" => 3,
        _ => 4,
    }
}

fn unescape_log_field(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut chars = value.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            match chars.peek().copied() {
                Some('n') => {
                    let _ = chars.next();
                    out.push('\n');
                }
                Some('t') => {
                    let _ = chars.next();
                    out.push('\t');
                }
                Some('\\') => {
                    let _ = chars.next();
                    out.push('\\');
                }
                _ => out.push(ch),
            }
        } else {
            out.push(ch);
        }
    }
    out
}

fn parse_runtime_log_line(line: &str) -> Option<RuntimeLogEntry> {
    let mut parts = line.splitn(4, '\t');
    let created_at = parts.next()?.to_string();
    let level = parts.next()?.to_string();
    let message = unescape_log_field(parts.next()?);
    let context_raw = parts.next().unwrap_or_default();
    let context = if context_raw.is_empty() {
        None
    } else {
        Some(unescape_log_field(context_raw))
    };

    Some(RuntimeLogEntry {
        id: format!("{created_at}:{level}"),
        level,
        message,
        context,
        created_at,
    })
}

fn read_tail_string(path: &Path, bytes: usize) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let len = file.metadata().map_err(|e| e.to_string())?.len();
    let want = bytes.min(len as usize) as u64;
    let start = len.saturating_sub(want);
    file.seek(SeekFrom::Start(start))
        .map_err(|e| e.to_string())?;

    let mut buf = Vec::with_capacity(want as usize);
    file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&buf).to_string())
}

fn read_runtime_logs_tail_from_file(
    file: &Path,
    target_count: usize,
    min_rank: i32,
) -> Result<Vec<RuntimeLogEntry>, String> {
    if !file.exists() || target_count == 0 {
        return Ok(Vec::new());
    }

    let file_len = fs::metadata(file).map_err(|e| e.to_string())?.len() as usize;
    if file_len == 0 {
        return Ok(Vec::new());
    }

    let mut window = 256 * 1024usize;
    let mut filtered = Vec::new();

    loop {
        let content = read_tail_string(file, window)?;
        filtered.clear();

        for line in content.lines() {
            if let Some(entry) = parse_runtime_log_line(line) {
                if parse_log_rank(&entry.level) <= min_rank {
                    filtered.push(entry);
                }
            }
        }

        if filtered.len() >= target_count || window >= file_len {
            break;
        }

        let next = window.saturating_mul(2);
        if next <= window {
            break;
        }
        window = next.min(file_len);
    }

    filtered.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    if filtered.len() > target_count {
        filtered.truncate(target_count);
    }
    Ok(filtered)
}

fn read_runtime_logs_from_files(
    app_dir: &Path,
    limit: usize,
    offset: usize,
    min_level: Option<&str>,
) -> Result<Vec<RuntimeLogEntry>, String> {
    crate::runtime_logs::with_log_io_lock(|| {
        let mut entries = Vec::new();
        let log_dir = app_dir.join("logs");
        let files = crate::runtime_logs::list_log_files(&log_dir)?;
        let min_rank = min_level.map(parse_log_rank).unwrap_or(4);
        let target = limit.saturating_add(offset);

        for file in files {
            let remaining = target.saturating_sub(entries.len());
            if remaining == 0 {
                break;
            }

            let mut chunk = read_runtime_logs_tail_from_file(&file, remaining, min_rank)?;
            entries.append(&mut chunk);
        }

        entries.sort_by(|a, b| b.created_at.cmp(&a.created_at));

        if offset >= entries.len() {
            return Ok(Vec::new());
        }

        let end = (offset + limit).min(entries.len());
        Ok(entries[offset..end].to_vec())
    })
}

fn normalize_log_level_input(raw: &str) -> Option<&'static str> {
    crate::runtime_logs::normalize_level_for_query(raw)
}

fn load_log_retention_days(settings: &crate::settings::SettingsManager) -> i64 {
    let parsed = settings
        .get("logs.retention_days")
        .and_then(|value| value.trim().parse::<i64>().ok())
        .unwrap_or(DEFAULT_LOG_RETENTION_DAYS);
    parsed.clamp(1, 3650)
}

fn cleanup_expired_runtime_logs(app_dir: &Path, retention_days: i64) -> Result<usize, String> {
    let log_dir = app_dir.join("logs");
    let threshold = Utc::now() - chrono::Duration::days(retention_days);

    crate::runtime_logs::with_log_io_lock(|| {
        let files = crate::runtime_logs::list_log_files(&log_dir)?;
        let mut removed = 0usize;

        for file in files {
            let content = fs::read_to_string(&file).map_err(|e| e.to_string())?;
            let mut kept_lines = Vec::new();

            for line in content.lines() {
                let keep_line = match parse_runtime_log_line(line) {
                    Some(entry) => chrono::DateTime::parse_from_rfc3339(&entry.created_at)
                        .map(|dt| dt.with_timezone(&Utc) >= threshold)
                        .unwrap_or(true),
                    None => true,
                };

                if keep_line {
                    kept_lines.push(line.to_string());
                } else {
                    removed += 1;
                }
            }

            if kept_lines.is_empty() {
                if file.exists() {
                    fs::remove_file(&file).map_err(|e| e.to_string())?;
                }
                continue;
            }

            let rewritten = format!("{}\n", kept_lines.join("\n"));
            fs::write(&file, rewritten).map_err(|e| e.to_string())?;
        }

        Ok(removed)
    })
}

fn cleanup_deleted_document_job_logs(
    conn: &rusqlite::Connection,
    retention_days: i64,
) -> Result<(usize, usize), String> {
    let threshold = format!("-{retention_days} days");

    let parse_deleted = conn
        .execute(
            "DELETE FROM parse_jobs
             WHERE document_id IN (
               SELECT id FROM documents WHERE deleted_at IS NOT NULL
             )
             AND datetime(created_at) < datetime('now', ?1)",
            [&threshold],
        )
        .map_err(|e| e.to_string())?;

    let translation_deleted = conn
        .execute(
            "DELETE FROM translation_jobs
             WHERE document_id IN (
               SELECT id FROM documents WHERE deleted_at IS NOT NULL
             )
             AND datetime(created_at) < datetime('now', ?1)",
            [&threshold],
        )
        .map_err(|e| e.to_string())?;

    Ok((parse_deleted, translation_deleted))
}

fn cleanup_output_cache_files(
    conn: &rusqlite::Connection,
    app_dir: &Path,
) -> Result<usize, String> {
    let output_dir = app_dir.join("outputs");
    if !output_dir.exists() {
        return Ok(0);
    }

    let mut referenced_paths: HashSet<String> = HashSet::new();

    let mut export_stmt = conn
        .prepare("SELECT file_path FROM export_records")
        .map_err(|e| e.to_string())?;
    let export_paths = export_stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    referenced_paths.extend(export_paths);

    let mut output_stmt = conn
        .prepare("SELECT file_path FROM document_outputs")
        .map_err(|e| e.to_string())?;
    let document_output_paths = output_stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    referenced_paths.extend(document_output_paths);

    let mut removed = 0usize;
    for entry in fs::read_dir(&output_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let path_str = path.to_string_lossy().to_string();
        if referenced_paths.contains(&path_str) {
            continue;
        }

        if fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }

    Ok(removed)
}

pub(crate) fn run_periodic_cleanup(
    conn: &rusqlite::Connection,
    settings: &crate::settings::SettingsManager,
    app_dir: &Path,
) -> Result<(), String> {
    let retention_days = load_log_retention_days(settings);
    let removed_logs = cleanup_expired_runtime_logs(app_dir, retention_days)?;
    let (removed_parse_jobs, removed_translation_jobs) =
        cleanup_deleted_document_job_logs(conn, retention_days)?;
    let removed_cache_files = cleanup_output_cache_files(conn, app_dir)?;

    if removed_logs > 0
        || removed_parse_jobs > 0
        || removed_translation_jobs > 0
        || removed_cache_files > 0
    {
        log::info!(
            "Periodic cleanup removed {} log entries, {} parse job rows, {} translation job rows, {} orphan cache files",
            removed_logs,
            removed_parse_jobs,
            removed_translation_jobs,
            removed_cache_files
        );
    }

    Ok(())
}

#[derive(Debug, Clone)]
struct TranslationRuntimeSettings {
    chunk_strategy: crate::chunking::TranslationChunkStrategy,
    chunk_size: usize,
    chunk_overlap: usize,
    max_concurrent_requests: usize,
    max_requests_per_minute: u32,
    smart_optimize_enabled: bool,
}

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
    pub max_retries: usize,
    pub max_concurrent_requests: usize,
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

fn parse_bounded_usize(
    value: Option<String>,
    default_value: usize,
    min: usize,
    max: usize,
) -> usize {
    value
        .map(|raw| raw.trim().to_string())
        .filter(|raw| !raw.is_empty())
        .and_then(|raw| raw.parse::<usize>().ok())
        .map(|parsed| parsed.clamp(min, max))
        .unwrap_or(default_value)
}

fn parse_bounded_u32(value: Option<String>, default_value: u32, min: u32, max: u32) -> u32 {
    value
        .map(|raw| raw.trim().to_string())
        .filter(|raw| !raw.is_empty())
        .and_then(|raw| raw.parse::<u32>().ok())
        .map(|parsed| parsed.clamp(min, max))
        .unwrap_or(default_value)
}

fn parse_bool(value: Option<String>, default_value: bool) -> bool {
    value
        .map(|raw| raw.trim().to_lowercase())
        .and_then(|raw| match raw.as_str() {
            "true" => Some(true),
            "false" => Some(false),
            _ => None,
        })
        .unwrap_or(default_value)
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value
        .map(|raw| raw.trim().to_string())
        .filter(|raw| !raw.is_empty())
}

fn parse_string_list(value: Option<String>) -> Vec<String> {
    value
        .unwrap_or_default()
        .split(|ch| matches!(ch, ',' | ';' | '\n' | '\r' | '，'))
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(|item| item.to_string())
        .collect()
}

fn get_setting_value(
    settings: &crate::settings::SettingsManager,
    key: &str,
) -> Result<Option<String>, String> {
    Ok(settings.get(key))
}

fn load_translation_runtime_settings(
    settings: &crate::settings::SettingsManager,
) -> Result<TranslationRuntimeSettings, String> {
    let chunk_strategy = crate::chunking::TranslationChunkStrategy::from_value(
        get_setting_value(settings, "translation.chunk_strategy")?
            .as_deref()
            .or(Some(DEFAULT_TRANSLATION_CHUNK_STRATEGY)),
    );

    let chunk_size = parse_bounded_usize(
        get_setting_value(settings, "translation.chunk_size")?,
        DEFAULT_TRANSLATION_CHUNK_SIZE,
        256,
        32000,
    );

    let chunk_overlap = parse_bounded_usize(
        get_setting_value(settings, "translation.chunk_overlap")?,
        DEFAULT_TRANSLATION_CHUNK_OVERLAP,
        0,
        chunk_size.saturating_sub(1),
    );

    let max_concurrent_requests = parse_bounded_usize(
        get_setting_value(settings, "translation.max_concurrent_requests")?,
        DEFAULT_TRANSLATION_MAX_CONCURRENT_REQUESTS,
        1,
        32,
    );

    let max_requests_per_minute = parse_bounded_u32(
        get_setting_value(settings, "translation.max_requests_per_minute")?,
        DEFAULT_TRANSLATION_MAX_REQUESTS_PER_MINUTE,
        1,
        600,
    );

    let smart_optimize_enabled = parse_bool(
        get_setting_value(settings, "translation.smart_optimize_enabled")?,
        false,
    );

    Ok(TranslationRuntimeSettings {
        chunk_strategy,
        chunk_size,
        chunk_overlap,
        max_concurrent_requests,
        max_requests_per_minute,
        smart_optimize_enabled,
    })
}

pub(crate) fn load_llm_sampling_config(
    settings: &crate::settings::SettingsManager,
    scope: &str,
) -> Result<LlmSamplingConfig, String> {
    Ok(LlmSamplingConfig {
        temperature: parse_optional_f64(get_setting_value(
            settings,
            &format!("llm.{scope}.temperature"),
        )?),
        top_p: parse_optional_f64(get_setting_value(settings, &format!("llm.{scope}.top_p"))?),
        top_k: parse_optional_i32(get_setting_value(settings, &format!("llm.{scope}.top_k"))?),
        max_tokens: parse_optional_i32(get_setting_value(
            settings,
            &format!("llm.{scope}.max_tokens"),
        )?),
    })
}

fn load_builtin_extraction_state_map(
    settings: &crate::settings::SettingsManager,
) -> HashMap<String, bool> {
    match settings.get(EXTRACTION_BUILTIN_STATE_SETTING_KEY) {
        Some(raw) => serde_json::from_str::<HashMap<String, bool>>(&raw).unwrap_or_else(|error| {
            log::warn!(
                "Failed to parse extraction builtin state map from settings: {}",
                error
            );
            HashMap::new()
        }),
        None => HashMap::new(),
    }
}

fn save_builtin_extraction_state_map(
    settings: &crate::settings::SettingsManager,
    states: &HashMap<String, bool>,
) -> Result<(), String> {
    let serialized = serde_json::to_string(states).map_err(|e| e.to_string())?;
    settings.set(EXTRACTION_BUILTIN_STATE_SETTING_KEY.to_string(), serialized)
}

fn normalize_field_key(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Field key is required".to_string());
    }

    let mut normalized = String::with_capacity(trimmed.len());
    let mut previous_was_separator = false;

    for ch in trimmed.chars() {
        let lower = ch.to_ascii_lowercase();
        if lower.is_ascii_alphanumeric() {
            normalized.push(lower);
            previous_was_separator = false;
            continue;
        }

        if matches!(lower, '_' | '-' | ' ') && !normalized.is_empty() && !previous_was_separator {
            normalized.push('_');
            previous_was_separator = true;
        }
    }

    while normalized.ends_with('_') {
        let _ = normalized.pop();
    }

    if normalized.is_empty() {
        return Err("Field key must contain letters or numbers".to_string());
    }
    if normalized.len() > 64 {
        return Err("Field key must be 64 characters or fewer".to_string());
    }
    if !normalized
        .chars()
        .next()
        .map(|ch| ch.is_ascii_alphabetic())
        .unwrap_or(false)
    {
        return Err("Field key must start with a letter".to_string());
    }

    Ok(normalized)
}

fn normalize_requested_field_keys(
    field_keys: Option<Vec<String>>,
) -> Result<Option<Vec<String>>, String> {
    let Some(field_keys) = field_keys else {
        return Ok(None);
    };

    let mut normalized = Vec::new();
    for field_key in field_keys {
        let normalized_key = normalize_field_key(&field_key)?;
        if !normalized
            .iter()
            .any(|existing| existing == &normalized_key)
        {
            normalized.push(normalized_key);
        }
    }

    Ok(Some(normalized))
}

fn serialize_provider_model_config(
    config: Option<&ProviderModelConfig>,
) -> Result<Option<String>, String> {
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
            let config = parse_provider_model_config(raw_config).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    8,
                    rusqlite::types::Type::Text,
                    Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
                )
            })?;

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
    let sql = format!(
        "{} ORDER BY priority ASC, created_at ASC, name ASC",
        provider_select_sql()
    );
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

fn resolve_extraction_provider_internal(
    conn: &rusqlite::Connection,
    settings: &crate::settings::SettingsManager,
    requested_provider_id: Option<&str>,
) -> Result<(ProviderRecord, ProviderModel, LlmSamplingConfig), String> {
    let resolve_sampling = |record: &ProviderRecord| -> Result<LlmSamplingConfig, String> {
        let mut sampling = load_llm_sampling_config(settings, "chat")?;
        if sampling.temperature.is_none() {
            sampling.temperature = record.legacy_temperature;
        }
        if sampling.max_tokens.is_none() {
            sampling.max_tokens = record.legacy_max_tokens;
        }
        Ok(sampling)
    };

    if let Some(provider_id) = requested_provider_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let record = load_provider_record_by_id(conn, provider_id)?;
        if !record.is_active {
            return Err(format!(
                "Provider \"{}\" is disabled and cannot be used for extraction",
                record.name
            ));
        }

        let models = load_provider_models_for_provider(conn, provider_id)?;
        let chat_model = find_primary_model_for_type(&models, PROVIDER_MODEL_TYPE_CHAT)
            .ok_or_else(|| {
                format!(
                    "Provider \"{}\" has no active chat model for extraction",
                    record.name
                )
            })?;
        return Ok((record.clone(), chat_model, resolve_sampling(&record)?));
    }

    if let Some(setting_provider_id) = settings
        .get(EXTRACTION_PROVIDER_SETTING_KEY)
        .map(|raw| raw.trim().to_string())
        .filter(|raw| !raw.is_empty())
    {
        match load_provider_record_by_id(conn, &setting_provider_id) {
            Ok(record) if record.is_active => {
                let models = load_provider_models_for_provider(conn, &setting_provider_id)?;
                if let Some(chat_model) =
                    find_primary_model_for_type(&models, PROVIDER_MODEL_TYPE_CHAT)
                {
                    return Ok((record.clone(), chat_model, resolve_sampling(&record)?));
                }

                log::warn!(
                    "Configured extraction provider {} has no active chat model. Falling back to automatic selection.",
                    setting_provider_id
                );
            }
            Ok(record) => {
                log::warn!(
                    "Configured extraction provider {} ({}) is disabled. Falling back to automatic selection.",
                    setting_provider_id,
                    record.name
                );
            }
            Err(error) => {
                log::warn!(
                    "Configured extraction provider {} is unavailable: {}. Falling back to automatic selection.",
                    setting_provider_id,
                    error
                );
            }
        }
    }

    for record in load_provider_records(conn)? {
        if !record.is_active {
            continue;
        }

        let models = load_provider_models_for_provider(conn, &record.id)?;
        if let Some(chat_model) = find_primary_model_for_type(&models, PROVIDER_MODEL_TYPE_CHAT) {
            return Ok((record.clone(), chat_model, resolve_sampling(&record)?));
        }
    }

    Err("No active chat provider is available for field extraction".to_string())
}

fn summarize_extraction_failures(results: &[ExtractionResult]) -> String {
    let failures = results
        .iter()
        .filter_map(|result| {
            result
                .error
                .as_ref()
                .map(|error| format!("{}: {}", result.field_key, error))
        })
        .collect::<Vec<_>>();

    if failures.is_empty() {
        return "No fields were extracted".to_string();
    }

    if failures.len() == 1 {
        return failures[0].clone();
    }

    format!("{} (and {} more)", failures[0], failures.len() - 1)
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
                if model.supports_vision.unwrap_or(false) {
                    1
                } else {
                    0
                },
                if model.is_active.unwrap_or(true) {
                    1
                } else {
                    0
                },
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

fn enrich_documents(conn: &rusqlite::Connection, documents: &mut [Document]) -> Result<(), String> {
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

fn map_mineru_processed_file_row(
    row: &rusqlite::Row<'_>,
) -> Result<MineruProcessedFile, rusqlite::Error> {
    Ok(MineruProcessedFile {
        id: row.get(0)?,
        document_id: row.get(1)?,
        artifact_type: row.get(2)?,
        file_path: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
        is_file_missing: None,
    })
}

fn load_mineru_processed_files_internal(
    conn: &rusqlite::Connection,
    document_id: &str,
) -> Result<Vec<MineruProcessedFile>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, document_id, artifact_type, file_path, created_at, updated_at
             FROM mineru_processed_files
             WHERE document_id = ?1
             ORDER BY artifact_type",
        )
        .map_err(|e| e.to_string())?;

    let mut files = stmt
        .query_map([document_id], map_mineru_processed_file_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    for file in files.iter_mut() {
        file.is_file_missing = Some(!Path::new(&file.file_path).exists());
    }

    Ok(files)
}

fn load_mineru_processed_file_path_internal(
    conn: &rusqlite::Connection,
    document_id: &str,
    artifact_type: &str,
) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT file_path FROM mineru_processed_files
         WHERE document_id = ?1 AND artifact_type = ?2",
        (document_id, artifact_type),
        |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn compute_content_hash(content: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    content.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn load_latest_parsed_content_internal(
    conn: &rusqlite::Connection,
    document_id: &str,
) -> Result<ParsedContent, String> {
    let (id, doc_id, version, markdown_ref, json_ref, structure_ref, created_at): (
        String,
        String,
        i32,
        String,
        String,
        Option<String>,
        String,
    ) = conn
        .query_row(
            "SELECT id, document_id, version, markdown_content, json_content, structure_tree, created_at
             FROM parsed_contents
             WHERE document_id = ?1
             ORDER BY version DESC
             LIMIT 1",
            [document_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    let markdown_content = crate::content_store::read_content_blob(&markdown_ref)?;
    let json_content = crate::content_store::read_content_blob(&json_ref)?;
    let structure_tree = match structure_ref {
        Some(raw) => Some(crate::content_store::read_content_blob(&raw)?),
        None => None,
    };
    let markdown_file_path =
        load_mineru_processed_file_path_internal(conn, document_id, "markdown")?.or_else(|| {
            if Path::new(&markdown_ref).is_absolute() {
                Some(markdown_ref.clone())
            } else {
                None
            }
        });
    let asset_base_dir = markdown_file_path.as_deref().and_then(|path| {
        Path::new(path)
            .parent()
            .map(|dir| dir.to_string_lossy().to_string())
    });

    Ok(ParsedContent {
        id,
        document_id: doc_id,
        version,
        markdown_content,
        json_content,
        structure_tree,
        markdown_file_path,
        asset_base_dir,
        created_at,
    })
}

fn load_latest_parsed_markdown_internal(
    conn: &rusqlite::Connection,
    document_id: &str,
) -> Result<String, String> {
    load_latest_parsed_content_internal(conn, document_id).map(|row| row.markdown_content)
}

fn load_latest_translated_content_internal(
    conn: &rusqlite::Connection,
    document_id: &str,
) -> Result<TranslatedContent, String> {
    let (id, doc_id, version, content_ref, created_at): (String, String, i32, String, String) =
        conn.query_row(
            "SELECT id, document_id, version, content, created_at
             FROM translated_contents
             WHERE document_id = ?1
             ORDER BY version DESC
             LIMIT 1",
            [document_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    let content = crate::content_store::read_content_blob(&content_ref)?;

    Ok(TranslatedContent {
        id,
        document_id: doc_id,
        version,
        content,
        created_at,
    })
}

fn load_latest_translated_text_internal(
    conn: &rusqlite::Connection,
    document_id: &str,
) -> Result<String, String> {
    load_latest_translated_content_internal(conn, document_id).map(|row| row.content)
}

fn load_custom_extraction_templates_internal(
    conn: &rusqlite::Connection,
) -> Result<Vec<ExtractionTemplate>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, field_key, description, system_prompt, user_prompt, is_enabled, created_at, updated_at
             FROM extraction_templates
             ORDER BY created_at ASC, name ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(ExtractionTemplate {
                id: row.get(0)?,
                name: row.get(1)?,
                field_key: row.get(2)?,
                description: row.get(3)?,
                system_prompt: row.get(4)?,
                user_prompt: row.get(5)?,
                is_enabled: row.get::<_, i32>(6)? != 0,
                is_builtin: false,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn load_custom_extraction_template_by_id_internal(
    conn: &rusqlite::Connection,
    id: &str,
) -> Result<ExtractionTemplate, String> {
    conn.query_row(
        "SELECT id, name, field_key, description, system_prompt, user_prompt, is_enabled, created_at, updated_at
         FROM extraction_templates
         WHERE id = ?1",
        [id],
        |row| {
            Ok(ExtractionTemplate {
                id: row.get(0)?,
                name: row.get(1)?,
                field_key: row.get(2)?,
                description: row.get(3)?,
                system_prompt: row.get(4)?,
                user_prompt: row.get(5)?,
                is_enabled: row.get::<_, i32>(6)? != 0,
                is_builtin: false,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

fn load_custom_extraction_template_by_field_key_internal(
    conn: &rusqlite::Connection,
    field_key: &str,
) -> Result<Option<ExtractionTemplate>, String> {
    conn.query_row(
        "SELECT id, name, field_key, description, system_prompt, user_prompt, is_enabled, created_at, updated_at
         FROM extraction_templates
         WHERE field_key = ?1",
        [field_key],
        |row| {
            Ok(ExtractionTemplate {
                id: row.get(0)?,
                name: row.get(1)?,
                field_key: row.get(2)?,
                description: row.get(3)?,
                system_prompt: row.get(4)?,
                user_prompt: row.get(5)?,
                is_enabled: row.get::<_, i32>(6)? != 0,
                is_builtin: false,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn build_builtin_extraction_templates(
    settings: &crate::settings::SettingsManager,
) -> Vec<ExtractionTemplate> {
    let state_map = load_builtin_extraction_state_map(settings);
    crate::extractor::builtin_templates()
        .iter()
        .map(|template| {
            let enabled = state_map
                .get(template.field_key)
                .copied()
                .unwrap_or(template.default_enabled);
            template.to_template(enabled)
        })
        .collect()
}

fn resolve_extraction_templates(
    conn: &rusqlite::Connection,
    settings: &crate::settings::SettingsManager,
    requested_field_keys: Option<&[String]>,
) -> Result<Vec<ExtractionTemplate>, String> {
    let builtin_templates = build_builtin_extraction_templates(settings);
    let custom_templates = load_custom_extraction_templates_internal(conn)?;

    if let Some(requested_field_keys) = requested_field_keys {
        let mut resolved = Vec::with_capacity(requested_field_keys.len());
        let mut missing = Vec::new();

        for field_key in requested_field_keys {
            if let Some(template) = builtin_templates
                .iter()
                .find(|template| template.field_key == *field_key)
            {
                resolved.push(template.clone());
                continue;
            }

            if let Some(template) = custom_templates
                .iter()
                .find(|template| template.field_key == *field_key)
            {
                resolved.push(template.clone());
                continue;
            }

            missing.push(field_key.clone());
        }

        if !missing.is_empty() {
            return Err(format!(
                "Unknown extraction template fields: {}",
                missing.join(", ")
            ));
        }

        if resolved.is_empty() {
            return Err("No matching extraction templates found".to_string());
        }

        return Ok(resolved);
    }

    let mut resolved = builtin_templates
        .into_iter()
        .filter(|template| template.is_enabled)
        .collect::<Vec<_>>();
    resolved.extend(
        custom_templates
            .into_iter()
            .filter(|template| template.is_enabled),
    );

    if resolved.is_empty() {
        return Err("No enabled extraction templates found".to_string());
    }

    Ok(resolved)
}

fn load_document_metadata_rows_internal(
    conn: &rusqlite::Connection,
    document_id: &str,
) -> Result<Vec<DocumentMetadataField>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, document_id, field_key, field_value, provider_id, model_name, extracted_at, error
             FROM document_metadata
             WHERE document_id = ?1
             ORDER BY field_key ASC, extracted_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([document_id], |row| {
            Ok(DocumentMetadataField {
                id: row.get(0)?,
                document_id: row.get(1)?,
                field_key: row.get(2)?,
                field_value: row.get(3)?,
                provider_id: row.get(4)?,
                model_name: row.get(5)?,
                extracted_at: row.get(6)?,
                error: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn upsert_document_metadata_fields_internal(
    conn: &rusqlite::Connection,
    rows: &[DocumentMetadataField],
) -> Result<(), String> {
    for row in rows {
        let id = if row.id.trim().is_empty() {
            Uuid::new_v4().to_string()
        } else {
            row.id.clone()
        };
        let extracted_at = if row.extracted_at.trim().is_empty() {
            Utc::now().to_rfc3339()
        } else {
            row.extracted_at.clone()
        };

        conn.execute(
            "INSERT INTO document_metadata (
                id,
                document_id,
                field_key,
                field_value,
                provider_id,
                model_name,
                extracted_at,
                error
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(document_id, field_key) DO UPDATE SET
                field_value = excluded.field_value,
                provider_id = excluded.provider_id,
                model_name = excluded.model_name,
                extracted_at = excluded.extracted_at,
                error = excluded.error",
            (
                &id,
                &row.document_id,
                &row.field_key,
                &row.field_value,
                &row.provider_id,
                &row.model_name,
                &extracted_at,
                &row.error,
            ),
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn persist_extraction_results_internal(
    conn: &rusqlite::Connection,
    document_id: &str,
    results: &[ExtractionResult],
) -> Result<(), String> {
    let rows = results
        .iter()
        .map(|result| DocumentMetadataField {
            id: String::new(),
            document_id: document_id.to_string(),
            field_key: result.field_key.clone(),
            field_value: result.field_value.clone(),
            provider_id: Some(result.provider_id.clone()),
            model_name: Some(result.model_name.clone()),
            extracted_at: result.extracted_at.clone(),
            error: result.error.clone(),
        })
        .collect::<Vec<_>>();

    upsert_document_metadata_fields_internal(conn, &rows)
}

fn rewrite_document_metadata_meta_json(
    conn: &rusqlite::Connection,
    app_dir: &Path,
    document_id: &str,
) -> Result<(), String> {
    let rows = load_document_metadata_rows_internal(conn, document_id)?;
    crate::extractor::write_meta_json(app_dir, document_id, &rows)
}

fn load_document_metadata_with_backfill_internal(
    conn: &rusqlite::Connection,
    app_dir: &Path,
    document_id: &str,
) -> Result<Vec<DocumentMetadataField>, String> {
    let existing = load_document_metadata_rows_internal(conn, document_id)?;
    if !existing.is_empty() {
        return Ok(existing);
    }

    let meta_rows = match crate::extractor::read_meta_json(app_dir, document_id) {
        Ok(rows) => rows,
        Err(error) => {
            log::warn!(
                "Failed to backfill document metadata from meta.json for document {}: {}",
                document_id,
                error
            );
            return Ok(Vec::new());
        }
    };

    if meta_rows.is_empty() {
        return Ok(Vec::new());
    }

    upsert_document_metadata_fields_internal(conn, &meta_rows)?;
    load_document_metadata_rows_internal(conn, document_id)
}

fn next_content_version(
    conn: &rusqlite::Connection,
    table_name: &str,
    document_id: &str,
) -> Result<i32, String> {
    let sql =
        format!("SELECT COALESCE(MAX(version), 0) + 1 FROM {table_name} WHERE document_id = ?1");
    conn.query_row(&sql, [document_id], |row| row.get::<_, i32>(0))
        .map_err(|e| e.to_string())
}

#[derive(Default)]
struct ExtractedMineruArtifacts {
    markdown_path: Option<PathBuf>,
    json_path: Option<PathBuf>,
    structure_path: Option<PathBuf>,
    html_path: Option<PathBuf>,
    docx_path: Option<PathBuf>,
    latex_path: Option<PathBuf>,
}

fn mineru_processed_document_dir(app_dir: &Path, document_id: &str) -> PathBuf {
    crate::app_dirs::mineru_processed_dir(app_dir).join(document_id)
}

pub(crate) fn migrate_legacy_mineru_processed_storage(
    conn: &rusqlite::Connection,
    app_dir: &Path,
) -> Result<bool, String> {
    let Some(legacy_dir) = crate::app_dirs::legacy_mineru_processed_dir() else {
        return Ok(false);
    };
    if !legacy_dir.exists() {
        return Ok(false);
    }

    let managed_dir = crate::app_dirs::mineru_processed_dir(app_dir);
    if legacy_dir == managed_dir {
        return Ok(false);
    }

    let moved = crate::app_dirs::move_dir_contents(&legacy_dir, &managed_dir)?;

    let mut stmt = conn
        .prepare("SELECT id, file_path FROM mineru_processed_files")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut updated_rows = false;
    for (id, file_path) in rows {
        let path = PathBuf::from(&file_path);
        let Ok(relative) = path.strip_prefix(&legacy_dir) else {
            continue;
        };

        let managed_path = managed_dir.join(relative);
        let managed_path_str = managed_path.to_string_lossy().to_string();
        if managed_path_str == file_path {
            continue;
        }

        conn.execute(
            "UPDATE mineru_processed_files SET file_path = ?1 WHERE id = ?2",
            (&managed_path_str, &id),
        )
        .map_err(|e| e.to_string())?;
        updated_rows = true;
    }

    Ok(moved || updated_rows)
}

fn upsert_mineru_processed_file_record(
    conn: &rusqlite::Connection,
    document_id: &str,
    artifact_type: &str,
    path: &Path,
    now: &str,
) -> Result<(), String> {
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO mineru_processed_files (id, document_id, artifact_type, file_path, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)
         ON CONFLICT(document_id, artifact_type)
         DO UPDATE SET
           file_path = excluded.file_path,
           updated_at = excluded.updated_at",
        (
            &id,
            document_id,
            artifact_type,
            path.to_str().ok_or("File path contains invalid characters")?,
            now,
        ),
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn safe_mineru_archive_relative_path(raw_name: &str) -> Option<PathBuf> {
    let normalized = raw_name.replace('\\', "/");
    let mut relative = PathBuf::new();

    for component in Path::new(&normalized).components() {
        match component {
            std::path::Component::Normal(segment) => relative.push(segment),
            std::path::Component::CurDir => {}
            _ => return None,
        }
    }

    if relative.as_os_str().is_empty() {
        None
    } else {
        Some(relative)
    }
}

fn select_preferred_path(current: &mut Option<PathBuf>, candidate: &Path) {
    let should_replace = match current.as_ref() {
        None => true,
        Some(existing) => {
            let existing_name = existing
                .file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.to_ascii_lowercase())
                .unwrap_or_default();
            let candidate_name = candidate
                .file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.to_ascii_lowercase())
                .unwrap_or_default();

            candidate_name == "index.html"
                || candidate_name == "full.html"
                || (existing_name != "index.html"
                    && existing_name != "full.html"
                    && candidate.components().count() < existing.components().count())
        }
    };

    if should_replace {
        *current = Some(candidate.to_path_buf());
    }
}

fn select_preferred_mineru_markdown_path(current: &mut Option<PathBuf>, candidate: &Path) {
    let current_entry_name = current
        .as_ref()
        .map(|path| path.to_string_lossy().into_owned());
    let candidate_entry_name = candidate.to_string_lossy().into_owned();
    let should_replace = crate::mineru::should_prefer_mineru_markdown_entry(
        current_entry_name.as_deref(),
        &candidate_entry_name,
    );

    if should_replace {
        *current = Some(candidate.to_path_buf());
    }
}

fn extract_mineru_archive(
    archive_bytes: &[u8],
    target_dir: &Path,
) -> Result<ExtractedMineruArtifacts, String> {
    let reader = Cursor::new(archive_bytes);
    let mut archive = ZipArchive::new(reader)
        .map_err(|e| format!("Failed to open MinerU parse archive: {}", e))?;
    let mut artifacts = ExtractedMineruArtifacts::default();

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| format!("Failed to read archive entry #{index}: {}", e))?;
        let Some(relative_path) = safe_mineru_archive_relative_path(entry.name()) else {
            continue;
        };

        let output_path = target_dir.join(&relative_path);
        if entry.is_dir() {
            fs::create_dir_all(&output_path).map_err(|e| e.to_string())?;
            continue;
        }

        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        let mut file = fs::File::create(&output_path).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut file).map_err(|e| e.to_string())?;

        let file_name = output_path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.to_ascii_lowercase())
            .unwrap_or_default();
        let extension = output_path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase())
            .unwrap_or_default();

        if crate::mineru::is_mineru_markdown_file_name(&file_name) {
            select_preferred_mineru_markdown_path(&mut artifacts.markdown_path, &output_path);
            continue;
        }

        if crate::mineru::is_mineru_layout_json_file_name(&file_name) {
            if artifacts.json_path.is_none() {
                artifacts.json_path = Some(output_path.clone());
            }
            continue;
        }

        if crate::mineru::is_mineru_content_list_json_file_name(&file_name) {
            if artifacts.structure_path.is_none() {
                artifacts.structure_path = Some(output_path.clone());
            }
            continue;
        }

        if crate::mineru::is_mineru_model_json_file_name(&file_name) {
            if artifacts.structure_path.is_none() {
                artifacts.structure_path = Some(output_path.clone());
            }
            continue;
        }

        match extension.as_str() {
            "html" | "htm" => select_preferred_path(&mut artifacts.html_path, &output_path),
            "docx" => {
                if artifacts.docx_path.is_none() {
                    artifacts.docx_path = Some(output_path.clone());
                }
            }
            "tex" | "latex" => {
                if artifacts.latex_path.is_none() {
                    artifacts.latex_path = Some(output_path.clone());
                }
            }
            _ => {}
        }
    }

    Ok(artifacts)
}

fn delete_mineru_processed_records_and_files(
    conn: &rusqlite::Connection,
    app_dir: Option<&Path>,
    document_id: &str,
) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT file_path FROM mineru_processed_files WHERE document_id = ?1")
        .map_err(|e| e.to_string())?;
    let paths = stmt
        .query_map([document_id], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    for path in paths {
        let path_ref = Path::new(&path);
        if path_ref.exists() {
            if path_ref.is_dir() {
                let _ = fs::remove_dir_all(path_ref);
            } else {
                let _ = fs::remove_file(path_ref);
            }
        }
    }

    if let Some(app_dir) = app_dir {
        let document_dir = mineru_processed_document_dir(app_dir, document_id);
        if document_dir.exists() {
            let _ = fs::remove_dir_all(document_dir);
        }
    }

    conn.execute(
        "DELETE FROM mineru_processed_files WHERE document_id = ?1",
        [document_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn persist_mineru_processed_files(
    conn: &rusqlite::Connection,
    app_dir: &Path,
    document_id: &str,
    markdown: &str,
    json_content: &str,
    structure_json: &str,
    now: &str,
) -> Result<(), String> {
    let document_dir = mineru_processed_document_dir(app_dir, document_id);
    fs::create_dir_all(&document_dir).map_err(|e| e.to_string())?;

    let timestamp = Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let markdown_path = document_dir.join(format!("parsed-{timestamp}.md"));
    let json_path = document_dir.join(format!("parsed-{timestamp}.json"));
    let structure_path = document_dir.join(format!("structure-{timestamp}.json"));

    fs::write(&markdown_path, markdown).map_err(|e| e.to_string())?;
    fs::write(&json_path, json_content).map_err(|e| e.to_string())?;
    fs::write(&structure_path, structure_json).map_err(|e| e.to_string())?;

    let records = [
        ("markdown", markdown_path),
        ("json", json_path),
        ("structure", structure_path),
    ];

    for (artifact_type, path) in records {
        upsert_mineru_processed_file_record(conn, document_id, artifact_type, &path, now)?;
    }

    Ok(())
}

fn persist_mineru_processed_archive(
    conn: &rusqlite::Connection,
    app_dir: &Path,
    document_id: &str,
    archive_bytes: &[u8],
    now: &str,
) -> Result<(), String> {
    let document_dir = mineru_processed_document_dir(app_dir, document_id);
    fs::create_dir_all(&document_dir).map_err(|e| e.to_string())?;

    let timestamp = Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let archive_path = document_dir.join(format!("parsed-{timestamp}.zip"));
    fs::write(&archive_path, archive_bytes).map_err(|e| e.to_string())?;
    upsert_mineru_processed_file_record(conn, document_id, "archive", &archive_path, now)?;

    let extracted_dir = document_dir.join(format!("archive-{timestamp}"));
    let extracted = extract_mineru_archive(archive_bytes, &extracted_dir)?;

    if let Some(markdown_path) = extracted.markdown_path.as_deref() {
        upsert_mineru_processed_file_record(conn, document_id, "markdown", markdown_path, now)?;
    }
    if let Some(json_path) = extracted.json_path.as_deref() {
        upsert_mineru_processed_file_record(conn, document_id, "json", json_path, now)?;
    }
    if let Some(structure_path) = extracted.structure_path.as_deref() {
        upsert_mineru_processed_file_record(conn, document_id, "structure", structure_path, now)?;
    }
    if let Some(html_path) = extracted.html_path.as_deref() {
        upsert_mineru_processed_file_record(conn, document_id, "html", html_path, now)?;
    }
    if let Some(docx_path) = extracted.docx_path.as_deref() {
        upsert_mineru_processed_file_record(conn, document_id, "docx", docx_path, now)?;
    }
    if let Some(latex_path) = extracted.latex_path.as_deref() {
        upsert_mineru_processed_file_record(conn, document_id, "latex", latex_path, now)?;
    }

    Ok(())
}

pub(crate) fn restore_missing_mineru_processed_files(
    conn: &rusqlite::Connection,
    app_dir: &Path,
) -> Result<usize, String> {
    let mut stmt = conn
        .prepare(
            "SELECT d.id
             FROM documents d
             WHERE d.deleted_at IS NULL
               AND EXISTS (
                   SELECT 1 FROM parse_jobs pj WHERE pj.document_id = d.id
               )
               AND EXISTS (
                   SELECT 1 FROM parsed_contents pc WHERE pc.document_id = d.id
               )
               AND NOT EXISTS (
                   SELECT 1 FROM mineru_processed_files mpf WHERE mpf.document_id = d.id
               )",
        )
        .map_err(|e| e.to_string())?;

    let document_ids = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut restored = 0usize;
    for document_id in document_ids {
        let parsed = load_latest_parsed_content_internal(conn, &document_id)?;
        let structure_json = parsed.structure_tree.unwrap_or_else(|| "null".to_string());

        persist_mineru_processed_files(
            conn,
            app_dir,
            &document_id,
            &parsed.markdown_content,
            &parsed.json_content,
            &structure_json,
            &Utc::now().to_rfc3339(),
        )?;
        restored += 1;
    }

    Ok(restored)
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
    delete_mineru_processed_records_and_files(conn, app_dir, document_id)?;

    if remove_parsed_content {
        clear_document_parsed_history(conn, app_dir, document_id)?;
    }

    clear_document_translation_and_index_data(
        conn,
        app_dir,
        document_id,
        remove_parsed_content,
        now,
    )
}

fn clear_document_translation_and_index_data(
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
    if let Some(app_dir) = app_dir {
        let _ = crate::content_store::remove_translated_dir(app_dir, document_id);
    }
    delete_document_output_record_and_file(conn, "translated_pdf", document_id)?;

    Ok(())
}

fn clear_document_parsed_history(
    conn: &rusqlite::Connection,
    app_dir: Option<&Path>,
    document_id: &str,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM parsed_contents WHERE document_id = ?1",
        [document_id],
    )
    .map_err(|e| e.to_string())?;

    if let Some(app_dir) = app_dir {
        let _ = crate::content_store::remove_parsed_dir(app_dir, document_id);
    }

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
    delete_mineru_processed_records_and_files(conn, None, document_id)?;

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

fn mark_index_job_failed(
    state: &AppState,
    document_id: &str,
    index_job_id: &str,
    message: &str,
) -> Result<(), String> {
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

    conn.execute(
        "UPDATE index_jobs
         SET status = 'failed', error_message = ?1, completed_at = ?2, updated_at = ?2
         WHERE id = ?3",
        (message, &now, index_job_id),
    )
    .map_err(|e| e.to_string())?;

    log::error!(
        "Index job {} for document {} failed: {}",
        index_job_id,
        document_id,
        message
    );
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

    // Also cancel any active index_jobs for this document
    conn.execute(
        "UPDATE index_jobs SET status = 'failed', error_message = 'Cancelled by user', completed_at = ?1, updated_at = ?1 WHERE document_id = ?2 AND status IN ('pending', 'indexing')",
        (&now, document_id),
    ).map_err(|e| e.to_string())?;

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

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn test_connection() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(include_str!("../migrations/001_initial_schema.sql"))
            .expect("apply initial schema");
        conn.execute_batch(include_str!("../migrations/002_vector_indexes.sql"))
            .expect("apply vector index schema");
        conn.execute_batch(include_str!("../migrations/004_document_outputs.sql"))
            .expect("apply document outputs schema");
        conn.execute_batch(include_str!("../migrations/006_mineru_processed_files.sql"))
            .expect("apply mineru processed files schema");
        conn
    }

    #[test]
    fn translation_cleanup_keeps_mineru_processed_files() {
        let conn = test_connection();
        let now = "2026-04-03T12:00:00Z";
        let document_id = "doc-1";

        conn.execute(
            "INSERT INTO documents (
                id, title, filename, file_path, file_size,
                parse_status, translation_status, index_status,
                created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, 'completed', 'completed', 'completed', ?6, ?6)",
            (
                document_id,
                "Sample",
                "sample.pdf",
                "C:\\sample.pdf",
                100_i64,
                now,
            ),
        )
        .expect("insert document");

        conn.execute(
            "INSERT INTO mineru_processed_files (
                id, document_id, artifact_type, file_path, created_at, updated_at
             ) VALUES (?1, ?2, 'markdown', ?3, ?4, ?4)",
            ("artifact-1", document_id, "C:\\mineru\\parsed.md", now),
        )
        .expect("insert mineru artifact");

        conn.execute(
            "INSERT INTO translated_contents (id, document_id, version, content, created_at)
             VALUES (?1, ?2, 1, ?3, ?4)",
            ("translated-1", document_id, "C:\\translated.md", now),
        )
        .expect("insert translated content");

        conn.execute(
            "INSERT INTO chunks (id, document_id, content, chunk_index, created_at)
             VALUES (?1, ?2, ?3, 0, ?4)",
            ("chunk-1", document_id, "chunk text", now),
        )
        .expect("insert chunk");

        conn.execute(
            "INSERT INTO embeddings (id, chunk_id, vector, model, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            ("embedding-1", "chunk-1", vec![0_u8], "test-model", now),
        )
        .expect("insert embedding");

        conn.execute(
            "INSERT INTO document_vector_indexes (
                document_id, backend, collection_key, embedding_model, vector_dimension, created_at, updated_at
             ) VALUES (?1, 'sqlite', 'collection', 'test-model', 1, ?2, ?2)",
            (document_id, now),
        )
        .expect("insert vector index");

        conn.execute(
            "INSERT INTO document_outputs (
                id, document_id, output_type, file_path, created_at, updated_at
             ) VALUES (?1, ?2, 'translated_pdf', ?3, ?4, ?4)",
            ("output-1", document_id, "C:\\translated.pdf", now),
        )
        .expect("insert translated pdf output");

        clear_document_translation_and_index_data(&conn, None, document_id, false, now)
            .expect("clear translation/index data");

        let artifact_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM mineru_processed_files WHERE document_id = ?1",
                [document_id],
                |row| row.get(0),
            )
            .expect("count mineru artifacts");
        assert_eq!(artifact_count, 1);

        let translated_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM translated_contents WHERE document_id = ?1",
                [document_id],
                |row| row.get(0),
            )
            .expect("count translated contents");
        assert_eq!(translated_count, 0);

        let chunk_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM chunks WHERE document_id = ?1",
                [document_id],
                |row| row.get(0),
            )
            .expect("count chunks");
        assert_eq!(chunk_count, 0);

        let embedding_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM embeddings", [], |row| row.get(0))
            .expect("count embeddings");
        assert_eq!(embedding_count, 0);

        let vector_index_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM document_vector_indexes WHERE document_id = ?1",
                [document_id],
                |row| row.get(0),
            )
            .expect("count vector indexes");
        assert_eq!(vector_index_count, 0);

        let translated_output_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM document_outputs WHERE document_id = ?1",
                [document_id],
                |row| row.get(0),
            )
            .expect("count document outputs");
        assert_eq!(translated_output_count, 0);

        let statuses: (String, String, String) = conn
            .query_row(
                "SELECT parse_status, translation_status, index_status
                 FROM documents WHERE id = ?1",
                [document_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("load document statuses");
        assert_eq!(statuses.0, "completed");
        assert_eq!(statuses.1, "pending");
        assert_eq!(statuses.2, "pending");
    }
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
                } else if let Err(error) =
                    crate::content_store::remove_document_dir(&app_dir, document_id)
                {
                    issues.push(DocumentCleanupIssue {
                        resource_type: "document_contents".to_string(),
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
            .prepare(
                "SELECT id FROM documents WHERE deleted_at IS NOT NULL ORDER BY updated_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let document_ids = stmt
            .query_map([], |row| row.get::<_, String>(0))
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

    let folders = stmt
        .query_map([], |row| {
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

    conn.execute_batch("BEGIN IMMEDIATE")
        .map_err(|e| e.to_string())?;
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
                if input.is_active.unwrap_or(true) {
                    1
                } else {
                    0
                },
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

    conn.execute_batch("BEGIN IMMEDIATE")
        .map_err(|e| e.to_string())?;
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
                    if input.is_active.unwrap_or(true) {
                        1
                    } else {
                        0
                    },
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
        let _permit = state_clone.parse_limiter.acquire().await;
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

struct MinerUParseExecution {
    parse_result: crate::mineru::ParseResult,
    archive_bytes: Option<Vec<u8>>,
}

fn mark_parse_job_failed(
    conn: &rusqlite::Connection,
    job_id: &str,
    document_id: &str,
    now: &str,
    error_message: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE parse_jobs SET status = 'failed', error_message = ?, completed_at = ?, updated_at = ? WHERE id = ?",
        (error_message, now, now, job_id),
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE documents
         SET parse_status = 'failed', updated_at = ?1
         WHERE id = ?2 AND deleted_at IS NULL",
        (now, document_id),
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn persist_parse_job_success(
    conn: &rusqlite::Connection,
    app_dir: Option<&Path>,
    job_id: &str,
    document_id: &str,
    execution: MinerUParseExecution,
    now: &str,
) -> Result<(), String> {
    let app_dir = app_dir.ok_or("App dir is required for parsed content storage")?;
    let MinerUParseExecution {
        parse_result,
        archive_bytes,
    } = execution;
    let content_id = Uuid::new_v4().to_string();
    let version = next_content_version(conn, "parsed_contents", document_id)?;
    let structure_json = parse_result.structure.to_string();

    let (markdown_path, json_path, structure_path) = crate::content_store::write_parsed_version(
        app_dir,
        document_id,
        version,
        &parse_result.markdown,
        &parse_result.json,
        Some(&structure_json),
    )?;

    let persist_result = (|| -> Result<(), String> {
        clear_document_derived_data(conn, Some(app_dir), document_id, false, now)?;

        if let Err(error) = persist_mineru_processed_files(
            conn,
            app_dir,
            document_id,
            &parse_result.markdown,
            &parse_result.json,
            &structure_json,
            now,
        ) {
            log::warn!(
                "Failed to persist MinerU processed files for document {}: {}",
                document_id,
                error
            );
        }

        if let Some(ref archive_bytes) = archive_bytes {
            if let Err(error) =
                persist_mineru_processed_archive(conn, app_dir, document_id, archive_bytes, now)
            {
                log::warn!(
                    "Failed to persist MinerU parse archive for document {}: {}",
                    document_id,
                    error
                );
            }
        }

        conn.execute(
            "INSERT INTO parsed_contents (id, document_id, version, markdown_content, json_content, structure_tree, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            (&content_id, document_id, &version, &markdown_path, &json_path, &structure_path, now),
        )
        .map_err(|e| e.to_string())?;

        conn.execute(
            "UPDATE parse_jobs SET status = 'completed', progress = 100, completed_at = ?, updated_at = ? WHERE id = ?",
            (now, now, job_id),
        )
        .map_err(|e| e.to_string())?;

        conn.execute(
            "UPDATE documents
             SET parse_status = 'completed', translation_status = 'pending', index_status = 'pending', updated_at = ?1
             WHERE id = ?2 AND deleted_at IS NULL",
            (now, document_id),
        )
        .map_err(|e| e.to_string())?;

        Ok(())
    })();

    if let Err(error) = persist_result {
        cleanup_written_parsed_version(&markdown_path, &json_path, structure_path.as_deref());
        return Err(error);
    }

    Ok(())
}

fn cleanup_written_parsed_version(
    markdown_path: &str,
    json_path: &str,
    structure_path: Option<&str>,
) {
    for path in [Some(markdown_path), Some(json_path), structure_path] {
        let Some(path) = path else {
            continue;
        };

        let path_ref = Path::new(path);
        if path_ref.exists() {
            let _ = fs::remove_file(path_ref);
        }
    }
}

fn update_parse_job_runtime_progress(
    state: &AppState,
    job_id: &str,
    progress: f64,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();
    let now = Utc::now().to_rfc3339();

    conn.execute(
        "UPDATE parse_jobs
         SET progress = ?1, updated_at = ?2
         WHERE id = ?3 AND status = 'parsing'",
        (progress.clamp(0.0, 99.0), &now, job_id),
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn load_mineru_official_request(
    settings: &crate::settings::SettingsManager,
    document_id: &str,
    file_path: &Path,
) -> Result<
    (
        crate::mineru_official::OfficialMinerUClient,
        crate::mineru_official::OfficialParseRequest,
    ),
    String,
> {
    let base_url =
        normalize_optional_string(get_setting_value(settings, "mineru.official_base_url")?)
            .unwrap_or_else(|| {
                crate::mineru_official::DEFAULT_MINERU_OFFICIAL_BASE_URL.to_string()
            });
    let api_token =
        normalize_optional_string(get_setting_value(settings, "mineru.official_api_token")?)
            .ok_or_else(|| {
                "Official MinerU API token is missing. Configure it in Settings before parsing."
                    .to_string()
            })?;

    let request = crate::mineru_official::OfficialParseRequest {
        model_version: normalize_optional_string(get_setting_value(
            settings,
            "mineru.official_model_version",
        )?)
        .unwrap_or_else(|| "vlm".to_string()),
        language: normalize_optional_string(get_setting_value(
            settings,
            "mineru.official_language",
        )?),
        enable_formula: parse_bool(
            get_setting_value(settings, "mineru.official_enable_formula")?,
            true,
        ),
        enable_table: parse_bool(
            get_setting_value(settings, "mineru.official_enable_table")?,
            true,
        ),
        is_ocr: parse_bool(
            get_setting_value(settings, "mineru.official_is_ocr")?,
            false,
        ),
        data_id: Some(document_id.to_string()),
        page_ranges: normalize_optional_string(get_setting_value(
            settings,
            "mineru.official_page_ranges",
        )?),
        extra_formats: parse_string_list(get_setting_value(
            settings,
            "mineru.official_extra_formats",
        )?),
        callback: normalize_optional_string(get_setting_value(
            settings,
            "mineru.official_callback_url",
        )?),
        seed: normalize_optional_string(get_setting_value(
            settings,
            "mineru.official_callback_seed",
        )?),
    }
    .sanitized_for_file(file_path)?;

    if request.callback.is_some() && request.seed.is_none() {
        return Err(
            "Official MinerU callback URL requires a callback seed. Add the seed in Settings or clear the callback URL."
                .to_string(),
        );
    }

    Ok((
        crate::mineru_official::OfficialMinerUClient::new(base_url, api_token),
        request,
    ))
}

async fn execute_parse_job_with_official_api(
    state: &AppState,
    job_id: &str,
    document_id: &str,
    file_path: &Path,
) -> Result<MinerUParseExecution, String> {
    let (client, request) =
        load_mineru_official_request(state.settings.as_ref(), document_id, file_path)?;
    let submission = client.submit_local_file(file_path, &request).await?;
    let _ = update_parse_job_runtime_progress(state, job_id, 6.0);

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30 * 60);
    let file_name = file_path
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_string());

    loop {
        if std::time::Instant::now() >= deadline {
            return Err(format!(
                "Timed out while waiting for MinerU official API to finish parsing (batch_id: {}).",
                submission.batch_id
            ));
        }

        let batch_result = client.get_batch_result(&submission.batch_id).await?;
        if let Some(item) = batch_result.find_item(request.data_id.as_deref(), file_name.as_deref())
        {
            let _ = update_parse_job_runtime_progress(
                state,
                job_id,
                crate::mineru_official::estimate_progress_percent(
                    &item.state,
                    item.extract_progress.as_ref(),
                ),
            );

            match item.state.as_str() {
                "done" => {
                    let archive_url = item
                        .full_zip_url
                        .as_deref()
                        .map(str::trim)
                        .filter(|url| !url.is_empty())
                        .ok_or_else(|| {
                            "MinerU official API completed the task but did not return full_zip_url."
                                .to_string()
                        })?;
                    let archive = client.download_archive(archive_url).await?;
                    return Ok(MinerUParseExecution {
                        parse_result: archive.parse_result,
                        archive_bytes: Some(archive.archive_bytes),
                    });
                }
                "failed" => {
                    let error_message = item
                        .err_msg
                        .as_deref()
                        .map(str::trim)
                        .filter(|message| !message.is_empty())
                        .unwrap_or("MinerU official API parse failed.");
                    return Err(error_message.to_string());
                }
                "waiting-file" | "pending" | "running" | "converting" => {}
                _ => {}
            }
        } else if batch_result.extract_result.is_empty() {
            let _ = update_parse_job_runtime_progress(state, job_id, 4.0);
        }

        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
    }
}

async fn execute_parse_job_with_selected_backend(
    state: &AppState,
    job_id: &str,
    document_id: &str,
    file_path: &Path,
) -> Result<MinerUParseExecution, String> {
    let mineru_mode =
        normalize_optional_string(get_setting_value(state.settings.as_ref(), "mineru.mode")?)
            .unwrap_or_else(|| "builtin".to_string());

    if mineru_mode == "official" {
        return execute_parse_job_with_official_api(state, job_id, document_id, file_path).await;
    }

    let _ = update_parse_job_runtime_progress(state, job_id, 3.0);
    let mineru_url = state
        .mineru_manager
        .get_effective_url(state.settings.as_ref())?;
    let _ = update_parse_job_runtime_progress(state, job_id, 8.0);
    let parse_backend = normalize_optional_string(
        get_setting_value(state.settings.as_ref(), "mineru.parse_backend")?,
    )
    .unwrap_or_else(|| "vlm".to_string());

    let client = if parse_backend == "auto" {
        if let Some(profile) = state.mineru_manager.get_active_runtime_profile()? {
            crate::mineru::MinerUClient::new(mineru_url).with_parse_backend(profile.backend)
        } else {
            crate::mineru::MinerUClient::new(mineru_url)
        }
    } else {
        crate::mineru::MinerUClient::new(mineru_url).with_parse_backend(parse_backend)
    };

    log::info!(
        "Dispatching parse job {} for document {} to MinerU.",
        job_id,
        document_id
    );
    let crate::mineru::ParseExecution {
        parse_result,
        archive_bytes,
    } = client.parse_pdf(file_path).await?;
    Ok(MinerUParseExecution {
        parse_result,
        archive_bytes,
    })
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
    let file_path = PathBuf::from(file_path);
    let result =
        execute_parse_job_with_selected_backend(state, job_id, document_id, &file_path).await;

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();
    let now = Utc::now().to_rfc3339();

    let result = match result {
        Ok(execution) => {
            persist_parse_job_success(conn, app_dir, job_id, document_id, execution, &now)
        }
        Err(error) => Err(error),
    };

    match result {
        Ok(()) => Ok(()),
        Err(error) => {
            if let Err(status_error) =
                mark_parse_job_failed(conn, job_id, document_id, &now, &error)
            {
                return Err(format!(
                    "{}; additionally failed to update parse job status: {}",
                    error, status_error
                ));
            }

            Err(error)
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
    pub failed_chunks: i32,
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
                    tj.total_chunks, tj.completed_chunks, COALESCE(tj.failed_chunks, 0), tj.error_message, tj.config,
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
                failed_chunks: row.get(8)?,
                error_message: row.get(9)?,
                config: row.get(10)?,
                started_at: row.get(11)?,
                completed_at: row.get(12)?,
                created_at: row.get(13)?,
                updated_at: row.get(14)?,
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

    load_latest_parsed_content_internal(conn, &document_id)
}

#[tauri::command]
pub fn get_mineru_processed_files(
    state: State<AppState>,
    document_id: String,
) -> Result<Vec<MineruProcessedFile>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    conn.query_row(
        "SELECT id FROM documents WHERE id = ?1 AND deleted_at IS NULL",
        [&document_id],
        |row| row.get::<_, String>(0),
    )
    .map_err(|e| e.to_string())?;

    load_mineru_processed_files_internal(conn, &document_id)
}

async fn extract_document_fields_internal(
    state: &AppState,
    app_dir: &Path,
    document_id: &str,
    provider_id: Option<&str>,
    field_keys: Option<&[String]>,
) -> Result<Vec<ExtractionResult>, String> {
    let (provider_record, chat_model, sampling, extraction_input, templates) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();
        let parse_status = conn
            .query_row(
                "SELECT parse_status FROM documents WHERE id = ?1 AND deleted_at IS NULL",
                [document_id],
                |row| row.get::<_, String>(0),
            )
            .map_err(|e| e.to_string())?;

        if parse_status != "completed" {
            return Err("Document has not been parsed yet".to_string());
        }

        let (provider_record, chat_model, sampling) =
            resolve_extraction_provider_internal(conn, state.settings.as_ref(), provider_id)?;
        let runtime_settings = load_translation_runtime_settings(state.settings.as_ref())?;
        let parsed_content = load_latest_parsed_content_internal(conn, document_id)?;
        let extraction_input = crate::extractor::prepare_extraction_input(
            &parsed_content.markdown_content,
            runtime_settings.chunk_size,
        );
        let templates = resolve_extraction_templates(conn, state.settings.as_ref(), field_keys)?;

        (
            provider_record,
            chat_model,
            sampling,
            extraction_input,
            templates,
        )
    };

    if extraction_input.trim().is_empty() {
        return Err(
            "Parsed content is empty and cannot be used for metadata extraction".to_string(),
        );
    }

    log::info!(
        "Extracting {} metadata fields for document {} using provider '{}' / model '{}' from the first chunk ({} chars)",
        templates.len(),
        document_id,
        provider_record.name,
        chat_model.model_name,
        extraction_input.len()
    );

    let mut retry_config = crate::retry::RetryConfig::for_network();
    retry_config.max_retries = provider_record.max_retries.max(0) as usize;

    let extractor = crate::extractor::Extractor::new(
        provider_record.base_url.clone(),
        provider_record.api_key.clone(),
        chat_model.model_name.clone(),
        sampling,
    )
    .with_retry_config(retry_config);

    let mut results = Vec::with_capacity(templates.len());
    for template in templates {
        let extracted_at = Utc::now().to_rfc3339();
        match extractor.extract_field(&template, &extraction_input).await {
            Ok(field_value) => results.push(ExtractionResult {
                document_id: document_id.to_string(),
                field_key: template.field_key.clone(),
                field_value: field_value.filter(|value| !value.trim().is_empty()),
                provider_id: provider_record.id.clone(),
                model_name: chat_model.model_name.clone(),
                extracted_at,
                error: None,
            }),
            Err(error) => {
                log::warn!(
                    "Metadata extraction failed for document {} field '{}': {}",
                    document_id,
                    template.field_key,
                    error
                );
                results.push(ExtractionResult {
                    document_id: document_id.to_string(),
                    field_key: template.field_key.clone(),
                    field_value: None,
                    provider_id: provider_record.id.clone(),
                    model_name: chat_model.model_name.clone(),
                    extracted_at,
                    error: Some(error),
                });
            }
        }
    }

    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();
        persist_extraction_results_internal(conn, document_id, &results)?;
        rewrite_document_metadata_meta_json(conn, app_dir, document_id)?;
    }

    Ok(results)
}

#[tauri::command]
pub fn get_extraction_templates(state: State<AppState>) -> Result<Vec<ExtractionTemplate>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    let mut templates = build_builtin_extraction_templates(state.settings.as_ref());
    templates.extend(load_custom_extraction_templates_internal(conn)?);
    Ok(templates)
}

#[tauri::command]
pub fn create_extraction_template(
    state: State<AppState>,
    input: ExtractionTemplateInput,
) -> Result<ExtractionTemplate, String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("Template name is required".to_string());
    }

    let field_key = normalize_field_key(&input.field_key)?;
    if crate::extractor::is_builtin_field_key(&field_key) {
        return Err(format!(
            "Field key '{}' is reserved by a built-in extraction template",
            field_key
        ));
    }

    let system_prompt = input.system_prompt.trim();
    if system_prompt.is_empty() {
        return Err("System prompt is required".to_string());
    }

    let user_prompt = input.user_prompt.trim();
    if user_prompt.is_empty() {
        return Err("User prompt is required".to_string());
    }

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();
    if load_custom_extraction_template_by_field_key_internal(conn, &field_key)?.is_some() {
        return Err(format!(
            "An extraction template for field '{}' already exists",
            field_key
        ));
    }

    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO extraction_templates (
            id,
            name,
            field_key,
            description,
            system_prompt,
            user_prompt,
            is_enabled,
            created_at,
            updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        (
            &id,
            name,
            &field_key,
            &normalize_optional_string(input.description),
            system_prompt,
            user_prompt,
            if input.is_enabled.unwrap_or(true) {
                1
            } else {
                0
            },
            &now,
        ),
    )
    .map_err(|e| e.to_string())?;

    load_custom_extraction_template_by_id_internal(conn, &id)
}

#[tauri::command]
pub fn update_extraction_template(
    state: State<AppState>,
    id: String,
    input: ExtractionTemplateInput,
) -> Result<ExtractionTemplate, String> {
    if id.trim().starts_with("builtin:") {
        return Err("Built-in extraction templates cannot be edited".to_string());
    }

    let name = input.name.trim();
    if name.is_empty() {
        return Err("Template name is required".to_string());
    }

    let system_prompt = input.system_prompt.trim();
    if system_prompt.is_empty() {
        return Err("System prompt is required".to_string());
    }

    let user_prompt = input.user_prompt.trim();
    if user_prompt.is_empty() {
        return Err("User prompt is required".to_string());
    }

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();
    let existing = load_custom_extraction_template_by_id_internal(conn, &id)?;
    let requested_field_key = normalize_field_key(&input.field_key)?;
    if requested_field_key != existing.field_key {
        return Err("Field key cannot be changed after the template is created".to_string());
    }

    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE extraction_templates
         SET name = ?1,
             description = ?2,
             system_prompt = ?3,
             user_prompt = ?4,
             is_enabled = ?5,
             updated_at = ?6
         WHERE id = ?7",
        (
            name,
            &normalize_optional_string(input.description),
            system_prompt,
            user_prompt,
            if input.is_enabled.unwrap_or(existing.is_enabled) {
                1
            } else {
                0
            },
            &now,
            &id,
        ),
    )
    .map_err(|e| e.to_string())?;

    load_custom_extraction_template_by_id_internal(conn, &id)
}

#[tauri::command]
pub fn delete_extraction_template(state: State<AppState>, id: String) -> Result<(), String> {
    if id.trim().starts_with("builtin:") {
        return Err("Built-in extraction templates cannot be deleted".to_string());
    }

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();
    let deleted = conn
        .execute("DELETE FROM extraction_templates WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    if deleted == 0 {
        return Err("Extraction template not found".to_string());
    }

    Ok(())
}

#[tauri::command]
pub fn toggle_builtin_template(
    state: State<AppState>,
    field_key: String,
    enabled: bool,
) -> Result<ExtractionTemplate, String> {
    let field_key = normalize_field_key(&field_key)?;
    let template = crate::extractor::builtin_template_by_field_key(&field_key)
        .ok_or_else(|| format!("Built-in extraction template '{}' was not found", field_key))?;

    let mut state_map = load_builtin_extraction_state_map(state.settings.as_ref());
    if enabled == template.default_enabled {
        state_map.remove(template.field_key);
    } else {
        state_map.insert(template.field_key.to_string(), enabled);
    }
    save_builtin_extraction_state_map(state.settings.as_ref(), &state_map)?;

    Ok(template.to_template(enabled))
}

#[tauri::command]
pub fn get_document_metadata(
    state: State<AppState>,
    document_id: String,
) -> Result<Vec<DocumentMetadataField>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();
    conn.query_row(
        "SELECT id FROM documents WHERE id = ?1 AND deleted_at IS NULL",
        [&document_id],
        |row| row.get::<_, String>(0),
    )
    .map_err(|e| e.to_string())?;

    load_document_metadata_with_backfill_internal(conn, &state.app_dir, &document_id)
}

#[tauri::command]
pub fn get_all_documents_metadata(
    state: State<AppState>,
    document_ids: Vec<String>,
) -> Result<HashMap<String, Vec<DocumentMetadataField>>, String> {
    let unique_ids = unique_document_ids(&document_ids);
    if unique_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();
    let mut metadata = HashMap::new();

    for document_id in unique_ids {
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
            continue;
        }

        let rows =
            load_document_metadata_with_backfill_internal(conn, &state.app_dir, &document_id)?;
        if !rows.is_empty() {
            metadata.insert(document_id, rows);
        }
    }

    Ok(metadata)
}

#[tauri::command]
pub fn delete_document_metadata_field(
    state: State<AppState>,
    document_id: String,
    field_key: String,
) -> Result<(), String> {
    let normalized_field_key = normalize_field_key(&field_key)?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    conn.query_row(
        "SELECT id FROM documents WHERE id = ?1 AND deleted_at IS NULL",
        [&document_id],
        |row| row.get::<_, String>(0),
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM document_metadata WHERE document_id = ?1 AND field_key = ?2",
        (&document_id, &normalized_field_key),
    )
    .map_err(|e| e.to_string())?;

    rewrite_document_metadata_meta_json(conn, &state.app_dir, &document_id)?;
    Ok(())
}

#[tauri::command]
pub async fn extract_document_fields(
    state: State<'_, AppState>,
    document_id: String,
    provider_id: Option<String>,
    field_keys: Option<Vec<String>>,
) -> Result<Vec<ExtractionResult>, String> {
    let normalized_field_keys = normalize_requested_field_keys(field_keys)?;
    extract_document_fields_internal(
        state.inner(),
        &state.app_dir,
        &document_id,
        provider_id.as_deref(),
        normalized_field_keys.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn batch_extract_document_fields(
    state: State<'_, AppState>,
    document_ids: Vec<String>,
    provider_id: Option<String>,
    field_keys: Option<Vec<String>>,
) -> Result<BatchActionReport, String> {
    let normalized_field_keys = normalize_requested_field_keys(field_keys)?;
    let unique_ids = unique_document_ids(&document_ids);
    let mut failures = Vec::new();
    let mut succeeded = 0usize;

    for document_id in unique_ids.iter() {
        match extract_document_fields_internal(
            state.inner(),
            &state.app_dir,
            document_id,
            provider_id.as_deref(),
            normalized_field_keys.as_deref(),
        )
        .await
        {
            Ok(results) if results.iter().all(|result| result.error.is_some()) => {
                failures.push(BatchActionFailure {
                    document_id: document_id.clone(),
                    reason: summarize_extraction_failures(&results),
                });
            }
            Ok(_) => {
                succeeded += 1;
            }
            Err(error) => {
                failures.push(BatchActionFailure {
                    document_id: document_id.clone(),
                    reason: error,
                });
            }
        }
    }

    Ok(BatchActionReport {
        requested: unique_ids.len(),
        succeeded,
        failed: failures.len(),
        failures,
    })
}

#[tauri::command]
pub async fn test_mineru_connection(
    base_url: Option<String>,
    mode: Option<String>,
    api_token: Option<String>,
) -> Result<String, String> {
    let mode = mode.unwrap_or_else(|| "external".to_string());

    if mode == "official" {
        let client = crate::mineru_official::OfficialMinerUClient::new(
            base_url.unwrap_or_else(|| {
                crate::mineru_official::DEFAULT_MINERU_OFFICIAL_BASE_URL.to_string()
            }),
            api_token.unwrap_or_default(),
        );
        return client.test_connection().await;
    }

    let client = crate::mineru::MinerUClient::new(
        base_url.unwrap_or_else(|| "http://localhost:8000".to_string()),
    );
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
    let translate_model =
        find_primary_model_for_type(&provider_models, PROVIDER_MODEL_TYPE_TRANSLATE).ok_or_else(
            || {
                format!(
                    "Channel \"{}\" has no active translate model",
                    provider_record.name
                )
            },
        )?;
    let mut sampling = load_llm_sampling_config(&state.settings, "translate")?;
    if sampling.temperature.is_none() {
        sampling.temperature = provider_record.legacy_temperature;
    }
    if sampling.max_tokens.is_none() {
        sampling.max_tokens = provider_record.legacy_max_tokens;
    }
    let runtime_settings = load_translation_runtime_settings(&state.settings)?;

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
        "runtime": {
            "chunk_strategy": runtime_settings.chunk_strategy.as_str(),
            "chunk_size": runtime_settings.chunk_size,
            "chunk_overlap": runtime_settings.chunk_overlap,
            "max_concurrent_requests": runtime_settings.max_concurrent_requests,
            "max_requests_per_minute": runtime_settings.max_requests_per_minute,
            "smart_optimize_enabled": runtime_settings.smart_optimize_enabled,
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
    let (provider_record, translate_model, chat_model, sampling, runtime_settings, parsed_content) = {
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
        let translate_model =
            find_primary_model_for_type(&provider_models, PROVIDER_MODEL_TYPE_TRANSLATE)
                .ok_or_else(|| {
                    format!(
                        "Channel \"{}\" has no active translate model",
                        provider_record.name
                    )
                })?;
        let chat_model = find_primary_model_for_type(&provider_models, PROVIDER_MODEL_TYPE_CHAT);
        let mut sampling = load_llm_sampling_config(&state.settings, "translate")?;
        if sampling.temperature.is_none() {
            sampling.temperature = provider_record.legacy_temperature;
        }
        if sampling.max_tokens.is_none() {
            sampling.max_tokens = provider_record.legacy_max_tokens;
        }
        let runtime_settings = load_translation_runtime_settings(&state.settings)?;

        let parsed_content = load_latest_parsed_content_internal(conn, document_id)?;

        (
            provider_record,
            translate_model,
            chat_model,
            sampling,
            runtime_settings,
            parsed_content,
        )
    };

    let translator = crate::translator::Translator::new(
        provider_record.base_url,
        provider_record.api_key,
        translate_model.model_name,
        sampling,
    );

    let chunking_config = crate::chunking::ChunkingConfig {
        max_tokens_per_chunk: runtime_settings.chunk_size,
        overlap_tokens: runtime_settings.chunk_overlap,
        preserve_sentences: true,
        tokens_per_char_estimate: 0.25,
    };
    let rate_limit_config = crate::rate_limiter::RateLimitConfig {
        max_requests_per_minute: runtime_settings.max_requests_per_minute,
        max_concurrent_requests: runtime_settings.max_concurrent_requests,
    };

    let mut retry_config = crate::retry::RetryConfig::for_batch_processing();
    retry_config.max_retries = provider_record.max_retries.max(0) as usize;

    let mut translator = translator
        .with_retry_config(retry_config)
        .with_chunking_config(chunking_config.clone())
        .with_rate_limit_config(rate_limit_config);

    let prepared_chunks = crate::chunking::prepare_translation_chunks(
        &parsed_content.markdown_content,
        Some(parsed_content.json_content.as_str()),
        parsed_content.structure_tree.as_deref(),
        &chunking_config,
        runtime_settings.chunk_strategy,
    );

    if prepared_chunks.chunks.is_empty() {
        return Err("Failed to build translation chunks from parsed content".to_string());
    }

    log::info!(
        "Prepared {} translation chunks using strategy={} (requested={}) for document {}",
        prepared_chunks.chunks.len(),
        prepared_chunks.strategy_used.as_str(),
        runtime_settings.chunk_strategy.as_str(),
        document_id
    );

    let limiter_status = translator.limiter_status();
    let limiter_cfg = translator.rate_limit_config();
    log::info!(
        "Translator limiter configured: concurrency={}, rpm={}, current_window_count={}, window_elapsed_ms={}, available_concurrency={}",
        limiter_cfg.max_concurrent_requests,
        limiter_cfg.max_requests_per_minute,
        limiter_status.current_request_count,
        limiter_status.window_elapsed.as_millis(),
        limiter_status.available_concurrency
    );

    if runtime_settings.smart_optimize_enabled {
        if let Some(chat_model) = chat_model {
            match translator
                .build_consistency_context(
                    &chat_model.model_name,
                    &parsed_content.markdown_content,
                    source_language,
                    target_language,
                )
                .await
            {
                Ok(context) if !context.trim().is_empty() => {
                    translator = translator.with_consistency_context(context);
                }
                Ok(_) => {
                    log::warn!(
                        "Translation smart optimization produced empty context, fallback to standard translation. job={} document={}",
                        job_id,
                        document_id
                    );
                }
                Err(error) => {
                    log::warn!(
                        "Translation smart optimization failed, fallback to standard translation. job={} document={} error={}",
                        job_id,
                        document_id,
                        error
                    );
                }
            }
        } else {
            log::warn!(
                "Translation smart optimization is enabled but no chat model is active for provider {}. Fallback to standard translation.",
                provider_id
            );
        }
    }

    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();
        let content_hash = compute_content_hash(&parsed_content.markdown_content);
        let now = Utc::now().to_rfc3339();

        conn.execute(
            "UPDATE translation_jobs SET content_hash = ?1, total_chunks = ?2, updated_at = ?3 WHERE id = ?4",
            (&content_hash, prepared_chunks.chunks.len() as i32, &now, job_id),
        ).map_err(|e| e.to_string())?;

        for chunk in &prepared_chunks.chunks {
            conn.execute(
                "INSERT OR IGNORE INTO translation_chunks
                 (id, job_id, document_id, chunk_index, source_text, start_pos, end_pos, status, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', ?8, ?8)",
                (
                    &Uuid::new_v4().to_string(),
                    job_id,
                    document_id,
                    chunk.index as i32,
                    &chunk.text,
                    chunk.start_pos as i64,
                    chunk.end_pos as i64,
                    &now,
                ),
            ).map_err(|e| e.to_string())?;
        }
    }

    let result = translator
        .translate_prepared_chunks_incremental(
            prepared_chunks.chunks,
            parsed_content.markdown_content.len(),
            source_language,
            target_language,
            |completed, total, chunk_result| {
                let progress = if total > 0 {
                    (completed as f64 / total as f64) * 100.0
                } else {
                    0.0
                };

                let completed_i32 = completed.min(i32::MAX as usize) as i32;
                let total_i32 = total.min(i32::MAX as usize) as i32;
                let now = Utc::now().to_rfc3339();

                match state.db.lock() {
                    Ok(db) => {
                        let conn = db.get_connection();
                        if let Err(error) = conn.execute(
                            "UPDATE translation_jobs
                             SET progress = ?1, total_chunks = ?2, completed_chunks = ?3, updated_at = ?4
                             WHERE id = ?5 AND status = 'translating'",
                            (progress, total_i32, completed_i32, &now, job_id),
                        ) {
                            log::warn!(
                                "Failed to update translation progress for job {}: {}",
                                job_id,
                                error
                            );
                        }
                        let status = if chunk_result.success { "completed" } else { "failed" };
                        let error_msg = chunk_result.error.as_deref();
                        if let Err(error) = conn.execute(
                            "UPDATE translation_chunks
                             SET translated_text = ?1, status = ?2, error_message = ?3, updated_at = ?4
                             WHERE job_id = ?5 AND chunk_index = ?6",
                            (
                                &chunk_result.translated_text,
                                status,
                                &error_msg,
                                &now,
                                job_id,
                                chunk_result.chunk_index as i32,
                            ),
                        ) {
                            log::warn!(
                                "Failed to persist translation chunk {} for job {}: {}",
                                chunk_result.chunk_index,
                                job_id,
                                error
                            );
                        }
                    }
                    Err(error) => {
                        log::warn!(
                            "Failed to lock DB for translation progress update (job {}): {}",
                            job_id,
                            error
                        );
                    }
                }
            },
        )
        .await;

    finalize_translation_job(
        state,
        app_dir,
        job_id,
        document_id,
        source_language,
        target_language,
        result,
    )
}

/// Finalize a translation job after all chunks have been processed
fn finalize_translation_job(
    state: &AppState,
    app_dir: Option<&Path>,
    job_id: &str,
    document_id: &str,
    _source_language: &str,
    target_language: &str,
    result: Result<Vec<crate::translator::TranslationResult>, String>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();
    let now = Utc::now().to_rfc3339();

    match result {
        Ok(chunk_results) => {
            let total_chunks = chunk_results.len() as i32;
            let completed_chunks = chunk_results.iter().filter(|item| item.success).count() as i32;
            let failed_chunks = total_chunks - completed_chunks;

            if failed_chunks > 0 {
                // Partial success — mark as partial, don't merge yet
                let progress = if total_chunks > 0 {
                    (completed_chunks as f64 / total_chunks as f64) * 100.0
                } else {
                    0.0
                };
                let error_msg = format!("{} chunk(s) failed to translate", failed_chunks);

                conn.execute(
                    "UPDATE translation_jobs
                     SET status = 'partial', error_message = ?1, progress = ?2,
                         total_chunks = ?3, completed_chunks = ?4, failed_chunks = ?5,
                         completed_at = ?6, updated_at = ?6
                     WHERE id = ?7",
                    (
                        &error_msg,
                        progress,
                        total_chunks,
                        completed_chunks,
                        failed_chunks,
                        &now,
                        job_id,
                    ),
                )
                .map_err(|e| e.to_string())?;

                conn.execute(
                    "UPDATE documents
                     SET translation_status = 'partial', updated_at = ?1
                     WHERE id = ?2 AND deleted_at IS NULL",
                    (&now, document_id),
                )
                .map_err(|e| e.to_string())?;

                return Ok(());
            }

            let translated_text =
                match crate::translator::Translator::merge_translation_results(&chunk_results) {
                    Ok(text) => text,
                    Err(e) => {
                        let progress = if total_chunks > 0 {
                            (completed_chunks as f64 / total_chunks as f64) * 100.0
                        } else {
                            0.0
                        };

                        conn.execute(
                            "UPDATE translation_jobs
                         SET status = 'failed', error_message = ?1, progress = ?2,
                             total_chunks = ?3, completed_chunks = ?4,
                             completed_at = ?5, updated_at = ?5
                         WHERE id = ?6",
                            (&e, progress, total_chunks, completed_chunks, &now, job_id),
                        )
                        .map_err(|error| error.to_string())?;

                        conn.execute(
                            "UPDATE documents
                         SET translation_status = 'failed', updated_at = ?1
                         WHERE id = ?2 AND deleted_at IS NULL",
                            (&now, document_id),
                        )
                        .map_err(|error| error.to_string())?;

                        return Err(e);
                    }
                };

            let content_id = Uuid::new_v4().to_string();
            let version = next_content_version(conn, "translated_contents", document_id)?;
            clear_document_translation_and_index_data(conn, app_dir, document_id, false, &now)?;

            let translated_path = crate::content_store::write_translated_version(
                app_dir.ok_or("App dir is required for translated content storage")?,
                document_id,
                version,
                &translated_text,
            )?;

            conn.execute(
                "INSERT INTO translated_contents (id, document_id, version, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                (&content_id, document_id, &version, &translated_path, &now),
            ).map_err(|e| e.to_string())?;

            conn.execute(
                "UPDATE translation_jobs
                 SET status = 'completed', progress = 100, total_chunks = ?1, completed_chunks = ?2,
                     failed_chunks = 0, completed_at = ?3, updated_at = ?3
                 WHERE id = ?4",
                (total_chunks, completed_chunks, &now, job_id),
            )
            .map_err(|e| e.to_string())?;

            conn.execute(
                "UPDATE documents
                 SET translation_status = 'completed', target_language = ?1, updated_at = ?2
                 WHERE id = ?3 AND deleted_at IS NULL",
                (target_language, &now, document_id),
            )
            .map_err(|e| e.to_string())?;

            Ok(())
        }
        Err(e) => {
            conn.execute(
                "UPDATE translation_jobs
                 SET status = 'failed', error_message = ?1, progress = 0, total_chunks = 0, completed_chunks = 0,
                     completed_at = ?2, updated_at = ?2
                 WHERE id = ?3",
                (&e, &now, job_id),
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
pub async fn resume_translation_job(
    app: AppHandle,
    state: State<'_, AppState>,
    job_id: String,
) -> Result<TranslationJob, String> {
    resume_translation_job_start(&app, state.inner(), &job_id, false).await
}

#[tauri::command]
pub async fn retry_failed_translation_chunks(
    app: AppHandle,
    state: State<'_, AppState>,
    job_id: String,
) -> Result<TranslationJob, String> {
    resume_translation_job_start(&app, state.inner(), &job_id, true).await
}

async fn resume_translation_job_start(
    app: &AppHandle,
    state: &AppState,
    job_id: &str,
    only_failed: bool,
) -> Result<TranslationJob, String> {
    let app_dir = crate::app_dirs::runtime_app_dir(app)?;

    let (job_document_id, job_provider_id, job_config_str, job_content_hash, job_total_chunks) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();

        let (status, document_id, provider_id, config, content_hash, total_chunks): (String, String, String, String, Option<String>, i32) =
            conn.query_row(
                "SELECT status, document_id, provider_id, config, content_hash, total_chunks FROM translation_jobs WHERE id = ?1",
                [job_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
            ).map_err(|e| format!("Translation job not found: {}", e))?;

        if status != "failed" && status != "partial" {
            return Err(format!("Cannot resume job with status '{}'. Only 'failed' or 'partial' jobs can be resumed.", status));
        }

        if let Ok(handles) = state.translation_job_handles.lock() {
            if handles.contains_key(job_id) {
                return Err("This job is already running".to_string());
            }
        }

        (document_id, provider_id, config, content_hash, total_chunks)
    };

    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();

        let current_markdown = load_latest_parsed_markdown_internal(conn, &job_document_id)
            .map_err(|e| format!("Failed to load document content: {}", e))?;

        if let Some(ref saved_hash) = job_content_hash {
            let current_hash = compute_content_hash(&current_markdown);
            if &current_hash != saved_hash {
                return Err("Source document has changed since the job started. Please start a new translation job.".to_string());
            }
        }
    }

    let (provider_record, translate_model, sampling) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();
        let provider_record = load_provider_record_by_id(conn, &job_provider_id)
            .map_err(|_| "The translation provider used for this job has been deleted. Please start a new job with a different provider.".to_string())?;
        let provider_models = load_provider_models_for_provider(conn, &job_provider_id)?;
        let translate_model =
            find_primary_model_for_type(&provider_models, PROVIDER_MODEL_TYPE_TRANSLATE)
                .ok_or_else(|| {
                    format!(
                        "Channel \"{}\" has no active translate model",
                        provider_record.name
                    )
                })?;
        let mut sampling = load_llm_sampling_config(&state.settings, "translate")?;
        if sampling.temperature.is_none() {
            sampling.temperature = provider_record.legacy_temperature;
        }
        if sampling.max_tokens.is_none() {
            sampling.max_tokens = provider_record.legacy_max_tokens;
        }
        (provider_record, translate_model, sampling)
    };

    let job_config: serde_json::Value = serde_json::from_str(&job_config_str)
        .map_err(|e| format!("Failed to parse job config: {}", e))?;
    let runtime = &job_config["runtime"];
    let chunk_size = runtime["chunk_size"]
        .as_u64()
        .unwrap_or(DEFAULT_TRANSLATION_CHUNK_SIZE as u64) as usize;
    let chunk_overlap = runtime["chunk_overlap"]
        .as_u64()
        .unwrap_or(DEFAULT_TRANSLATION_CHUNK_OVERLAP as u64) as usize;
    let max_concurrent = runtime["max_concurrent_requests"]
        .as_u64()
        .unwrap_or(DEFAULT_TRANSLATION_MAX_CONCURRENT_REQUESTS as u64)
        as usize;
    let max_rpm = runtime["max_requests_per_minute"]
        .as_u64()
        .unwrap_or(DEFAULT_TRANSLATION_MAX_REQUESTS_PER_MINUTE as u64) as u32;
    let source_language = job_config["source_language"]
        .as_str()
        .unwrap_or("auto")
        .to_string();
    let target_language = job_config["target_language"]
        .as_str()
        .unwrap_or("en")
        .to_string();

    let chunk_filter = if only_failed {
        "status = 'failed'"
    } else {
        "status IN ('pending', 'failed')"
    };

    let chunks_to_resume: Vec<(i32, String, i64, i64)> = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();
        let mut stmt = conn.prepare(
            &format!(
                "SELECT chunk_index, source_text, start_pos, end_pos FROM translation_chunks WHERE job_id = ?1 AND {}",
                chunk_filter
            )
        ).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([job_id], |row| {
                Ok((
                    row.get::<_, i32>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    if chunks_to_resume.is_empty() {
        return Err("No chunks to resume/retry".to_string());
    }

    let already_completed: usize = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();
        conn.query_row(
            "SELECT COUNT(*) FROM translation_chunks WHERE job_id = ?1 AND status = 'completed'",
            [job_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())? as usize
    };

    let resume_chunks: Vec<crate::chunking::Chunk> = chunks_to_resume
        .iter()
        .map(|(idx, text, start, end)| crate::chunking::Chunk {
            index: *idx as usize,
            text: text.clone(),
            start_pos: *start as usize,
            end_pos: *end as usize,
        })
        .collect();

    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE translation_jobs SET status = 'translating', error_message = NULL, started_at = ?1, updated_at = ?1 WHERE id = ?2",
            (&now, job_id),
        ).map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE documents SET translation_status = 'translating', updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL",
            (&now, &job_document_id),
        ).map_err(|e| e.to_string())?;
        conn.execute(
            &format!("UPDATE translation_chunks SET status = 'pending', error_message = NULL, updated_at = ?1 WHERE job_id = ?2 AND {}", chunk_filter),
            (&now, job_id),
        ).map_err(|e| e.to_string())?;
    }

    let job = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();
        conn.query_row(
            "SELECT * FROM translation_jobs WHERE id = ?1",
            [job_id],
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
        .map_err(|e| e.to_string())?
    };

    let chunking_config = crate::chunking::ChunkingConfig {
        max_tokens_per_chunk: chunk_size,
        overlap_tokens: chunk_overlap,
        preserve_sentences: true,
        tokens_per_char_estimate: 0.25,
    };
    let rate_limit_config = crate::rate_limiter::RateLimitConfig {
        max_requests_per_minute: max_rpm,
        max_concurrent_requests: max_concurrent,
    };

    let mut retry_config = crate::retry::RetryConfig::for_batch_processing();
    retry_config.max_retries = provider_record.max_retries.max(0) as usize;

    let translator = crate::translator::Translator::new(
        provider_record.base_url,
        provider_record.api_key,
        translate_model.model_name,
        sampling,
    )
    .with_retry_config(retry_config)
    .with_chunking_config(chunking_config)
    .with_rate_limit_config(rate_limit_config);

    let job_id_str = job_id.to_string();
    let doc_id_str = job_document_id.clone();
    let source_lang = source_language.clone();
    let target_lang = target_language.clone();
    let state_clone = state.clone();
    let app_dir_clone = app_dir.clone();
    let total = job_total_chunks as usize;

    let handle = tauri::async_runtime::spawn(async move {
        let result = translator
            .translate_specific_chunks(
                resume_chunks,
                &source_lang,
                &target_lang,
                total,
                already_completed,
                |completed, total_c, chunk_result| {
                    let progress = if total_c > 0 {
                        (completed as f64 / total_c as f64) * 100.0
                    } else {
                        0.0
                    };
                    let now = Utc::now().to_rfc3339();

                    if let Ok(db) = state_clone.db.lock() {
                        let conn = db.get_connection();
                        let _ = conn.execute(
                            "UPDATE translation_jobs
                             SET progress = ?1, completed_chunks = ?2, updated_at = ?3
                             WHERE id = ?4 AND status = 'translating'",
                            (progress, completed as i32, &now, &job_id_str),
                        );
                        let status = if chunk_result.success { "completed" } else { "failed" };
                        let error_msg = chunk_result.error.as_deref();
                        let _ = conn.execute(
                            "UPDATE translation_chunks
                             SET translated_text = ?1, status = ?2, error_message = ?3, updated_at = ?4
                             WHERE job_id = ?5 AND chunk_index = ?6",
                            (
                                &chunk_result.translated_text,
                                status,
                                &error_msg,
                                &now,
                                &job_id_str,
                                chunk_result.chunk_index as i32,
                            ),
                        );
                    }
                },
            )
            .await;

        let all_results = gather_all_translation_chunks(&state_clone, &job_id_str);
        let final_result = match (result, all_results) {
            (Ok(_), Ok(results)) => Ok(results),
            (Err(e), _) => Err(e),
            (_, Err(e)) => Err(e),
        };

        let _ = finalize_translation_job(
            &state_clone,
            Some(app_dir_clone.as_path()),
            &job_id_str,
            &doc_id_str,
            &source_lang,
            &target_lang,
            final_result,
        );

        if let Ok(mut handles) = state_clone.translation_job_handles.lock() {
            handles.remove(&job_id_str);
        }
    });

    let mut handles = state
        .translation_job_handles
        .lock()
        .map_err(|e| e.to_string())?;
    handles.insert(job_id.to_string(), handle);

    Ok(job)
}

/// Gather all translation chunk results for a job (for merge after resume)
fn gather_all_translation_chunks(
    state: &AppState,
    job_id: &str,
) -> Result<Vec<crate::translator::TranslationResult>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    let mut stmt = conn
        .prepare(
            "SELECT chunk_index, translated_text, start_pos, end_pos, status, error_message
         FROM translation_chunks WHERE job_id = ?1 ORDER BY chunk_index",
        )
        .map_err(|e| e.to_string())?;

    let results = stmt
        .query_map([job_id], |row| {
            let status: String = row.get(4)?;
            let success = status == "completed";
            Ok(crate::translator::TranslationResult {
                chunk_index: row.get::<_, i32>(0)? as usize,
                translated_text: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                start_pos: row.get::<_, i64>(2)? as usize,
                end_pos: row.get::<_, i64>(3)? as usize,
                success,
                error: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;

    results
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
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

    load_latest_translated_content_internal(conn, &document_id)
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

    let version = next_content_version(conn, "parsed_contents", &document_id)?;
    let (markdown_path, json_path, structure_path) = crate::content_store::write_parsed_version(
        &app_dir,
        &document_id,
        version,
        &markdown_content,
        "{}",
        None,
    )?;

    let persist_result = (|| -> Result<(), String> {
        clear_document_derived_data(conn, Some(&app_dir), &document_id, false, &now)?;

        if let Err(error) = persist_mineru_processed_files(
            conn,
            &app_dir,
            &document_id,
            &markdown_content,
            "{}",
            "null",
            &now,
        ) {
            log::warn!(
                "Failed to persist replacement parsed assets for document {}: {}",
                document_id,
                error
            );
        }

        conn.execute(
            "INSERT INTO parsed_contents (id, document_id, version, markdown_content, json_content, structure_tree, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            (
                &content_id,
                &document_id,
                &version,
                &markdown_path,
                &json_path,
                &structure_path,
                &now,
            ),
        )
        .map_err(|e| e.to_string())?;

        conn.execute(
            "UPDATE documents
             SET parse_status = 'completed', translation_status = 'pending', index_status = 'pending', updated_at = ?1
             WHERE id = ?2 AND deleted_at IS NULL",
            (&now, &document_id),
        )
        .map_err(|e| e.to_string())?;

        Ok(())
    })();

    if let Err(error) = persist_result {
        cleanup_written_parsed_version(&markdown_path, &json_path, structure_path.as_deref());
        return Err(error);
    }

    load_latest_parsed_content_internal(conn, &document_id)
}

#[tauri::command]
pub async fn start_index_job(
    app: AppHandle,
    state: State<'_, AppState>,
    document_id: String,
    provider_id: String,
) -> Result<String, String> {
    let app_dir = crate::app_dirs::runtime_app_dir(&app)?;

    let index_job_id = Uuid::new_v4().to_string();

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

        let config = serde_json::json!({
            "provider_id": provider_id,
        })
        .to_string();

        conn.execute(
            "INSERT INTO index_jobs (id, document_id, provider_id, status, config, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'pending', ?4, ?5, ?5)",
            (&index_job_id, &document_id, &provider_id, &config, &now),
        ).map_err(|e| e.to_string())?;
    }

    let document_id_clone = document_id.clone();
    let provider_id_clone = provider_id.clone();
    let state_clone = state.inner().clone();
    let app_dir_clone = app_dir.clone();
    let index_job_id_clone = index_job_id.clone();

    let handle = tauri::async_runtime::spawn(async move {
        let result = execute_index_job(
            &state_clone,
            &app_dir_clone,
            &document_id_clone,
            &provider_id_clone,
            &index_job_id_clone,
        )
        .await;
        if let Ok(mut handles) = state_clone.index_job_handles.lock() {
            handles.remove(&document_id_clone);
        }
        if let Err(e) = result {
            let _ =
                mark_index_job_failed(&state_clone, &document_id_clone, &index_job_id_clone, &e);
        }
    });

    let mut handles = state.index_job_handles.lock().map_err(|e| e.to_string())?;
    handles.insert(document_id.clone(), handle);

    Ok(index_job_id)
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
    index_job_id: &str,
) -> Result<(), String> {
    let provider = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();
        let provider_record = load_provider_record_by_id(conn, provider_id)?;
        let provider_models = load_provider_models_for_provider(conn, provider_id)?;
        let embed_model = find_primary_model_for_type(&provider_models, PROVIDER_MODEL_TYPE_EMBED)
            .ok_or_else(|| {
                format!(
                    "Channel \"{}\" has no active embedding model",
                    provider_record.name
                )
            })?;

        DirectEmbeddingProvider {
            base_url: provider_record.base_url,
            api_key: provider_record.api_key,
            embedding_model: embed_model.model_name,
            dimensions: embed_model.config.and_then(|config| config.dimensions),
            max_retries: provider_record.max_retries.max(0) as usize,
            max_concurrent_requests: provider_record.concurrency.max(1) as usize,
        }
    };

    execute_index_job_with_embedding_provider(state, app_dir, document_id, &provider, index_job_id)
        .await
}

pub(crate) async fn execute_index_job_with_embedding_provider(
    state: &AppState,
    app_dir: &Path,
    document_id: &str,
    provider: &DirectEmbeddingProvider,
    index_job_id: &str,
) -> Result<(), String> {
    let (markdown_content, rag_settings, zvec_settings) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();

        let markdown_content = load_latest_parsed_markdown_internal(conn, document_id)?;

        let rag_settings = crate::zvec::load_rag_settings(conn, app_dir)?;
        let zvec_settings = crate::zvec::load_zvec_settings(conn, app_dir)?;

        (markdown_content, rag_settings, zvec_settings)
    };

    let embedding_model = provider.embedding_model.clone();

    let mut retry_config = crate::retry::RetryConfig::for_batch_processing();
    retry_config.max_retries = provider.max_retries;

    let chunking_config = crate::chunking::ChunkingConfig {
        max_tokens_per_chunk: rag_settings.chunk_size,
        overlap_tokens: rag_settings.chunk_overlap,
        preserve_sentences: true,
        tokens_per_char_estimate: 0.25,
    };
    let rate_limit_config = crate::rate_limiter::RateLimitConfig {
        max_requests_per_minute: crate::rate_limiter::RateLimitConfig::moderate()
            .max_requests_per_minute,
        max_concurrent_requests: provider.max_concurrent_requests,
    };

    let embedder = crate::embedder::Embedder::new(
        provider.base_url.clone(),
        provider.api_key.clone(),
        embedding_model.clone(),
        provider.dimensions,
    )
    .with_retry_config(retry_config)
    .with_chunking_config(chunking_config.clone())
    .with_rate_limit_config(rate_limit_config);

    let limiter_status = embedder.limiter_status();
    let limiter_cfg = embedder.rate_limit_config();
    log::info!(
        "Embedder limiter configured: concurrency={}, rpm={}, current_window_count={}, window_elapsed_ms={}, available_concurrency={}",
        limiter_cfg.max_concurrent_requests,
        limiter_cfg.max_requests_per_minute,
        limiter_status.current_request_count,
        limiter_status.window_elapsed.as_millis(),
        limiter_status.available_concurrency
    );

    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();
        let content_hash = compute_content_hash(&markdown_content);
        let chunker = crate::chunking::TextChunker::new(chunking_config);
        let chunks = chunker.chunk(&markdown_content);
        let now = Utc::now().to_rfc3339();

        let config = serde_json::json!({
            "embedding_model": embedding_model,
            "chunk_size": rag_settings.chunk_size,
            "chunk_overlap": rag_settings.chunk_overlap,
            "provider_id": provider.base_url,
        })
        .to_string();

        conn.execute(
            "UPDATE index_jobs SET status = 'indexing', config = ?1, content_hash = ?2, total_chunks = ?3, started_at = ?4, updated_at = ?4 WHERE id = ?5",
            (&config, &content_hash, chunks.len() as i32, &now, index_job_id),
        ).map_err(|e| e.to_string())?;

        for chunk in &chunks {
            conn.execute(
                "INSERT OR IGNORE INTO index_chunks
                 (id, job_id, document_id, chunk_index, content, status, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?6)",
                (
                    &Uuid::new_v4().to_string(),
                    index_job_id,
                    document_id,
                    chunk.index as i32,
                    &chunk.text,
                    &now,
                ),
            )
            .map_err(|e| e.to_string())?;
        }
    }

    let embeddings = embedder.embed_with_chunks_incremental(
        &markdown_content,
        |completed, total, result, success| {
            let progress = if total > 0 {
                (completed as f64 / total as f64) * 100.0
            } else {
                0.0
            };
            let now = Utc::now().to_rfc3339();

            if let Ok(db) = state.db.lock() {
                let conn = db.get_connection();
                let _ = conn.execute(
                    "UPDATE index_jobs SET progress = ?1, completed_chunks = ?2, updated_at = ?3 WHERE id = ?4 AND status = 'indexing'",
                    (progress, completed as i32, &now, index_job_id),
                );
                let status = if success { "completed" } else { "failed" };
                let embedding_bytes: Option<Vec<u8>> = if success {
                    Some(result.embedding.iter().flat_map(|f| f.to_le_bytes()).collect())
                } else {
                    None
                };
                let _ = conn.execute(
                    "UPDATE index_chunks SET embedding = ?1, status = ?2, updated_at = ?3 WHERE job_id = ?4 AND chunk_index = ?5",
                    (&embedding_bytes, status, &now, index_job_id, result.chunk_index as i32),
                );
            }
        },
    ).await?;

    let failed_count = embeddings.iter().filter(|r| r.embedding.is_empty()).count();
    let successful_embeddings: Vec<_> = embeddings
        .into_iter()
        .filter(|r| !r.embedding.is_empty())
        .collect();

    if successful_embeddings.is_empty() {
        return Err("No text was available to index".to_string());
    }

    if failed_count > 0 {
        // Partial success
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();
        let now = Utc::now().to_rfc3339();
        let error_msg = format!("{} chunk(s) failed to embed", failed_count);

        conn.execute(
            "UPDATE index_jobs SET status = 'partial', error_message = ?1, completed_at = ?2, updated_at = ?2 WHERE id = ?3",
            (&error_msg, &now, index_job_id),
        ).map_err(|e| e.to_string())?;

        conn.execute(
            "UPDATE documents SET index_status = 'failed', updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL",
            (&now, document_id),
        ).map_err(|e| e.to_string())?;

        return Err(error_msg);
    }

    // All succeeded — write to final tables
    let mut sorted_embeddings = successful_embeddings;
    sorted_embeddings.sort_by_key(|chunk| chunk.chunk_index);

    if let (Some(first), Some(last)) = (sorted_embeddings.first(), sorted_embeddings.last()) {
        log::debug!(
            "Embedding chunks cover byte range {}..{}",
            first.start_pos,
            last.end_pos
        );
    }

    let vector_dimension = sorted_embeddings
        .first()
        .map(|embedding| embedding.embedding.len())
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

    let indexed_chunks = sorted_embeddings
        .into_iter()
        .map(|chunk| IndexedChunk {
            id: Uuid::new_v4().to_string(),
            content: chunk.text,
            chunk_index: chunk.chunk_index as i32,
            embedding: chunk.embedding,
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
        if use_zvec { "zvec" } else { "sqlite" },
        collection_key.as_deref(),
        &embedding_model,
        vector_dimension,
        &now,
    )?;

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

        crate::zvec::vec0_insert(
            conn,
            vector_dimension,
            &indexed_chunk.id,
            &embedding_bytes,
            &embedding_model,
        )?;
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

    conn.execute(
        "UPDATE index_jobs SET status = 'completed', progress = 100, completed_at = ?1, updated_at = ?1 WHERE id = ?2",
        (&now, index_job_id),
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct IndexJobWithDoc {
    pub id: String,
    pub document_id: String,
    pub document_title: String,
    pub provider_id: String,
    pub status: String,
    pub progress: f64,
    pub total_chunks: i32,
    pub completed_chunks: i32,
    pub error_message: Option<String>,
    pub config: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub fn get_all_index_jobs(state: State<AppState>) -> Result<Vec<IndexJobWithDoc>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    let mut stmt = conn
        .prepare(
            "SELECT ij.id, ij.document_id, d.title, ij.provider_id, ij.status, ij.progress,
                ij.total_chunks, ij.completed_chunks, ij.error_message, ij.config,
                ij.started_at, ij.completed_at, ij.created_at, ij.updated_at
         FROM index_jobs ij
         JOIN documents d ON d.id = ij.document_id
         WHERE d.deleted_at IS NULL
         ORDER BY ij.created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let jobs = stmt
        .query_map([], |row| {
            Ok(IndexJobWithDoc {
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
        .map_err(|e| e.to_string())?;

    jobs.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_index_job(state: State<AppState>, job_id: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();
    conn.execute("DELETE FROM index_jobs WHERE id = ?1", [&job_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn resume_index_job(
    app: AppHandle,
    state: State<'_, AppState>,
    job_id: String,
) -> Result<String, String> {
    resume_index_job_internal(&app, state.inner(), &job_id, false).await
}

#[tauri::command]
pub async fn retry_failed_index_chunks(
    app: AppHandle,
    state: State<'_, AppState>,
    job_id: String,
) -> Result<String, String> {
    resume_index_job_internal(&app, state.inner(), &job_id, true).await
}

async fn resume_index_job_internal(
    app: &AppHandle,
    state: &AppState,
    job_id: &str,
    _only_failed: bool,
) -> Result<String, String> {
    let app_dir = crate::app_dirs::runtime_app_dir(app)?;

    let (document_id, provider_id) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();

        let (status, doc_id, prov_id): (String, String, String) = conn
            .query_row(
                "SELECT status, document_id, provider_id FROM index_jobs WHERE id = ?1",
                [job_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(|e| format!("Index job not found: {}", e))?;

        if status != "failed" && status != "partial" {
            return Err(format!("Cannot resume index job with status '{}'. Only 'failed' or 'partial' jobs can be resumed.", status));
        }

        if let Ok(handles) = state.index_job_handles.lock() {
            if handles.contains_key(&doc_id) {
                return Err("An index job is already running for this document".to_string());
            }
        }

        (doc_id, prov_id)
    };

    let provider = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();
        let provider_record = load_provider_record_by_id(conn, &provider_id).map_err(|_| {
            "The provider used for this job has been deleted. Please start a new index job."
                .to_string()
        })?;
        let provider_models = load_provider_models_for_provider(conn, &provider_id)?;
        let embed_model = find_primary_model_for_type(&provider_models, PROVIDER_MODEL_TYPE_EMBED)
            .ok_or_else(|| {
                format!(
                    "Channel \"{}\" has no active embedding model",
                    provider_record.name
                )
            })?;

        DirectEmbeddingProvider {
            base_url: provider_record.base_url,
            api_key: provider_record.api_key,
            embedding_model: embed_model.model_name,
            dimensions: embed_model.config.and_then(|config| config.dimensions),
            max_retries: provider_record.max_retries.max(0) as usize,
            max_concurrent_requests: provider_record.concurrency.max(1) as usize,
        }
    };

    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE index_jobs SET status = 'indexing', error_message = NULL, started_at = ?1, updated_at = ?1 WHERE id = ?2",
            (&now, job_id),
        ).map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE documents SET index_status = 'indexing', updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL",
            (&now, &document_id),
        ).map_err(|e| e.to_string())?;
    }

    // For index resume, we re-run the full index job since embeddings need to be written atomically
    // to the final tables (chunks, embeddings, vec0). The index_chunks table tracks progress.
    let doc_id_clone = document_id.clone();
    let state_clone = state.clone();
    let app_dir_clone = app_dir.clone();
    let job_id_str = job_id.to_string();

    let handle = tauri::async_runtime::spawn(async move {
        let result = execute_index_job_with_embedding_provider(
            &state_clone,
            &app_dir_clone,
            &doc_id_clone,
            &provider,
            &job_id_str,
        )
        .await;
        if let Ok(mut handles) = state_clone.index_job_handles.lock() {
            handles.remove(&doc_id_clone);
        }
        if let Err(e) = result {
            let _ = mark_index_job_failed(&state_clone, &doc_id_clone, &job_id_str, &e);
        }
    });

    let mut handles = state.index_job_handles.lock().map_err(|e| e.to_string())?;
    handles.insert(document_id.clone(), handle);

    Ok(job_id.to_string())
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
            .ok_or_else(|| {
                format!(
                    "Channel \"{}\" has no active embedding model",
                    provider_record.name
                )
            })?;
        let rag_settings = crate::zvec::load_rag_settings(conn, &app_dir)?;
        let zvec_settings = crate::zvec::load_zvec_settings(conn, &app_dir)?;

        (
            DirectEmbeddingProvider {
                base_url: provider_record.base_url,
                api_key: provider_record.api_key,
                embedding_model: embed_model.model_name,
                dimensions: embed_model.config.and_then(|config| config.dimensions),
                max_retries: provider_record.max_retries.max(0) as usize,
                max_concurrent_requests: provider_record.concurrency.max(1) as usize,
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
    )
    .with_retry_config({
        let mut config = crate::retry::RetryConfig::for_batch_processing();
        config.max_retries = provider.max_retries;
        config
    });

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
                chunk_map
                    .get(&hit.id)
                    .map(|(document_id, content)| SearchResult {
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

    let dimension = query_embedding.len();
    let query_bytes: Vec<u8> = query_embedding
        .iter()
        .flat_map(|f| f.to_le_bytes())
        .collect();

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
                        chunk_map
                            .get(&chunk_id)
                            .map(|(document_id, content)| SearchResult {
                                chunk_id: chunk_id.clone(),
                                document_id: document_id.clone(),
                                content: content.clone(),
                                score: 1.0 - distance,
                            })
                    })
                    .take(requested_limit)
                    .collect();

                return Ok(results);
            }
        }
    }

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

    results.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
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
            "original" => load_latest_parsed_markdown_internal(conn, &document_id)?,
            "translated" => load_latest_translated_text_internal(conn, &document_id)?,
            "bilingual" => {
                let original = load_latest_parsed_markdown_internal(conn, &document_id)?;
                let translated = load_latest_translated_text_internal(conn, &document_id)?;

                format!(
                    "# Original\n\n{}\n\n# Translation\n\n{}",
                    original, translated
                )
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRuntimeLogsOptions {
    pub min_level: Option<String>,
    pub days: Option<i64>,
}

#[tauri::command]
pub fn get_runtime_logs(
    state: State<AppState>,
    limit: Option<i64>,
    min_level: Option<String>,
    offset: Option<i64>,
) -> Result<Vec<RuntimeLogEntry>, String> {
    let normalized_limit = limit.unwrap_or(500).clamp(10, 5000) as usize;
    let normalized_offset = offset.unwrap_or(0).max(0) as usize;
    let normalized_level = min_level
        .as_deref()
        .and_then(normalize_log_level_input)
        .map(|v| v.to_string());

    read_runtime_logs_from_files(
        &state.app_dir,
        normalized_limit,
        normalized_offset,
        normalized_level.as_deref(),
    )
}

#[tauri::command]
pub fn export_runtime_logs(
    state: State<AppState>,
    file_path: String,
    options: Option<ExportRuntimeLogsOptions>,
) -> Result<String, String> {
    let min_level = options
        .as_ref()
        .and_then(|opt| opt.min_level.as_deref())
        .and_then(normalize_log_level_input)
        .unwrap_or("debug");
    let days = options
        .as_ref()
        .and_then(|opt| opt.days)
        .unwrap_or(7)
        .clamp(1, 3650);
    let now = Utc::now();
    let threshold = now - chrono::Duration::days(days);
    let rows = read_runtime_logs_from_files(&state.app_dir, 50_000, 0, Some(min_level))?;

    let mut output = fs::File::create(&file_path).map_err(|e| e.to_string())?;
    writeln!(output, "# Rosetta Runtime Logs").map_err(|e| e.to_string())?;
    writeln!(output, "# min_level={min_level}, days={days}").map_err(|e| e.to_string())?;
    writeln!(output).map_err(|e| e.to_string())?;

    for row in rows.into_iter().rev() {
        let created_time = chrono::DateTime::parse_from_rfc3339(&row.created_at)
            .map(|dt| dt.with_timezone(&Utc))
            .ok();
        if let Some(created_time) = created_time {
            if created_time < threshold {
                continue;
            }
        }

        let created_at = row.created_at;
        let level = row.level;
        let message = row.message;
        let context = row.context;
        if let Some(context) = context {
            writeln!(output, "[{created_at}] [{level}] {message} | {context}")
                .map_err(|e| e.to_string())?;
        } else {
            writeln!(output, "[{created_at}] [{level}] {message}").map_err(|e| e.to_string())?;
        }
    }

    Ok(file_path)
}

#[tauri::command]
pub fn run_cleanup_now(app: AppHandle, state: State<AppState>) -> Result<String, String> {
    let app_dir = crate::app_dirs::runtime_app_dir(&app)?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    run_periodic_cleanup(db.get_connection(), &state.settings, &app_dir)?;
    Ok("Cleanup completed".to_string())
}

#[tauri::command]
pub fn get_mineru_processed_storage_dir(app: AppHandle) -> Result<String, String> {
    let path = crate::app_dirs::runtime_app_dir(&app)?;
    path.to_str()
        .map(|value| value.to_string())
        .ok_or_else(|| "Storage path contains invalid characters".to_string())
}

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

    let title = filename
        .rsplit_once('.')
        .map(|(name, _)| name)
        .unwrap_or(filename);

    let id = Uuid::new_v4().to_string();

    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();
        let now = Utc::now().to_rfc3339();

        let parse_status = match normalized_file_type.as_str() {
            "md" | "txt" => "completed",
            _ => "pending",
        };

        conn.execute(
            "INSERT INTO documents (id, title, filename, file_path, file_size, parse_status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            (&id, title, filename, dest_path.to_str().ok_or("File path contains invalid characters")?, &(file_size as i64), parse_status, &now, &now),
        )
        .map_err(|e| e.to_string())?;

        if normalized_file_type == "md" || normalized_file_type == "txt" {
            let content = FileHandler::read_text_file(source_path)?;
            let content_id = Uuid::new_v4().to_string();
            let (markdown_path, json_path, structure_path) =
                crate::content_store::write_parsed_version(&app_dir, &id, 1, &content, "{}", None)?;

            conn.execute(
                "INSERT INTO parsed_contents (id, document_id, version, markdown_content, json_content, structure_tree, created_at) VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6)",
                (&content_id, &id, &markdown_path, &json_path, &structure_path, &now),
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
    let extension = source_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
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
        )
        .map_err(|e| e.to_string())?;
    }

    if let Some(tags) = doc.tags {
        for tag in tags {
            conn.execute(
                "INSERT INTO document_tags (document_id, tag_id, created_at) VALUES (?1, ?2, ?3)",
                (&new_id, &tag.id, &now),
            )
            .map_err(|e| e.to_string())?;
        }
    }

    let is_text = doc.filename.ends_with(".md")
        || doc.filename.ends_with(".txt")
        || doc.filename.ends_with(".csv");
    if is_text {
        if let Ok(content) = FileHandler::read_text_file(&dest_path) {
            let content_id = Uuid::new_v4().to_string();
            let (markdown_path, json_path, structure_path) =
                crate::content_store::write_parsed_version(
                    &app_dir, &new_id, 1, &content, "{}", None,
                )?;
            let _ = conn.execute(
                "INSERT INTO parsed_contents (id, document_id, version, markdown_content, json_content, structure_tree, created_at) VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6)",
                (&content_id, &new_id, &markdown_path, &json_path, &structure_path, &now),
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

#[tauri::command]
pub async fn batch_start_parse_jobs(
    app: AppHandle,
    state: State<'_, AppState>,
    document_ids: Vec<String>,
) -> Result<BatchActionReport, String> {
    let app_dir = crate::app_dirs::runtime_app_dir(&app)?;
    let unique_ids = unique_document_ids(&document_ids);
    let mut failures = Vec::new();
    let mut succeeded = 0usize;

    for document_id in unique_ids.iter() {
        let status: String = {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            let conn = db.get_connection();
            match conn.query_row(
                "SELECT parse_status FROM documents WHERE id = ?1 AND deleted_at IS NULL",
                [document_id],
                |row| row.get::<_, String>(0),
            ) {
                Ok(s) => s,
                Err(_) => {
                    failures.push(BatchActionFailure {
                        document_id: document_id.clone(),
                        reason: "Document not found".to_string(),
                    });
                    continue;
                }
            }
        };

        if status == "parsing" {
            failures.push(BatchActionFailure {
                document_id: document_id.clone(),
                reason: "Already parsing".to_string(),
            });
            continue;
        }

        match enqueue_parse_job(state.inner(), Some(app_dir.clone()), document_id, true) {
            Ok(_) => succeeded += 1,
            Err(e) => {
                failures.push(BatchActionFailure {
                    document_id: document_id.clone(),
                    reason: e,
                });
            }
        }
    }

    Ok(BatchActionReport {
        requested: unique_ids.len(),
        succeeded,
        failed: failures.len(),
        failures,
    })
}

fn enqueue_translation_job_internal(
    state: &AppState,
    app_dir: PathBuf,
    document_id: &str,
    provider_id: &str,
    source_language: &str,
    target_language: &str,
    sampling: &LlmSamplingConfig,
    runtime_settings: &TranslationRuntimeSettings,
    translate_model: &ProviderModel,
    provider_record: &ProviderRecord,
) -> Result<TranslationJob, String> {
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
        "runtime": {
            "chunk_strategy": runtime_settings.chunk_strategy.as_str(),
            "chunk_size": runtime_settings.chunk_size,
            "chunk_overlap": runtime_settings.chunk_overlap,
            "max_concurrent_requests": runtime_settings.max_concurrent_requests,
            "max_requests_per_minute": runtime_settings.max_requests_per_minute,
            "smart_optimize_enabled": runtime_settings.smart_optimize_enabled,
        },
    })
    .to_string();

    let job = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();

        conn.execute(
            "INSERT INTO translation_jobs (id, document_id, provider_id, status, progress, config, created_at, updated_at) VALUES (?1, ?2, ?3, 'pending', 0, ?4, ?5, ?6)",
            (&job_id, document_id, provider_id, &config, &now, &now),
        ).map_err(|e| e.to_string())?;

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
        .map_err(|e| e.to_string())?
    };

    let job_id_clone = job_id.clone();
    let document_id_clone = document_id.to_string();
    let provider_id_clone = provider_id.to_string();
    let source_language_clone = source_language.to_string();
    let target_language_clone = target_language.to_string();
    let state_clone = state.clone();
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
pub async fn batch_start_translation_jobs(
    app: AppHandle,
    state: State<'_, AppState>,
    document_ids: Vec<String>,
    provider_id: String,
) -> Result<BatchActionReport, String> {
    let app_dir = crate::app_dirs::runtime_app_dir(&app)?;

    let (provider_record, translate_model, sampling, runtime_settings) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();
        let provider_record = load_provider_record_by_id(conn, &provider_id)?;
        let provider_models = load_provider_models_for_provider(conn, &provider_id)?;
        let translate_model =
            find_primary_model_for_type(&provider_models, PROVIDER_MODEL_TYPE_TRANSLATE)
                .ok_or_else(|| {
                    format!(
                        "Channel \"{}\" has no active translate model",
                        provider_record.name
                    )
                })?;
        let mut sampling = load_llm_sampling_config(&state.settings, "translate")?;
        if sampling.temperature.is_none() {
            sampling.temperature = provider_record.legacy_temperature;
        }
        if sampling.max_tokens.is_none() {
            sampling.max_tokens = provider_record.legacy_max_tokens;
        }
        let runtime_settings = load_translation_runtime_settings(&state.settings)?;
        (provider_record, translate_model, sampling, runtime_settings)
    };

    let unique_ids = unique_document_ids(&document_ids);
    let mut failures = Vec::new();
    let mut succeeded = 0usize;

    for document_id in unique_ids.iter() {
        let (parse_status, translation_status, source_lang, target_lang) = {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            let conn = db.get_connection();
            match conn.query_row(
                "SELECT parse_status, translation_status, source_language, target_language FROM documents WHERE id = ?1 AND deleted_at IS NULL",
                [document_id],
                |row| Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                )),
            ) {
                Ok(r) => r,
                Err(_) => {
                    failures.push(BatchActionFailure {
                        document_id: document_id.clone(),
                        reason: "Document not found".to_string(),
                    });
                    continue;
                }
            }
        };

        if parse_status != "completed" {
            failures.push(BatchActionFailure {
                document_id: document_id.clone(),
                reason: "Document has not been parsed yet".to_string(),
            });
            continue;
        }

        if translation_status == "translating" {
            failures.push(BatchActionFailure {
                document_id: document_id.clone(),
                reason: "Already translating".to_string(),
            });
            continue;
        }

        let source_language = source_lang.unwrap_or_else(|| "English".to_string());
        let target_language = target_lang.unwrap_or_else(|| "Chinese".to_string());

        match enqueue_translation_job_internal(
            state.inner(),
            app_dir.clone(),
            document_id,
            &provider_id,
            &source_language,
            &target_language,
            &sampling,
            &runtime_settings,
            &translate_model,
            &provider_record,
        ) {
            Ok(_) => succeeded += 1,
            Err(e) => {
                failures.push(BatchActionFailure {
                    document_id: document_id.clone(),
                    reason: e,
                });
            }
        }
    }

    Ok(BatchActionReport {
        requested: unique_ids.len(),
        succeeded,
        failed: failures.len(),
        failures,
    })
}

fn enqueue_index_job_internal(
    state: &AppState,
    app_dir: &Path,
    document_id: &str,
    provider_id: &str,
) -> Result<(), String> {
    let index_job_id = Uuid::new_v4().to_string();

    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();
        let now = Utc::now().to_rfc3339();
        let updated = conn
            .execute(
                "UPDATE documents
                 SET index_status = 'indexing', updated_at = ?1
                 WHERE id = ?2 AND deleted_at IS NULL",
                (&now, document_id),
            )
            .map_err(|e| e.to_string())?;

        if updated == 0 {
            return Err("Document not found".to_string());
        }

        conn.execute(
            "INSERT INTO index_jobs (id, document_id, provider_id, status, config, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'pending', '{}', ?4, ?4)",
            (&index_job_id, document_id, provider_id, &now),
        ).map_err(|e| e.to_string())?;
    }

    let document_id_clone = document_id.to_string();
    let provider_id_clone = provider_id.to_string();
    let state_clone = state.clone();
    let app_dir_clone = app_dir.to_path_buf();
    let index_job_id_clone = index_job_id.clone();

    let handle = tauri::async_runtime::spawn(async move {
        let result = execute_index_job(
            &state_clone,
            &app_dir_clone,
            &document_id_clone,
            &provider_id_clone,
            &index_job_id_clone,
        )
        .await;
        if let Ok(mut handles) = state_clone.index_job_handles.lock() {
            handles.remove(&document_id_clone);
        }
        if let Err(e) = result {
            let _ =
                mark_index_job_failed(&state_clone, &document_id_clone, &index_job_id_clone, &e);
        }
    });

    let mut handles = state.index_job_handles.lock().map_err(|e| e.to_string())?;
    handles.insert(document_id.to_string(), handle);

    Ok(())
}

#[tauri::command]
pub async fn batch_start_index_jobs(
    app: AppHandle,
    state: State<'_, AppState>,
    document_ids: Vec<String>,
    provider_id: String,
) -> Result<BatchActionReport, String> {
    let app_dir = crate::app_dirs::runtime_app_dir(&app)?;

    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();
        let provider_record = load_provider_record_by_id(conn, &provider_id)?;
        let provider_models = load_provider_models_for_provider(conn, &provider_id)?;
        find_primary_model_for_type(&provider_models, PROVIDER_MODEL_TYPE_EMBED).ok_or_else(
            || {
                format!(
                    "Channel \"{}\" has no active embedding model",
                    provider_record.name
                )
            },
        )?;
    }

    let unique_ids = unique_document_ids(&document_ids);
    let mut failures = Vec::new();
    let mut succeeded = 0usize;

    for document_id in unique_ids.iter() {
        let (parse_status, index_status) = {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            let conn = db.get_connection();
            match conn.query_row(
                "SELECT parse_status, index_status FROM documents WHERE id = ?1 AND deleted_at IS NULL",
                [document_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            ) {
                Ok(r) => r,
                Err(_) => {
                    failures.push(BatchActionFailure {
                        document_id: document_id.clone(),
                        reason: "Document not found".to_string(),
                    });
                    continue;
                }
            }
        };

        if parse_status != "completed" {
            failures.push(BatchActionFailure {
                document_id: document_id.clone(),
                reason: "Document has not been parsed yet".to_string(),
            });
            continue;
        }

        if index_status == "indexing" {
            failures.push(BatchActionFailure {
                document_id: document_id.clone(),
                reason: "Already indexing".to_string(),
            });
            continue;
        }

        match enqueue_index_job_internal(state.inner(), &app_dir, document_id, &provider_id) {
            Ok(_) => succeeded += 1,
            Err(e) => {
                failures.push(BatchActionFailure {
                    document_id: document_id.clone(),
                    reason: e,
                });
            }
        }
    }

    Ok(BatchActionReport {
        requested: unique_ids.len(),
        succeeded,
        failed: failures.len(),
        failures,
    })
}

#[tauri::command]
pub fn batch_add_tags(
    state: State<AppState>,
    document_ids: Vec<String>,
    tag_ids: Vec<String>,
) -> Result<BatchActionReport, String> {
    let unique_ids = unique_document_ids(&document_ids);
    let mut failures = Vec::new();
    let mut succeeded = 0usize;

    for document_id in unique_ids.iter() {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();

        let exists = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM documents WHERE id = ?1 AND deleted_at IS NULL)",
                [document_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|e| e.to_string())?
            != 0;

        if !exists {
            failures.push(BatchActionFailure {
                document_id: document_id.clone(),
                reason: "Document not found".to_string(),
            });
            continue;
        }

        let now = Utc::now().to_rfc3339();
        for tag_id in tag_ids.iter() {
            let _ = conn.execute(
                "INSERT OR IGNORE INTO document_tags (document_id, tag_id, created_at) VALUES (?1, ?2, ?3)",
                (document_id, tag_id, &now),
            );
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

#[tauri::command]
pub fn batch_remove_tags(
    state: State<AppState>,
    document_ids: Vec<String>,
    tag_ids: Vec<String>,
) -> Result<BatchActionReport, String> {
    let unique_ids = unique_document_ids(&document_ids);
    let mut failures = Vec::new();
    let mut succeeded = 0usize;

    for document_id in unique_ids.iter() {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();

        let exists = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM documents WHERE id = ?1 AND deleted_at IS NULL)",
                [document_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|e| e.to_string())?
            != 0;

        if !exists {
            failures.push(BatchActionFailure {
                document_id: document_id.clone(),
                reason: "Document not found".to_string(),
            });
            continue;
        }

        for tag_id in tag_ids.iter() {
            let _ = conn.execute(
                "DELETE FROM document_tags WHERE document_id = ?1 AND tag_id = ?2",
                (document_id, tag_id),
            );
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

#[tauri::command]
pub fn batch_set_language(
    state: State<AppState>,
    document_ids: Vec<String>,
    source_language: Option<String>,
    target_language: Option<String>,
) -> Result<BatchActionReport, String> {
    if source_language.is_none() && target_language.is_none() {
        let unique_ids = unique_document_ids(&document_ids);
        return Ok(BatchActionReport {
            requested: unique_ids.len(),
            succeeded: 0,
            failed: 0,
            failures: Vec::new(),
        });
    }

    let unique_ids = unique_document_ids(&document_ids);
    let mut failures = Vec::new();
    let mut succeeded = 0usize;

    for document_id in unique_ids.iter() {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();
        let now = Utc::now().to_rfc3339();

        let exists = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM documents WHERE id = ?1 AND deleted_at IS NULL)",
                [document_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|e| e.to_string())?
            != 0;

        if !exists {
            failures.push(BatchActionFailure {
                document_id: document_id.clone(),
                reason: "Document not found".to_string(),
            });
            continue;
        }

        if let Some(ref lang) = source_language {
            conn.execute(
                "UPDATE documents SET source_language = ?1, updated_at = ?2 WHERE id = ?3",
                (lang, &now, document_id),
            )
            .map_err(|e| e.to_string())?;
        }

        if let Some(ref lang) = target_language {
            conn.execute(
                "UPDATE documents SET target_language = ?1, updated_at = ?2 WHERE id = ?3",
                (lang, &now, document_id),
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

fn get_export_content(
    conn: &rusqlite::Connection,
    document_id: &str,
    content_type: &str,
) -> Result<String, String> {
    match content_type {
        "original" => load_latest_parsed_markdown_internal(conn, document_id)
            .map_err(|e| format!("No parsed content: {}", e)),
        "translated" => load_latest_translated_text_internal(conn, document_id)
            .map_err(|e| format!("No translated content: {}", e)),
        "bilingual" => {
            let original = load_latest_parsed_markdown_internal(conn, document_id)
                .map_err(|e| format!("No parsed content: {}", e))?;

            let translated = load_latest_translated_text_internal(conn, document_id)
                .map_err(|e| format!("No translated content: {}", e))?;

            Ok(format!(
                "# Original\n\n{}\n\n# Translation\n\n{}",
                original, translated
            ))
        }
        _ => Err("Invalid content type".to_string()),
    }
}

#[tauri::command]
pub async fn batch_export_documents(
    state: State<'_, AppState>,
    document_ids: Vec<String>,
    format: String,
    content_type: String,
    output_dir: String,
) -> Result<BatchActionReport, String> {
    let unique_ids = unique_document_ids(&document_ids);
    let mut failures = Vec::new();
    let mut succeeded = 0usize;

    let ext = match format.as_str() {
        "txt" => "txt",
        _ => "md",
    };

    for document_id in unique_ids.iter() {
        let (title, content) = {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            let conn = db.get_connection();

            let title = match conn.query_row(
                "SELECT title FROM documents WHERE id = ?1 AND deleted_at IS NULL",
                [document_id],
                |row| row.get::<_, String>(0),
            ) {
                Ok(t) => t,
                Err(_) => {
                    failures.push(BatchActionFailure {
                        document_id: document_id.clone(),
                        reason: "Document not found".to_string(),
                    });
                    continue;
                }
            };

            match get_export_content(conn, document_id, &content_type) {
                Ok(c) => (title, c),
                Err(e) => {
                    failures.push(BatchActionFailure {
                        document_id: document_id.clone(),
                        reason: e,
                    });
                    continue;
                }
            }
        };

        let safe_title: String = title
            .chars()
            .map(|c| {
                if c == '/'
                    || c == '\\'
                    || c == ':'
                    || c == '*'
                    || c == '?'
                    || c == '"'
                    || c == '<'
                    || c == '>'
                    || c == '|'
                {
                    '_'
                } else {
                    c
                }
            })
            .collect();

        let mut output_path = PathBuf::from(&output_dir).join(format!("{}.{}", safe_title, ext));
        let mut counter = 1;
        while output_path.exists() {
            output_path =
                PathBuf::from(&output_dir).join(format!("{}_{}.{}", safe_title, counter, ext));
            counter += 1;
        }

        match tokio::fs::write(&output_path, content.as_bytes()).await {
            Ok(_) => {
                let db = state.db.lock().map_err(|e| e.to_string())?;
                let conn = db.get_connection();
                let now = Utc::now().to_rfc3339();
                let export_id = Uuid::new_v4().to_string();
                let path_str = output_path.to_string_lossy().to_string();
                let _ = conn.execute(
                    "INSERT INTO export_records (id, document_id, format, content_type, file_path, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    (&export_id, document_id, &format, &content_type, &path_str, &now),
                );
                succeeded += 1;
            }
            Err(e) => {
                failures.push(BatchActionFailure {
                    document_id: document_id.clone(),
                    reason: format!("Failed to write file: {}", e),
                });
            }
        }
    }

    Ok(BatchActionReport {
        requested: unique_ids.len(),
        succeeded,
        failed: failures.len(),
        failures,
    })
}
