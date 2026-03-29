use crate::AppState;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::{AppHandle, State};

const DEFAULT_CHUNK_OVERLAP: usize = 50;
const DEFAULT_CHUNK_SIZE: usize = 512;
const DEFAULT_VECTOR_BACKEND: &str = "sqlite";
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

    Ok(RagSettings {
        chunk_size,
        chunk_overlap,
        vector_backend,
    })
}

pub fn load_zvec_settings(conn: &Connection, app_dir: &Path) -> Result<ZvecSettings, String> {
    let python_path =
        get_setting(conn, "rag.zvec_python_path")?.unwrap_or_else(default_python_path);

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
         FROM document_vector_indexes
         WHERE document_id = ?1",
        [document_id],
        |row| {
            Ok(VectorIndexRecord {
                backend: row.get(0)?,
                collection_key: row.get(1)?,
                embedding_model: row.get(2)?,
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

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x08000000;
        child.creation_flags(CREATE_NO_WINDOW);
    }

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

#[tauri::command]
pub fn get_zvec_status(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ZvecStatusResponse, String> {
    let app_dir = crate::app_dirs::runtime_app_dir(&app)?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    probe_status(db.get_connection(), &app_dir)
}
