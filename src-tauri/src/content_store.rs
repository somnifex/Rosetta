use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};

fn content_root(app_dir: &Path) -> PathBuf {
    crate::app_dirs::document_contents_dir(app_dir)
}

fn parsed_dir(app_dir: &Path, document_id: &str) -> PathBuf {
    content_root(app_dir).join(document_id).join("parsed")
}

fn translated_dir(app_dir: &Path, document_id: &str) -> PathBuf {
    content_root(app_dir).join(document_id).join("translated")
}

fn is_path_reference(value: &str) -> bool {
    if value.trim().is_empty() {
        return false;
    }
    Path::new(value).is_absolute()
}

pub fn read_content_blob(raw_or_path: &str) -> Result<String, String> {
    if is_path_reference(raw_or_path) {
        if !Path::new(raw_or_path).exists() {
            return Err(format!(
                "Referenced content file does not exist: {raw_or_path}"
            ));
        }
        return fs::read_to_string(raw_or_path).map_err(|e| e.to_string());
    }
    Ok(raw_or_path.to_string())
}

pub fn write_parsed_version(
    app_dir: &Path,
    document_id: &str,
    version: i32,
    markdown: &str,
    json_content: &str,
    structure_tree: Option<&str>,
) -> Result<(String, String, Option<String>), String> {
    let dir = parsed_dir(app_dir, document_id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let markdown_path = dir.join(format!("v{version}.md"));
    let json_path = dir.join(format!("v{version}.json"));
    fs::write(&markdown_path, markdown).map_err(|e| e.to_string())?;
    fs::write(&json_path, json_content).map_err(|e| e.to_string())?;

    let structure_path = if let Some(structure) = structure_tree {
        let path = dir.join(format!("v{version}.structure.json"));
        fs::write(&path, structure).map_err(|e| e.to_string())?;
        Some(path)
    } else {
        None
    };

    Ok((
        markdown_path.to_string_lossy().to_string(),
        json_path.to_string_lossy().to_string(),
        structure_path.map(|p| p.to_string_lossy().to_string()),
    ))
}

pub fn write_translated_version(
    app_dir: &Path,
    document_id: &str,
    version: i32,
    content: &str,
) -> Result<String, String> {
    let dir = translated_dir(app_dir, document_id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let path = dir.join(format!("v{version}.md"));
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

pub fn remove_document_dir(app_dir: &Path, document_id: &str) -> Result<(), String> {
    let dir = content_root(app_dir).join(document_id);
    if dir.exists() {
        fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn remove_parsed_dir(app_dir: &Path, document_id: &str) -> Result<(), String> {
    let dir = parsed_dir(app_dir, document_id);
    if dir.exists() {
        fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn remove_translated_dir(app_dir: &Path, document_id: &str) -> Result<(), String> {
    let dir = translated_dir(app_dir, document_id);
    if dir.exists() {
        fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn clear_all_document_dirs(app_dir: &Path) -> Result<(), String> {
    let dir = content_root(app_dir);
    if dir.exists() {
        fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn migrate_legacy_contents(conn: &Connection, app_dir: &Path) -> Result<bool, String> {
    let mut changed = false;

    {
        let mut stmt = conn
            .prepare(
                "SELECT id, document_id, version, markdown_content, json_content, structure_tree
                 FROM parsed_contents",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i32>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, Option<String>>(5)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        for (id, document_id, version, markdown_content, json_content, structure_tree) in rows {
            let markdown_is_path = is_path_reference(&markdown_content);
            let json_is_path = is_path_reference(&json_content);
            let structure_is_path = structure_tree
                .as_deref()
                .map(is_path_reference)
                .unwrap_or(false);

            if markdown_is_path || json_is_path || structure_is_path {
                if !markdown_is_path || !Path::new(&markdown_content).exists() {
                    return Err(format!(
                        "Parsed content row {id} references a missing markdown file"
                    ));
                }
                if !json_is_path || !Path::new(&json_content).exists() {
                    return Err(format!(
                        "Parsed content row {id} references a missing JSON file"
                    ));
                }
                if let Some(structure_path) =
                    structure_tree.as_deref().filter(|_| structure_is_path)
                {
                    if !Path::new(structure_path).exists() {
                        return Err(format!(
                            "Parsed content row {id} references a missing structure file"
                        ));
                    }
                }
                continue;
            }

            let (markdown_path, json_path, structure_path) = write_parsed_version(
                app_dir,
                &document_id,
                version,
                &markdown_content,
                &json_content,
                structure_tree.as_deref(),
            )?;

            conn.execute(
                "UPDATE parsed_contents
                 SET markdown_content = ?1, json_content = ?2, structure_tree = ?3
                 WHERE id = ?4",
                (&markdown_path, &json_path, &structure_path, &id),
            )
            .map_err(|e| e.to_string())?;
            changed = true;
        }
    }

    {
        let mut stmt = conn
            .prepare(
                "SELECT id, document_id, version, content
                 FROM translated_contents",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i32>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        for (id, document_id, version, content) in rows {
            if is_path_reference(&content) {
                if !Path::new(&content).exists() {
                    return Err(format!(
                        "Translated content row {id} references a missing content file"
                    ));
                }
                continue;
            }

            let content_path = write_translated_version(app_dir, &document_id, version, &content)?;
            conn.execute(
                "UPDATE translated_contents SET content = ?1 WHERE id = ?2",
                (&content_path, &id),
            )
            .map_err(|e| e.to_string())?;
            changed = true;
        }
    }

    Ok(changed)
}
