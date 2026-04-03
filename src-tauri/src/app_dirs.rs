use std::fs;
use std::path::{Path, PathBuf};
use tauri::{Manager, Runtime};

pub fn runtime_app_dir<R: Runtime, M: Manager<R>>(app: &M) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .or_else(|_| app.path().app_local_data_dir())
        .map_err(|err| err.to_string())
}

fn ensure_dir(path: PathBuf) -> Result<PathBuf, String> {
    fs::create_dir_all(&path).map_err(|err| err.to_string())?;
    Ok(path)
}

fn dir_has_entries(path: &Path) -> Result<bool, String> {
    Ok(fs::read_dir(path)
        .map_err(|err| err.to_string())?
        .next()
        .transpose()
        .map_err(|err| err.to_string())?
        .is_some())
}

pub fn database_path(app_dir: &Path) -> PathBuf {
    app_dir.join("database.db")
}

pub fn settings_path(app_dir: &Path) -> PathBuf {
    app_dir.join("settings.json")
}

pub fn logs_dir(app_dir: &Path) -> PathBuf {
    app_dir.join("logs")
}

pub fn ensure_logs_dir(app_dir: &Path) -> Result<PathBuf, String> {
    ensure_dir(logs_dir(app_dir))
}

pub fn documents_dir(app_dir: &Path) -> PathBuf {
    app_dir.join("documents")
}

pub fn ensure_documents_dir(app_dir: &Path) -> Result<PathBuf, String> {
    ensure_dir(documents_dir(app_dir))
}

pub fn outputs_dir(app_dir: &Path) -> PathBuf {
    app_dir.join("outputs")
}

pub fn ensure_outputs_dir(app_dir: &Path) -> Result<PathBuf, String> {
    ensure_dir(outputs_dir(app_dir))
}

pub fn document_contents_dir(app_dir: &Path) -> PathBuf {
    app_dir.join("document_contents")
}

pub fn mineru_processed_dir(app_dir: &Path) -> PathBuf {
    app_dir.join("mineru_processed")
}

pub fn legacy_mineru_processed_dir() -> Option<PathBuf> {
    dirs::document_dir()
        .or_else(dirs::home_dir)
        .map(|base| base.join("Rosetta").join("MinerUProcessed"))
}

pub fn scripts_dir(app_dir: &Path) -> PathBuf {
    app_dir.join("scripts")
}

pub fn ensure_scripts_dir(app_dir: &Path) -> Result<PathBuf, String> {
    ensure_dir(scripts_dir(app_dir))
}

pub fn zvec_collections_dir(app_dir: &Path) -> PathBuf {
    app_dir.join("zvec").join("collections")
}

pub fn mineru_models_dir(app_dir: &Path) -> PathBuf {
    app_dir.join("mineru_models")
}

pub fn mineru_venv_dir(app_dir: &Path) -> PathBuf {
    app_dir.join("mineru_venv")
}

pub fn zvec_venv_dir(app_dir: &Path) -> PathBuf {
    app_dir.join("zvec_venv")
}

pub fn mineru_repo_dir(app_dir: &Path) -> PathBuf {
    app_dir.join("MinerU")
}

pub fn cache_root_dir(app_dir: &Path) -> PathBuf {
    app_dir.join("caches")
}

pub fn pip_cache_dir(app_dir: &Path) -> PathBuf {
    cache_root_dir(app_dir).join("pip")
}

pub fn temp_dir(app_dir: &Path) -> PathBuf {
    cache_root_dir(app_dir).join("tmp")
}

pub fn huggingface_cache_dir(app_dir: &Path) -> PathBuf {
    cache_root_dir(app_dir).join("huggingface")
}

pub fn modelscope_cache_dir(app_dir: &Path) -> PathBuf {
    cache_root_dir(app_dir).join("modelscope")
}

pub fn transformers_cache_dir(app_dir: &Path) -> PathBuf {
    cache_root_dir(app_dir).join("transformers")
}

pub fn sentence_transformers_cache_dir(app_dir: &Path) -> PathBuf {
    cache_root_dir(app_dir).join("sentence_transformers")
}

#[derive(Debug, Clone)]
pub struct ManagedCacheDirs {
    pub root: PathBuf,
    pub pip: PathBuf,
    pub temp: PathBuf,
    pub huggingface: PathBuf,
    pub modelscope: PathBuf,
    pub transformers: PathBuf,
    pub sentence_transformers: PathBuf,
}

pub fn ensure_managed_cache_dirs(app_dir: &Path) -> Result<ManagedCacheDirs, String> {
    let root = ensure_dir(cache_root_dir(app_dir))?;
    let pip = ensure_dir(pip_cache_dir(app_dir))?;
    let temp = ensure_dir(temp_dir(app_dir))?;
    let huggingface = ensure_dir(huggingface_cache_dir(app_dir))?;
    let modelscope = ensure_dir(modelscope_cache_dir(app_dir))?;
    let transformers = ensure_dir(transformers_cache_dir(app_dir))?;
    let sentence_transformers = ensure_dir(sentence_transformers_cache_dir(app_dir))?;

    Ok(ManagedCacheDirs {
        root,
        pip,
        temp,
        huggingface,
        modelscope,
        transformers,
        sentence_transformers,
    })
}

pub fn move_dir_contents(source: &Path, destination: &Path) -> Result<bool, String> {
    if !source.exists() {
        return Ok(false);
    }

    fs::create_dir_all(destination).map_err(|err| err.to_string())?;

    let mut moved_anything = false;
    for entry in fs::read_dir(source).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());

        if destination_path.exists() {
            if source_path.is_dir() && destination_path.is_dir() {
                moved_anything |= move_dir_contents(&source_path, &destination_path)?;
                if source_path.exists() && !dir_has_entries(&source_path)? {
                    fs::remove_dir(&source_path).map_err(|err| err.to_string())?;
                    moved_anything = true;
                }
            } else if source_path.is_dir() {
                fs::remove_dir_all(&source_path).map_err(|err| err.to_string())?;
                moved_anything = true;
            } else {
                fs::remove_file(&source_path).map_err(|err| err.to_string())?;
                moved_anything = true;
            }
            continue;
        }

        match fs::rename(&source_path, &destination_path) {
            Ok(_) => {
                moved_anything = true;
            }
            Err(_) if source_path.is_dir() => {
                let nested_moved = move_dir_contents(&source_path, &destination_path)?;
                if source_path.exists() {
                    fs::remove_dir_all(&source_path).map_err(|err| err.to_string())?;
                }
                moved_anything = moved_anything || nested_moved || destination_path.exists();
            }
            Err(_) => {
                fs::copy(&source_path, &destination_path).map_err(|err| err.to_string())?;
                fs::remove_file(&source_path).map_err(|err| err.to_string())?;
                moved_anything = true;
            }
        }
    }

    if source.exists() && !dir_has_entries(source)? {
        let _ = fs::remove_dir(source);
    }

    Ok(moved_anything)
}
