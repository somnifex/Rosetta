use crate::AppState;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, State};

/// Apply `CREATE_NO_WINDOW` on Windows to prevent console window flashes.
/// Works with both `std::process::Command` and `tokio::process::Command`.
macro_rules! hide_console_window {
    ($cmd:expr) => {{
        #[cfg(target_os = "windows")]
        {
            #[allow(unused_imports)]
            use std::os::windows::process::CommandExt as _;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            $cmd.creation_flags(CREATE_NO_WINDOW);
        }
    }};
}

const DEFAULT_CHUNK_OVERLAP: usize = 50;
const DEFAULT_CHUNK_SIZE: usize = 512;
const DEFAULT_VECTOR_BACKEND: &str = "zvec";
const VECTOR_INDEX_BACKEND_ZVEC: &str = "zvec";
const ZVEC_BRIDGE_FILENAME: &str = "zvec_bridge.py";
const ZVEC_BRIDGE_SOURCE: &str = include_str!("../scripts/zvec_bridge.py");

#[derive(Debug, Clone, Serialize)]
pub struct ZvecStatusResponse {
    pub enabled: bool,
    pub backend: String,
    pub available: bool,
    pub platform_supported: bool,
    pub python_path: String,
    pub collections_dir: String,
    pub version: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone)]
pub struct RagSettings {
    pub chunk_size: usize,
    pub chunk_overlap: usize,
    pub vector_backend: String,
    pub reranker_mode: String,
    pub reranker_top_n: usize,
}

#[derive(Debug, Clone)]
pub struct ZvecSettings {
    pub python_path: String,
    pub collections_dir: PathBuf,
}

#[derive(Debug, Clone)]
pub struct VectorIndexRecord {
    pub backend: String,
    pub collection_key: Option<String>,
    pub embedding_model: Option<String>,
    pub vector_dimension: Option<usize>,
}

#[derive(Debug, Serialize)]
struct BridgeUpsertDoc<'a> {
    id: &'a str,
    vector: &'a [f32],
}

#[derive(Debug, Deserialize)]
struct BridgeResponse<T> {
    ok: bool,
    #[serde(default)]
    error: Option<String>,
    #[serde(flatten)]
    data: T,
}

#[derive(Debug, Default, Deserialize)]
struct ProbeResponse {
    available: bool,
    version: Option<String>,
    message: String,
}

#[derive(Debug, Default, Deserialize, Serialize)]
pub struct ProbeRerankerResponse {
    pub available: bool,
    pub message: String,
    #[serde(default)]
    pub hint: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct SearchBridgeResponse {
    #[serde(default)]
    hits: Vec<SearchHit>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SearchHit {
    pub id: String,
    pub score: Option<f32>,
}

pub fn default_python_path() -> String {
    if cfg!(windows) {
        "python".to_string()
    } else {
        "python3".to_string()
    }
}

pub fn default_collections_dir(app_dir: &Path) -> PathBuf {
    app_dir.join("zvec").join("collections")
}

pub fn platform_supported() -> bool {
    cfg!(target_os = "linux") || cfg!(target_os = "macos")
}

// --- Zvec runtime availability cache ---

pub struct ZvecAvailabilityCache {
    cached: Mutex<Option<bool>>,
    last_checked: Mutex<Option<std::time::Instant>>,
}

impl ZvecAvailabilityCache {
    pub fn new() -> Self {
        Self {
            cached: Mutex::new(None),
            last_checked: Mutex::new(None),
        }
    }

    pub fn invalidate(&self) {
        if let Ok(mut c) = self.cached.lock() {
            *c = None;
        }
        if let Ok(mut t) = self.last_checked.lock() {
            *t = None;
        }
    }

    fn check_or_probe(&self, app_dir: &Path, python_path: &str) -> bool {
        const TTL_SECS: u64 = 60;

        if let (Ok(cached), Ok(last)) = (self.cached.lock(), self.last_checked.lock()) {
            if let (Some(result), Some(ts)) = (*cached, *last) {
                if ts.elapsed().as_secs() < TTL_SECS {
                    return result;
                }
            }
        }

        let probe: ProbeResponse =
            match run_bridge(app_dir, python_path, "probe", None) {
                Ok(p) => p,
                Err(e) => {
                    log::warn!("zvec availability probe failed: {e}");
                    ProbeResponse {
                        available: false,
                        version: None,
                        message: e,
                    }
                }
            };

        let result = probe.available;
        if let Ok(mut c) = self.cached.lock() {
            *c = Some(result);
        }
        if let Ok(mut t) = self.last_checked.lock() {
            *t = Some(std::time::Instant::now());
        }
        result
    }
}

/// Check if zvec should actually be used: configured + platform + runtime availability.
pub fn should_use_zvec(
    rag_settings: &RagSettings,
    app_dir: &Path,
    zvec_settings: &ZvecSettings,
    cache: &ZvecAvailabilityCache,
) -> bool {
    if !vector_backend_is_zvec(rag_settings) {
        return false;
    }
    if !platform_supported() {
        return false;
    }
    cache.check_or_probe(app_dir, &zvec_settings.python_path)
}

fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    conn.query_row("SELECT value FROM app_settings WHERE key = ?1", [key], |row| {
        row.get::<_, String>(0)
    })
    .optional()
    .map_err(|e| e.to_string())
}

pub fn load_rag_settings(conn: &Connection) -> Result<RagSettings, String> {
    let chunk_size = get_setting(conn, "rag.chunk_size")?
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_CHUNK_SIZE);

    let chunk_overlap = get_setting(conn, "rag.chunk_overlap")?
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(DEFAULT_CHUNK_OVERLAP)
        .min(chunk_size.saturating_sub(1));

    let vector_backend =
        get_setting(conn, "rag.vector_backend")?.unwrap_or_else(|| DEFAULT_VECTOR_BACKEND.to_string());

    let reranker_mode =
        get_setting(conn, "rag.reranker_mode")?.unwrap_or_else(|| "disabled".to_string());

    let reranker_top_n = get_setting(conn, "rag.reranker_top_n")?
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(5);

    Ok(RagSettings {
        chunk_size,
        chunk_overlap,
        vector_backend,
        reranker_mode,
        reranker_top_n,
    })
}

pub fn load_zvec_settings(conn: &Connection, app_dir: &Path) -> Result<ZvecSettings, String> {
    let use_venv = get_setting(conn, "rag.zvec_use_venv")?
        .map(|v| v == "true")
        .unwrap_or(false);

    let python_path = if use_venv {
        let venv_dir = zvec_venv_dir(app_dir);
        let venv_python = zvec_venv_python_path(&venv_dir);
        if venv_python.exists() {
            venv_python.to_str().unwrap_or("python").to_string()
        } else {
            log::warn!("zvec use_venv is true but venv python not found, falling back to configured path");
            get_setting(conn, "rag.zvec_python_path")?.unwrap_or_else(default_python_path)
        }
    } else {
        get_setting(conn, "rag.zvec_python_path")?.unwrap_or_else(default_python_path)
    };

    let collections_dir = get_setting(conn, "rag.zvec_collections_dir")?
        .map(PathBuf::from)
        .filter(|value| !value.as_os_str().is_empty())
        .unwrap_or_else(|| default_collections_dir(app_dir));

    Ok(ZvecSettings {
        python_path,
        collections_dir,
    })
}

pub fn vector_backend_is_zvec(rag_settings: &RagSettings) -> bool {
    rag_settings.vector_backend.eq_ignore_ascii_case(VECTOR_INDEX_BACKEND_ZVEC)
}

pub fn collection_key_for_model(model: &str, dimension: usize) -> String {
    let mut sanitized = String::with_capacity(model.len() + 16);
    let mut last_was_sep = false;

    for ch in model.chars() {
        if ch.is_ascii_alphanumeric() {
            sanitized.push(ch.to_ascii_lowercase());
            last_was_sep = false;
        } else if !last_was_sep {
            sanitized.push('_');
            last_was_sep = true;
        }
    }

    let sanitized = sanitized.trim_matches('_');
    let base = if sanitized.is_empty() {
        "embedding"
    } else {
        sanitized
    };

    format!("{base}_{dimension}")
}

pub fn collection_path(settings: &ZvecSettings, collection_key: &str) -> PathBuf {
    settings.collections_dir.join(collection_key)
}

// --- sqlite-vec (vec0) helpers ---

pub fn vec0_table_name(dimension: usize) -> String {
    format!("vec_embeddings_{}", dimension)
}

pub fn ensure_vec0_table(conn: &Connection, dimension: usize) -> Result<(), String> {
    let table = vec0_table_name(dimension);
    let sql = format!(
        "CREATE VIRTUAL TABLE IF NOT EXISTS [{table}] USING vec0(
            embedding float[{dimension}] distance_metric=cosine,
            model text,
            +chunk_id text
        )"
    );
    conn.execute_batch(&sql).map_err(|e| e.to_string())
}

pub fn vec0_insert(
    conn: &Connection,
    dimension: usize,
    chunk_id: &str,
    embedding_bytes: &[u8],
    model: &str,
) -> Result<(), String> {
    let table = vec0_table_name(dimension);
    let sql = format!("INSERT INTO [{table}](embedding, model, chunk_id) VALUES (?1, ?2, ?3)");
    conn.execute(&sql, rusqlite::params![embedding_bytes, model, chunk_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn vec0_search(
    conn: &Connection,
    dimension: usize,
    query_bytes: &[u8],
    model: &str,
    limit: usize,
) -> Result<Vec<(String, f32)>, String> {
    let table = vec0_table_name(dimension);
    let sql = format!(
        "SELECT chunk_id, distance FROM [{table}]
         WHERE embedding MATCH ?1 AND k = ?2 AND model = ?3"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(
            rusqlite::params![query_bytes, limit as i32, model],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, f32>(1)?)),
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

pub fn vec0_delete_by_chunk_ids(
    conn: &Connection,
    dimension: usize,
    chunk_ids: &[String],
) -> Result<(), String> {
    if chunk_ids.is_empty() {
        return Ok(());
    }
    let table = vec0_table_name(dimension);
    for chunk_id in chunk_ids {
        let sql = format!(
            "DELETE FROM [{table}] WHERE rowid IN (
                SELECT rowid FROM [{table}] WHERE chunk_id = ?1
            )"
        );
        conn.execute(&sql, [chunk_id])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn upsert_document_index_record(
    conn: &Connection,
    document_id: &str,
    backend: &str,
    collection_key: Option<&str>,
    embedding_model: &str,
    vector_dimension: usize,
    now: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO document_vector_indexes (
            document_id,
            backend,
            collection_key,
            embedding_model,
            vector_dimension,
            created_at,
            updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
        ON CONFLICT(document_id) DO UPDATE SET
            backend = excluded.backend,
            collection_key = excluded.collection_key,
            embedding_model = excluded.embedding_model,
            vector_dimension = excluded.vector_dimension,
            updated_at = excluded.updated_at",
        params![
            document_id,
            backend,
            collection_key,
            embedding_model,
            vector_dimension as i64,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

pub fn delete_document_index_record(conn: &Connection, document_id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM document_vector_indexes WHERE document_id = ?1",
        [document_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

pub fn load_document_index_record(
    conn: &Connection,
    document_id: &str,
) -> Result<Option<VectorIndexRecord>, String> {
    conn.query_row(
        "SELECT backend, collection_key
         , embedding_model
         , vector_dimension
         FROM document_vector_indexes
         WHERE document_id = ?1",
        [document_id],
        |row| {
            Ok(VectorIndexRecord {
                backend: row.get(0)?,
                collection_key: row.get(1)?,
                embedding_model: row.get(2)?,
                vector_dimension: row.get::<_, Option<i64>>(3)?
                    .map(|v| v as usize),
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn load_document_chunk_ids(conn: &Connection, document_id: &str) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT id FROM chunks WHERE document_id = ?1 ORDER BY chunk_index")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([document_id], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(rows)
}

fn ensure_bridge_script(app_dir: &Path) -> Result<PathBuf, String> {
    let script_dir = app_dir.join("scripts");
    fs::create_dir_all(&script_dir).map_err(|e| e.to_string())?;
    let script_path = script_dir.join(ZVEC_BRIDGE_FILENAME);

    let should_write = match fs::read_to_string(&script_path) {
        Ok(existing) => existing != ZVEC_BRIDGE_SOURCE,
        Err(_) => true,
    };

    if should_write {
        fs::write(&script_path, ZVEC_BRIDGE_SOURCE).map_err(|e| e.to_string())?;
    }

    Ok(script_path)
}

fn run_bridge<T: for<'de> Deserialize<'de>>(
    app_dir: &Path,
    python_path: &str,
    command: &str,
    payload: Option<serde_json::Value>,
) -> Result<T, String> {
    let script_path = ensure_bridge_script(app_dir)?;

    let mut child = Command::new(python_path);
    child
        .arg(&script_path)
        .arg(command)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    hide_console_window!(child);

    let mut child = child
        .spawn()
        .map_err(|e| format!("Failed to start Python bridge: {e}"))?;

    if let Some(payload) = payload {
        let body = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(&body)
                .map_err(|e| format!("Failed to write Python bridge input: {e}"))?;
        }
    } else {
        drop(child.stdin.take());
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed to wait for Python bridge: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if stdout.is_empty() && !output.status.success() {
        return Err(if stderr.is_empty() {
            "Python bridge failed without output".to_string()
        } else {
            stderr
        });
    }

    let parsed: BridgeResponse<T> = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse Python bridge output: {e}. Output: {stdout}"))?;

    if !output.status.success() || !parsed.ok {
        return Err(parsed.error.unwrap_or_else(|| {
            if stderr.is_empty() {
                "Python bridge returned an unknown error".to_string()
            } else {
                stderr
            }
        }));
    }

    Ok(parsed.data)
}

pub fn rerank_via_bridge(
    app_dir: &Path,
    settings: &ZvecSettings,
    query: &str,
    documents: &[(String, String)],
    top_n: usize,
) -> Result<Vec<SearchHit>, String> {
    if documents.is_empty() {
        return Ok(Vec::new());
    }

    let docs: Vec<serde_json::Value> = documents
        .iter()
        .map(|(id, content)| json!({ "id": id, "content": content }))
        .collect();

    let payload = json!({
        "query": query,
        "documents": docs,
        "top_n": top_n,
        "rerank_field": "content",
    });

    let response: SearchBridgeResponse =
        run_bridge(app_dir, &settings.python_path, "rerank", Some(payload))?;

    Ok(response.hits)
}

pub fn probe_status(
    conn: &Connection,
    app_dir: &Path,
) -> Result<ZvecStatusResponse, String> {
    let rag_settings = load_rag_settings(conn)?;
    let zvec_settings = load_zvec_settings(conn, app_dir)?;

    if !platform_supported() {
        return Ok(ZvecStatusResponse {
            enabled: vector_backend_is_zvec(&rag_settings),
            backend: rag_settings.vector_backend,
            available: false,
            platform_supported: false,
            python_path: zvec_settings.python_path,
            collections_dir: zvec_settings.collections_dir.display().to_string(),
            version: None,
            message: "ZVEC currently has no official runtime support on Windows in this app.".to_string(),
        });
    }

    let probe: ProbeResponse = match run_bridge(app_dir, &zvec_settings.python_path, "probe", None)
    {
        Ok(probe) => probe,
        Err(error) => ProbeResponse {
            available: false,
            version: None,
            message: error,
        },
    };

    Ok(ZvecStatusResponse {
        enabled: vector_backend_is_zvec(&rag_settings),
        backend: rag_settings.vector_backend,
        available: probe.available,
        platform_supported: true,
        python_path: zvec_settings.python_path,
        collections_dir: zvec_settings.collections_dir.display().to_string(),
        version: probe.version,
        message: probe.message,
    })
}

pub fn upsert_embeddings(
    app_dir: &Path,
    settings: &ZvecSettings,
    collection_key: &str,
    embeddings: &[(&str, &[f32])],
) -> Result<(), String> {
    if embeddings.is_empty() {
        return Ok(());
    }

    let collection_path = collection_path(settings, collection_key);
    let dimension = embeddings[0].1.len();
    let docs = embeddings
        .iter()
        .map(|(id, vector)| BridgeUpsertDoc {
            id,
            vector,
        })
        .collect::<Vec<_>>();

    let payload = json!({
        "collection_path": collection_path,
        "collection_name": collection_key,
        "dimension": dimension,
        "docs": docs,
        "optimize": true,
    });

    let _: serde_json::Value = run_bridge(app_dir, &settings.python_path, "upsert", Some(payload))?;
    Ok(())
}

pub fn delete_embeddings(
    app_dir: &Path,
    settings: &ZvecSettings,
    collection_key: &str,
    chunk_ids: &[String],
) -> Result<(), String> {
    if chunk_ids.is_empty() {
        return Ok(());
    }

    let payload = json!({
        "collection_path": collection_path(settings, collection_key),
        "ids": chunk_ids,
    });

    let _: serde_json::Value = run_bridge(app_dir, &settings.python_path, "delete", Some(payload))?;
    Ok(())
}

pub fn search_embeddings(
    app_dir: &Path,
    settings: &ZvecSettings,
    collection_key: &str,
    vector: &[f32],
    topk: usize,
) -> Result<Vec<SearchHit>, String> {
    let payload = json!({
        "collection_path": collection_path(settings, collection_key),
        "vector": vector,
        "topk": topk,
    });

    let response: SearchBridgeResponse =
        run_bridge(app_dir, &settings.python_path, "search", Some(payload))?;

    Ok(response.hits)
}

/// Resolve the Python path for dependency operations (probe, install, download).
/// Always prefers the zvec venv when it exists, regardless of the `use_venv` toggle.
fn resolve_python_for_deps(app_dir: &Path, conn: &Connection) -> Result<String, String> {
    let venv_dir = zvec_venv_dir(app_dir);
    let venv_python = zvec_venv_python_path(&venv_dir);
    if venv_python.exists() {
        return Ok(venv_python.to_str().unwrap_or("python").to_string());
    }
    let zvec_settings = load_zvec_settings(conn, app_dir)?;
    Ok(zvec_settings.python_path)
}

#[tauri::command]
pub fn get_zvec_status(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ZvecStatusResponse, String> {
    state.zvec_availability_cache.invalidate();
    let app_dir = crate::app_dirs::runtime_app_dir(&app)?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    probe_status(db.get_connection(), &app_dir)
}

#[tauri::command]
pub fn probe_reranker_status(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ProbeRerankerResponse, String> {
    let app_dir = crate::app_dirs::runtime_app_dir(&app)?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let python_path = resolve_python_for_deps(&app_dir, db.get_connection())?;

    match run_bridge::<ProbeRerankerResponse>(
        &app_dir,
        &python_path,
        "probe_reranker",
        None,
    ) {
        Ok(resp) => Ok(resp),
        Err(error) => Ok(ProbeRerankerResponse {
            available: false,
            message: error,
            hint: Some("pip install sentence-transformers".to_string()),
        }),
    }
}

#[tauri::command]
pub async fn install_reranker_deps(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let app_dir = crate::app_dirs::runtime_app_dir(&app)?;
    let python_path = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        resolve_python_for_deps(&app_dir, db.get_connection())?
    };

    let mut pip_cmd = tokio::process::Command::new(&python_path);
    pip_cmd.args(["-m", "pip", "install", "sentence-transformers"]);
    hide_console_window!(pip_cmd);
    let output = pip_cmd
        .output()
        .await
        .map_err(|e| format!("Failed to run pip: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("pip install failed: {stderr}"));
    }

    Ok("sentence-transformers installed successfully".to_string())
}

// --- Reranker Model Manager ---

pub struct RerankerModelManager {
    status: Mutex<String>,
    message: Mutex<String>,
}

#[derive(Debug, Serialize)]
pub struct RerankerModelStatusResponse {
    pub status: String,
    pub message: String,
}

impl RerankerModelManager {
    pub fn new() -> Self {
        Self {
            status: Mutex::new("idle".to_string()),
            message: Mutex::new(String::new()),
        }
    }

    pub fn get_status(&self) -> Result<RerankerModelStatusResponse, String> {
        let status = self.status.lock().map_err(|e| e.to_string())?;
        let message = self.message.lock().map_err(|e| e.to_string())?;
        Ok(RerankerModelStatusResponse {
            status: status.clone(),
            message: message.clone(),
        })
    }

    pub fn set_status(&self, status: &str, message: &str) {
        if let Ok(mut s) = self.status.lock() {
            *s = status.to_string();
        }
        if let Ok(mut m) = self.message.lock() {
            *m = message.to_string();
        }
    }
}

#[tauri::command]
pub async fn download_reranker_model(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    {
        let status = state
            .reranker_model_manager
            .status
            .lock()
            .map_err(|e| e.to_string())?;
        if *status == "downloading" {
            return Err("Reranker model download already in progress".to_string());
        }
    }

    let app_dir = crate::app_dirs::runtime_app_dir(&app)?;
    let python_path = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        resolve_python_for_deps(&app_dir, db.get_connection())?
    };

    state
        .reranker_model_manager
        .set_status("downloading", "Starting reranker model download...");

    let manager = std::sync::Arc::clone(&state.reranker_model_manager);
    let app_dir_clone = app_dir.clone();

    tauri::async_runtime::spawn(async move {
        manager.set_status("downloading", "Downloading reranker model (~80 MB)...");

        let script_path = match ensure_bridge_script(&app_dir_clone) {
            Ok(p) => p,
            Err(e) => {
                manager.set_status("failed", &format!("Failed to prepare bridge script: {e}"));
                return;
            }
        };

        let payload = json!({
            "model": "cross-encoder/ms-marco-MiniLM-L6-v2",
        });

        let mut child = tokio::process::Command::new(&python_path);
        child
            .arg(&script_path)
            .arg("download_reranker_model")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        hide_console_window!(child);

        let mut child = match child.spawn() {
            Ok(c) => c,
            Err(e) => {
                manager.set_status("failed", &format!("Failed to start Python: {e}"));
                return;
            }
        };

        // Write payload to stdin
        if let Some(mut stdin) = child.stdin.take() {
            use tokio::io::AsyncWriteExt;
            let body = serde_json::to_vec(&payload).unwrap_or_default();
            let _ = stdin.write_all(&body).await;
            drop(stdin);
        }

        // Read stderr for progress messages
        let mm_stderr = std::sync::Arc::clone(&manager);
        let stderr_handle = if let Some(stderr) = child.stderr.take() {
            Some(tauri::async_runtime::spawn(async move {
                use tokio::io::{AsyncBufReadExt, BufReader};
                let reader = BufReader::new(stderr);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let trimmed = line.trim().to_string();
                    if !trimmed.is_empty() {
                        mm_stderr.set_status("downloading", &trimmed);
                    }
                }
            }))
        } else {
            None
        };

        let status = child.wait().await;

        if let Some(h) = stderr_handle {
            let _ = h.await;
        }

        match status {
            Ok(exit) if exit.success() => {
                manager.set_status("completed", "Reranker model downloaded successfully");
            }
            Ok(exit) => {
                let code = exit.code().unwrap_or(-1);
                manager.set_status(
                    "failed",
                    &format!("Model download failed (exit code: {})", code),
                );
            }
            Err(e) => {
                manager.set_status("failed", &format!("Model download error: {e}"));
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn get_reranker_model_status(
    state: State<'_, AppState>,
) -> Result<RerankerModelStatusResponse, String> {
    state.reranker_model_manager.get_status()
}

// --- Zvec Venv Manager ---

pub struct ZvecVenvManager {
    status: Mutex<String>,
    message: Mutex<String>,
}

#[derive(Debug, Serialize)]
pub struct ZvecVenvStatusResponse {
    pub status: String,
    pub message: String,
}

impl ZvecVenvManager {
    pub fn new() -> Self {
        Self {
            status: Mutex::new("not_created".to_string()),
            message: Mutex::new(String::new()),
        }
    }

    pub fn get_status(&self) -> Result<ZvecVenvStatusResponse, String> {
        let status = self.status.lock().map_err(|e| e.to_string())?;
        let message = self.message.lock().map_err(|e| e.to_string())?;
        Ok(ZvecVenvStatusResponse {
            status: status.clone(),
            message: message.clone(),
        })
    }

    pub fn set_status(&self, status: &str, message: &str) {
        if let Ok(mut s) = self.status.lock() {
            *s = status.to_string();
        }
        if let Ok(mut m) = self.message.lock() {
            *m = message.to_string();
        }
    }
}

fn zvec_venv_python_path(venv_dir: &Path) -> PathBuf {
    if cfg!(windows) {
        venv_dir.join("Scripts").join("python.exe")
    } else {
        venv_dir.join("bin").join("python")
    }
}

fn zvec_venv_dir(app_dir: &Path) -> PathBuf {
    app_dir.join("zvec_venv")
}

/// Run a pip command in the zvec venv. Returns Ok on success, Err with message on failure.
async fn run_venv_pip(
    python: &str,
    args: &[&str],
    pip_index_url: &str,
) -> Result<(), String> {
    let mut cmd_args = vec!["-m", "pip", "install"];
    cmd_args.extend_from_slice(args);
    if !pip_index_url.is_empty() {
        cmd_args.push("--index-url");
        cmd_args.push(pip_index_url);
    }

    let mut command = tokio::process::Command::new(python);
    command.args(&cmd_args);
    // Isolate from user pip config
    command.env("PIP_CONFIG_FILE", if cfg!(windows) { "NUL" } else { "/dev/null" });
    command.env_remove("PIP_INDEX_URL");
    command.env_remove("PIP_EXTRA_INDEX_URL");
    hide_console_window!(command);

    let output = command
        .output()
        .await
        .map_err(|e| format!("Failed to run pip: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let msg = if !stderr.is_empty() {
            stderr.to_string()
        } else if !stdout.is_empty() {
            stdout.to_string()
        } else {
            "pip install failed with no output".to_string()
        };
        // Truncate long messages
        let truncated = if msg.len() > 1500 { &msg[msg.len() - 1500..] } else { &msg };
        return Err(truncated.to_string());
    }

    Ok(())
}

#[tauri::command]
pub async fn setup_zvec_venv(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    {
        let status = state
            .zvec_venv_manager
            .status
            .lock()
            .map_err(|e| e.to_string())?;
        if *status == "creating" {
            return Err("Setup already in progress".to_string());
        }
    }

    let app_dir = crate::app_dirs::runtime_app_dir(&app)?;
    let venv_dir = zvec_venv_dir(&app_dir);

    let (system_python, pip_index_url) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();
        let python = get_setting(conn, "rag.zvec_system_python")?
            .unwrap_or_else(default_python_path);
        let pip_url = get_setting(conn, "rag.zvec_pip_index_url")?
            .unwrap_or_else(|| "https://pypi.org/simple".to_string());
        (python, pip_url)
    };

    state
        .zvec_venv_manager
        .set_status("creating", "Creating virtual environment...");

    let manager = std::sync::Arc::clone(&state.zvec_venv_manager);

    tauri::async_runtime::spawn(async move {
        // Validate system Python
        manager.set_status("creating", "Checking Python version...");
        let mut py_cmd = tokio::process::Command::new(&system_python);
        py_cmd.args(["--version"]);
        hide_console_window!(py_cmd);
        let output = py_cmd.output().await;
        match output {
            Ok(o) if o.status.success() => {
                let version = String::from_utf8_lossy(&o.stdout).trim().to_string();
                log::info!("System Python for zvec venv: {}", version);
            }
            Ok(o) => {
                let msg = String::from_utf8_lossy(&o.stderr).trim().to_string();
                manager.set_status("failed", &format!("Python version check failed: {msg}"));
                return;
            }
            Err(e) => {
                manager.set_status("failed", &format!("Failed to run Python: {e}"));
                return;
            }
        }

        // Remove old venv if exists
        if venv_dir.exists() {
            manager.set_status("creating", "Removing previous virtual environment...");
            if let Err(e) = std::fs::remove_dir_all(&venv_dir) {
                manager.set_status(
                    "failed",
                    &format!("Failed to remove previous venv: {e}"),
                );
                return;
            }
        }

        // Step 1: Create venv
        manager.set_status("creating", "Creating virtual environment...");
        let venv_dir_str = venv_dir.to_str().unwrap_or_default().to_string();
        let mut venv_cmd = tokio::process::Command::new(&system_python);
        venv_cmd.args(["-m", "venv", &venv_dir_str]);
        hide_console_window!(venv_cmd);
        let output = venv_cmd.output().await;

        match output {
            Ok(o) if !o.status.success() => {
                let msg = String::from_utf8_lossy(&o.stderr).trim().to_string();
                manager.set_status("failed", &format!("Failed to create venv: {msg}"));
                return;
            }
            Err(e) => {
                manager.set_status("failed", &format!("Failed to run Python: {e}"));
                return;
            }
            _ => {}
        }

        let venv_python = zvec_venv_python_path(&venv_dir);
        let venv_python_str = venv_python.to_str().unwrap_or_default().to_string();

        // Step 2: Upgrade pip
        manager.set_status("creating", "Upgrading pip...");
        if let Err(e) = run_venv_pip(
            &venv_python_str,
            &["--upgrade", "pip", "setuptools", "wheel"],
            &pip_index_url,
        )
        .await
        {
            log::warn!("pip upgrade warning (continuing): {e}");
        }

        // Step 3: Install zvec
        manager.set_status("creating", "Installing zvec...");
        if let Err(e) = run_venv_pip(&venv_python_str, &["zvec"], &pip_index_url).await {
            manager.set_status("failed", &format!("Failed to install zvec: {e}"));
            return;
        }

        // Step 4: Install sentence-transformers (for local reranker)
        manager.set_status("creating", "Installing sentence-transformers...");
        if let Err(e) =
            run_venv_pip(&venv_python_str, &["sentence-transformers"], &pip_index_url).await
        {
            manager.set_status("failed", &format!("Failed to install sentence-transformers: {e}"));
            return;
        }

        // Verify
        let mut verify_cmd = tokio::process::Command::new(&venv_python_str);
        verify_cmd.args(["-c", "import zvec; print(zvec.__version__)"]);
        hide_console_window!(verify_cmd);
        let verify = verify_cmd.output().await;

        match verify {
            Ok(o) if o.status.success() => {
                let ver = String::from_utf8_lossy(&o.stdout).trim().to_string();
                manager.set_status(
                    "ready",
                    &format!("Environment ready. zvec {ver}"),
                );
            }
            _ => {
                manager.set_status(
                    "failed",
                    "Virtual environment created, but zvec could not be imported. Please run Setup again.",
                );
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn get_zvec_venv_status(
    state: State<'_, AppState>,
) -> Result<ZvecVenvStatusResponse, String> {
    state.zvec_venv_manager.get_status()
}

#[tauri::command]
pub fn check_zvec_venv_exists(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let app_dir = crate::app_dirs::runtime_app_dir(&app)?;
    let venv_dir = zvec_venv_dir(&app_dir);
    let python_exe = zvec_venv_python_path(&venv_dir);
    let exists = python_exe.exists();

    if exists {
        let python_cmd = python_exe.to_string_lossy().to_string();

        // Check if zvec can be imported
        let mut cmd = std::process::Command::new(&python_cmd);
        cmd.args(["-c", "import zvec"])
            .stderr(std::process::Stdio::null());
        hide_console_window!(cmd);
        let ok = cmd
            .status()
            .map(|s| s.success())
            .unwrap_or(false);

        if ok {
            state
                .zvec_venv_manager
                .set_status("ready", "Environment is ready");
        } else {
            state.zvec_venv_manager.set_status(
                "failed",
                "Virtual environment exists, but zvec is not installed correctly. Run Setup to repair.",
            );
            return Ok(false);
        }

        return Ok(true);
    }

    state.zvec_venv_manager.set_status("not_created", "");
    Ok(false)
}
