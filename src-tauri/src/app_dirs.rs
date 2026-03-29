use std::path::PathBuf;
use tauri::{Manager, Runtime};

pub fn runtime_app_dir<R: Runtime, M: Manager<R>>(app: &M) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .or_else(|_| app.path().app_local_data_dir())
        .map_err(|err| err.to_string())
}
