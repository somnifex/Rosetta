use crate::mineru::{
    is_mineru_content_list_json_file_name, is_mineru_layout_json_file_name,
    is_mineru_markdown_file_name, is_mineru_model_json_file_name, mineru_archive_file_name,
    normalize_mineru_archive_entry_name, should_prefer_mineru_markdown_entry, ParseResult,
};
use reqwest::header::ACCEPT;
use reqwest::{Client, Response, StatusCode};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{Cursor, Read};
use std::path::Path;
use std::time::Duration;
use zip::ZipArchive;

pub const DEFAULT_MINERU_OFFICIAL_BASE_URL: &str = "https://mineru.net";
const DEFAULT_HTTP_TIMEOUT_SECS: u64 = 600;
const ALLOWED_EXTRA_FORMATS: &[&str] = &["docx", "html", "latex"];

#[derive(Debug, Clone)]
pub struct OfficialParseRequest {
    pub model_version: String,
    pub language: Option<String>,
    pub enable_formula: bool,
    pub enable_table: bool,
    pub is_ocr: bool,
    pub data_id: Option<String>,
    pub page_ranges: Option<String>,
    pub extra_formats: Vec<String>,
    pub callback: Option<String>,
    pub seed: Option<String>,
}

impl OfficialParseRequest {
    pub fn sanitized_for_file(&self, file_path: &Path) -> Result<Self, String> {
        let mut request = self.clone();
        let configured_model = normalize_model_version(&request.model_version)?;
        let is_html = is_html_file(file_path);

        request.extra_formats = sanitize_extra_formats(&request.extra_formats)?;
        request.model_version = if is_html {
            "MinerU-HTML".to_string()
        } else {
            if configured_model == "MinerU-HTML" {
                return Err(
                    "MinerU-HTML can only be used for HTML files. Choose pipeline or vlm for other document types."
                        .to_string(),
                );
            }
            configured_model
        };

        if is_html {
            request.language = None;
            request.extra_formats.clear();
        }

        if !is_pdf_file(file_path) {
            request.page_ranges = None;
        }

        Ok(request)
    }
}

pub struct OfficialMinerUClient {
    base_url: String,
    api_token: String,
    client: Client,
}

#[derive(Debug)]
pub struct SubmittedLocalBatch {
    pub batch_id: String,
}

#[derive(Debug)]
pub struct OfficialArchive {
    pub parse_result: ParseResult,
    pub archive_bytes: Vec<u8>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OfficialExtractProgress {
    #[serde(default)]
    pub extracted_pages: Option<i32>,
    #[serde(default)]
    pub total_pages: Option<i32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OfficialBatchResult {
    #[serde(default)]
    pub extract_result: Vec<OfficialBatchItem>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OfficialBatchItem {
    #[serde(default)]
    pub file_name: Option<String>,
    pub state: String,
    #[serde(default)]
    pub full_zip_url: Option<String>,
    #[serde(default)]
    pub err_msg: Option<String>,
    #[serde(default)]
    pub data_id: Option<String>,
    #[serde(default)]
    pub extract_progress: Option<OfficialExtractProgress>,
}

impl OfficialBatchResult {
    pub fn find_item(
        &self,
        data_id: Option<&str>,
        file_name: Option<&str>,
    ) -> Option<&OfficialBatchItem> {
        if let Some(data_id) = data_id {
            if let Some(item) = self
                .extract_result
                .iter()
                .find(|item| item.data_id.as_deref() == Some(data_id))
            {
                return Some(item);
            }
        }

        if let Some(file_name) = file_name {
            if let Some(item) = self.extract_result.iter().find(|item| {
                item.file_name
                    .as_deref()
                    .map(|name| name.eq_ignore_ascii_case(file_name))
                    .unwrap_or(false)
            }) {
                return Some(item);
            }
        }

        if self.extract_result.len() == 1 {
            return self.extract_result.first();
        }

        None
    }
}

impl OfficialMinerUClient {
    pub fn new(base_url: String, api_token: String) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(DEFAULT_HTTP_TIMEOUT_SECS))
            .build()
            .unwrap_or_else(|_| Client::new());

        Self {
            base_url: normalize_base_url(&base_url),
            api_token: api_token.trim().to_string(),
            client,
        }
    }

    pub async fn test_connection(&self) -> Result<String, String> {
        if self.api_token.is_empty() {
            return Err("Official MinerU API token is required.".to_string());
        }

        let url = self.endpoint("api/v4/extract/task/00000000-0000-0000-0000-000000000000");
        let response = self
            .authorized(self.client.get(&url))
            .send()
            .await
            .map_err(|e| format!("Failed to reach MinerU official API: {}", e))?;

        if matches!(
            response.status(),
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN
        ) {
            return Err(
                "MinerU official API authentication failed. Check whether the token is valid."
                    .to_string(),
            );
        }

        if !response.status().is_success() {
            return Err(
                read_http_error_response(response, "MinerU official API connection test").await,
            );
        }

        let payload = response
            .json::<ApiEnvelope<Value>>()
            .await
            .map_err(|e| format!("Failed to parse MinerU official API response: {}", e))?;

        if payload.code == 0 || matches!(payload.code, -60012 | -60013) {
            return Ok("MinerU official API is reachable".to_string());
        }

        if is_probable_auth_failure(payload.code, &payload.msg) {
            return Err(format!(
                "MinerU official API authentication failed: {}",
                payload.msg
            ));
        }

        Ok(format!(
            "MinerU official API responded successfully (code {}: {})",
            payload.code, payload.msg
        ))
    }

    pub async fn submit_local_file(
        &self,
        file_path: &Path,
        request: &OfficialParseRequest,
    ) -> Result<SubmittedLocalBatch, String> {
        let request = request.sanitized_for_file(file_path)?;
        let file_name = file_path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "The file name contains invalid characters".to_string())?;

        let body = UploadBatchRequest::from_request(file_name, file_path, &request);
        let payload: ApiEnvelope<BatchUploadData> = self
            .post_json(
                "api/v4/file-urls/batch",
                &body,
                "MinerU official local file upload URL request",
            )
            .await?;

        let data = require_success_data(payload, "request MinerU official upload URL")?;
        let upload_url = data
            .file_urls
            .first()
            .cloned()
            .ok_or_else(|| "MinerU official API returned no upload URL".to_string())?;

        self.upload_file(&upload_url, file_path).await?;

        Ok(SubmittedLocalBatch {
            batch_id: data.batch_id,
        })
    }

    pub async fn get_batch_result(&self, batch_id: &str) -> Result<OfficialBatchResult, String> {
        let path = format!("api/v4/extract-results/batch/{batch_id}");
        let payload: ApiEnvelope<OfficialBatchResult> = self
            .get_json(&path, "MinerU official batch result query")
            .await?;
        require_success_data(payload, "query MinerU official batch result")
    }

    pub async fn download_archive(&self, full_zip_url: &str) -> Result<OfficialArchive, String> {
        let response = self
            .client
            .get(full_zip_url)
            .send()
            .await
            .map_err(|e| format!("Failed to download MinerU official parse archive: {}", e))?;

        if !response.status().is_success() {
            return Err(read_http_error_response(
                response,
                "MinerU official parse archive download",
            )
            .await);
        }

        let archive_bytes = response
            .bytes()
            .await
            .map_err(|e| format!("Failed to read MinerU official parse archive: {}", e))?
            .to_vec();

        OfficialArchive::from_zip_bytes(archive_bytes)
    }

    async fn upload_file(&self, upload_url: &str, file_path: &Path) -> Result<(), String> {
        let file_bytes = tokio::fs::read(file_path)
            .await
            .map_err(|e| format!("Failed to read file for MinerU official upload: {}", e))?;

        let response = self
            .client
            .put(upload_url)
            .body(file_bytes)
            .send()
            .await
            .map_err(|e| format!("Failed to upload file to MinerU official API: {}", e))?;

        if response.status().is_success() {
            return Ok(());
        }

        Err(read_http_error_response(response, "MinerU official file upload").await)
    }

    async fn post_json<TRequest: Serialize, TResponse: DeserializeOwned>(
        &self,
        path: &str,
        body: &TRequest,
        context: &str,
    ) -> Result<TResponse, String> {
        let response = self
            .authorized(self.client.post(self.endpoint(path)).json(body))
            .send()
            .await
            .map_err(|e| format!("{context} failed: {}", e))?;

        if !response.status().is_success() {
            return Err(read_http_error_response(response, context).await);
        }

        response
            .json::<TResponse>()
            .await
            .map_err(|e| format!("Failed to parse {context} response: {}", e))
    }

    async fn get_json<TResponse: DeserializeOwned>(
        &self,
        path: &str,
        context: &str,
    ) -> Result<TResponse, String> {
        let response = self
            .authorized(self.client.get(self.endpoint(path)))
            .send()
            .await
            .map_err(|e| format!("{context} failed: {}", e))?;

        if !response.status().is_success() {
            return Err(read_http_error_response(response, context).await);
        }

        response
            .json::<TResponse>()
            .await
            .map_err(|e| format!("Failed to parse {context} response: {}", e))
    }

    fn endpoint(&self, path: &str) -> String {
        format!(
            "{}/{}",
            self.base_url.trim_end_matches('/'),
            path.trim_start_matches('/')
        )
    }

    fn authorized(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        request
            .bearer_auth(self.api_token.trim())
            .header(ACCEPT, "*/*")
    }
}

impl OfficialArchive {
    fn from_zip_bytes(archive_bytes: Vec<u8>) -> Result<Self, String> {
        let reader = Cursor::new(archive_bytes.as_slice());
        let mut archive = ZipArchive::new(reader)
            .map_err(|e| format!("Failed to open MinerU official parse archive: {}", e))?;

        let mut markdown = None;
        let mut markdown_entry_name = None;
        let mut layout_json = None;
        let mut content_list_json = None;
        let mut model_json = None;

        for index in 0..archive.len() {
            let mut file = archive
                .by_index(index)
                .map_err(|e| format!("Failed to read archive entry #{index}: {}", e))?;
            if file.is_dir() {
                continue;
            }

            let entry_name = normalize_mineru_archive_entry_name(file.name());
            let file_name = mineru_archive_file_name(&entry_name);

            let mut bytes = Vec::new();
            file.read_to_end(&mut bytes)
                .map_err(|e| format!("Failed to read archive entry '{}': {}", entry_name, e))?;
            let text = String::from_utf8_lossy(&bytes).to_string();

            if is_mineru_markdown_file_name(&file_name) {
                if should_prefer_mineru_markdown_entry(markdown_entry_name.as_deref(), &entry_name)
                {
                    markdown = Some(text);
                    markdown_entry_name = Some(entry_name);
                }
                continue;
            }

            if is_mineru_layout_json_file_name(&file_name) {
                if layout_json.is_none() {
                    layout_json = Some(text);
                }
                continue;
            }

            if is_mineru_content_list_json_file_name(&file_name) {
                if content_list_json.is_none() {
                    content_list_json = Some(text);
                }
                continue;
            }

            if is_mineru_model_json_file_name(&file_name) {
                if model_json.is_none() {
                    model_json = Some(text);
                }
            }
        }

        let markdown = markdown.ok_or_else(|| {
            "MinerU official parse archive did not contain a Markdown result file".to_string()
        })?;

        let json_content = layout_json
            .clone()
            .or_else(|| content_list_json.clone())
            .or_else(|| model_json.clone())
            .unwrap_or_else(|| "{}".to_string());
        let structure_source = content_list_json
            .or(layout_json)
            .or(model_json)
            .unwrap_or_else(|| json_content.clone());
        let structure = serde_json::from_str::<Value>(&structure_source)
            .unwrap_or_else(|_| Value::String(structure_source.clone()));

        Ok(Self {
            parse_result: ParseResult {
                markdown,
                json: json_content,
                structure,
            },
            archive_bytes,
        })
    }
}

pub fn estimate_progress_percent(
    state: &str,
    extract_progress: Option<&OfficialExtractProgress>,
) -> f64 {
    match state {
        "waiting-file" => 2.0,
        "pending" => 5.0,
        "running" => extract_progress
            .and_then(
                |progress| match (progress.extracted_pages, progress.total_pages) {
                    (Some(done), Some(total)) if total > 0 => {
                        Some(((done as f64 / total as f64) * 90.0).clamp(8.0, 90.0))
                    }
                    _ => None,
                },
            )
            .unwrap_or(45.0),
        "converting" => 95.0,
        "done" => 100.0,
        "failed" => 0.0,
        _ => 10.0,
    }
}

#[derive(Debug, Deserialize)]
struct ApiEnvelope<T> {
    code: i32,
    msg: String,
    #[serde(default)]
    trace_id: Option<String>,
    data: Option<T>,
}

#[derive(Debug, Deserialize)]
struct BatchUploadData {
    batch_id: String,
    #[serde(default)]
    file_urls: Vec<String>,
}

#[derive(Debug, Serialize)]
struct UploadBatchRequest {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    files: Vec<UploadBatchFile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    enable_formula: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    enable_table: Option<bool>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    extra_formats: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    callback: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    seed: Option<String>,
    model_version: String,
}

#[derive(Debug, Serialize)]
struct UploadBatchFile {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    is_ocr: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    data_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    page_ranges: Option<String>,
}

impl UploadBatchRequest {
    fn from_request(file_name: &str, file_path: &Path, request: &OfficialParseRequest) -> Self {
        let supports_pipeline = supports_pipeline_options(&request.model_version);
        Self {
            files: vec![UploadBatchFile {
                name: file_name.to_string(),
                is_ocr: if supports_pipeline {
                    Some(request.is_ocr)
                } else {
                    None
                },
                data_id: request.data_id.clone(),
                page_ranges: request.page_ranges.clone(),
            }],
            language: if supports_pipeline {
                request.language.clone()
            } else {
                None
            },
            enable_formula: if supports_pipeline {
                Some(request.enable_formula)
            } else {
                None
            },
            enable_table: if supports_pipeline {
                Some(request.enable_table)
            } else {
                None
            },
            extra_formats: if is_html_file(file_path) {
                Vec::new()
            } else {
                request.extra_formats.clone()
            },
            callback: request.callback.clone(),
            seed: request.seed.clone(),
            model_version: request.model_version.clone(),
        }
    }
}

fn normalize_base_url(base_url: &str) -> String {
    let trimmed = base_url.trim();
    if trimmed.is_empty() {
        DEFAULT_MINERU_OFFICIAL_BASE_URL.to_string()
    } else {
        trimmed.trim_end_matches('/').to_string()
    }
}

fn normalize_model_version(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok("vlm".to_string());
    }

    if trimmed.eq_ignore_ascii_case("pipeline") {
        return Ok("pipeline".to_string());
    }
    if trimmed.eq_ignore_ascii_case("vlm") {
        return Ok("vlm".to_string());
    }
    if trimmed.eq_ignore_ascii_case("MinerU-HTML") {
        return Ok("MinerU-HTML".to_string());
    }

    Err(format!(
        "Unsupported MinerU official model version '{}'. Allowed values: pipeline, vlm, MinerU-HTML.",
        trimmed
    ))
}

fn sanitize_extra_formats(extra_formats: &[String]) -> Result<Vec<String>, String> {
    let mut sanitized = Vec::new();
    let mut invalid = Vec::new();

    for format in extra_formats {
        let normalized = format.trim().to_ascii_lowercase();
        if normalized.is_empty() {
            continue;
        }

        if ALLOWED_EXTRA_FORMATS.contains(&normalized.as_str()) {
            if !sanitized.iter().any(|item| item == &normalized) {
                sanitized.push(normalized);
            }
        } else {
            invalid.push(format.trim().to_string());
        }
    }

    if invalid.is_empty() {
        return Ok(sanitized);
    }

    Err(format!(
        "Unsupported MinerU official extra formats: {}. Allowed values: docx, html, latex.",
        invalid.join(", ")
    ))
}

fn is_html_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| matches!(ext.to_ascii_lowercase().as_str(), "html" | "htm"))
        .unwrap_or(false)
}

fn is_pdf_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false)
}

fn supports_pipeline_options(model_version: &str) -> bool {
    !model_version.eq_ignore_ascii_case("MinerU-HTML")
}

fn require_success_data<T>(payload: ApiEnvelope<T>, context: &str) -> Result<T, String> {
    if payload.code != 0 {
        return Err(build_api_error(
            context,
            payload.code,
            &payload.msg,
            payload.trace_id.as_deref(),
        ));
    }

    payload
        .data
        .ok_or_else(|| format!("MinerU official API returned no data for {}.", context))
}

fn build_api_error(context: &str, code: i32, message: &str, trace_id: Option<&str>) -> String {
    if let Some(trace_id) = trace_id.filter(|value| !value.trim().is_empty()) {
        format!(
            "{} failed (code {}): {} [trace_id={}]",
            context, code, message, trace_id
        )
    } else {
        format!("{} failed (code {}): {}", context, code, message)
    }
}

fn is_probable_auth_failure(code: i32, message: &str) -> bool {
    if matches!(code, -401 | 401 | -403 | 403) {
        return true;
    }

    let lower = message.to_ascii_lowercase();
    lower.contains("token")
        || lower.contains("authorization")
        || lower.contains("auth")
        || lower.contains("unauthorized")
        || lower.contains("forbidden")
        || message.contains("未授权")
        || message.contains("鉴权")
        || message.contains("权限")
}

async fn read_http_error_response(response: Response, context: &str) -> String {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if body.trim().is_empty() {
        format!("{} returned HTTP {}", context, status)
    } else {
        format!(
            "{} returned HTTP {} - {}",
            context,
            status,
            truncate_message(body.trim(), 400)
        )
    }
}

fn truncate_message(message: &str, max_chars: usize) -> String {
    let total_chars = message.chars().count();
    if total_chars <= max_chars {
        return message.to_string();
    }

    let truncated: String = message.chars().take(max_chars).collect();
    format!("{}...", truncated)
}
