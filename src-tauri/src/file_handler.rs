use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

pub struct FileHandler {
    storage_dir: PathBuf,
    output_dir: PathBuf,
}

impl FileHandler {
    pub fn new(app_dir: &Path) -> Result<Self, String> {
        let storage_dir = crate::app_dirs::ensure_documents_dir(app_dir)
            .map_err(|e| format!("Failed to create storage directory: {e}"))?;
        let output_dir = crate::app_dirs::ensure_outputs_dir(app_dir)
            .map_err(|e| format!("Failed to create output directory: {e}"))?;
        Ok(Self {
            storage_dir,
            output_dir,
        })
    }

    pub fn import_pdf(&self, source_path: &Path) -> Result<PathBuf, String> {
        if !source_path.exists() {
            return Err("Source file does not exist".to_string());
        }

        let file_id = Uuid::new_v4();
        let filename = source_path
            .file_name()
            .ok_or("Invalid filename")?
            .to_str()
            .ok_or("Invalid UTF-8 in filename")?;

        let dest_path = self.storage_dir.join(format!("{}_{}", file_id, filename));

        fs::copy(source_path, &dest_path).map_err(|e| format!("Failed to copy file: {}", e))?;

        Ok(dest_path)
    }

    pub fn get_file_size(path: &Path) -> Result<u64, String> {
        fs::metadata(path)
            .map(|m| m.len())
            .map_err(|e| format!("Failed to get file size: {}", e))
    }

    pub fn import_document(&self, source_path: &Path) -> Result<PathBuf, String> {
        if !source_path.exists() {
            return Err("Source file does not exist".to_string());
        }

        let file_id = Uuid::new_v4();
        let filename = source_path
            .file_name()
            .ok_or("Invalid filename")?
            .to_str()
            .ok_or("Invalid UTF-8 in filename")?;

        let dest_path = self.storage_dir.join(format!("{}_{}", file_id, filename));

        fs::copy(source_path, &dest_path).map_err(|e| format!("Failed to copy file: {}", e))?;

        Ok(dest_path)
    }

    pub fn import_output_file(&self, source_path: &Path, prefix: &str) -> Result<PathBuf, String> {
        if !source_path.exists() {
            return Err("Source file does not exist".to_string());
        }

        let file_id = Uuid::new_v4();
        let filename = source_path
            .file_name()
            .ok_or("Invalid filename")?
            .to_str()
            .ok_or("Invalid UTF-8 in filename")?;

        let safe_prefix = prefix.trim().replace(' ', "_");
        let dest_path = self
            .output_dir
            .join(format!("{}_{}_{}", safe_prefix, file_id, filename));

        fs::copy(source_path, &dest_path).map_err(|e| format!("Failed to copy file: {}", e))?;

        Ok(dest_path)
    }

    pub fn read_text_file(path: &Path) -> Result<String, String> {
        fs::read_to_string(path).map_err(|e| format!("Failed to read file: {}", e))
    }

    pub fn delete_file(&self, file_path: &Path) -> Result<(), String> {
        if file_path.exists() {
            fs::remove_file(file_path).map_err(|e| format!("Failed to delete file: {}", e))?;
        }
        Ok(())
    }
}
