mod app_dirs;
mod commands;
mod database;
mod embedder;
mod file_handler;
mod mineru;
mod mineru_process;
mod models;
mod rag_chat;
mod sync_backup;
mod translator;
mod webdav;
mod zvec;

use database::Database;
use mineru_process::{MinerUModelManager, MinerUProcessManager, MinerUVenvManager};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::async_runtime::JoinHandle;
use tauri::{Manager, RunEvent};

pub struct AppState {
    pub db: Arc<Mutex<Database>>,
    pub mineru_manager: Arc<MinerUProcessManager>,
    pub venv_manager: Arc<MinerUVenvManager>,
    pub model_manager: Arc<MinerUModelManager>,
    pub parse_job_handles: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
    pub translation_job_handles: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
    pub index_job_handles: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
    pub chat_request_handles: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
}

impl Clone for AppState {
    fn clone(&self) -> Self {
        Self {
            db: Arc::clone(&self.db),
            mineru_manager: Arc::clone(&self.mineru_manager),
            venv_manager: Arc::clone(&self.venv_manager),
            model_manager: Arc::clone(&self.model_manager),
            parse_job_handles: Arc::clone(&self.parse_job_handles),
            translation_job_handles: Arc::clone(&self.translation_job_handles),
            index_job_handles: Arc::clone(&self.index_job_handles),
            chat_request_handles: Arc::clone(&self.chat_request_handles),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_dir = app_dirs::runtime_app_dir(app).map_err(|e| {
                log::error!("Failed to get runtime app dir: {}", e);
                e
            })?;
            std::fs::create_dir_all(&app_dir).map_err(|e| {
                log::error!("Failed to create app data dir: {}", e);
                e
            })?;

            let db_path = app_dir.join("database.db");
            let db = Database::new(&db_path).map_err(|e| {
                log::error!("Failed to open database: {}", e);
                e
            })?;
            db.init().map_err(|e| {
                log::error!("Failed to initialize database: {}", e);
                e
            })?;
            if let Err(e) = db.recover_incomplete_tasks() {
                log::error!("Failed to recover incomplete tasks: {}", e);
            }

            let mineru_manager = Arc::new(MinerUProcessManager::new());
            let venv_manager = Arc::new(MinerUVenvManager::new());
            let model_manager = Arc::new(MinerUModelManager::new());

            let db_arc = Arc::new(Mutex::new(db));

            if let Ok(db_guard) = db_arc.lock() {
                mineru_process::refresh_model_download_status(
                    &model_manager,
                    db_guard.get_connection(),
                    &app_dir,
                );
            }

            app.manage(AppState {
                db: Arc::clone(&db_arc),
                mineru_manager: Arc::clone(&mineru_manager),
                venv_manager: Arc::clone(&venv_manager),
                model_manager: Arc::clone(&model_manager),
                parse_job_handles: Arc::new(Mutex::new(HashMap::new())),
                translation_job_handles: Arc::new(Mutex::new(HashMap::new())),
                index_job_handles: Arc::new(Mutex::new(HashMap::new())),
                chat_request_handles: Arc::new(Mutex::new(HashMap::new())),
            });

            // Auto-start MinerU if configured
            let db_for_autostart = Arc::clone(&db_arc);
            let manager_for_autostart = Arc::clone(&mineru_manager);
            let app_dir_for_autostart = app_dir.clone();
            tauri::async_runtime::spawn(async move {
                let (mode, auto_start, python_path, port_str, use_venv, model_source, models_dir) = {
                    let Ok(db) = db_for_autostart.lock() else {
                        log::error!("Failed to lock database for MinerU auto-start");
                        return;
                    };
                    let conn = db.get_connection();
                    let mode = conn.query_row(
                        "SELECT value FROM app_settings WHERE key = 'mineru.mode'",
                        [],
                        |row| row.get::<_, String>(0),
                    ).unwrap_or_else(|_| "builtin".to_string());
                    let auto_start = conn.query_row(
                        "SELECT value FROM app_settings WHERE key = 'mineru.auto_start'",
                        [],
                        |row| row.get::<_, String>(0),
                    ).unwrap_or_else(|_| "false".to_string());
                    let use_venv_str = conn.query_row(
                        "SELECT value FROM app_settings WHERE key = 'mineru.use_venv'",
                        [],
                        |row| row.get::<_, String>(0),
                    ).unwrap_or_else(|_| "false".to_string());
                    let use_venv = use_venv_str == "true";
                    let python_path = if use_venv {
                        let venv_dir = app_dir_for_autostart.join("mineru_venv");
                        let venv_python = mineru_process::venv_python_path_pub(&venv_dir);
                        if venv_python.exists() {
                            venv_python.to_str().unwrap_or("python").to_string()
                        } else {
                            log::warn!("use_venv is true but venv python not found, falling back to system python");
                            conn.query_row(
                                "SELECT value FROM app_settings WHERE key = 'mineru.python_path'",
                                [],
                                |row| row.get::<_, String>(0),
                            ).unwrap_or_else(|_| if cfg!(windows) { "python".to_string() } else { "python3".to_string() })
                        }
                    } else {
                        conn.query_row(
                            "SELECT value FROM app_settings WHERE key = 'mineru.python_path'",
                            [],
                            |row| row.get::<_, String>(0),
                        ).unwrap_or_else(|_| if cfg!(windows) { "python".to_string() } else { "python3".to_string() })
                    };
                    let port_str = conn.query_row(
                        "SELECT value FROM app_settings WHERE key = 'mineru.port'",
                        [],
                        |row| row.get::<_, String>(0),
                    ).unwrap_or_else(|_| "8765".to_string());
                    let model_source = conn.query_row(
                        "SELECT value FROM app_settings WHERE key = 'mineru.model_source'",
                        [],
                        |row| row.get::<_, String>(0),
                    ).unwrap_or_else(|_| "huggingface".to_string());
                    let models_dir = conn.query_row(
                        "SELECT value FROM app_settings WHERE key = 'mineru.models_dir'",
                        [],
                        |row| row.get::<_, String>(0),
                    ).unwrap_or_else(|_| String::new());
                    // Default models dir to app_data_dir/mineru_models
                    let models_dir = if models_dir.trim().is_empty() {
                        app_dir_for_autostart.join("mineru_models").to_str().unwrap_or_default().to_string()
                    } else {
                        models_dir
                    };
                    (mode, auto_start, python_path, port_str, use_venv, model_source, models_dir)
                };

                if mode == "builtin" && auto_start == "true" {
                    let port: u16 = port_str.parse().unwrap_or(8765);
                    log::info!("Auto-starting MinerU on port {}...", port);
                    let venv_dir = app_dir_for_autostart.join("mineru_venv");
                    let venv_path = if use_venv { Some(venv_dir.as_path()) } else { None };
                    match manager_for_autostart.start(&python_path, port, use_venv, venv_path, &model_source, &models_dir).await {
                        Ok(p) => log::info!("MinerU auto-started on port {}", p),
                        Err(e) => log::error!("Failed to auto-start MinerU: {}", e),
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_documents,
            commands::get_document_by_id,
            commands::create_document,
            commands::update_document,
            commands::delete_document,
            commands::get_categories,
            commands::create_category,
            commands::update_category,
            commands::delete_category,
            commands::get_tags,
            commands::create_tag,
            commands::update_tag,
            commands::delete_tag,
            commands::add_document_tags,
            commands::remove_document_tag,
            commands::get_document_tags,
            commands::get_providers,
            commands::create_provider,
            commands::update_provider,
            commands::delete_provider,
            commands::test_provider_connection,
            commands::import_pdf,
            commands::import_document,
            commands::start_parse_job,
            commands::cancel_parse_job,
            commands::delete_parse_job,
            commands::get_parse_job,
            commands::get_all_parse_jobs,
            commands::get_parsed_content,
            commands::start_translation_job,
            commands::cancel_translation_job,
            commands::delete_translation_job,
            commands::get_translation_job,
            commands::get_all_translation_jobs,
            commands::get_translated_content,
            commands::start_index_job,
            commands::cancel_index_job,
            commands::search_documents,
            rag_chat::start_rag_chat,
            rag_chat::cancel_rag_chat,
            commands::test_webdav_connection,
            commands::sync_document,
            commands::export_document,
            commands::test_mineru_connection,
            commands::get_document_file_path,
            commands::get_document_chunks,
            zvec::get_zvec_status,
            mineru_process::get_app_setting,
            mineru_process::set_app_setting,
            mineru_process::get_all_app_settings,
            mineru_process::start_mineru,
            mineru_process::stop_mineru,
            mineru_process::get_mineru_status,
            mineru_process::setup_mineru_venv,
            mineru_process::get_venv_status,
            mineru_process::check_venv_exists,
            mineru_process::download_mineru_models,
            mineru_process::get_model_download_status,
            sync_backup::collect_backup_data,
            sync_backup::apply_backup_data,
            sync_backup::validate_backup,
            sync_backup::webdav_upload_backup,
            sync_backup::webdav_download_backup,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(state) = app.try_state::<AppState>() {
                    let _ = state.mineru_manager.stop();
                }
            }
        });
}
