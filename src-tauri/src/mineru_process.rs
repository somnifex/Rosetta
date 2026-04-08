use crate::AppState;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, State};
use tokio::io::AsyncReadExt;
use tokio::process::{Child, Command};

macro_rules! hide_console_window {
    ($cmd:expr) => {{
        #[cfg(target_os = "windows")]
        {
            #[allow(unused_imports)]
            use std::os::windows::process::CommandExt as _;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            $cmd.creation_flags(CREATE_NO_WINDOW);
        }
    }};
}

const DEFAULT_MINERU_CLONE_URL: &str = "https://github.com/opendatalab/MinerU.git";
const DEFAULT_PIP_INDEX_URL: &str = "https://pypi.org/simple";
const PYTORCH_CUDA_INDEX_URL: &str = "https://download.pytorch.org/whl/cu126";
const PIPELINE_GPU_MIN_VRAM_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const AUTO_ENGINE_MIN_VRAM_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const APPLE_SILICON_AUTO_ENGINE_MIN_RAM_BYTES: u64 = 16 * 1024 * 1024 * 1024;
const MODEL_SCAN_MAX_DEPTH: usize = 12;
const MODEL_SCAN_MAX_ENTRIES: usize = 20000;
const LOCAL_MINERU_HEALTH_TIMEOUT: Duration = Duration::from_millis(750);
const LOCAL_MINERU_PORT_SCAN_WINDOW: u16 = 10;
const REQUIRED_MINERU_MODULES: &[&str] = &["mineru", "albumentations"];
const KNOWN_MODEL_EXTENSIONS: &[&str] = &[
    "safetensors",
    "bin",
    "onnx",
    "pt",
    "pth",
    "ckpt",
    "pdparams",
    "pdmodel",
];
const KNOWN_MODEL_FILENAMES: &[&str] = &[
    "model.safetensors",
    "pytorch_model.bin",
    "model.onnx",
    "weights.pb",
];

#[derive(Clone, Debug)]
struct MinerUStartParams {
    app_dir: PathBuf,
    python_path: String,
    requested_port: u16,
    use_venv: bool,
    venv_dir: Option<PathBuf>,
    model_source: String,
    models_dir: String,
}

pub struct MinerUProcessManager {
    process: Mutex<Option<Child>>,
    status: Mutex<String>,
    port: Mutex<Option<u16>>,
    owned_by_app: Mutex<bool>,
    error: Mutex<Option<String>>,
    runtime_profile: Mutex<Option<MinerURuntimeProfile>>,
    restart_count: Mutex<u32>,
    last_start_params: Mutex<Option<MinerUStartParams>>,
    consecutive_health_failures: Mutex<u32>,
    last_activity: Mutex<Option<std::time::Instant>>,
}

#[derive(Debug, Serialize)]
pub struct MinerUStatusResponse {
    pub status: String,
    pub port: Option<u16>,
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_backend: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_device_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_reason: Option<String>,
    pub restart_count: u32,
}

#[derive(Debug, Serialize)]
pub struct AppSettingRow {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Serialize)]
pub struct VenvStatusResponse {
    pub status: String,
    pub message: String,
}

pub struct MinerUVenvManager {
    status: Mutex<String>,
    message: Mutex<String>,
}

impl MinerUVenvManager {
    pub fn new() -> Self {
        Self {
            status: Mutex::new("not_created".to_string()),
            message: Mutex::new(String::new()),
        }
    }

    pub fn get_status(&self) -> Result<VenvStatusResponse, String> {
        let status = self.status.lock().map_err(|e| e.to_string())?;
        let message = self.message.lock().map_err(|e| e.to_string())?;
        Ok(VenvStatusResponse {
            status: status.clone(),
            message: message.clone(),
        })
    }

    pub fn set_status(&self, status: &str, message: &str) {
        if let Ok(mut s) = self.status.lock() {
            *s = status.to_string();
        }
        if let Ok(mut m) = self.message.lock() {
            *m = message.to_string();
        }
    }
}

pub struct MinerUModelManager {
    status: Mutex<String>,
    message: Mutex<String>,
    progress: Mutex<f64>,
    output_tail: Mutex<String>,
}

#[derive(Debug, Serialize)]
pub struct ModelDownloadStatusResponse {
    pub status: String,
    pub message: String,
    pub progress: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct MinerURuntimeProfile {
    pub backend: String,
    pub device_mode: Option<String>,
    pub reason: String,
}

#[derive(Debug, Default, Deserialize)]
struct MinerUPythonRuntimeProbe {
    #[serde(default)]
    torch_present: bool,
    #[serde(default)]
    cuda_available: bool,
    #[serde(default)]
    cuda_device_count: u32,
    #[serde(default)]
    max_vram_bytes: u64,
    #[serde(default)]
    mps_available: bool,
    #[serde(default)]
    total_memory_bytes: Option<u64>,
    #[serde(default)]
    device_names: Vec<String>,
}

impl MinerUModelManager {
    pub fn new() -> Self {
        Self {
            status: Mutex::new("idle".to_string()),
            message: Mutex::new(String::new()),
            progress: Mutex::new(0.0),
            output_tail: Mutex::new(String::new()),
        }
    }

    pub fn get_status(&self) -> Result<ModelDownloadStatusResponse, String> {
        let status = self.status.lock().map_err(|e| e.to_string())?;
        let message = self.message.lock().map_err(|e| e.to_string())?;
        let progress = self.progress.lock().map_err(|e| e.to_string())?;
        Ok(ModelDownloadStatusResponse {
            status: status.clone(),
            message: message.clone(),
            progress: *progress,
        })
    }

    pub fn set_status(&self, status: &str, message: &str) {
        if let Ok(mut s) = self.status.lock() {
            *s = status.to_string();
        }
        if let Ok(mut m) = self.message.lock() {
            *m = message.to_string();
        }
        if status != "downloading" {
            if let Ok(mut p) = self.progress.lock() {
                *p = if status == "completed" { 100.0 } else { 0.0 };
            }
        }
        if status == "downloading" {
            if let Ok(mut t) = self.output_tail.lock() {
                t.clear();
            }
        }
    }

    pub fn set_progress(&self, progress: f64, message: &str) {
        if let Ok(mut p) = self.progress.lock() {
            *p = progress;
        }
        if let Ok(mut m) = self.message.lock() {
            *m = message.to_string();
        }
    }

    pub fn append_output(&self, line: &str) {
        if let Ok(mut t) = self.output_tail.lock() {
            if !t.is_empty() {
                t.push('\n');
            }
            t.push_str(line);
            if t.chars().count() > 2000 {
                let truncated = truncate_tail(t.as_str(), 2000);
                *t = truncated;
            }
        }
    }

    pub fn get_output_tail(&self) -> String {
        self.output_tail
            .lock()
            .map(|t| t.clone())
            .unwrap_or_default()
    }
}

fn venv_python_path(venv_dir: &Path) -> PathBuf {
    if cfg!(windows) {
        venv_dir.join("Scripts").join("python.exe")
    } else {
        venv_dir.join("bin").join("python")
    }
}

fn venv_script_path(venv_dir: &Path, script_name: &str) -> PathBuf {
    if cfg!(windows) {
        venv_dir
            .join("Scripts")
            .join(format!("{}.exe", script_name))
    } else {
        venv_dir.join("bin").join(script_name)
    }
}

impl MinerUProcessManager {
    pub fn new() -> Self {
        Self {
            process: Mutex::new(None),
            status: Mutex::new("stopped".to_string()),
            port: Mutex::new(None),
            owned_by_app: Mutex::new(false),
            error: Mutex::new(None),
            runtime_profile: Mutex::new(None),
            restart_count: Mutex::new(0),
            last_start_params: Mutex::new(None),
            consecutive_health_failures: Mutex::new(0),
            last_activity: Mutex::new(None),
        }
    }

    pub fn increment_consecutive_health_failures(&self) -> Result<u32, String> {
        let mut count = self
            .consecutive_health_failures
            .lock()
            .map_err(|e| e.to_string())?;
        *count += 1;
        Ok(*count)
    }

    pub fn reset_consecutive_health_failures(&self) -> Result<(), String> {
        let mut count = self
            .consecutive_health_failures
            .lock()
            .map_err(|e| e.to_string())?;
        *count = 0;
        Ok(())
    }

    pub fn touch_activity(&self) {
        if let Ok(mut ts) = self.last_activity.lock() {
            *ts = Some(std::time::Instant::now());
        }
    }

    pub fn idle_duration(&self) -> Option<std::time::Duration> {
        self.last_activity
            .lock()
            .ok()
            .and_then(|ts| ts.map(|t| t.elapsed()))
    }

    pub async fn start(
        &self,
        app_dir: &Path,
        python_path: &str,
        requested_port: u16,
        use_venv: bool,
        venv_dir: Option<&Path>,
        model_source: &str,
        models_dir: &str,
    ) -> Result<u16, String> {
        {
            let status = self.status.lock().map_err(|e| e.to_string())?;
            if *status == "running" || *status == "starting" {
                return Err("MinerU is already running or starting".to_string());
            }
        }

        {
            let mut status = self.status.lock().map_err(|e| e.to_string())?;
            *status = "starting".to_string();
            let mut error = self.error.lock().map_err(|e| e.to_string())?;
            *error = None;
            let mut runtime_profile = self.runtime_profile.lock().map_err(|e| e.to_string())?;
            *runtime_profile = None;
        }

        let runtime_profile = detect_mineru_runtime_profile(python_path);
        log::info!(
            "MinerU runtime profile detected: backend={}, device_mode={:?}, reason={}",
            runtime_profile.backend,
            runtime_profile.device_mode,
            runtime_profile.reason
        );
        if local_mineru_health_check(requested_port, LOCAL_MINERU_HEALTH_TIMEOUT) {
            log::warn!(
                "Configured MinerU port {} is already occupied by a healthy service. Rosetta will start its own managed MinerU process on a nearby free port instead of taking over an external process.",
                requested_port
            );
        }

        let actual_port = find_available_port(requested_port)
            .ok_or_else(|| "Could not find an available port".to_string())?;
        let port_str = actual_port.to_string();
        {
            let mut profile = self.runtime_profile.lock().map_err(|e| e.to_string())?;
            *profile = Some(runtime_profile.clone());
        }

        let (cmd, args): (String, Vec<String>) = if use_venv {
            let api_bin = venv_script_path(venv_dir.unwrap(), "mineru-api");
            if api_bin.exists() {
                (
                    api_bin.to_str().unwrap().to_string(),
                    vec![
                        "--host".to_string(),
                        "127.0.0.1".to_string(),
                        "--port".to_string(),
                        port_str.clone(),
                    ],
                )
            } else {
                (
                    python_path.to_string(),
                    vec![
                        "-m".to_string(),
                        "mineru.cli.fast_api".to_string(),
                        "--port".to_string(),
                        port_str.clone(),
                    ],
                )
            }
        } else {
            (
                python_path.to_string(),
                vec![
                    "-m".to_string(),
                    "mineru.cli.fast_api".to_string(),
                    "--host".to_string(),
                    "127.0.0.1".to_string(),
                    "--port".to_string(),
                    port_str.clone(),
                ],
            )
        };

        let mut command = Command::new(&cmd);
        command
            .args(&args)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(false);

        hide_console_window!(command);

        // At runtime, use "local" when mineru.json already has valid model
        // paths so that MinerU loads the pre-downloaded models directly
        // instead of trying to re-download via HuggingFace / ModelScope.
        let runtime_model_source = if model_source != "local" && mineru_json_has_valid_model_paths()
        {
            log::info!(
                "mineru.json has valid model paths; overriding runtime MINERU_MODEL_SOURCE from '{}' to 'local'",
                model_source
            );
            "local"
        } else {
            model_source
        };

        if !runtime_model_source.is_empty() {
            command.env("MINERU_MODEL_SOURCE", runtime_model_source);
        }
        if let Some(device_mode) = runtime_profile.device_mode.as_deref() {
            command.env("MINERU_DEVICE_MODE", device_mode);
        }
        if !models_dir.is_empty() {
            command.env("HF_HOME", models_dir);
            command.env("MODELSCOPE_CACHE", models_dir);
            if runtime_model_source == "local" {
                command.env("MINERU_MODEL_DIR", models_dir);
            }
        }
        // lmdeploy turbomind on Windows requires CUDA_PATH to locate CUDA DLLs.
        let resolved_cuda_path = resolve_cuda_path_for_lmdeploy(python_path, app_dir);
        match resolved_cuda_path {
            Some(ref cuda_path) => {
                log::info!("Setting CUDA_PATH={} for MinerU process", cuda_path);
                command.env("CUDA_PATH", cuda_path);
            }
            None => {
                log::warn!("Could not resolve CUDA_PATH for lmdeploy; hybrid-auto-engine may fail on Windows without a CUDA Toolkit installation");
            }
        }
        // MINERU_API_SHUTDOWN_ON_STDIN_EOF is intentionally NOT set because
        // piping stdin causes lmdeploy/turbomind to deadlock during CUDA
        // initialization on Windows.  Rosetta uses kill_process_tree() for
        // shutdown instead.
        apply_managed_cache_env(&mut command, app_dir)?;

        let child = match command.spawn() {
            Ok(c) => c,
            Err(e) => {
                if use_venv && cmd != python_path {
                    let mut fallback = Command::new(python_path);
                    fallback
                        .args([
                            "-m",
                            "mineru.cli.fast_api",
                            "--host",
                            "127.0.0.1",
                            "--port",
                            &port_str,
                        ])
                        .stdin(std::process::Stdio::null())
                        .stdout(std::process::Stdio::null())
                        .stderr(std::process::Stdio::piped())
                        .kill_on_drop(false);
                    hide_console_window!(fallback);
                    if !runtime_model_source.is_empty() {
                        fallback.env("MINERU_MODEL_SOURCE", runtime_model_source);
                    }
                    if let Some(device_mode) = runtime_profile.device_mode.as_deref() {
                        fallback.env("MINERU_DEVICE_MODE", device_mode);
                    }
                    if !models_dir.is_empty() {
                        fallback.env("HF_HOME", models_dir);
                        fallback.env("MODELSCOPE_CACHE", models_dir);
                        if runtime_model_source == "local" {
                            fallback.env("MINERU_MODEL_DIR", models_dir);
                        }
                    }
                    if let Some(ref cuda_path) = resolved_cuda_path {
                        fallback.env("CUDA_PATH", cuda_path);
                    }
                    fallback.env("MINERU_API_SHUTDOWN_ON_STDIN_EOF", "0");
                    apply_managed_cache_env(&mut fallback, app_dir)?;
                    fallback.spawn().map_err(|e2| {
                        let err_msg = format!("Failed to start MinerU: {}", e2);
                        if let Ok(mut status) = self.status.lock() {
                            *status = "failed".to_string();
                        }
                        if let Ok(mut error) = self.error.lock() {
                            *error = Some(err_msg.clone());
                        }
                        err_msg
                    })?
                } else {
                    let err_msg = format!("Failed to start MinerU: {}", e);
                    if let Ok(mut status) = self.status.lock() {
                        *status = "failed".to_string();
                    }
                    if let Ok(mut error) = self.error.lock() {
                        *error = Some(err_msg.clone());
                    }
                    return Err(err_msg);
                }
            }
        };

        let early_exit_stderr: std::sync::Arc<Mutex<String>> =
            std::sync::Arc::new(Mutex::new(String::new()));
        {
            let mut child = child;
            if let Some(stderr) = child.stderr.take() {
                let shared_buf = std::sync::Arc::clone(&early_exit_stderr);
                tokio::spawn(async move {
                    use tokio::io::{AsyncBufReadExt, BufReader};
                    let reader = BufReader::new(stderr);
                    let mut lines = reader.lines();
                    while let Ok(Some(line)) = lines.next_line().await {
                        log::debug!("[MinerU stderr] {}", line);
                        if let Ok(mut buf) = shared_buf.lock() {
                            if buf.len() > 8192 {
                                let drain = buf.len() - 4096;
                                buf.drain(..drain);
                            }
                            buf.push_str(&line);
                            buf.push('\n');
                        }
                    }
                });
            }
            let mut proc = self.process.lock().map_err(|e| e.to_string())?;
            *proc = Some(child);
            let mut port = self.port.lock().map_err(|e| e.to_string())?;
            *port = Some(actual_port);
            let mut owned = self.owned_by_app.lock().map_err(|e| e.to_string())?;
            *owned = true;
        }

        let base_url = format!("http://127.0.0.1:{}", actual_port);
        let client = crate::mineru::MinerUClient::new(base_url);

        let max_health_wait = 30;
        let mut healthy = false;
        for _ in 0..max_health_wait {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;

            let exited_info: Option<std::process::ExitStatus> = {
                let mut proc = self.process.lock().map_err(|e| e.to_string())?;
                if let Some(ref mut child) = *proc {
                    match child.try_wait() {
                        Ok(Some(exit_status)) => {
                            *proc = None;
                            Some(exit_status)
                        }
                        Ok(None) => None, // Still running
                        Err(e) => {
                            log::warn!("Error checking MinerU process status: {}", e);
                            None
                        }
                    }
                } else {
                    None
                }
            };

            if let Some(exit_status) = exited_info {
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                let stderr_output = early_exit_stderr
                    .lock()
                    .map(|buf| buf.clone())
                    .unwrap_or_default();

                let err_detail = if stderr_output.trim().is_empty() {
                    format!("Process exited with {}", exit_status)
                } else {
                    let trimmed = stderr_output.trim();
                    let tail = if trimmed.len() > 500 {
                        &trimmed[trimmed.len() - 500..]
                    } else {
                        trimmed
                    };
                    tail.to_string()
                };

                let mut status = self.status.lock().map_err(|e| e.to_string())?;
                *status = "failed".to_string();
                let mut error = self.error.lock().map_err(|e| e.to_string())?;
                *error = Some(err_detail.clone());
                return Err(err_detail);
            }

            match client.health_check().await {
                Ok(true) => {
                    healthy = true;
                    break;
                }
                _ => continue,
            }
        }

        if healthy {
            let mut status = self.status.lock().map_err(|e| e.to_string())?;
            *status = "running".to_string();
            if let Ok(mut params) = self.last_start_params.lock() {
                *params = Some(MinerUStartParams {
                    app_dir: app_dir.to_path_buf(),
                    python_path: python_path.to_string(),
                    requested_port,
                    use_venv,
                    venv_dir: venv_dir.map(|p| p.to_path_buf()),
                    model_source: model_source.to_string(),
                    models_dir: models_dir.to_string(),
                });
            }
            if let Ok(mut count) = self.restart_count.lock() {
                *count = 0;
            }
            self.touch_activity();
            Ok(actual_port)
        } else {
            self.stop_internal()?;
            let mut status = self.status.lock().map_err(|e| e.to_string())?;
            *status = "failed".to_string();
            let mut error = self.error.lock().map_err(|e| e.to_string())?;
            *error = Some(format!(
                "MinerU did not become healthy within {} seconds",
                max_health_wait
            ));
            Err(format!(
                "MinerU did not become healthy within {} seconds",
                max_health_wait
            ))
        }
    }

    fn stop_internal(&self) -> Result<(), String> {
        let owned_by_app = *self.owned_by_app.lock().map_err(|e| e.to_string())?;

        if !owned_by_app {
            let mut proc = self.process.lock().map_err(|e| e.to_string())?;
            *proc = None;
            return Ok(());
        }

        let port_to_cleanup = *self.port.lock().map_err(|e| e.to_string())?;
        let mut proc = self.process.lock().map_err(|e| e.to_string())?;
        if let Some(ref mut child) = *proc {
            if let Some(pid) = child.id() {
                kill_process_tree(pid);
            }
            let _ = child.start_kill();
            for _ in 0..20 {
                match child.try_wait() {
                    Ok(Some(_)) => break,
                    Ok(None) => std::thread::sleep(Duration::from_millis(100)),
                    Err(_) => break,
                }
            }
        }
        *proc = None;
        drop(proc);

        if let Some(port) = port_to_cleanup {
            if local_port_is_open(port, Duration::from_millis(250)) {
                kill_processes_listening_on_port(port);
            }
        }

        Ok(())
    }

    pub fn stop(&self) -> Result<(), String> {
        self.stop_internal()?;
        let mut status = self.status.lock().map_err(|e| e.to_string())?;
        *status = "stopped".to_string();
        let mut port = self.port.lock().map_err(|e| e.to_string())?;
        *port = None;
        let mut owned = self.owned_by_app.lock().map_err(|e| e.to_string())?;
        *owned = false;
        let mut error = self.error.lock().map_err(|e| e.to_string())?;
        *error = None;
        let mut runtime_profile = self.runtime_profile.lock().map_err(|e| e.to_string())?;
        *runtime_profile = None;
        Ok(())
    }

    pub fn get_status(&self) -> Result<MinerUStatusResponse, String> {
        let status = self.status.lock().map_err(|e| e.to_string())?;
        let port = self.port.lock().map_err(|e| e.to_string())?;
        let error = self.error.lock().map_err(|e| e.to_string())?;
        let runtime_profile = self.runtime_profile.lock().map_err(|e| e.to_string())?;
        let restart_count = *self.restart_count.lock().unwrap_or_else(|e| e.into_inner());
        Ok(MinerUStatusResponse {
            status: status.clone(),
            port: *port,
            error: error.clone(),
            runtime_backend: runtime_profile.as_ref().map(|p| p.backend.clone()),
            runtime_device_mode: runtime_profile.as_ref().and_then(|p| p.device_mode.clone()),
            runtime_reason: runtime_profile.as_ref().map(|p| p.reason.clone()),
            restart_count,
        })
    }

    pub fn managed_process_is_alive(&self) -> Result<bool, String> {
        let owned_by_app = *self.owned_by_app.lock().map_err(|e| e.to_string())?;
        if !owned_by_app {
            return Ok(false);
        }

        let mut process = self.process.lock().map_err(|e| e.to_string())?;
        let Some(child) = process.as_mut() else {
            return Ok(false);
        };

        match child.try_wait() {
            Ok(Some(exit_status)) => {
                log::warn!(
                    "Managed MinerU process has already exited with {}.",
                    exit_status
                );
                Ok(false)
            }
            Ok(None) => Ok(true),
            Err(error) => Err(format!(
                "Failed to inspect managed MinerU process state: {}",
                error
            )),
        }
    }

    pub fn get_active_runtime_profile(&self) -> Result<Option<MinerURuntimeProfile>, String> {
        let status = self.status.lock().map_err(|e| e.to_string())?;
        if *status != "running" {
            return Ok(None);
        }
        drop(status);

        let runtime_profile = self.runtime_profile.lock().map_err(|e| e.to_string())?;
        Ok(runtime_profile.clone())
    }

    pub fn get_restart_count(&self) -> u32 {
        *self.restart_count.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub async fn attempt_auto_restart(&self, max_retries: u32) -> bool {
        let params = {
            let guard = self
                .last_start_params
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            guard.clone()
        };
        let Some(params) = params else {
            log::warn!("Cannot auto-restart MinerU: no previous start parameters stored.");
            return false;
        };

        {
            let mut count = self.restart_count.lock().unwrap_or_else(|e| e.into_inner());
            if *count >= max_retries {
                log::warn!(
                    "MinerU has crashed {} time(s); max_retries={} reached, not restarting.",
                    *count,
                    max_retries
                );
                return false;
            }
            *count += 1;
            log::info!(
                "Auto-restarting MinerU (attempt {}/{})",
                *count,
                max_retries
            );
        }

        if let Err(error) = self.stop() {
            log::warn!(
                "MinerU auto-restart could not fully stop the previous process cleanly: {}",
                error
            );
            if let Ok(mut status) = self.status.lock() {
                *status = "stopped".to_string();
            }
            if let Ok(mut port) = self.port.lock() {
                *port = None;
            }
        }

        let venv_path = params.venv_dir.as_deref();
        match self
            .start(
                &params.app_dir,
                &params.python_path,
                params.requested_port,
                params.use_venv,
                venv_path,
                &params.model_source,
                &params.models_dir,
            )
            .await
        {
            Ok(port) => {
                log::info!("MinerU auto-restart succeeded on port {}", port);
                true
            }
            Err(e) => {
                log::error!("MinerU auto-restart failed: {}", e);
                true
            }
        }
    }

    pub fn get_effective_url(
        &self,
        settings: &crate::settings::SettingsManager,
    ) -> Result<String, String> {
        let mode =
            get_setting_value(settings, "mineru.mode").unwrap_or_else(|| "builtin".to_string());

        match mode.as_str() {
            "builtin" => {
                let status = self.status.lock().map_err(|e| e.to_string())?.clone();
                let current_port = *self.port.lock().map_err(|e| e.to_string())?;

                if status == "running" {
                    if let Some(port) = current_port {
                        return Ok(local_mineru_base_url(port));
                    }
                }

                if let Ok(url) = std::env::var("MINERU_URL") {
                    if !url.trim().is_empty() {
                        return Ok(url);
                    }
                }

                Err("Built-in MinerU is not running. Start it in Settings first.".to_string())
            }
            "external" => {
                let url = get_setting_value(settings, "mineru.external_url").unwrap_or_else(|| {
                    std::env::var("MINERU_URL")
                        .unwrap_or_else(|_| "http://localhost:8000".to_string())
                });
                Ok(url)
            }
            _ => {
                Ok(std::env::var("MINERU_URL")
                    .unwrap_or_else(|_| "http://localhost:8000".to_string()))
            }
        }
    }
}

fn find_available_port(start_port: u16) -> Option<u16> {
    for offset in 0..LOCAL_MINERU_PORT_SCAN_WINDOW {
        let port = start_port + offset;
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Some(port);
        }
    }
    None
}

fn local_mineru_base_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

fn local_mineru_health_check(port: u16, timeout: Duration) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = match TcpStream::connect_timeout(&addr, timeout) {
        Ok(stream) => stream,
        Err(_) => return false,
    };

    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));

    if stream
        .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }

    let mut buf = [0u8; 512];
    match stream.read(&mut buf) {
        Ok(n) if n > 0 => {
            let response = String::from_utf8_lossy(&buf[..n]);
            response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200")
        }
        _ => false,
    }
}

pub fn local_mineru_health_check_pub(port: u16, timeout: Duration) -> bool {
    local_mineru_health_check(port, timeout)
}

fn local_port_is_open(port: u16, timeout: Duration) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, timeout).is_ok()
}

fn get_setting_value(settings: &crate::settings::SettingsManager, key: &str) -> Option<String> {
    settings.get(key)
}

fn normalize_setting_or_default(value: Option<String>, default: &str) -> String {
    value
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| default.to_string())
}

fn detect_mineru_runtime_profile(python_cmd: &str) -> MinerURuntimeProfile {
    match probe_mineru_runtime(python_cmd) {
        Ok(probe) => classify_mineru_runtime(&probe),
        Err(err) => {
            log::warn!(
                "Failed to probe MinerU runtime with '{}': {}; using CPU pipeline",
                python_cmd,
                err
            );
            MinerURuntimeProfile {
                backend: "pipeline".to_string(),
                device_mode: Some("cpu".to_string()),
                reason: format!("Failed to detect accelerator; using CPU. {}", err),
            }
        }
    }
}

fn probe_mineru_runtime(python_cmd: &str) -> Result<MinerUPythonRuntimeProbe, String> {
    let script = r#"
import ctypes
import json
import os
import sys

total_memory = None
try:
    if sys.platform == "win32":
        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong),
                ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        memory_status = MEMORYSTATUSEX()
        memory_status.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(memory_status)):
            total_memory = int(memory_status.ullTotalPhys)
    elif sys.platform == "darwin":
        import subprocess
        total_memory = int(subprocess.check_output(["sysctl", "-n", "hw.memsize"]).decode().strip())
    else:
        total_memory = int(os.sysconf("SC_PHYS_PAGES") * os.sysconf("SC_PAGE_SIZE"))
except Exception:
    total_memory = None

result = {
    "python_version": "{}.{}.{}".format(*sys.version_info[:3]),
    "platform": sys.platform,
    "torch_present": False,
    "cuda_available": False,
    "cuda_device_count": 0,
    "max_vram_bytes": 0,
    "mps_available": False,
    "total_memory_bytes": total_memory,
    "device_names": [],
}

try:
    import torch

    result["torch_present"] = True

    try:
        result["cuda_available"] = bool(torch.cuda.is_available())
    except Exception:
        result["cuda_available"] = False

    if result["cuda_available"]:
        try:
            result["cuda_device_count"] = int(torch.cuda.device_count())
        except Exception:
            result["cuda_device_count"] = 0

        max_vram = 0
        device_names = []
        for index in range(result["cuda_device_count"]):
            try:
                props = torch.cuda.get_device_properties(index)
                device_names.append(str(getattr(props, "name", f"cuda:{index}")))
                total = int(getattr(props, "total_memory", 0) or 0)
                if total > max_vram:
                    max_vram = total
            except Exception:
                device_names.append(f"cuda:{index}")

        result["max_vram_bytes"] = int(max_vram)
        result["device_names"] = device_names

    try:
        mps_backend = getattr(getattr(torch, "backends", None), "mps", None)
        result["mps_available"] = bool(mps_backend and mps_backend.is_available())
    except Exception:
        result["mps_available"] = False
except Exception:
    pass

print(json.dumps(result))
"#;

    let mut cmd = std::process::Command::new(python_cmd);
    cmd.args(["-c", script]);
    hide_console_window!(cmd);
    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run Python runtime probe: {}", e))?;

    if !output.status.success() {
        return Err(command_output_message(
            &output,
            "The Python runtime probe exited unexpectedly",
        ));
    }

    serde_json::from_slice::<MinerUPythonRuntimeProbe>(&output.stdout)
        .map_err(|e| format!("Failed to parse MinerU runtime probe output: {}", e))
}

fn classify_mineru_runtime(probe: &MinerUPythonRuntimeProbe) -> MinerURuntimeProfile {
    let max_vram_gib = bytes_to_gib(probe.max_vram_bytes);
    let total_memory_gib = probe.total_memory_bytes.map(bytes_to_gib);
    let primary_device = probe
        .device_names
        .first()
        .map(String::as_str)
        .unwrap_or("GPU");
    let cuda_device_label = if probe.cuda_device_count > 1 {
        format!("{} ({} devices)", primary_device, probe.cuda_device_count)
    } else {
        primary_device.to_string()
    };

    if probe.cuda_available {
        if probe.max_vram_bytes >= AUTO_ENGINE_MIN_VRAM_BYTES {
            return MinerURuntimeProfile {
                backend: "hybrid-auto-engine".to_string(),
                device_mode: Some("cuda".to_string()),
                reason: format!(
                    "CUDA device {} with {:.1} GiB VRAM (auto-engine threshold met).",
                    cuda_device_label, max_vram_gib
                ),
            };
        }

        if probe.max_vram_bytes >= PIPELINE_GPU_MIN_VRAM_BYTES || probe.max_vram_bytes == 0 {
            return MinerURuntimeProfile {
                backend: "pipeline".to_string(),
                device_mode: Some("cuda".to_string()),
                reason: format!(
                    "CUDA device {} with {:.1} GiB VRAM; using pipeline with CUDA.",
                    cuda_device_label, max_vram_gib
                ),
            };
        }

        return MinerURuntimeProfile {
            backend: "pipeline".to_string(),
            device_mode: Some("cpu".to_string()),
            reason: format!(
                "CUDA device {} has insufficient VRAM ({:.1} GiB); using CPU pipeline.",
                cuda_device_label, max_vram_gib
            ),
        };
    }

    if probe.mps_available {
        if probe.total_memory_bytes.unwrap_or_default() >= APPLE_SILICON_AUTO_ENGINE_MIN_RAM_BYTES {
            return MinerURuntimeProfile {
                backend: "hybrid-auto-engine".to_string(),
                device_mode: Some("mps".to_string()),
                reason: format!(
                    "Apple Silicon / MPS with {:.1} GiB unified memory; using hybrid-auto-engine.",
                    total_memory_gib.unwrap_or(0.0)
                ),
            };
        }

        return MinerURuntimeProfile {
            backend: "pipeline".to_string(),
            device_mode: Some("mps".to_string()),
            reason: format!(
                "Apple Silicon / MPS with {:.1} GiB unified memory; using pipeline with MPS.",
                total_memory_gib.unwrap_or(0.0)
            ),
        };
    }

    let no_accelerator_reason = if probe.torch_present {
        "No compatible CUDA or MPS accelerator was reported by torch."
    } else {
        "Torch was not available in the selected Python environment."
    };

    MinerURuntimeProfile {
        backend: "pipeline".to_string(),
        device_mode: Some("cpu".to_string()),
        reason: format!("{no_accelerator_reason} Using pipeline on CPU."),
    }
}

fn has_nvidia_gpu() -> bool {
    let mut cmd = std::process::Command::new("nvidia-smi");
    cmd.args(["--query-gpu=name", "--format=csv,noheader"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    hide_console_window!(cmd);
    cmd.status().map(|s| s.success()).unwrap_or(false)
}

fn torch_is_cpu_only(python_cmd: &str) -> bool {
    let mut cmd = std::process::Command::new(python_cmd);
    cmd.args(["-c", "import torch; print(torch.version.cuda or '')"])
        .stderr(std::process::Stdio::null());
    hide_console_window!(cmd);
    let output = cmd.output();
    match output {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().is_empty(),
        _ => false,
    }
}

fn bytes_to_gib(bytes: u64) -> f64 {
    bytes as f64 / 1024_f64 / 1024_f64 / 1024_f64
}

/// On Windows, lmdeploy's turbomind requires `CUDA_PATH` to be set so it can
/// locate CUDA DLLs via `CUDA_PATH/bin`.  Many users only have the NVIDIA
/// driver installed (no standalone CUDA Toolkit), so `CUDA_PATH` is empty.
///
/// When `CUDA_PATH` is unset we try to derive a compatible path from the CUDA
/// DLLs bundled inside PyTorch (`torch/lib/`).  We create a directory junction
/// `<app_dir>/cuda_compat/bin  ->  <venv>/Lib/site-packages/torch/lib` and
/// return the `cuda_compat` directory as the effective `CUDA_PATH`.
#[cfg(target_os = "windows")]
fn resolve_cuda_path_for_lmdeploy(python_cmd: &str, app_dir: &Path) -> Option<String> {
    // Honour an existing CUDA_PATH (from the system or user environment).
    if let Ok(existing) = std::env::var("CUDA_PATH") {
        let existing = existing.trim().to_string();
        if !existing.is_empty() && Path::new(&existing).is_dir() {
            log::info!("Using existing CUDA_PATH={}", existing);
            return Some(existing);
        }
    }

    // Ask the Python that will run MinerU for the torch lib directory.
    let mut cmd = std::process::Command::new(python_cmd);
    cmd.args([
        "-c",
        "import os, torch; print(os.path.join(os.path.dirname(torch.__file__), 'lib'))",
    ]);
    hide_console_window!(cmd);
    let output = match cmd.output() {
        Ok(o) => o,
        Err(e) => {
            log::warn!("CUDA_PATH probe: failed to run Python: {}", e);
            return None;
        }
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::warn!("CUDA_PATH probe: Python exited with error: {}", stderr.chars().take(200).collect::<String>());
        return None;
    }
    let torch_lib = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if torch_lib.is_empty() || !Path::new(&torch_lib).is_dir() {
        log::warn!("CUDA_PATH probe: torch lib dir not found or empty: '{}'", torch_lib);
        return None;
    }

    // Only useful when torch ships CUDA DLLs.
    let has_cuda_dll = std::fs::read_dir(&torch_lib)
        .ok()
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .any(|e| {
                    e.file_name()
                        .to_str()
                        .map(|n| n.starts_with("cudart64") && n.ends_with(".dll"))
                        .unwrap_or(false)
                })
        })
        .unwrap_or(false);
    if !has_cuda_dll {
        log::warn!("CUDA_PATH probe: no cudart64*.dll found in {}", torch_lib);
        return None;
    }

    let compat_dir = app_dir.join("cuda_compat");
    let bin_junction = compat_dir.join("bin");

    // If the junction already points to the right place we're done.
    if bin_junction.is_dir() {
        log::info!("CUDA_PATH resolved via existing junction: {}", compat_dir.display());
        return Some(compat_dir.to_str()?.to_string());
    }

    // Create the junction: cuda_compat/bin  ->  torch/lib
    let _ = std::fs::create_dir_all(&compat_dir);
    let torch_lib_win = torch_lib.replace('/', "\\");
    let bin_junction_win = bin_junction.to_str()?.replace('/', "\\");
    let mut mklink = std::process::Command::new("cmd");
    mklink.args(["/C", &format!("mklink /J \"{}\" \"{}\"", bin_junction_win, torch_lib_win)]);
    hide_console_window!(mklink);
    let link_result = mklink.status();
    if link_result.map(|s| s.success()).unwrap_or(false) && bin_junction.is_dir() {
        log::info!(
            "Created CUDA_PATH compat junction: {} -> {}",
            bin_junction_win,
            torch_lib_win
        );
        Some(compat_dir.to_str()?.to_string())
    } else {
        log::warn!(
            "Failed to create CUDA_PATH compat junction ({} -> {})",
            bin_junction_win,
            torch_lib_win
        );
        None
    }
}

#[cfg(not(target_os = "windows"))]
fn resolve_cuda_path_for_lmdeploy(_python_cmd: &str, _app_dir: &Path) -> Option<String> {
    None // Only needed on Windows.
}

fn build_pip_index_args(index_url: &str) -> Vec<String> {
    vec!["--index-url".to_string(), index_url.trim().to_string()]
}

fn disabled_pip_config_path() -> &'static str {
    if cfg!(windows) {
        "NUL"
    } else {
        "/dev/null"
    }
}

fn apply_managed_cache_env(command: &mut Command, app_dir: &Path) -> Result<(), String> {
    let dirs = crate::app_dirs::ensure_managed_cache_dirs(app_dir)?;
    command
        .env("XDG_CACHE_HOME", &dirs.root)
        .env("PIP_CACHE_DIR", &dirs.pip)
        .env("TMPDIR", &dirs.temp)
        .env("TMP", &dirs.temp)
        .env("TEMP", &dirs.temp)
        .env("HF_HUB_DISABLE_SYMLINKS_WARNING", "1");
    Ok(())
}

fn configure_pip_command(command: &mut Command, app_dir: &Path) -> Result<(), String> {
    command
        .env("PIP_CONFIG_FILE", disabled_pip_config_path())
        .env_remove("PIP_INDEX_URL")
        .env_remove("PIP_EXTRA_INDEX_URL")
        .env_remove("PIP_NO_INDEX")
        .env_remove("PIP_FIND_LINKS")
        .env_remove("PIP_TRUSTED_HOST");
    apply_managed_cache_env(command, app_dir)
}

#[cfg(target_os = "windows")]
fn kill_process_tree(pid: u32) {
    let mut cmd = std::process::Command::new("taskkill");
    cmd.args(["/PID", &pid.to_string(), "/T", "/F"]);
    hide_console_window!(cmd);
    let _ = cmd.status();
}

#[cfg(not(target_os = "windows"))]
fn kill_process_tree(_pid: u32) {}

#[cfg(target_os = "windows")]
fn kill_processes_listening_on_port(port: u16) {
    let script = format!(
        "Get-NetTCPConnection -LocalPort {port} -State Listen -ErrorAction SilentlyContinue | \
         Select-Object -ExpandProperty OwningProcess -Unique | \
         ForEach-Object {{ Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }}"
    );

    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-Command", &script]);
    hide_console_window!(cmd);
    let _ = cmd.status();
}

#[cfg(not(target_os = "windows"))]
fn kill_processes_listening_on_port(_port: u16) {}

#[cfg(target_os = "windows")]
fn kill_lingering_processes_in_venv(venv_dir: &Path) {
    let prefix = venv_dir.to_string_lossy().replace('\'', "''");
    let script = format!(
        "$prefix = '{prefix}'; \
         Get-Process -ErrorAction SilentlyContinue | \
         Where-Object {{ $_.Path -and $_.Path.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase) }} | \
         Stop-Process -Force -ErrorAction SilentlyContinue"
    );

    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-Command", &script]);
    hide_console_window!(cmd);
    let _ = cmd.status();
}

#[cfg(not(target_os = "windows"))]
fn kill_lingering_processes_in_venv(_venv_dir: &Path) {}

fn remove_dir_all_with_retries(target: &Path) -> Result<(), String> {
    if !target.exists() {
        return Ok(());
    }

    let mut last_error = None;
    for attempt in 0..6 {
        match std::fs::remove_dir_all(target) {
            Ok(_) => return Ok(()),
            Err(error) => {
                last_error = Some(error);
                std::thread::sleep(Duration::from_millis(300 * (attempt + 1) as u64));
            }
        }
    }

    Err(last_error
        .map(|error| error.to_string())
        .unwrap_or_else(|| "Unknown error while removing directory".to_string()))
}

fn normalize_command_output_text(raw: &[u8]) -> String {
    String::from_utf8_lossy(raw)
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .trim()
        .to_string()
}

fn line_looks_like_package_list(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return false;
    }

    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("successfully installed ")
        || lower.starts_with("installing collected packages:")
    {
        return true;
    }

    let packages: Vec<&str> = trimmed
        .split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect();

    packages.len() >= 8
        && packages.iter().all(|part| {
            part.chars()
                .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
        })
}

fn command_output_line_is_noise(line: &str) -> bool {
    if line_looks_like_package_list(line) {
        return true;
    }

    let lower = line.trim().to_ascii_lowercase();
    lower.starts_with("collecting ")
        || lower.starts_with("using cached ")
        || lower.starts_with("downloading ")
        || lower.starts_with("installing collected packages:")
        || lower.starts_with("successfully installed ")
        || lower.starts_with("building wheels for collected packages:")
        || lower.starts_with("building wheel for ")
        || lower.starts_with("created wheel for ")
        || lower.starts_with("stored in directory:")
        || lower.starts_with("preparing metadata")
        || lower.starts_with("running command ")
        || lower.starts_with("copying ")
        || lower.starts_with("attempting uninstall:")
        || lower.starts_with("found existing installation:")
        || lower.starts_with("uninstalling ")
        || lower.starts_with("removing file or directory ")
        || lower.starts_with("requirement already satisfied:")
}

fn command_output_line_is_error_signal(line: &str) -> bool {
    let trimmed = line.trim();
    let lower = trimmed.to_ascii_lowercase();

    trimmed.starts_with('×')
        || lower.starts_with("error:")
        || lower.contains("traceback")
        || lower.contains("exception")
        || lower.contains("subprocess-exited-with-error")
        || lower.contains("metadata-generation-failed")
        || lower.contains("did not run successfully")
        || lower.contains("exit code")
        || lower.contains("failed")
        || lower.contains("could not ")
        || lower.contains("no matching distribution found")
        || lower.contains("could not find a version")
        || lower.contains("requires python")
        || lower.contains("permission denied")
        || lower.contains("access is denied")
        || lower.contains("winerror")
        || lower.contains("externally-managed-environment")
        || lower.contains("command errored out")
}

fn push_unique_line(lines: &mut Vec<String>, line: &str) {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return;
    }

    if !lines.iter().any(|existing| existing == trimmed) {
        lines.push(trimmed.to_string());
    }
}

fn extract_command_output_summary(combined: &str) -> Option<String> {
    let lines: Vec<&str> = combined
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();

    if lines.is_empty() {
        return None;
    }

    let error_indexes: Vec<usize> = lines
        .iter()
        .enumerate()
        .filter_map(|(index, line)| command_output_line_is_error_signal(line).then_some(index))
        .collect();

    let mut selected = Vec::new();

    if !error_indexes.is_empty() {
        for index in error_indexes.into_iter().take(4) {
            let start = index.saturating_sub(1);
            let end = usize::min(index + 2, lines.len().saturating_sub(1));

            for candidate in &lines[start..=end] {
                if command_output_line_is_noise(candidate)
                    && !command_output_line_is_error_signal(candidate)
                {
                    continue;
                }

                push_unique_line(&mut selected, candidate);
            }
        }
    } else {
        let useful_lines: Vec<&&str> = lines
            .iter()
            .filter(|line| !command_output_line_is_noise(line))
            .collect();

        let start = useful_lines.len().saturating_sub(6);
        for line in &useful_lines[start..] {
            push_unique_line(&mut selected, line);
        }
    }

    if selected.is_empty() {
        None
    } else {
        Some(selected.join("\n"))
    }
}

fn truncate_middle(s: &str, max_len: usize) -> String {
    let trimmed = s.trim();
    let chars: Vec<char> = trimmed.chars().collect();

    if chars.len() <= max_len {
        return trimmed.to_string();
    }

    if max_len <= 20 {
        return chars.into_iter().take(max_len).collect();
    }

    let head_len = max_len / 2;
    let tail_len = max_len.saturating_sub(head_len + 5);
    let head: String = chars[..head_len].iter().collect();
    let tail: String = chars[chars.len() - tail_len..].iter().collect();

    format!("{head}\n...\n{tail}")
}

fn command_output_message(output: &std::process::Output, fallback: &str) -> String {
    let stdout = normalize_command_output_text(&output.stdout);
    let stderr = normalize_command_output_text(&output.stderr);

    let combined = match (stdout.is_empty(), stderr.is_empty()) {
        (true, true) => String::new(),
        (false, true) => stdout,
        (true, false) => stderr,
        (false, false) => format!("{}\n{}", stdout, stderr),
    };

    if combined.is_empty() {
        format!("{} (exit code: {})", fallback, output.status)
    } else if let Some(summary) = extract_command_output_summary(&combined) {
        truncate_middle(&format!("{fallback}\n{summary}"), 1200)
    } else {
        truncate_middle(&format!("{fallback}\n{combined}"), 1200)
    }
}

fn normalize_python_startup_error(python_cmd: &str, message: String) -> String {
    let lower = message.to_ascii_lowercase();
    if lower.contains("did not find executable at") {
        return format!(
            "Selected Python environment is broken (base interpreter missing). Reinstall and try Setup Environment again. Interpreter: {}. Details: {}",
            python_cmd, message
        );
    }
    message
}

fn with_pip_index_hint(message: String, pip_index_url: &str) -> String {
    if !pip_index_url.trim().is_empty() {
        return message;
    }

    let lower = message.to_lowercase();
    if lower.contains("no matching distribution found")
        || lower.contains("could not find a version")
        || lower.contains("temporary failure in name resolution")
        || lower.contains("connection")
        || lower.contains("timed out")
    {
        format!(
            "{}\n\nTip: The Git clone URL only changes how the MinerU repository is downloaded. Python packages are still fetched by pip. If your default package index is slow or unreachable, set a pip index URL in Settings and try again.",
            message
        )
    } else {
        message
    }
}

fn default_models_dir(app_dir: &Path) -> PathBuf {
    crate::app_dirs::mineru_models_dir(app_dir)
}

fn expand_tilde_path(raw: &str) -> Option<PathBuf> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    if !trimmed.starts_with('~') {
        return Some(PathBuf::from(trimmed));
    }

    let home = dirs::home_dir()?;
    if trimmed == "~" {
        return Some(home);
    }

    let suffix = trimmed
        .trim_start_matches('~')
        .trim_start_matches(['/', '\\']);
    Some(home.join(suffix))
}

fn candidate_mineru_json_paths() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join("mineru.json"));
        candidates.push(home.join(".mineru").join("mineru.json"));
    }

    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        let profile = PathBuf::from(user_profile);
        candidates.push(profile.join("mineru.json"));
        candidates.push(profile.join(".mineru").join("mineru.json"));
    }

    let mut seen = std::collections::HashSet::new();
    candidates
        .into_iter()
        .filter(|p| seen.insert(p.clone()))
        .collect()
}

fn collect_model_paths_from_value(
    value: &serde_json::Value,
    current_key: Option<&str>,
    output: &mut Vec<PathBuf>,
) {
    match value {
        serde_json::Value::String(raw) => {
            let Some(path) = expand_tilde_path(raw) else {
                return;
            };

            let key = current_key.unwrap_or_default().to_ascii_lowercase();
            let key_looks_like_model_path = key.contains("model")
                && (key.contains("dir") || key.contains("path") || key.contains("cache"));

            if !key_looks_like_model_path {
                return;
            }

            if path.is_dir() {
                output.push(path);
            } else if path.is_file() {
                if let Some(parent) = path.parent() {
                    output.push(parent.to_path_buf());
                }
            }
        }
        serde_json::Value::Object(map) => {
            for (key, nested) in map {
                collect_model_paths_from_value(nested, Some(key), output);
            }
        }
        serde_json::Value::Array(items) => {
            for nested in items {
                collect_model_paths_from_value(nested, current_key, output);
            }
        }
        _ => {}
    }
}

/// Returns `true` when `mineru.json` already contains at least one `models-dir`
/// entry pointing to a directory that holds recognisable model files.
///
/// When this is true the runtime should be started with
/// `MINERU_MODEL_SOURCE=local` so that MinerU loads the already-downloaded
/// models instead of trying to re-download them via HuggingFace / ModelScope.
fn mineru_json_has_valid_model_paths() -> bool {
    for config_path in candidate_mineru_json_paths() {
        let raw = match std::fs::read_to_string(&config_path) {
            Ok(raw) => raw,
            Err(_) => continue,
        };

        let json: serde_json::Value = match serde_json::from_str(&raw) {
            Ok(json) => json,
            Err(_) => continue,
        };

        let models_dir = json.get("models-dir").and_then(|v| v.as_object());
        let Some(models_dir) = models_dir else {
            continue;
        };

        let all_valid = !models_dir.is_empty()
            && models_dir.values().all(|v| {
                v.as_str()
                    .map(|s| {
                        let p = PathBuf::from(s);
                        p.is_dir() && find_known_model_file(&p).is_some()
                    })
                    .unwrap_or(false)
            });

        if all_valid {
            return true;
        }
    }
    false
}

fn resolve_models_dir_from_mineru_json() -> Option<PathBuf> {
    for config_path in candidate_mineru_json_paths() {
        if !config_path.exists() {
            continue;
        }

        let raw = match std::fs::read_to_string(&config_path) {
            Ok(raw) => raw,
            Err(_) => continue,
        };

        let json = match serde_json::from_str::<serde_json::Value>(&raw) {
            Ok(json) => json,
            Err(_) => continue,
        };

        let mut candidates = Vec::new();
        collect_model_paths_from_value(&json, None, &mut candidates);

        let mut seen = std::collections::HashSet::new();
        let mut deduped: Vec<PathBuf> = candidates
            .into_iter()
            .filter(|path| seen.insert(path.clone()))
            .collect();

        deduped.sort_by_key(|path| {
            if find_known_model_file(path).is_some() {
                0u8
            } else {
                1u8
            }
        });

        if let Some(path) = deduped.into_iter().next() {
            log::info!(
                "Using MinerU local models directory '{}' from {}",
                path.display(),
                config_path.display()
            );
            return Some(path);
        }
    }

    None
}

fn resolve_models_dir(app_dir: &Path, model_source: &str, configured_dir: &str) -> PathBuf {
    if model_source.eq_ignore_ascii_case("local") && !configured_dir.trim().is_empty() {
        PathBuf::from(configured_dir.trim())
    } else if model_source.eq_ignore_ascii_case("local") {
        resolve_models_dir_from_mineru_json().unwrap_or_else(|| default_models_dir(app_dir))
    } else {
        default_models_dir(app_dir)
    }
}

fn candidate_model_dirs(app_dir: &Path, model_source: &str, configured_dir: &str) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let resolved = resolve_models_dir(app_dir, model_source, configured_dir);
    dirs.push(resolved.clone());
    dirs.push(resolved.join("hub"));

    let mut seen = std::collections::HashSet::new();
    dirs.into_iter()
        .filter(|dir| seen.insert(dir.clone()))
        .collect()
}

fn is_known_model_file(path: &Path) -> bool {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_ascii_lowercase());

    let Some(file_name) = file_name else {
        return false;
    };

    if KNOWN_MODEL_FILENAMES
        .iter()
        .any(|known| *known == file_name)
    {
        return true;
    }

    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .map(|ext| KNOWN_MODEL_EXTENSIONS.iter().any(|known| *known == ext))
        .unwrap_or(false)
}

fn find_known_model_file(root: &Path) -> Option<PathBuf> {
    if !root.exists() {
        return None;
    }

    let mut visited_entries = 0usize;
    let mut stack = vec![(root.to_path_buf(), 0usize)];

    while let Some((dir, depth)) = stack.pop() {
        let Ok(read_dir) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in read_dir.flatten() {
            visited_entries += 1;
            if visited_entries > MODEL_SCAN_MAX_ENTRIES {
                return None;
            }

            let path = entry.path();
            if path.is_file() && is_known_model_file(&path) {
                return Some(path);
            }

            if path.is_dir() && depth < MODEL_SCAN_MAX_DEPTH {
                stack.push((path, depth + 1));
            }
        }
    }

    None
}

pub(crate) fn refresh_model_download_status(
    model_manager: &MinerUModelManager,
    settings: &crate::settings::SettingsManager,
    app_dir: &Path,
) {
    let is_downloading = model_manager
        .status
        .lock()
        .map(|status| status.as_str() == "downloading")
        .unwrap_or(false);

    if is_downloading {
        return;
    }

    let configured_dir = get_setting_value(settings, "mineru.models_dir").unwrap_or_default();
    let model_source = get_setting_value(settings, "mineru.model_source")
        .unwrap_or_else(|| "huggingface".to_string());

    for candidate_dir in candidate_model_dirs(app_dir, &model_source, &configured_dir) {
        if let Some(found_path) = find_known_model_file(&candidate_dir) {
            let message = format!(
                "Detected existing model files in '{}'",
                found_path.parent().unwrap_or(&candidate_dir).display()
            );
            model_manager.set_status("completed", &message);
            return;
        }
    }

    model_manager.set_status("idle", "No known MinerU model files were detected.");
}

fn pip_packages_for_module(module_name: &str) -> Vec<String> {
    match module_name {
        "albumentations" => vec![
            "albumentations".to_string(),
            "opencv-python-headless".to_string(),
        ],
        _ => vec![module_name.to_string()],
    }
}

fn python_has_module(python_cmd: &str, module_name: &str) -> bool {
    let script = format!("import {module_name}");

    let mut cmd = std::process::Command::new(python_cmd);
    cmd.args(["-c", &script])
        .stderr(std::process::Stdio::null());
    hide_console_window!(cmd);
    cmd.status().map(|status| status.success()).unwrap_or(false)
}

fn missing_python_modules(python_cmd: &str, module_names: &[&str]) -> Vec<String> {
    module_names
        .iter()
        .filter(|module_name| !python_has_module(python_cmd, module_name))
        .map(|module_name| (*module_name).to_string())
        .collect()
}

fn required_mineru_modules_ready(python_cmd: &str) -> Result<(), String> {
    let missing = missing_python_modules(python_cmd, REQUIRED_MINERU_MODULES);
    if missing.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "The MinerU runtime is missing required Python modules: {}",
            missing.join(", ")
        ))
    }
}

async fn install_missing_mineru_modules_in_venv(
    app_dir: &Path,
    python_cmd: &str,
    pip_index_url: &str,
    missing_modules: &[String],
) -> Result<(), String> {
    if missing_modules.is_empty() {
        return Ok(());
    }

    let mut install_args = vec![
        "-m".to_string(),
        "pip".to_string(),
        "install".to_string(),
        "--force-reinstall".to_string(),
    ];
    install_args.extend(build_pip_index_args(pip_index_url));

    for module in missing_modules {
        install_args.extend(pip_packages_for_module(module));
    }

    let mut install_command = Command::new(python_cmd);
    install_command.args(&install_args);
    configure_pip_command(&mut install_command, app_dir)?;
    hide_console_window!(install_command);
    let output = install_command
        .output()
        .await
        .map_err(|e| format!("Failed to run pip in the MinerU virtual environment: {}", e))?;

    if !output.status.success() {
        return Err(with_pip_index_hint(
            command_output_message(
                &output,
                "Failed to install missing MinerU runtime dependencies",
            ),
            pip_index_url,
        ));
    }

    Ok(())
}

async fn upgrade_to_cuda_torch_if_needed(
    app_dir: &Path,
    python_cmd: &str,
    pip_index_url: &str,
) -> bool {
    if !has_nvidia_gpu() || !torch_is_cpu_only(python_cmd) {
        return false;
    }

    log::info!("NVIDIA GPU detected; upgrading PyTorch to CUDA build...");

    let cuda_args = vec![
        "-m".to_string(),
        "pip".to_string(),
        "install".to_string(),
        "--force-reinstall".to_string(),
        "--index-url".to_string(),
        PYTORCH_CUDA_INDEX_URL.to_string(),
        "--extra-index-url".to_string(),
        pip_index_url.to_string(),
        "torch".to_string(),
        "torchvision".to_string(),
    ];

    let mut cmd = Command::new(python_cmd);
    cmd.args(&cuda_args);
    if let Err(error) = configure_pip_command(&mut cmd, app_dir) {
        log::warn!(
            "Could not configure managed cache directories for CUDA PyTorch install: {}",
            error
        );
        return true;
    }
    hide_console_window!(cmd);

    match cmd.output().await {
        Ok(o) if o.status.success() => {
            log::info!("Successfully installed CUDA-enabled PyTorch.");
            true
        }
        Ok(o) => {
            log::warn!(
                "CUDA PyTorch install failed (MinerU will use CPU mode): {}",
                command_output_message(&o, "pip install torch CUDA")
            );
            true
        }
        Err(e) => {
            log::warn!(
                "Could not run CUDA PyTorch install (MinerU will use CPU mode): {}",
                e
            );
            true
        }
    }
}

fn check_python_version(python_cmd: &str) -> Result<String, String> {
    let mut cmd = std::process::Command::new(python_cmd);
    cmd.args([
        "-c",
        "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')",
    ]);
    hide_console_window!(cmd);
    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run Python: {}", e))?;

    if !output.status.success() {
        return Err(normalize_python_startup_error(
            python_cmd,
            command_output_message(&output, "Failed to detect Python version"),
        ));
    }

    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parts = version
        .split('.')
        .map(str::parse::<u32>)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| format!("Failed to parse Python version from '{}'", version))?;

    let major = *parts
        .first()
        .ok_or_else(|| format!("Failed to parse Python version from '{}'", version))?;
    let minor = *parts
        .get(1)
        .ok_or_else(|| format!("Failed to parse Python version from '{}'", version))?;

    let supported_range = if cfg!(windows) { 10..=12 } else { 10..=13 };

    if major != 3 || !supported_range.contains(&minor) {
        return Err(format!(
            "MinerU requires Python 3.10-{} on this platform, but '{}' resolved to Python {}.",
            if cfg!(windows) { 12 } else { 13 },
            python_cmd,
            version
        ));
    }

    Ok(version)
}

#[tauri::command]
pub fn get_app_setting(state: State<AppState>, key: String) -> Result<Option<String>, String> {
    Ok(state.settings.get(&key))
}

#[tauri::command]
pub fn set_app_setting(state: State<AppState>, key: String, value: String) -> Result<(), String> {
    state.settings.set(key.clone(), value.clone())?;
    crate::runtime_logs::handle_setting_change(&key, &value);
    Ok(())
}

#[tauri::command]
pub fn get_all_app_settings(state: State<AppState>) -> Result<Vec<AppSettingRow>, String> {
    let mut rows = Vec::new();
    for (key, value) in state.settings.get_all() {
        rows.push(AppSettingRow { key, value });
    }
    rows.sort_by(|a, b| a.key.cmp(&b.key));
    Ok(rows)
}

pub async fn start_mineru_with_state(state: &AppState) -> Result<u16, String> {
    let app_dir = state.app_dir.clone();
    let venv_dir = crate::app_dirs::mineru_venv_dir(&app_dir);

    let (python_path, port_str, use_venv, model_source, models_dir_raw, pip_index_url) = {
        let settings = &state.settings;

        let use_venv_str =
            get_setting_value(settings, "mineru.use_venv").unwrap_or_else(|| "false".to_string());
        let use_venv = use_venv_str == "true";

        let python_path = if use_venv {
            let venv_python = venv_python_path(&venv_dir);
            if venv_python.exists() {
                venv_python.to_str().unwrap().to_string()
            } else {
                return Err(
                    "Virtual environment not found. Please run Setup Environment first."
                        .to_string(),
                );
            }
        } else {
            get_setting_value(settings, "mineru.python_path").unwrap_or_else(|| {
                if cfg!(windows) {
                    "python".to_string()
                } else {
                    "python3".to_string()
                }
            })
        };

        let port_str =
            get_setting_value(settings, "mineru.port").unwrap_or_else(|| "8765".to_string());
        let model_source = get_setting_value(settings, "mineru.model_source")
            .unwrap_or_else(|| "huggingface".to_string());
        let models_dir_raw = get_setting_value(settings, "mineru.models_dir").unwrap_or_default();
        let pip_index_url = normalize_setting_or_default(
            get_setting_value(settings, "mineru.pip_index_url"),
            DEFAULT_PIP_INDEX_URL,
        );

        (
            python_path,
            port_str,
            use_venv,
            model_source,
            models_dir_raw,
            pip_index_url,
        )
    };

    let models_dir = resolve_models_dir(&app_dir, &model_source, &models_dir_raw)
        .to_str()
        .unwrap_or_default()
        .to_string();

    if model_source.eq_ignore_ascii_case("local") {
        let has_local_models = candidate_model_dirs(&app_dir, &model_source, &models_dir_raw)
            .iter()
            .any(|dir| find_known_model_file(dir).is_some());

        if !has_local_models {
            return Err(format!(
                "Local model mode is enabled, but no model files were detected under '{}'. Run mineru-models-download first, or set mineru.models_dir to your existing model directory.",
                models_dir
            ));
        }
    }

    let port: u16 = port_str
        .parse()
        .map_err(|_| "Invalid port number".to_string())?;

    check_python_version(&python_path)
        .map_err(|e| format!("Selected Python environment cannot start: {}", e))?;

    if !python_has_module(&python_path, "mineru") {
        return Err("MinerU is not installed in the selected Python environment.".to_string());
    }

    let missing_modules = missing_python_modules(&python_path, REQUIRED_MINERU_MODULES);
    if !missing_modules.is_empty() {
        if use_venv {
            log::warn!(
                "MinerU virtual environment is missing runtime modules: {}. Attempting auto-repair.",
                missing_modules.join(", ")
            );
            install_missing_mineru_modules_in_venv(
                &app_dir,
                &python_path,
                &pip_index_url,
                &missing_modules,
            )
            .await
            .map_err(|error| format!("{}", error))?;

            required_mineru_modules_ready(&python_path).map_err(|error| format!("{}", error))?;
        } else {
            return Err(format!(
                "The MinerU runtime is missing required Python modules: {}. Install the missing modules into the configured Python environment before starting MinerU.",
                missing_modules.join(", ")
            ));
        }
    }

    if use_venv {
        upgrade_to_cuda_torch_if_needed(&app_dir, &python_path, &pip_index_url).await;
    }

    let venv_path = if use_venv {
        Some(venv_dir.as_path())
    } else {
        None
    };

    state
        .mineru_manager
        .start(
            &app_dir,
            &python_path,
            port,
            use_venv,
            venv_path,
            &model_source,
            &models_dir,
        )
        .await
}

#[tauri::command]
pub async fn start_mineru(app: AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    let _ = app;
    let actual_port = start_mineru_with_state(state.inner()).await?;

    Ok(format!("MinerU started on port {}", actual_port))
}

#[tauri::command]
pub fn stop_mineru(state: State<AppState>) -> Result<(), String> {
    state.mineru_manager.stop()
}

#[tauri::command]
pub fn get_mineru_status(state: State<AppState>) -> Result<MinerUStatusResponse, String> {
    state.mineru_manager.get_status()
}

#[tauri::command]
pub async fn setup_mineru_venv(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    if let Ok(status) = state.venv_manager.status.lock() {
        if *status == "creating" {
            return Err("Setup already in progress".to_string());
        }
    }

    let mineru_status = state.mineru_manager.get_status()?;
    if matches!(mineru_status.status.as_str(), "running" | "starting") {
        return Err("Stop MinerU before setting up or reinstalling the environment.".to_string());
    }

    let app_dir = crate::app_dirs::runtime_app_dir(&app)?;
    let venv_dir = crate::app_dirs::mineru_venv_dir(&app_dir);
    let repo_dir = crate::app_dirs::mineru_repo_dir(&app_dir);

    let (system_python, clone_url, pip_index_url, install_method) = {
        let settings = &state.settings;
        let python = get_setting_value(settings, "mineru.python_path").unwrap_or_else(|| {
            if cfg!(windows) {
                "python".to_string()
            } else {
                "python3".to_string()
            }
        });
        let url = normalize_setting_or_default(
            get_setting_value(settings, "mineru.clone_url"),
            DEFAULT_MINERU_CLONE_URL,
        );
        let pip_index_url = normalize_setting_or_default(
            get_setting_value(settings, "mineru.pip_index_url"),
            DEFAULT_PIP_INDEX_URL,
        );
        let install_method = get_setting_value(settings, "mineru.install_method")
            .unwrap_or_else(|| "pip".to_string());
        (python, url, pip_index_url, install_method)
    };

    state
        .venv_manager
        .set_status("creating", "Creating virtual environment...");

    let venv_manager = std::sync::Arc::clone(&state.venv_manager);

    tauri::async_runtime::spawn(async move {
        venv_manager.set_status("creating", "Checking Python version...");
        let python_version = match check_python_version(&system_python) {
            Ok(version) => version,
            Err(e) => {
                venv_manager.set_status("failed", &e);
                return;
            }
        };

        if venv_dir.exists() {
            venv_manager.set_status("creating", "Removing previous virtual environment...");
            kill_lingering_processes_in_venv(&venv_dir);
            if let Err(e) = remove_dir_all_with_retries(&venv_dir) {
                venv_manager.set_status(
                    "failed",
                    &format!("Failed to remove previous virtual environment: {}", e),
                );
                return;
            }
        }

        venv_manager.set_status(
            "creating",
            &format!("Creating venv with Python {}...", python_version),
        );
        let venv_dir_str = venv_dir.to_str().unwrap_or_default().to_string();
        let mut venv_cmd = Command::new(&system_python);
        venv_cmd.args(["-m", "venv", &venv_dir_str]);
        if let Err(e) = apply_managed_cache_env(&mut venv_cmd, &app_dir) {
            venv_manager.set_status("failed", &e);
            return;
        }
        hide_console_window!(venv_cmd);
        let output = venv_cmd.output().await;

        match output {
            Ok(o) if !o.status.success() => {
                let msg = command_output_message(&o, "Failed to create the virtual environment");
                venv_manager.set_status("failed", &msg);
                return;
            }
            Err(e) => {
                venv_manager.set_status("failed", &format!("Failed to run Python: {}", e));
                return;
            }
            _ => {}
        }

        if install_method == "git" {
            let repo_dir_str = repo_dir.to_str().unwrap_or_default().to_string();
            if repo_dir.join(".git").exists() {
                venv_manager.set_status("creating", "Updating MinerU repository (git pull)...");
                let mut git_cmd = Command::new("git");
                git_cmd.args(["pull", "--ff-only"]).current_dir(&repo_dir);
                hide_console_window!(git_cmd);
                let output = git_cmd.output().await;
                if let Ok(o) = &output {
                    if !o.status.success() {
                        log::warn!(
                            "git pull warning: {}",
                            command_output_message(o, "git pull failed")
                        );
                    }
                }
            } else {
                venv_manager.set_status("creating", "Cloning MinerU repository...");
                if repo_dir.exists() {
                    let _ = std::fs::remove_dir_all(&repo_dir);
                }
                let mut git_cmd = Command::new("git");
                git_cmd.args(["clone", "--depth", "1", &clone_url, &repo_dir_str]);
                hide_console_window!(git_cmd);
                let output = git_cmd.output().await;

                match output {
                    Ok(o) if !o.status.success() => {
                        let msg =
                            command_output_message(&o, "Failed to clone the MinerU repository");
                        venv_manager.set_status("failed", &msg);
                        return;
                    }
                    Err(e) => {
                        venv_manager.set_status("failed", &format!("Failed to run git: {}", e));
                        return;
                    }
                    _ => {}
                }
            }
        }

        let venv_python = venv_python_path(&venv_dir);
        let venv_python_str = venv_python.to_str().unwrap_or_default().to_string();

        venv_manager.set_status("creating", "Preparing Python build tools...");

        let mut build_tool_args = vec![
            "-m".to_string(),
            "pip".to_string(),
            "install".to_string(),
            "--upgrade".to_string(),
        ];
        build_tool_args.extend(build_pip_index_args(&pip_index_url));
        build_tool_args.extend([
            "pip".to_string(),
            "setuptools".to_string(),
            "wheel".to_string(),
        ]);

        let mut build_tool_command = Command::new(&venv_python_str);
        build_tool_command.args(&build_tool_args);
        if let Err(e) = configure_pip_command(&mut build_tool_command, &app_dir) {
            venv_manager.set_status("failed", &e);
            return;
        }
        hide_console_window!(build_tool_command);
        let output = build_tool_command.output().await;

        match output {
            Ok(o) if !o.status.success() => {
                if !(python_has_module(&venv_python_str, "pip")
                    && python_has_module(&venv_python_str, "setuptools"))
                {
                    let msg = with_pip_index_hint(
                        command_output_message(&o, "Failed to prepare Python build tools"),
                        &pip_index_url,
                    );
                    venv_manager.set_status("failed", &msg);
                    return;
                }

                log::warn!(
                    "pip/setuptools bootstrap warning: {}",
                    command_output_message(&o, "Failed to prepare Python build tools")
                );
            }
            Err(e) => {
                if !(python_has_module(&venv_python_str, "pip")
                    && python_has_module(&venv_python_str, "setuptools"))
                {
                    venv_manager.set_status(
                        "failed",
                        &format!("Failed to run pip bootstrap step: {}", e),
                    );
                    return;
                }

                log::warn!("pip/setuptools bootstrap spawn warning: {}", e);
            }
            Ok(_) => {}
        }

        venv_manager.set_status(
            "creating",
            "Installing MinerU (this may take several minutes)...",
        );

        let mut install_args = vec!["-m".to_string(), "pip".to_string(), "install".to_string()];

        if install_method == "git" {
            install_args.push("--no-build-isolation".to_string());
            install_args.extend(build_pip_index_args(&pip_index_url));
            install_args.push(".[all]".to_string());

            let mut install_command = Command::new(&venv_python_str);
            install_command.args(&install_args).current_dir(&repo_dir);
            if let Err(e) = configure_pip_command(&mut install_command, &app_dir) {
                venv_manager.set_status("failed", &e);
                return;
            }
            hide_console_window!(install_command);
            let output = install_command.output().await;

            match output {
                Ok(o) if !o.status.success() => {
                    let msg = with_pip_index_hint(
                        command_output_message(&o, "MinerU install failed"),
                        &pip_index_url,
                    );
                    venv_manager.set_status("failed", &msg);
                    return;
                }
                Err(e) => {
                    venv_manager.set_status("failed", &format!("Failed to run pip: {}", e));
                    return;
                }
                Ok(_) => {}
            }
        } else {
            install_args.extend(build_pip_index_args(&pip_index_url));
            install_args.push("mineru[all]".to_string());

            let mut install_command = Command::new(&venv_python_str);
            install_command.args(&install_args);
            if let Err(e) = configure_pip_command(&mut install_command, &app_dir) {
                venv_manager.set_status("failed", &e);
                return;
            }
            hide_console_window!(install_command);
            let output = install_command.output().await;

            match output {
                Ok(o) if !o.status.success() => {
                    let msg = with_pip_index_hint(
                        command_output_message(&o, "MinerU install failed"),
                        &pip_index_url,
                    );
                    venv_manager.set_status("failed", &msg);
                    return;
                }
                Err(e) => {
                    venv_manager.set_status("failed", &format!("Failed to run pip: {}", e));
                    return;
                }
                Ok(_) => {}
            }
        }

        if has_nvidia_gpu() && torch_is_cpu_only(&venv_python_str) {
            venv_manager.set_status(
                "creating",
                "Detected NVIDIA GPU. Installing CUDA-enabled PyTorch (this may take several minutes)...",
            );
            upgrade_to_cuda_torch_if_needed(&app_dir, &venv_python_str, &pip_index_url).await;
        }

        let missing_modules = missing_python_modules(&venv_python_str, REQUIRED_MINERU_MODULES);
        if !missing_modules.is_empty() {
            venv_manager.set_status(
                "creating",
                "Installing missing MinerU runtime dependencies...",
            );
            let mut repair_args = vec![
                "-m".to_string(),
                "pip".to_string(),
                "install".to_string(),
                "--force-reinstall".to_string(),
            ];
            repair_args.extend(build_pip_index_args(&pip_index_url));
            for module in &missing_modules {
                repair_args.extend(pip_packages_for_module(module));
            }

            let mut repair_command = Command::new(&venv_python_str);
            repair_command.args(&repair_args);
            if let Err(e) = configure_pip_command(&mut repair_command, &app_dir) {
                venv_manager.set_status("failed", &e);
                return;
            }
            hide_console_window!(repair_command);
            let output = repair_command.output().await;

            match output {
                Ok(o) if !o.status.success() => {
                    let msg = with_pip_index_hint(
                        command_output_message(
                            &o,
                            "Failed to install missing MinerU runtime dependencies",
                        ),
                        &pip_index_url,
                    );
                    venv_manager.set_status("failed", &msg);
                    return;
                }
                Err(e) => {
                    venv_manager.set_status(
                        "failed",
                        &format!(
                            "Failed to run pip for MinerU runtime dependency repair: {}",
                            e
                        ),
                    );
                    return;
                }
                Ok(_) => {}
            }
        }

        if python_has_module(&venv_python_str, "mineru")
            && missing_python_modules(&venv_python_str, REQUIRED_MINERU_MODULES).is_empty()
        {
            venv_manager.set_status("ready", "Environment is ready. Download models to proceed.");
        } else {
            venv_manager.set_status(
                "failed",
                "Virtual environment was created, but MinerU could not be imported afterwards. Please run Setup Environment again.",
            );
        }
    });

    Ok(())
}

#[tauri::command]
pub fn get_venv_status(state: State<AppState>) -> Result<VenvStatusResponse, String> {
    state.venv_manager.get_status()
}

#[tauri::command]
pub fn check_venv_exists(app: AppHandle, state: State<AppState>) -> Result<bool, String> {
    let app_dir = crate::app_dirs::runtime_app_dir(&app)?;
    let venv_dir = crate::app_dirs::mineru_venv_dir(&app_dir);
    let python_exe = venv_python_path(&venv_dir);
    let exists = python_exe.exists();
    if exists {
        let python_cmd = python_exe.to_string_lossy().to_string();
        if let Err(error) = check_python_version(&python_cmd) {
            state.venv_manager.set_status(
                "failed",
                &format!("Venv exists but Python cannot start: {}", error),
            );
            return Ok(false);
        }

        if !python_has_module(&python_cmd, "mineru") {
            state.venv_manager.set_status(
                "failed",
                "Venv exists but MinerU is not installed. Run Setup Environment to repair.",
            );
            return Ok(false);
        }

        let missing_runtime_modules = missing_python_modules(&python_cmd, REQUIRED_MINERU_MODULES);
        if missing_runtime_modules.is_empty() {
            state
                .venv_manager
                .set_status("ready", "Environment is ready");
        } else {
            state.venv_manager.set_status(
                "ready",
                &format!(
                    "Venv ready. Missing modules: {}; will repair on startup.",
                    missing_runtime_modules.join(", ")
                ),
            );
        }

        return Ok(true);
    }
    state.venv_manager.set_status("not_created", "");
    Ok(exists)
}

fn parse_percentage_from_line(line: &str) -> Option<f64> {
    let mut last_pct: Option<f64> = None;
    for (i, _) in line.match_indices('%') {
        let before = &line[..i];
        let num_str: String = before
            .chars()
            .rev()
            .take_while(|c| c.is_ascii_digit() || *c == '.')
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        if let Ok(v) = num_str.parse::<f64>() {
            if (0.0..=100.0).contains(&v) {
                last_pct = Some(v);
            }
        }
    }
    last_pct
}

fn clean_terminal_output(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\x1b' {
            if chars.peek() == Some(&'[') {
                chars.next();
                while let Some(&c) = chars.peek() {
                    chars.next();
                    if c.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        if ch.is_ascii() || ch >= '\u{4E00}' {
            out.push(ch);
        }
    }
    out = out.replace("| |", " ").replace("||", " ");
    out
}

async fn read_download_progress<R: tokio::io::AsyncRead + Unpin>(
    mut stream: R,
    model_manager: &MinerUModelManager,
) {
    let mut buf = [0u8; 4096];
    let mut line_buf = String::new();
    let mut utf8_remainder = Vec::new();

    loop {
        match stream.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => {
                let data = if utf8_remainder.is_empty() {
                    &buf[..n]
                } else {
                    utf8_remainder.extend_from_slice(&buf[..n]);
                    utf8_remainder.as_slice()
                };

                let (valid, remainder) = match std::str::from_utf8(data) {
                    Ok(s) => (s.to_string(), Vec::new()),
                    Err(e) => {
                        let valid_up_to = e.valid_up_to();
                        let valid_str = String::from_utf8_lossy(&data[..valid_up_to]).to_string();
                        let leftover = data[valid_up_to..].to_vec();
                        (valid_str, leftover)
                    }
                };
                utf8_remainder = remainder;

                for ch in valid.chars() {
                    if ch == '\n' || ch == '\r' {
                        if !line_buf.is_empty() {
                            let cleaned = clean_terminal_output(line_buf.trim());
                            if !cleaned.is_empty() {
                                log::debug!("mineru-models-download output: {}", cleaned);
                                model_manager.append_output(&cleaned);
                                if let Some(pct) = parse_percentage_from_line(&cleaned) {
                                    model_manager.set_progress(pct, &cleaned);
                                } else {
                                    if let Ok(mut m) = model_manager.message.lock() {
                                        *m = truncate_tail(&cleaned, 300);
                                    }
                                }
                            }
                            line_buf.clear();
                        }
                    } else {
                        line_buf.push(ch);
                    }
                }
            }
            Err(_) => break,
        }
    }

    let cleaned = clean_terminal_output(line_buf.trim());
    if !cleaned.is_empty() {
        if let Some(pct) = parse_percentage_from_line(&cleaned) {
            model_manager.set_progress(pct, &cleaned);
        }
    }
}

#[tauri::command]
pub async fn download_mineru_models(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if let Ok(status) = state.model_manager.status.lock() {
        if *status == "downloading" {
            return Err("Model download already in progress".to_string());
        }
    }

    let app_dir = crate::app_dirs::runtime_app_dir(&app)?;
    let venv_dir = crate::app_dirs::mineru_venv_dir(&app_dir);

    let (use_venv, model_source, parse_backend) = {
        let use_venv = get_setting_value(&state.settings, "mineru.use_venv")
            .unwrap_or_else(|| "false".to_string());
        let model_source = get_setting_value(&state.settings, "mineru.model_source")
            .unwrap_or_else(|| "huggingface".to_string());
        let parse_backend = get_setting_value(&state.settings, "mineru.parse_backend")
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "vlm".to_string());
        (use_venv == "true", model_source, parse_backend)
    };

    let models_dir = {
        let dir = get_setting_value(&state.settings, "mineru.models_dir").unwrap_or_default();
        resolve_models_dir(&app_dir, &model_source, &dir)
            .to_str()
            .unwrap_or_default()
            .to_string()
    };

    let download_bin = if use_venv {
        let bin = venv_script_path(&venv_dir, "mineru-models-download");
        if !bin.exists() {
            return Err(
                "mineru-models-download not found in virtual environment. Run Setup Environment first."
                    .to_string(),
            );
        }
        bin.to_str().unwrap().to_string()
    } else {
        "mineru-models-download".to_string()
    };

    state
        .model_manager
        .set_status("downloading", "Starting model download...");

    let model_manager = std::sync::Arc::clone(&state.model_manager);

    tauri::async_runtime::spawn(async move {
        let models_path = std::path::Path::new(&models_dir);
        if !models_path.exists() {
            if let Err(e) = std::fs::create_dir_all(models_path) {
                model_manager.set_status(
                    "failed",
                    &format!("Failed to create models directory '{}': {}", models_dir, e),
                );
                return;
            }
        }

        model_manager.set_status(
            "downloading",
            "Downloading model files (this may take a long time)...",
        );

        log::info!(
            "Running model download: {} (model_source={}, models_dir={})",
            download_bin,
            model_source,
            models_dir
        );

        let mut command = Command::new(&download_bin);

        let effective_source = if model_source == "local" || model_source.is_empty() {
            "huggingface"
        } else {
            &model_source
        };
        // hybrid-auto-engine (triggered by parse_backend="vlm") needs both VLM and Pipeline models
        let model_type = if parse_backend == "vlm" || parse_backend == "auto" {
            "all"
        } else if parse_backend == "pipeline" {
            "pipeline"
        } else {
            "all" // safe default: download both model types
        };
        command.args(["--source", effective_source, "--model_type", model_type]);

        if model_source != "huggingface" {
            command.env("MINERU_MODEL_SOURCE", &model_source);
        }
        command.env("HF_HOME", &models_dir);
        command.env("MODELSCOPE_CACHE", &models_dir);

        command.env("HF_HUB_DISABLE_SYMLINKS_WARNING", "1");
        if let Err(error) = apply_managed_cache_env(&mut command, &app_dir) {
            model_manager.set_status("failed", &error);
            return;
        }

        command.stdin(std::process::Stdio::null());
        command
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        hide_console_window!(command);

        match command.spawn() {
            Ok(mut child) => {
                let mm_stderr = std::sync::Arc::clone(&model_manager);
                let stderr_handle = if let Some(stderr) = child.stderr.take() {
                    Some(tauri::async_runtime::spawn(async move {
                        read_download_progress(stderr, &mm_stderr).await;
                    }))
                } else {
                    None
                };

                let mm_stdout = std::sync::Arc::clone(&model_manager);
                let stdout_handle = if let Some(stdout) = child.stdout.take() {
                    Some(tauri::async_runtime::spawn(async move {
                        read_download_progress(stdout, &mm_stdout).await;
                    }))
                } else {
                    None
                };

                let status = child.wait().await;

                if let Some(h) = stderr_handle {
                    let _ = h.await;
                }
                if let Some(h) = stdout_handle {
                    let _ = h.await;
                }

                let output_tail = model_manager.get_output_tail();

                match status {
                    Ok(exit) if exit.success() => {
                        log::info!("Model download completed successfully");
                        model_manager.set_status("completed", "Models downloaded successfully");
                    }
                    Ok(exit) => {
                        let code = exit.code().unwrap_or(-1);
                        let msg = if output_tail.is_empty() {
                            format!("Model download failed (exit code: {})", code)
                        } else {
                            log::error!("mineru-models-download output:\n{}", output_tail);
                            truncate_tail(&output_tail, 1200)
                        };
                        model_manager.set_status("failed", &msg);
                    }
                    Err(e) => {
                        log::error!("Model download error: {}", e);
                        model_manager.set_status("failed", &format!("Model download error: {}", e));
                    }
                }
            }
            Err(e) => {
                log::error!("Failed to spawn mineru-models-download: {}", e);
                model_manager.set_status(
                    "failed",
                    &format!("Failed to run mineru-models-download: {}", e),
                );
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn get_model_download_status(
    app: AppHandle,
    state: State<AppState>,
) -> Result<ModelDownloadStatusResponse, String> {
    let app_dir = crate::app_dirs::runtime_app_dir(&app)?;
    refresh_model_download_status(&state.model_manager, &state.settings, &app_dir);
    state.model_manager.get_status()
}

fn truncate_tail(s: &str, max_len: usize) -> String {
    let trimmed = s.trim();
    let chars: Vec<char> = trimmed.chars().collect();
    if chars.len() > max_len {
        chars[chars.len() - max_len..].iter().collect()
    } else {
        trimmed.to_string()
    }
}
