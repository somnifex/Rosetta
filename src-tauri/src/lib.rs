mod app_dirs;
mod app_updater;
mod chunking;
mod commands;
mod content_store;
mod database;
mod embedder;
mod extractor;
mod file_handler;
mod mineru;
mod mineru_official;
mod mineru_process;
mod models;
mod rag_chat;
mod rate_limiter;
mod reranker;
mod retry;
mod runtime_logs;
mod settings;
mod sync_backup;
mod translator;
mod webdav;
mod window_appearance;
mod zvec;

use database::Database;
use mineru_process::{MinerUModelManager, MinerUProcessManager, MinerUVenvManager};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::async_runtime::JoinHandle;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, RunEvent};

const DEFAULT_MINERU_MAX_CONCURRENT_PARSE_JOBS: usize = 2;
const DEFAULT_HEALTH_CHECK_INTERVAL_SECS: u64 = 30;
const DEFAULT_AUTO_RESTART_MAX_RETRIES: u32 = 3;

pub struct AppState {
    pub app_dir: PathBuf,
    pub db: Arc<Mutex<Database>>,
    pub settings: Arc<settings::SettingsManager>,
    pub mineru_manager: Arc<MinerUProcessManager>,
    pub venv_manager: Arc<MinerUVenvManager>,
    pub model_manager: Arc<MinerUModelManager>,
    pub reranker_model_manager: Arc<zvec::RerankerModelManager>,
    pub zvec_venv_manager: Arc<zvec::ZvecVenvManager>,
    pub zvec_availability_cache: Arc<zvec::ZvecAvailabilityCache>,
    pub parse_job_handles: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
    pub translation_job_handles: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
    pub index_job_handles: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
    pub chat_request_handles: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
    pub parse_limiter: Arc<rate_limiter::ConcurrencyLimiter>,
}

impl Clone for AppState {
    fn clone(&self) -> Self {
        Self {
            app_dir: self.app_dir.clone(),
            db: Arc::clone(&self.db),
            settings: Arc::clone(&self.settings),
            mineru_manager: Arc::clone(&self.mineru_manager),
            venv_manager: Arc::clone(&self.venv_manager),
            model_manager: Arc::clone(&self.model_manager),
            reranker_model_manager: Arc::clone(&self.reranker_model_manager),
            zvec_venv_manager: Arc::clone(&self.zvec_venv_manager),
            zvec_availability_cache: Arc::clone(&self.zvec_availability_cache),
            parse_job_handles: Arc::clone(&self.parse_job_handles),
            translation_job_handles: Arc::clone(&self.translation_job_handles),
            index_job_handles: Arc::clone(&self.index_job_handles),
            chat_request_handles: Arc::clone(&self.chat_request_handles),
            parse_limiter: Arc::clone(&self.parse_limiter),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = runtime_logs::init_runtime_logger();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let app_dir = app_dirs::runtime_app_dir(app).map_err(|e| {
                log::error!("Failed to get runtime app dir: {}", e);
                e
            })?;
            std::fs::create_dir_all(&app_dir).map_err(|e| {
                log::error!("Failed to create app data dir: {}", e);
                e
            })?;

            let db_path = app_dirs::database_path(&app_dir);
            let db = Database::new(&db_path).map_err(|e| {
                log::error!("Failed to open database: {}", e);
                e
            })?;
            db.init().map_err(|e| {
                log::error!("Failed to initialize database: {}", e);
                e
            })?;

            let settings_manager = Arc::new(settings::SettingsManager::new(&app_dir));

            // Migrate legacy settings from DB
            {
                let conn = db.get_connection();
                if let Ok(mut stmt) = conn.prepare("SELECT key, value FROM app_settings") {
                    if let Ok(rows) = stmt
                        .query_map([], |row| {
                            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                        })
                        .and_then(|iter| iter.collect::<Result<Vec<_>, _>>())
                    {
                        let mut merged = settings_manager.get_all();
                        let mut changed = false;

                        for (key, value) in rows {
                            if !merged.contains_key(&key) {
                                merged.insert(key, value);
                                changed = true;
                            }
                        }

                        if changed {
                            settings_manager.replace_all(merged).map_err(|e| {
                                log::error!("Failed to migrate legacy settings into settings.json: {}", e);
                                e
                            })?;
                        }
                    }
                }
            }

            match zvec::migrate_legacy_collections_dir(settings_manager.as_ref(), &app_dir) {
                Ok(true) => {
                    log::info!("Migrated legacy ZVEC collection storage into the managed app directory.");
                }
                Ok(false) => {}
                Err(e) => {
                    log::warn!("Failed to migrate legacy ZVEC collection storage: {}", e);
                }
            }

            let mut needs_vacuum = false;

            // Migrate legacy parsed/translated large TEXT blobs into file storage once.
            {
                let conn = db.get_connection();
                match commands::migrate_legacy_mineru_processed_storage(conn, &app_dir) {
                    Ok(true) => {
                        log::info!(
                            "Migrated legacy MinerU processed storage into the managed app directory."
                        );
                    }
                    Ok(false) => {}
                    Err(e) => {
                        log::warn!("Failed to migrate legacy MinerU processed storage: {}", e);
                    }
                }

                match content_store::migrate_legacy_contents(conn, &app_dir) {
                    Ok(true) => {
                        needs_vacuum = true;
                    }
                    Ok(false) => {}
                    Err(e) => {
                        log::warn!("Failed to migrate legacy document contents: {}", e);
                    }
                }

                match commands::restore_missing_mineru_processed_files(conn, &app_dir) {
                    Ok(restored) if restored > 0 => {
                        log::info!(
                            "Restored missing MinerU processed file records for {} documents.",
                            restored
                        );
                    }
                    Ok(_) => {}
                    Err(e) => {
                        log::warn!("Failed to restore missing MinerU processed files: {}", e);
                    }
                }

                let log_dir = app_dirs::ensure_logs_dir(&app_dir).map_err(|e| {
                    log::error!("Failed to prepare log directory: {}", e);
                    e
                })?;
                match runtime_logs::migrate_legacy_logs(conn, &log_dir) {
                    Ok(true) => {
                        needs_vacuum = true;
                    }
                    Ok(false) => {}
                    Err(e) => {
                        log::warn!("Failed to migrate legacy runtime logs: {}", e);
                    }
                }

                if needs_vacuum {
                    let _ = conn.execute_batch("VACUUM");
                }
            }

            // Optional hard-close compaction (rebuild light tables + drop legacy settings/log tables).
            {
                let compact_enabled = settings_manager
                    .get("storage.compact_legacy_tables")
                    .map(|v| v == "true")
                    .unwrap_or(false)
                    || std::env::var("ROSETTA_COMPACT_LEGACY_TABLES")
                        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
                        .unwrap_or(false);

                match db.apply_optional_storage_compaction(compact_enabled) {
                    Ok(true) => {
                        let _ = db.get_connection().execute_batch("VACUUM");
                        log::info!("Optional storage compaction applied.");
                    }
                    Ok(false) => {}
                    Err(e) => {
                        log::warn!("Optional storage compaction failed: {}", e);
                    }
                }
            }

            let logger_level = settings_manager.get_with_default("logs.level", "info");
            let log_dir = app_dirs::ensure_logs_dir(&app_dir).map_err(|e| {
                log::error!("Failed to prepare runtime logger directory: {}", e);
                e
            })?;
            runtime_logs::configure_runtime_logger(log_dir, &logger_level);

            if let Err(e) = db.recover_incomplete_tasks() {
                log::error!("Failed to recover incomplete tasks: {}", e);
            }

            let mineru_manager = Arc::new(MinerUProcessManager::new());
            let venv_manager = Arc::new(MinerUVenvManager::new());
            let model_manager = Arc::new(MinerUModelManager::new());
            let reranker_model_manager = Arc::new(zvec::RerankerModelManager::new());
            let zvec_venv_manager = Arc::new(zvec::ZvecVenvManager::new());
            let zvec_availability_cache = Arc::new(zvec::ZvecAvailabilityCache::new());

            let db_arc = Arc::new(Mutex::new(db));

            let max_concurrent_parse = settings_manager
                .get("mineru.max_concurrent_parse_jobs")
                .and_then(|v| v.parse::<usize>().ok())
                .unwrap_or(DEFAULT_MINERU_MAX_CONCURRENT_PARSE_JOBS)
                .clamp(1, 8);
            let parse_limiter = Arc::new(rate_limiter::ConcurrencyLimiter::new(max_concurrent_parse));
            log::info!("Parse job concurrency limiter initialized with max_concurrent={}", max_concurrent_parse);

            if db_arc.lock().is_ok() {
                mineru_process::refresh_model_download_status(
                    &model_manager,
                    &settings_manager,
                    &app_dir,
                );
            }

            app.manage(AppState {
                app_dir: app_dir.clone(),
                db: Arc::clone(&db_arc),
                settings: Arc::clone(&settings_manager),
                mineru_manager: Arc::clone(&mineru_manager),
                venv_manager: Arc::clone(&venv_manager),
                model_manager: Arc::clone(&model_manager),
                reranker_model_manager: Arc::clone(&reranker_model_manager),
                zvec_venv_manager: Arc::clone(&zvec_venv_manager),
                zvec_availability_cache: Arc::clone(&zvec_availability_cache),
                parse_job_handles: Arc::new(Mutex::new(HashMap::new())),
                translation_job_handles: Arc::new(Mutex::new(HashMap::new())),
                index_job_handles: Arc::new(Mutex::new(HashMap::new())),
                chat_request_handles: Arc::new(Mutex::new(HashMap::new())),
                parse_limiter: Arc::clone(&parse_limiter),
            });

            window_appearance::sync_main_window_theme(app.handle(), settings_manager.as_ref());

            // First-launch optimal window sizing
            {
                let state_marker = app_dir.join(".window-initialized");
                if !state_marker.exists() {
                    if let Some(window) = app.get_webview_window("main") {
                        if let Ok(Some(monitor)) = window.current_monitor() {
                            let screen = monitor.size();
                            let scale = monitor.scale_factor();
                            let lw = (screen.width as f64 / scale) * 0.80;
                            let lh = (screen.height as f64 / scale) * 0.80;
                            let w = lw.clamp(900.0, 1600.0);
                            let h = lh.clamp(600.0, 1100.0);
                            let _ = window.set_size(tauri::Size::Logical(
                                tauri::LogicalSize { width: w, height: h },
                            ));
                            let _ = window.center();
                        }
                    }
                    let _ = std::fs::write(&state_marker, b"1");
                }
            }

            let settings_for_autostart = Arc::clone(&settings_manager);
            let app_handle_for_autostart = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let (mode, auto_start) = {
                    let mode = settings_for_autostart.get_with_default("mineru.mode", "builtin");
                    let auto_start = settings_for_autostart.get_with_default("mineru.auto_start", "false");
                    (mode, auto_start)
                };

                if mode == "builtin" && auto_start == "true" {
                    if let Some(state) = app_handle_for_autostart.try_state::<AppState>() {
                        log::info!("Auto-starting MinerU with unified startup validation...");
                        match mineru_process::start_mineru_with_state(state.inner()).await {
                            Ok(port) => log::info!("MinerU auto-started on port {}", port),
                            Err(e) => log::error!("Failed to auto-start MinerU: {}", e),
                        }
                    } else {
                        log::error!("Failed to auto-start MinerU: app state is not available.");
                    }
                }
            });

            // Background health monitor for MinerU
            let manager_for_health = Arc::clone(&mineru_manager);
            let settings_for_health = Arc::clone(&settings_manager);
            let app_handle_for_health = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    let interval_secs = settings_for_health
                        .get("mineru.health_check_interval_secs")
                        .and_then(|v| v.parse::<u64>().ok())
                        .unwrap_or(DEFAULT_HEALTH_CHECK_INTERVAL_SECS)
                        .clamp(10, 300);

                    tokio::time::sleep(std::time::Duration::from_secs(interval_secs)).await;

                    let mode = settings_for_health.get_with_default("mineru.mode", "builtin");
                    if mode != "builtin" {
                        continue;
                    }

                    let status_response = match manager_for_health.get_status() {
                        Ok(s) => s,
                        Err(_) => continue,
                    };

                    if status_response.status != "running" {
                        continue;
                    }

                    let Some(port) = status_response.port else {
                        continue;
                    };

                    let active_parse_jobs = app_handle_for_health
                        .try_state::<AppState>()
                        .and_then(|state| {
                            state
                                .parse_job_handles
                                .lock()
                                .ok()
                                .map(|handles| handles.len())
                        })
                        .unwrap_or(0);

                    if active_parse_jobs > 0 {
                        log::debug!(
                            "Skipping MinerU background health probe on port {} because {} parse job(s) are active.",
                            port,
                            active_parse_jobs
                        );
                        continue;
                    }

                    let is_healthy = mineru_process::local_mineru_health_check_pub(
                        port,
                        std::time::Duration::from_millis(1500),
                    );

                    if !is_healthy {
                        let process_alive = match manager_for_health.managed_process_is_alive() {
                            Ok(alive) => alive,
                            Err(error) => {
                                log::warn!(
                                    "Periodic health check could not inspect the managed MinerU process on port {}: {}",
                                    port,
                                    error
                                );
                                continue;
                            }
                        };

                        if process_alive {
                            log::warn!(
                                "Periodic health check: MinerU on port {} did not answer /health, but its managed process is still running. Skipping auto-restart while the process remains alive.",
                                port
                            );
                            continue;
                        }

                        log::warn!(
                            "Periodic health check: MinerU on port {} is not responding and its managed process is no longer running.",
                            port
                        );

                        let max_retries = settings_for_health
                            .get("mineru.auto_restart_max_retries")
                            .and_then(|v| v.parse::<u32>().ok())
                            .unwrap_or(DEFAULT_AUTO_RESTART_MAX_RETRIES)
                            .clamp(0, 10);

                        if max_retries > 0 {
                            manager_for_health.attempt_auto_restart(max_retries).await;
                        } else {
                            log::warn!("Auto-restart is disabled (max_retries=0). MinerU remains in failed state.");
                        }
                    }
                }
            });

            let cleanup_db = Arc::clone(&db_arc);
            let cleanup_app_dir = app_dir.clone();
            let cleanup_settings = Arc::clone(&settings_manager);
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(6 * 60 * 60)).await;
                    let Ok(db_guard) = cleanup_db.lock() else {
                        continue;
                    };
                    if let Err(error) = commands::run_periodic_cleanup(
                        db_guard.get_connection(),
                        &cleanup_settings,
                        &cleanup_app_dir,
                    ) {
                        log::warn!("Periodic cleanup failed: {}", error);
                    }
                }
            });

            // System tray setup
            let quit_item = tauri::menu::MenuItem::with_id(app, "quit", "Quit Rosetta", true, None::<&str>)?;
            let show_item = tauri::menu::MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let menu = tauri::menu::Menu::with_items(app, &[&show_item, &quit_item])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("Rosetta")
                .on_menu_event(|app: &tauri::AppHandle, event| {
                    match event.id.as_ref() {
                        "quit" => {
                            app.exit(0);
                        }
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray: &tauri::tray::TrayIcon, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Intercept window close: minimize to tray when tasks are active
            if let Some(window) = app.get_webview_window("main") {
                let app_handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        if let Some(state) = app_handle.try_state::<AppState>() {
                            let has_active = {
                                let t = state
                                    .translation_job_handles
                                    .lock()
                                    .map(|h| !h.is_empty())
                                    .unwrap_or(false);
                                let i = state
                                    .index_job_handles
                                    .lock()
                                    .map(|h| !h.is_empty())
                                    .unwrap_or(false);
                                let p = state
                                    .parse_job_handles
                                    .lock()
                                    .map(|h| !h.is_empty())
                                    .unwrap_or(false);
                                t || i || p
                            };
                            if has_active {
                                api.prevent_close();
                                if let Some(w) = app_handle.get_webview_window("main") {
                                    let _ = w.hide();
                                }
                            }
                        }
                    }
                });
            }

            // Silent start: hide window if the setting is enabled
            {
                let start_silent = settings_manager.get_with_default("general.start_silent", "false");

                if start_silent == "true" {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.hide();
                    }
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_documents,
            commands::get_library_documents,
            commands::get_document_by_id,
            commands::create_document,
            commands::update_document,
            commands::delete_document,
            commands::move_documents_to_trash,
            commands::restore_documents,
            commands::batch_update_documents,
            commands::permanently_delete_documents,
            commands::empty_trash,
            commands::get_folders,
            commands::create_folder,
            commands::update_folder,
            commands::delete_folder,
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
            commands::get_mineru_processed_files,
            commands::start_translation_job,
            commands::cancel_translation_job,
            commands::delete_translation_job,
            commands::get_translation_job,
            commands::get_all_translation_jobs,
            commands::resume_translation_job,
            commands::retry_failed_translation_chunks,
            commands::get_translated_content,
            commands::get_document_outputs,
            commands::replace_original_document_file,
            commands::replace_translated_pdf,
            commands::replace_parsed_markdown,
            commands::start_index_job,
            commands::cancel_index_job,
            commands::get_all_index_jobs,
            commands::delete_index_job,
            commands::resume_index_job,
            commands::retry_failed_index_chunks,
            commands::search_documents,
            rag_chat::start_rag_chat,
            rag_chat::cancel_rag_chat,
            rag_chat::generate_chat_title,
            commands::test_webdav_connection,
            commands::sync_document,
            commands::export_document,
            commands::export_document_asset,
            commands::test_mineru_connection,
            commands::get_runtime_logs,
            commands::export_runtime_logs,
            commands::run_cleanup_now,
            commands::get_mineru_processed_storage_dir,
            commands::get_document_file_path,
            commands::duplicate_document,
            commands::reveal_in_os,
            commands::get_document_chunks,
            commands::get_extraction_templates,
            commands::create_extraction_template,
            commands::update_extraction_template,
            commands::delete_extraction_template,
            commands::toggle_builtin_template,
            commands::get_document_metadata,
            commands::get_all_documents_metadata,
            commands::delete_document_metadata_field,
            commands::extract_document_fields,
            commands::batch_extract_document_fields,
            commands::batch_start_parse_jobs,
            commands::batch_start_translation_jobs,
            commands::batch_start_index_jobs,
            commands::batch_add_tags,
            commands::batch_remove_tags,
            commands::batch_set_language,
            commands::batch_export_documents,
            window_appearance::sync_window_theme,
            zvec::get_zvec_status,
            zvec::probe_reranker_status,
            zvec::install_reranker_deps,
            zvec::download_reranker_model,
            zvec::get_reranker_model_status,
            zvec::setup_zvec_venv,
            zvec::get_zvec_venv_status,
            zvec::check_zvec_venv_exists,
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
            app_updater::check_app_update,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            match event {
                RunEvent::ExitRequested { api, .. } => {
                    if let Some(state) = app.try_state::<AppState>() {
                        let has_active = {
                            let t = state.translation_job_handles.lock().map(|h| !h.is_empty()).unwrap_or(false);
                            let i = state.index_job_handles.lock().map(|h| !h.is_empty()).unwrap_or(false);
                            let p = state.parse_job_handles.lock().map(|h| !h.is_empty()).unwrap_or(false);
                            t || i || p
                        };
                        if has_active {
                            api.prevent_exit();
                        }
                    }
                }
                RunEvent::Exit => {
                    if let Some(state) = app.try_state::<AppState>() {
                        let _ = state.mineru_manager.stop();
                    }
                }
                _ => {}
            }
        });
}
