use chrono::Utc;
use log::{Level, LevelFilter, Log, Metadata, Record};
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Mutex;
use uuid::Uuid;

struct LoggerSink {
    db_path: PathBuf,
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
            .and_then(|guard| guard.as_ref().map(|sink| sink.db_path.clone()));

        if let Some(db_path) = sink_path {
            if let Err(err) = write_log_entry(&db_path, &level, &message, Some(&context)) {
                eprintln!("Failed to persist runtime log entry: {err}");
            }
        }
    }

    fn flush(&self) {}
}

static LOGGER: RuntimeLogger = RuntimeLogger::new();

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

fn write_log_entry(
    db_path: &PathBuf,
    level: &str,
    message: &str,
    context: Option<&str>,
) -> Result<(), String> {
    let conn = Connection::open(db_path).map_err(|err| err.to_string())?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO logs (id, level, message, context, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        (&id, level, message, context, &now),
    )
    .map_err(|err| err.to_string())?;

    Ok(())
}

pub fn init_runtime_logger() -> Result<(), String> {
    log::set_logger(&LOGGER).map_err(|err| err.to_string())?;
    log::set_max_level(LevelFilter::Trace);
    Ok(())
}

pub fn configure_runtime_logger(db_path: PathBuf, level: &str) {
    if let Some(filter) = normalize_level_filter(level) {
        LOGGER.set_level_filter(filter);
    }

    if let Ok(mut sink) = LOGGER.sink.lock() {
        *sink = Some(LoggerSink { db_path });
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
