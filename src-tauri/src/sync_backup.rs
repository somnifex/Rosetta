use crate::AppState;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::State;

/// Backup file envelope
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupEnvelope {
    pub version: u32,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    pub scope: String,  // "full" | "config"
    pub source: String, // "local-export" | "webdav-sync"
    #[serde(rename = "appInfo")]
    pub app_info: AppInfo,
    pub payload: BackupPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppInfo {
    pub name: String,
    #[serde(rename = "schemaVersion")]
    pub schema_version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupPayload {
    /// Always present: app_settings rows
    pub app_settings: Vec<SettingRow>,
    /// Always present: localStorage-backed config (passed from frontend)
    pub local_config: serde_json::Value,
    /// Only in "full" scope
    pub documents: Option<Vec<serde_json::Value>>,
    pub categories: Option<Vec<serde_json::Value>>,
    pub folders: Option<Vec<serde_json::Value>>,
    pub tags: Option<Vec<serde_json::Value>>,
    pub document_tags: Option<Vec<serde_json::Value>>,
    pub document_folders: Option<Vec<serde_json::Value>>,
    pub providers: Option<Vec<serde_json::Value>>,
    pub provider_models: Option<Vec<serde_json::Value>>,
    pub parsed_contents: Option<Vec<serde_json::Value>>,
    pub translated_contents: Option<Vec<serde_json::Value>>,
    pub chunks: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingRow {
    pub key: String,
    pub value: String,
}

// ---- Collect backup data from DB ----

#[tauri::command]
pub fn collect_backup_data(
    state: State<AppState>,
    scope: String,
    local_config: serde_json::Value,
    source: String,
) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    // Always collect app_settings
    let mut settings_stmt = conn
        .prepare("SELECT key, value FROM app_settings")
        .map_err(|e| e.to_string())?;
    let app_settings: Vec<SettingRow> = settings_stmt
        .query_map([], |row| {
            Ok(SettingRow {
                key: row.get(0)?,
                value: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut payload = BackupPayload {
        app_settings,
        local_config,
        documents: None,
        categories: None,
        folders: None,
        tags: None,
        document_tags: None,
        document_folders: None,
        providers: None,
        provider_models: None,
        parsed_contents: None,
        translated_contents: None,
        chunks: None,
    };

    payload.providers = Some(query_table_as_json(conn, "SELECT * FROM providers")?);
    payload.provider_models = Some(query_table_as_json(conn, "SELECT * FROM provider_models")?);

    if scope == "full" {
        payload.documents = Some(query_table_as_json(conn, "SELECT * FROM documents")?);
        payload.categories = Some(query_table_as_json(conn, "SELECT * FROM categories")?);
        payload.folders = Some(query_table_as_json(conn, "SELECT * FROM folders")?);
        payload.tags = Some(query_table_as_json(conn, "SELECT * FROM tags")?);
        payload.document_tags = Some(query_table_as_json(conn, "SELECT * FROM document_tags")?);
        payload.document_folders = Some(query_table_as_json(conn, "SELECT * FROM document_folders")?);
        payload.parsed_contents = Some(query_table_as_json(conn, "SELECT * FROM parsed_contents")?);
        payload.translated_contents = Some(query_table_as_json(
            conn,
            "SELECT * FROM translated_contents",
        )?);
        payload.chunks = Some(query_table_as_json(conn, "SELECT id, document_id, content, translated_content, chunk_index, page_number, section_title, metadata, created_at FROM chunks")?);
    }

    let envelope = BackupEnvelope {
        version: 1,
        created_at: Utc::now().to_rfc3339(),
        scope,
        source,
        app_info: AppInfo {
            name: "PDFTranslate".to_string(),
            schema_version: 1,
        },
        payload,
    };

    serde_json::to_string_pretty(&envelope).map_err(|e| e.to_string())
}

// ---- Apply backup data to DB ----

#[tauri::command]
pub fn apply_backup_data(
    state: State<AppState>,
    backup_json: String,
) -> Result<serde_json::Value, String> {
    let envelope: BackupEnvelope =
        serde_json::from_str(&backup_json).map_err(|e| format!("Invalid backup format: {}", e))?;

    if envelope.version != 1 {
        return Err(format!(
            "Unsupported backup version: {}. Expected: 1",
            envelope.version
        ));
    }

    if envelope.app_info.name != "PDFTranslate" {
        return Err(format!(
            "Backup is from a different app: {}",
            envelope.app_info.name
        ));
    }

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    // Always restore app_settings
    for setting in &envelope.payload.app_settings {
        conn.execute(
            "INSERT INTO app_settings (id, key, value, created_at, updated_at) VALUES (lower(hex(randomblob(16))), ?1, ?2, datetime('now'), datetime('now')) ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = datetime('now')",
            (&setting.key, &setting.value),
        ).map_err(|e| format!("Failed to restore setting {}: {}", setting.key, e))?;
    }

    if envelope.scope == "full" {
        // Restore full data - clear and re-insert
        // Order matters due to foreign keys
        conn.execute_batch("DELETE FROM document_tags; DELETE FROM document_folders; DELETE FROM chunks; DELETE FROM translated_contents; DELETE FROM parsed_contents; DELETE FROM documents; DELETE FROM folders; DELETE FROM categories; DELETE FROM tags; DELETE FROM provider_models; DELETE FROM providers;")
            .map_err(|e| format!("Failed to clear tables: {}", e))?;

        if let Some(categories) = &envelope.payload.categories {
            for row in categories {
                insert_json_row(conn, "categories", row)?;
            }
        }
        if let Some(folders) = &envelope.payload.folders {
            for row in folders {
                insert_json_row(conn, "folders", row)?;
            }
        }
        if let Some(tags) = &envelope.payload.tags {
            for row in tags {
                insert_json_row(conn, "tags", row)?;
            }
        }
        if let Some(documents) = &envelope.payload.documents {
            for row in documents {
                insert_json_row(conn, "documents", row)?;
            }
        }
        if let Some(parsed) = &envelope.payload.parsed_contents {
            for row in parsed {
                insert_json_row(conn, "parsed_contents", row)?;
            }
        }
        if let Some(translated) = &envelope.payload.translated_contents {
            for row in translated {
                insert_json_row(conn, "translated_contents", row)?;
            }
        }
        if let Some(chunks) = &envelope.payload.chunks {
            for row in chunks {
                insert_json_row(conn, "chunks", row)?;
            }
        }
        if let Some(doc_tags) = &envelope.payload.document_tags {
            for row in doc_tags {
                insert_json_row(conn, "document_tags", row)?;
            }
        }
        if let Some(doc_folders) = &envelope.payload.document_folders {
            for row in doc_folders {
                insert_json_row(conn, "document_folders", row)?;
            }
        }
    }

    if let Some(providers) = &envelope.payload.providers {
        for row in providers {
            insert_json_row(conn, "providers", row)?;
        }
    }
    if let Some(provider_models) = &envelope.payload.provider_models {
        for row in provider_models {
            insert_json_row(conn, "provider_models", row)?;
        }
    }

    // Return the local_config so frontend can restore localStorage
    Ok(serde_json::json!({
        "scope": envelope.scope,
        "local_config": envelope.payload.local_config,
        "created_at": envelope.created_at,
    }))
}

// ---- Validate backup file without applying ----

#[tauri::command]
pub fn validate_backup(backup_json: String) -> Result<serde_json::Value, String> {
    let envelope: BackupEnvelope =
        serde_json::from_str(&backup_json).map_err(|e| format!("Invalid backup format: {}", e))?;

    if envelope.version != 1 {
        return Err(format!(
            "Unsupported backup version: {}. Expected: 1",
            envelope.version
        ));
    }

    if envelope.app_info.name != "PDFTranslate" {
        return Err(format!(
            "Backup is from a different app: {}",
            envelope.app_info.name
        ));
    }

    let doc_count = envelope
        .payload
        .documents
        .as_ref()
        .map(|d| d.len())
        .unwrap_or(0);

    Ok(serde_json::json!({
        "version": envelope.version,
        "scope": envelope.scope,
        "source": envelope.source,
        "created_at": envelope.created_at,
        "app_name": envelope.app_info.name,
        "schema_version": envelope.app_info.schema_version,
        "settings_count": envelope.payload.app_settings.len(),
        "document_count": doc_count,
    }))
}

// ---- WebDAV sync operations ----

#[tauri::command]
pub async fn webdav_upload_backup(
    state: State<'_, AppState>,
    base_url: String,
    username: String,
    password: String,
    remote_path: String,
    scope: String,
    local_config: serde_json::Value,
) -> Result<String, String> {
    // Collect data
    let backup_json = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();

        let mut settings_stmt = conn
            .prepare("SELECT key, value FROM app_settings")
            .map_err(|e| e.to_string())?;
        let app_settings: Vec<SettingRow> = settings_stmt
            .query_map([], |row| {
                Ok(SettingRow {
                    key: row.get(0)?,
                    value: row.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        let mut payload = BackupPayload {
            app_settings,
            local_config,
            documents: None,
            categories: None,
            folders: None,
            tags: None,
            document_tags: None,
            document_folders: None,
            providers: None,
            provider_models: None,
            parsed_contents: None,
            translated_contents: None,
            chunks: None,
        };

        payload.providers = Some(query_table_as_json(conn, "SELECT * FROM providers")?);
        payload.provider_models = Some(query_table_as_json(conn, "SELECT * FROM provider_models")?);

        if scope == "full" {
            payload.documents = Some(query_table_as_json(conn, "SELECT * FROM documents")?);
            payload.categories = Some(query_table_as_json(conn, "SELECT * FROM categories")?);
            payload.folders = Some(query_table_as_json(conn, "SELECT * FROM folders")?);
            payload.tags = Some(query_table_as_json(conn, "SELECT * FROM tags")?);
            payload.document_tags = Some(query_table_as_json(conn, "SELECT * FROM document_tags")?);
            payload.document_folders = Some(query_table_as_json(conn, "SELECT * FROM document_folders")?);
            payload.parsed_contents =
                Some(query_table_as_json(conn, "SELECT * FROM parsed_contents")?);
            payload.translated_contents = Some(query_table_as_json(
                conn,
                "SELECT * FROM translated_contents",
            )?);
            payload.chunks = Some(query_table_as_json(conn, "SELECT id, document_id, content, translated_content, chunk_index, page_number, section_title, metadata, created_at FROM chunks")?);
        }

        let envelope = BackupEnvelope {
            version: 1,
            created_at: Utc::now().to_rfc3339(),
            scope: scope.clone(),
            source: "webdav-sync".to_string(),
            app_info: AppInfo {
                name: "PDFTranslate".to_string(),
                schema_version: 1,
            },
            payload,
        };

        serde_json::to_string(&envelope).map_err(|e| e.to_string())?
    };

    // Upload via WebDAV
    let filename = if scope == "full" {
        "pdftranslate-sync-full.json"
    } else {
        "pdftranslate-sync-config.json"
    };
    let full_path = format!("{}/{}", remote_path.trim_end_matches('/'), filename);

    let client = crate::webdav::WebDAVClient::new(base_url, username, password);

    // Try to create the remote directory (ignore errors if it exists)
    let _ = client.create_directory(&remote_path).await;

    client
        .upload_file(&full_path, backup_json.into_bytes())
        .await?;

    Ok(Utc::now().to_rfc3339())
}

#[tauri::command]
pub async fn webdav_download_backup(
    base_url: String,
    username: String,
    password: String,
    remote_path: String,
    scope: String,
) -> Result<String, String> {
    let filename = if scope == "full" {
        "pdftranslate-sync-full.json"
    } else {
        "pdftranslate-sync-config.json"
    };
    let full_path = format!("{}/{}", remote_path.trim_end_matches('/'), filename);

    let client = crate::webdav::WebDAVClient::new(base_url, username, password);
    let data = client.download_file(&full_path).await?;
    String::from_utf8(data).map_err(|e| format!("Invalid UTF-8 in backup file: {}", e))
}

// ---- Helper: query a table and return rows as Vec<serde_json::Value> ----

fn query_table_as_json(
    conn: &rusqlite::Connection,
    sql: &str,
) -> Result<Vec<serde_json::Value>, String> {
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let column_count = stmt.column_count();
    let column_names: Vec<String> = (0..column_count)
        .map(|i| stmt.column_name(i).unwrap().to_string())
        .collect();

    let rows = stmt
        .query_map([], |row| {
            let mut map = serde_json::Map::new();
            for (i, name) in column_names.iter().enumerate() {
                let val = match row.get_ref(i) {
                    Ok(rusqlite::types::ValueRef::Null) => serde_json::Value::Null,
                    Ok(rusqlite::types::ValueRef::Integer(n)) => {
                        serde_json::Value::Number(serde_json::Number::from(n))
                    }
                    Ok(rusqlite::types::ValueRef::Real(f)) => {
                        serde_json::json!(f)
                    }
                    Ok(rusqlite::types::ValueRef::Text(t)) => {
                        serde_json::Value::String(String::from_utf8_lossy(t).to_string())
                    }
                    Ok(rusqlite::types::ValueRef::Blob(b)) => {
                        serde_json::Value::String(base64_encode(b))
                    }
                    Err(_) => serde_json::Value::Null,
                };
                map.insert(name.clone(), val);
            }
            Ok(serde_json::Value::Object(map))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(rows)
}

fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            result.push(CHARS[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARS[(triple & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}

// ---- Helper: insert a JSON object as a row ----

fn insert_json_row(
    conn: &rusqlite::Connection,
    table: &str,
    row: &serde_json::Value,
) -> Result<(), String> {
    let obj = row
        .as_object()
        .ok_or_else(|| format!("Expected object for table {}", table))?;

    let columns: Vec<&String> = obj.keys().collect();
    let placeholders: Vec<String> = (1..=columns.len()).map(|i| format!("?{}", i)).collect();

    let sql = format!(
        "INSERT OR REPLACE INTO {} ({}) VALUES ({})",
        table,
        columns
            .iter()
            .map(|c| c.as_str())
            .collect::<Vec<_>>()
            .join(", "),
        placeholders.join(", ")
    );

    let values: Vec<Box<dyn rusqlite::ToSql>> = columns
        .iter()
        .map(|col| {
            let v = &obj[col.as_str()];
            let boxed: Box<dyn rusqlite::ToSql> = match v {
                serde_json::Value::Null => Box::new(Option::<String>::None),
                serde_json::Value::Bool(b) => Box::new(if *b { 1i32 } else { 0i32 }),
                serde_json::Value::Number(n) => {
                    if let Some(i) = n.as_i64() {
                        Box::new(i)
                    } else if let Some(f) = n.as_f64() {
                        Box::new(f)
                    } else {
                        Box::new(n.to_string())
                    }
                }
                serde_json::Value::String(s) => Box::new(s.clone()),
                _ => Box::new(v.to_string()),
            };
            boxed
        })
        .collect();

    let params_refs: Vec<&dyn rusqlite::ToSql> = values
        .iter()
        .map(|p: &Box<dyn rusqlite::ToSql>| p.as_ref())
        .collect();

    conn.execute(&sql, params_refs.as_slice())
        .map_err(|e| format!("Failed to insert into {}: {}", table, e))?;

    Ok(())
}
