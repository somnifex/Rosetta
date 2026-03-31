use chrono::Utc;
use log::{Level, LevelFilter, Log, Metadata, Record};
use rusqlite::Connection;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Mutex;

struct LoggerSink {
    log_dir: PathBuf,
}

pub struct RuntimeLogger {
    level: AtomicU8,
    sink: Mutex<Option<LoggerSink>>,
}

impl RuntimeLogger {
    const fn new() -> Self {
        Self {
            // default info
            level: AtomicU8::new(level_filter_to_u8(LevelFilter::Info)),
            sink: Mutex::new(None),
        }
    }

    fn set_level_filter(&self, filter: LevelFilter) {
        self.level
            .store(level_filter_to_u8(filter), Ordering::Relaxed);
    }

    fn current_level_filter(&self) -> LevelFilter {
        u8_to_level_filter(self.level.load(Ordering::Relaxed))
    }
}

impl Log for RuntimeLogger {
    fn enabled(&self, metadata: &Metadata<'_>) -> bool {
        level_enabled(metadata.level(), self.current_level_filter())
    }

    fn log(&self, record: &Record<'_>) {
        if !self.enabled(record.metadata()) {
            return;
        }

        let level = level_to_db_value(record.level()).to_string();
        let message = record.args().to_string();
        let target = record.target().to_string();
        let context = serde_json::json!({
            "target": target,
            "module": record.module_path(),
            "file": record.file(),
            "line": record.line(),
        })
        .to_string();

        let sink_path = self
            .sink
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().map(|sink| sink.log_dir.clone()));

        if let Some(log_dir) = sink_path {
            if let Err(err) = write_log_entry(&log_dir, &level, &message, Some(&context)) {
                eprintln!("Failed to persist runtime log entry: {err}");
            }
        }
    }

    fn flush(&self) {}
}

static LOGGER: RuntimeLogger = RuntimeLogger::new();
static LOG_IO_MUTEX: Mutex<()> = Mutex::new(());

const fn level_filter_to_u8(filter: LevelFilter) -> u8 {
    match filter {
        LevelFilter::Off => 0,
        LevelFilter::Error => 1,
        LevelFilter::Warn => 2,
        LevelFilter::Info => 3,
        LevelFilter::Debug => 4,
        LevelFilter::Trace => 5,
    }
}

const fn u8_to_level_filter(value: u8) -> LevelFilter {
    match value {
        0 => LevelFilter::Off,
        1 => LevelFilter::Error,
        2 => LevelFilter::Warn,
        3 => LevelFilter::Info,
        4 => LevelFilter::Debug,
        _ => LevelFilter::Trace,
    }
}

fn normalize_level_filter(level: &str) -> Option<LevelFilter> {
    match level.trim().to_lowercase().as_str() {
        "error" => Some(LevelFilter::Error),
        "warn" | "warning" => Some(LevelFilter::Warn),
        "info" => Some(LevelFilter::Info),
        "debug" => Some(LevelFilter::Debug),
        // Keep trace internal; UI does not expose it.
        "trace" => Some(LevelFilter::Trace),
        _ => None,
    }
}

fn level_to_db_value(level: Level) -> &'static str {
    match level {
        Level::Error => "error",
        Level::Warn => "warn",
        Level::Info => "info",
        Level::Debug | Level::Trace => "debug",
    }
}

fn level_enabled(level: Level, filter: LevelFilter) -> bool {
    match filter {
        LevelFilter::Off => false,
        LevelFilter::Error => level <= Level::Error,
        LevelFilter::Warn => level <= Level::Warn,
        LevelFilter::Info => level <= Level::Info,
        LevelFilter::Debug | LevelFilter::Trace => true,
    }
}

fn parse_log_file_index(name: &str) -> Option<u32> {
    if name == "app.log" {
        return Some(0);
    }

    name.strip_prefix("app.log.")?.parse::<u32>().ok()
}

fn list_log_files_with_index(log_dir: &Path) -> Result<Vec<(u32, PathBuf)>, String> {
    if !log_dir.exists() {
        return Ok(Vec::new());
    }

    let mut files = Vec::new();
    for entry in fs::read_dir(log_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.path().is_file() {
            continue;
        }

        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();
        if let Some(index) = parse_log_file_index(&file_name) {
            files.push((index, entry.path()));
        }
    }

    files.sort_by_key(|(index, _)| *index);
    Ok(files)
}

pub fn list_log_files(log_dir: &Path) -> Result<Vec<PathBuf>, String> {
    Ok(list_log_files_with_index(log_dir)?
        .into_iter()
        .map(|(_, path)| path)
        .collect())
}

pub fn with_log_io_lock<T, F>(operation: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String>,
{
    let _guard = LOG_IO_MUTEX
        .lock()
        .map_err(|e| format!("Failed to acquire runtime log I/O lock: {e}"))?;
    operation()
}

fn rotate_if_needed(log_file: &Path) -> Result<(), String> {
    const MAX_SIZE_BYTES: u64 = 5 * 1024 * 1024;
    if !log_file.exists() {
        return Ok(());
    }

    let meta = fs::metadata(log_file).map_err(|e| e.to_string())?;
    if meta.len() < MAX_SIZE_BYTES {
        return Ok(());
    }

    let log_dir = log_file
        .parent()
        .ok_or_else(|| "Runtime log file has no parent directory".to_string())?;

    let mut archived = list_log_files_with_index(log_dir)?
        .into_iter()
        .filter(|(index, _)| *index > 0)
        .collect::<Vec<_>>();
    archived.sort_by(|a, b| b.0.cmp(&a.0));

    for (index, path) in archived {
        let target = log_dir.join(format!("app.log.{}", index + 1));
        fs::rename(path, target).map_err(|e| e.to_string())?;
    }

    fs::rename(log_file, log_dir.join("app.log.1")).map_err(|e| e.to_string())
}

fn sanitize_log_field(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\t', "\\t").replace('\n', "\\n")
}

fn format_log_line(created_at: &str, level: &str, message: &str, context: Option<&str>) -> String {
    let msg = sanitize_log_field(message);
    let ctx = context.map(sanitize_log_field).unwrap_or_default();
    format!("{created_at}\t{level}\t{msg}\t{ctx}\n")
}

fn write_log_entry_unlocked(
    log_dir: &Path,
    created_at: &str,
    level: &str,
    message: &str,
    context: Option<&str>,
) -> Result<(), String> {
    fs::create_dir_all(log_dir).map_err(|e| e.to_string())?;
    let log_file = log_dir.join("app.log");
    rotate_if_needed(&log_file)?;

    let line = format_log_line(created_at, level, message, context);

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_file)
        .map_err(|e| e.to_string())?;
    file.write_all(line.as_bytes()).map_err(|e| e.to_string())
}

fn write_log_entry(
    log_dir: &PathBuf,
    level: &str,
    message: &str,
    context: Option<&str>,
) -> Result<(), String> {
    with_log_io_lock(|| {
        let now = Utc::now().to_rfc3339();
        write_log_entry_unlocked(log_dir.as_path(), &now, level, message, context)
    })
}

pub fn init_runtime_logger() -> Result<(), String> {
    log::set_logger(&LOGGER).map_err(|err| err.to_string())?;
    log::set_max_level(LevelFilter::Trace);
    Ok(())
}

pub fn configure_runtime_logger(log_dir: PathBuf, level: &str) {
    if let Some(filter) = normalize_level_filter(level) {
        LOGGER.set_level_filter(filter);
    }

    if let Ok(mut sink) = LOGGER.sink.lock() {
        *sink = Some(LoggerSink { log_dir });
    }
}

pub fn set_runtime_log_level(level: &str) -> Result<(), String> {
    let Some(filter) = normalize_level_filter(level) else {
        return Err("Unsupported log level. Use error, warning, info, or debug".to_string());
    };

    LOGGER.set_level_filter(filter);
    Ok(())
}

pub fn handle_setting_change(key: &str, value: &str) {
    if key == "logs.level" {
        let _ = set_runtime_log_level(value);
    }
}

pub fn normalize_level_for_query(level: &str) -> Option<&'static str> {
    match level.trim().to_lowercase().as_str() {
        "error" => Some("error"),
        "warn" | "warning" => Some("warn"),
        "info" => Some("info"),
        "debug" => Some("debug"),
        _ => None,
    }
}

pub fn migrate_legacy_logs(conn: &Connection, log_dir: &Path) -> Result<bool, String> {
    let has_logs_table = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='logs')",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())?
        != 0;

    if !has_logs_table {
        return Ok(false);
    }

    let mut stmt = conn
        .prepare("SELECT created_at, level, message, context FROM logs ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    if rows.is_empty() {
        return Ok(false);
    }

    with_log_io_lock(|| {
        for (created_at, level, message, context) in &rows {
            write_log_entry_unlocked(log_dir, created_at, level, message, context.as_deref())?;
        }
        Ok(())
    })?;

    conn.execute("DELETE FROM logs", [])
        .map_err(|e| e.to_string())?;

    Ok(true)
}
