use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

pub struct SettingsManager {
    path: PathBuf,
    settings: Arc<RwLock<HashMap<String, String>>>,
}

impl SettingsManager {
    pub fn new(app_dir: &Path) -> Self {
        let path = crate::app_dirs::settings_path(app_dir);
        let manager = Self {
            path,
            settings: Arc::new(RwLock::new(HashMap::new())),
        };
        manager.load_or_create();
        manager
    }

    fn load_or_create(&self) {
        let tmp_path = self.path.with_extension("json.tmp");
        let bak_path = self.path.with_extension("json.bak");

        // Recover from interrupted atomic writes.
        if !self.path.exists() && bak_path.exists() {
            let _ = fs::rename(&bak_path, &self.path);
        }
        if tmp_path.exists() {
            let _ = fs::remove_file(&tmp_path);
        }

        if !self.path.exists() {
            let _ = self.save(); // create empty JSON file
            return;
        }

        if let Ok(content) = fs::read_to_string(&self.path) {
            if let Ok(settings) = serde_json::from_str::<HashMap<String, String>>(&content) {
                if let Ok(mut lock) = self.settings.write() {
                    *lock = settings;
                }
            }
        }
    }

    pub fn save(&self) -> Result<(), String> {
        let lock = self
            .settings
            .read()
            .map_err(|e| format!("Failed to acquire settings read lock: {e}"))?;
        let content = serde_json::to_string_pretty(&*lock).map_err(|e| e.to_string())?;
        atomic_write_file(&self.path, content.as_bytes())
    }

    pub fn get(&self, key: &str) -> Option<String> {
        self.settings.read().ok()?.get(key).cloned()
    }

    pub fn get_with_default(&self, key: &str, default: &str) -> String {
        self.get(key).unwrap_or_else(|| default.to_string())
    }

    pub fn set(&self, key: String, value: String) -> Result<(), String> {
        let mut lock = self
            .settings
            .write()
            .map_err(|e| format!("Failed to acquire settings write lock: {e}"))?;
        lock.insert(key, value);
        drop(lock);
        self.save()
    }

    pub fn get_all(&self) -> HashMap<String, String> {
        self.settings
            .read()
            .ok()
            .map(|lock| lock.clone())
            .unwrap_or_default()
    }

    pub fn replace_all(&self, new_settings: HashMap<String, String>) -> Result<(), String> {
        let mut lock = self
            .settings
            .write()
            .map_err(|e| format!("Failed to acquire settings write lock: {e}"))?;
        *lock = new_settings;
        drop(lock);
        self.save()
    }
}

fn atomic_write_file(path: &Path, content: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let tmp_path = path.with_extension("json.tmp");
    let bak_path = path.with_extension("json.bak");

    {
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&tmp_path)
            .map_err(|e| e.to_string())?;
        file.write_all(content).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
    }

    if path.exists() {
        if bak_path.exists() {
            let _ = fs::remove_file(&bak_path);
        }
        fs::rename(path, &bak_path).map_err(|e| e.to_string())?;
    }

    if let Err(e) = fs::rename(&tmp_path, path) {
        if bak_path.exists() {
            let _ = fs::rename(&bak_path, path);
        }
        return Err(e.to_string());
    }

    if bak_path.exists() {
        let _ = fs::remove_file(&bak_path);
    }

    Ok(())
}
