use std::path::PathBuf;
use tauri::{Manager, Runtime};

pub fn runtime_app_dir<R: Runtime, M: Manager<R>>(app: &M) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .or_else(|_| app.path().app_local_data_dir())
        .map_err(|err| err.to_string())
}

pub fn mineru_processed_dir() -> Result<PathBuf, String> {
    let base = dirs::document_dir()
        .or_else(dirs::home_dir)
        .ok_or_else(|| "Failed to resolve a writable user directory".to_string())?;
    let path = base.join("Rosetta").join("MinerUProcessed");
    std::fs::create_dir_all(&path).map_err(|err| err.to_string())?;
    Ok(path)
}
