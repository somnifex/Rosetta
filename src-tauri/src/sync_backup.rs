use crate::AppState;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupEnvelope {
    pub version: u32,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    pub scope: String,
    pub source: String,
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
    pub app_settings: Vec<SettingRow>,
    pub local_config: serde_json::Value,
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

#[tauri::command]
pub fn collect_backup_data(
    state: State<AppState>,
    scope: String,
    local_config: serde_json::Value,
    source: String,
) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.get_connection();

    let mut app_settings: Vec<SettingRow> = state
        .settings
        .get_all()
        .into_iter()
        .map(|(key, value)| SettingRow { key, value })
        .collect();
    app_settings.sort_by(|a, b| a.key.cmp(&b.key));

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
        payload.document_folders =
            Some(query_table_as_json(conn, "SELECT * FROM document_folders")?);
        payload.parsed_contents = Some(query_parsed_contents_for_backup(conn)?);
        payload.translated_contents = Some(query_translated_contents_for_backup(conn)?);
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

    merge_backup_settings(state.inner(), &envelope.payload.app_settings)?;

    if envelope.scope == "full" {
        crate::content_store::clear_all_document_dirs(&state.app_dir)?;

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
            restore_parsed_contents_from_backup(conn, &state.app_dir, parsed)?;
        }
        if let Some(translated) = &envelope.payload.translated_contents {
            restore_translated_contents_from_backup(conn, &state.app_dir, translated)?;
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

    Ok(serde_json::json!({
        "scope": envelope.scope,
        "local_config": envelope.payload.local_config,
        "created_at": envelope.created_at,
    }))
}

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
    let backup_json = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();

        let mut app_settings: Vec<SettingRow> = state
            .settings
            .get_all()
            .into_iter()
            .map(|(key, value)| SettingRow { key, value })
            .collect();
        app_settings.sort_by(|a, b| a.key.cmp(&b.key));

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
            payload.document_folders =
                Some(query_table_as_json(conn, "SELECT * FROM document_folders")?);
            payload.parsed_contents = Some(query_parsed_contents_for_backup(conn)?);
            payload.translated_contents = Some(query_translated_contents_for_backup(conn)?);
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

    let filename = if scope == "full" {
        "pdftranslate-sync-full.json"
    } else {
        "pdftranslate-sync-config.json"
    };
    let full_path = format!("{}/{}", remote_path.trim_end_matches('/'), filename);

    let client = crate::webdav::WebDAVClient::new(base_url, username, password);

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

fn query_parsed_contents_for_backup(
    conn: &rusqlite::Connection,
) -> Result<Vec<serde_json::Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, document_id, version, markdown_content, json_content, structure_tree, created_at
             FROM parsed_contents",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, String>(6)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut out = Vec::with_capacity(rows.len());
    for (id, document_id, version, markdown_ref, json_ref, structure_ref, created_at) in rows {
        let markdown_content = crate::content_store::read_content_blob(&markdown_ref)?;
        let json_content = crate::content_store::read_content_blob(&json_ref)?;
        let structure_tree = match structure_ref {
            Some(v) => Some(crate::content_store::read_content_blob(&v)?),
            None => None,
        };

        out.push(serde_json::json!({
            "id": id,
            "document_id": document_id,
            "version": version,
            "markdown_content": markdown_content,
            "json_content": json_content,
            "structure_tree": structure_tree,
            "created_at": created_at
        }));
    }

    Ok(out)
}

fn query_translated_contents_for_backup(
    conn: &rusqlite::Connection,
) -> Result<Vec<serde_json::Value>, String> {
    let mut stmt = conn
        .prepare("SELECT id, document_id, version, content, created_at FROM translated_contents")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut out = Vec::with_capacity(rows.len());
    for (id, document_id, version, content_ref, created_at) in rows {
        let content = crate::content_store::read_content_blob(&content_ref)?;
        out.push(serde_json::json!({
            "id": id,
            "document_id": document_id,
            "version": version,
            "content": content,
            "created_at": created_at
        }));
    }

    Ok(out)
}

fn merge_backup_settings(state: &AppState, settings: &[SettingRow]) -> Result<(), String> {
    if settings.is_empty() {
        return Ok(());
    }

    let mut merged = state.settings.get_all();
    for setting in settings {
        merged.insert(setting.key.clone(), setting.value.clone());
    }
    state.settings.replace_all(merged)
}

fn json_object_field<'a>(
    row: &'a serde_json::Value,
    table: &str,
) -> Result<&'a serde_json::Map<String, serde_json::Value>, String> {
    row.as_object()
        .ok_or_else(|| format!("Expected object for table {table}"))
}

fn json_required_string_field(
    row: &serde_json::Value,
    table: &str,
    field: &str,
) -> Result<String, String> {
    json_object_field(row, table)?
        .get(field)
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
        .ok_or_else(|| format!("Missing or invalid {table}.{field}"))
}

fn json_optional_string_field(
    row: &serde_json::Value,
    table: &str,
    field: &str,
) -> Result<Option<String>, String> {
    match json_object_field(row, table)?.get(field) {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::String(value)) => Ok(Some(value.clone())),
        Some(_) => Err(format!("Invalid {table}.{field}")),
    }
}

fn json_required_i32_field(
    row: &serde_json::Value,
    table: &str,
    field: &str,
) -> Result<i32, String> {
    let value = json_object_field(row, table)?
        .get(field)
        .and_then(|value| value.as_i64())
        .ok_or_else(|| format!("Missing or invalid {table}.{field}"))?;
    i32::try_from(value).map_err(|_| format!("Out-of-range {table}.{field}: {value}"))
}

fn restore_parsed_contents_from_backup(
    conn: &rusqlite::Connection,
    app_dir: &std::path::Path,
    rows: &[serde_json::Value],
) -> Result<(), String> {
    for row in rows {
        let id = json_required_string_field(row, "parsed_contents", "id")?;
        let document_id = json_required_string_field(row, "parsed_contents", "document_id")?;
        let version = json_required_i32_field(row, "parsed_contents", "version")?;
        let markdown_content =
            json_required_string_field(row, "parsed_contents", "markdown_content")?;
        let json_content = json_required_string_field(row, "parsed_contents", "json_content")?;
        let structure_tree = json_optional_string_field(row, "parsed_contents", "structure_tree")?;
        let created_at = json_required_string_field(row, "parsed_contents", "created_at")?;

        let (markdown_path, json_path, structure_path) =
            crate::content_store::write_parsed_version(
                app_dir,
                &document_id,
                version,
                &markdown_content,
                &json_content,
                structure_tree.as_deref(),
            )?;

        conn.execute(
            "INSERT OR REPLACE INTO parsed_contents (id, document_id, version, markdown_content, json_content, structure_tree, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            (
                &id,
                &document_id,
                version,
                &markdown_path,
                &json_path,
                &structure_path,
                &created_at,
            ),
        )
        .map_err(|e| format!("Failed to restore parsed_contents row {id}: {e}"))?;
    }

    Ok(())
}

fn restore_translated_contents_from_backup(
    conn: &rusqlite::Connection,
    app_dir: &std::path::Path,
    rows: &[serde_json::Value],
) -> Result<(), String> {
    for row in rows {
        let id = json_required_string_field(row, "translated_contents", "id")?;
        let document_id = json_required_string_field(row, "translated_contents", "document_id")?;
        let version = json_required_i32_field(row, "translated_contents", "version")?;
        let content = json_required_string_field(row, "translated_contents", "content")?;
        let created_at = json_required_string_field(row, "translated_contents", "created_at")?;

        let content_path = crate::content_store::write_translated_version(
            app_dir,
            &document_id,
            version,
            &content,
        )?;

        conn.execute(
            "INSERT OR REPLACE INTO translated_contents (id, document_id, version, content, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            (&id, &document_id, version, &content_path, &created_at),
        )
        .map_err(|e| format!("Failed to restore translated_contents row {id}: {e}"))?;
    }

    Ok(())
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
