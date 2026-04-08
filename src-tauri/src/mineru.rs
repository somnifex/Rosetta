use reqwest::multipart::{Form, Part};
use reqwest::{Client, ClientBuilder, Response, StatusCode, Url};
use serde::Deserialize;
use std::collections::HashMap;
use std::io::{Cursor, Read};
use std::net::IpAddr;
use std::path::Path;
use std::time::{Duration, Instant};
use zip::ZipArchive;

const TASK_STATUS_POLL_INTERVAL: Duration = Duration::from_secs(1);
const TASK_STATUS_REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const TASK_RESULT_TIMEOUT: Duration = Duration::from_secs(3600);

const TASK_SUBMIT_TIMEOUT: Duration = Duration::from_secs(600);
const TASK_SUBMIT_MAX_RETRIES: u32 = 3;
const TASK_SUBMIT_RETRY_DELAY: Duration = Duration::from_secs(15);

const FILE_PARSE_REQUEST_TIMEOUT: Duration = Duration::from_secs(3600);

#[derive(Debug, Deserialize)]
pub struct ParseResult {
    pub markdown: String,
    pub json: String,
    pub structure: serde_json::Value,
}

#[derive(Debug)]
pub struct ParseExecution {
    pub parse_result: ParseResult,
    pub archive_bytes: Option<Vec<u8>>,
}

#[derive(Debug, Deserialize)]
struct LegacyParseResult {
    markdown: String,
    json: String,
    structure: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct ModernParseResponse {
    #[serde(default)]
    results: HashMap<String, ModernParseItem>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ModernParseItem {
    #[serde(default)]
    md_content: Option<String>,
    #[serde(default)]
    middle_json: Option<String>,
    #[serde(default)]
    content_list: Option<String>,
    #[serde(default)]
    model_output: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AsyncTaskSubmission {
    #[serde(default)]
    status_url: Option<String>,
    #[serde(default)]
    result_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AsyncTaskStatusResponse {
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    detail: Option<serde_json::Value>,
}

pub struct MinerUClient {
    base_url: String,
    client: Client,
    preferred_backend: Option<String>,
}

impl MinerUClient {
    pub fn new(base_url: String) -> Self {
        let builder = build_mineru_http_client(&base_url);
        let client = builder.build().unwrap_or_else(|_| Client::new());

        Self {
            base_url,
            client,
            preferred_backend: None,
        }
    }

    pub fn with_parse_backend(mut self, backend: impl Into<String>) -> Self {
        let backend = backend.into();
        self.preferred_backend = if backend.trim().is_empty() {
            None
        } else {
            Some(backend)
        };
        self
    }

    pub async fn parse_pdf(&self, file_path: &Path) -> Result<ParseExecution, String> {
        match self
            .try_parse_with_modern_endpoint(file_path, self.preferred_backend.as_deref())
            .await
        {
            Ok(Some(result)) => return Ok(result),
            Ok(None) => {}
            Err(err) => {
                if matches!(
                    self.preferred_backend.as_deref(),
                    Some("hybrid-auto-engine") | Some("vlm")
                ) {
                    let fallback = "pipeline";
                    log::warn!(
                        "MinerU modern parse flow failed with {}, retrying with {}: {}",
                        self.preferred_backend.as_deref().unwrap_or("unknown"),
                        fallback,
                        err
                    );
                    match self
                        .try_parse_with_modern_endpoint(file_path, Some(fallback))
                        .await
                    {
                        Ok(Some(result)) => return Ok(result),
                        Ok(None) => {}
                        Err(pipeline_err) => return Err(pipeline_err),
                    }
                } else {
                    return Err(err);
                }
            }
        }

        self.try_parse_with_legacy_endpoint(file_path).await
    }

    async fn try_parse_with_modern_endpoint(
        &self,
        file_path: &Path,
        backend: Option<&str>,
    ) -> Result<Option<ParseExecution>, String> {
        let mut tasks_error: Option<String> = None;

        match self.try_parse_with_tasks_endpoint(file_path, backend).await {
            Ok(Some(result)) => return Ok(Some(result)),
            Ok(None) => {}
            Err(err) => {
                log::warn!(
                    "MinerU /tasks parse flow failed, falling back to /file_parse: {}",
                    err
                );
                tasks_error = Some(err);
            }
        }

        match self
            .try_parse_with_file_parse_endpoint(file_path, backend)
            .await
        {
            Ok(result) => Ok(result),
            Err(file_parse_err) => {
                if let Some(tasks_error) = tasks_error {
                    Err(format!(
                        "MinerU modern endpoints failed. /tasks: {}; /file_parse: {}",
                        tasks_error, file_parse_err
                    ))
                } else {
                    Err(file_parse_err)
                }
            }
        }
    }

    async fn try_parse_with_tasks_endpoint(
        &self,
        file_path: &Path,
        backend: Option<&str>,
    ) -> Result<Option<ParseExecution>, String> {
        let url = format!("{}/tasks", self.base_url.trim_end_matches('/'));

        let mut last_error: Option<String> = None;
        let mut response = None;
        for attempt in 0..=TASK_SUBMIT_MAX_RETRIES {
            if attempt > 0 {
                log::warn!(
                    "MinerU /tasks submission timed out (attempt {}). MinerU is likely busy processing another task; retrying in {}s.",
                    attempt,
                    TASK_SUBMIT_RETRY_DELAY.as_secs()
                );
                tokio::time::sleep(TASK_SUBMIT_RETRY_DELAY).await;
            }
            let form = build_modern_parse_form(file_path, backend).await?;
            match self
                .client
                .post(&url)
                .timeout(TASK_SUBMIT_TIMEOUT)
                .multipart(form)
                .send()
                .await
            {
                Ok(resp) => {
                    response = Some(resp);
                    break;
                }
                Err(e) if e.is_timeout() && attempt < TASK_SUBMIT_MAX_RETRIES => {
                    last_error = Some(format!("Request to MinerU /tasks failed: {}", e));
                    continue;
                }
                Err(e) => {
                    return Err(format!("Request to MinerU /tasks failed: {}", e));
                }
            }
        }
        let response = response.ok_or_else(|| {
            last_error
                .unwrap_or_else(|| "MinerU /tasks submission failed after retries".to_string())
        })?;

        if matches!(
            response.status(),
            StatusCode::NOT_FOUND | StatusCode::METHOD_NOT_ALLOWED
        ) {
            return Ok(None);
        }

        if response.status() != StatusCode::ACCEPTED && !response.status().is_success() {
            return Err(read_error_response(response).await);
        }

        let payload = response
            .json::<AsyncTaskSubmission>()
            .await
            .map_err(|e| format!("Failed to parse MinerU /tasks response: {}", e))?;

        let status_url = self.resolve_task_url(
            payload
                .status_url
                .as_deref()
                .ok_or("MinerU /tasks response did not include status_url")?,
        )?;
        let result_url = self.resolve_task_url(
            payload
                .result_url
                .as_deref()
                .ok_or("MinerU /tasks response did not include result_url")?,
        )?;

        self.wait_for_task_completion(&status_url).await?;
        let result_response = self
            .client
            .get(&result_url)
            .timeout(FILE_PARSE_REQUEST_TIMEOUT)
            .send()
            .await
            .map_err(|e| format!("Failed to download MinerU task result: {}", e))?;

        if !result_response.status().is_success() {
            return Err(read_error_response(result_response).await);
        }

        let content_type = result_response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let bytes = result_response
            .bytes()
            .await
            .map_err(|e| format!("Failed to read MinerU task result: {}", e))?;

        Ok(Some(parse_file_parse_response_bytes(
            &bytes,
            &content_type,
        )?))
    }

    async fn try_parse_with_file_parse_endpoint(
        &self,
        file_path: &Path,
        backend: Option<&str>,
    ) -> Result<Option<ParseExecution>, String> {
        let url = format!("{}/file_parse", self.base_url.trim_end_matches('/'));
        let form = build_modern_parse_form(file_path, backend).await?;

        let response = self
            .client
            .post(&url)
            .timeout(FILE_PARSE_REQUEST_TIMEOUT)
            .multipart(form)
            .send()
            .await
            .map_err(|e| format!("Request to MinerU /file_parse failed: {}", e))?;

        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }

        if !response.status().is_success() {
            return Err(read_error_response(response).await);
        }

        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let bytes = response
            .bytes()
            .await
            .map_err(|e| format!("Failed to read MinerU /file_parse response: {}", e))?;

        Ok(Some(parse_file_parse_response_bytes(
            &bytes,
            &content_type,
        )?))
    }

    async fn try_parse_with_legacy_endpoint(
        &self,
        file_path: &Path,
    ) -> Result<ParseExecution, String> {
        let url = format!("{}/parse", self.base_url.trim_end_matches('/'));
        let part = build_pdf_part(file_path).await?;
        let form = Form::new().part("file", part);

        let response = self
            .client
            .post(&url)
            .timeout(FILE_PARSE_REQUEST_TIMEOUT)
            .multipart(form)
            .send()
            .await
            .map_err(|e| format!("Request to MinerU /parse failed: {}", e))?;

        if !response.status().is_success() {
            return Err(read_error_response(response).await);
        }

        let result = response
            .json::<LegacyParseResult>()
            .await
            .map_err(|e| format!("Failed to parse MinerU /parse response: {}", e))?;

        Ok(ParseExecution {
            parse_result: ParseResult {
                markdown: result.markdown,
                json: result.json,
                structure: result.structure,
            },
            archive_bytes: None,
        })
    }

    pub async fn health_check(&self) -> Result<bool, String> {
        let url = format!("{}/health", self.base_url.trim_end_matches('/'));

        match self
            .client
            .get(&url)
            .timeout(Duration::from_secs(3))
            .send()
            .await
        {
            Ok(resp) => Ok(resp.status().is_success()),
            Err(_) => Ok(false),
        }
    }

    fn resolve_task_url(&self, raw_url: &str) -> Result<String, String> {
        let raw_url = raw_url.trim();
        if raw_url.is_empty() {
            return Err("MinerU task response returned an empty URL".to_string());
        }

        if let Ok(url) = Url::parse(raw_url) {
            return Ok(url.to_string());
        }

        let mut base_url = self.base_url.trim_end_matches('/').to_string();
        base_url.push('/');
        let base = Url::parse(&base_url)
            .map_err(|e| format!("Invalid MinerU base URL '{}': {}", self.base_url, e))?;
        base.join(raw_url)
            .map(|url| url.to_string())
            .map_err(|e| format!("Failed to resolve MinerU task URL '{}': {}", raw_url, e))
    }

    async fn wait_for_task_completion(&self, status_url: &str) -> Result<(), String> {
        let deadline = Instant::now() + TASK_RESULT_TIMEOUT;

        loop {
            let response = match self
                .client
                .get(status_url)
                .timeout(TASK_STATUS_REQUEST_TIMEOUT)
                .send()
                .await
            {
                Ok(response) => response,
                Err(error) if error.is_timeout() => {
                    if Instant::now() >= deadline {
                        return Err("Timed out waiting for MinerU task completion.".to_string());
                    }

                    log::warn!(
                        "MinerU task status poll timed out for {}. This can happen while MinerU is cold-starting models or busy inside a long-running parse; retrying until the task deadline.",
                        status_url
                    );
                    tokio::time::sleep(TASK_STATUS_POLL_INTERVAL).await;
                    continue;
                }
                Err(error) => {
                    return Err(format!("Failed to query MinerU task status: {}", error));
                }
            };

            if !response.status().is_success() {
                return Err(read_error_response(response).await);
            }

            let payload = response
                .json::<AsyncTaskStatusResponse>()
                .await
                .map_err(|e| format!("Failed to parse MinerU task status response: {}", e))?;
            let status = payload.status.as_deref().map(str::trim).unwrap_or_default();

            match status {
                "completed" | "done" => return Ok(()),
                "failed" => return Err(describe_task_status_failure(&payload)),
                "pending" | "processing" | "running" | "converting" | "waiting-file" => {}
                "" => {
                    return Err(
                        "MinerU task status response did not include a recognizable status."
                            .to_string(),
                    )
                }
                other => {
                    return Err(format!(
                        "MinerU task entered unexpected status '{}'.",
                        other
                    ))
                }
            }

            if Instant::now() >= deadline {
                return Err("Timed out waiting for MinerU task completion.".to_string());
            }

            tokio::time::sleep(TASK_STATUS_POLL_INTERVAL).await;
        }
    }
}

fn build_mineru_http_client(base_url: &str) -> ClientBuilder {
    let builder = Client::builder();
    if should_disable_system_proxy(base_url) {
        // Built-in MinerU runs on loopback. Bypass system proxies so local
        // multipart uploads and long polling cannot be intercepted or rewritten.
        return builder.no_proxy();
    }
    builder
}

fn should_disable_system_proxy(base_url: &str) -> bool {
    let Ok(url) = Url::parse(base_url) else {
        return false;
    };

    match url.host_str() {
        Some(host) if host.eq_ignore_ascii_case("localhost") => true,
        Some(host) => host
            .trim_matches(['[', ']'])
            .parse::<IpAddr>()
            .map(|ip| ip.is_loopback())
            .unwrap_or(false),
        None => false,
    }
}

async fn build_pdf_part(file_path: &Path) -> Result<Part, String> {
    let file_bytes = tokio::fs::read(file_path)
        .await
        .map_err(|e| format!("Failed to read file: {}", e))?;

    // MinerU derives filesystem paths from the upload filename.
    // Keep it ASCII on Windows to avoid [Errno 22].
    let file_name = file_path
        .file_stem()
        .and_then(|s| s.to_str())
        .and_then(|s| s.split('_').next())
        .map(|uuid| format!("{}.pdf", uuid))
        .unwrap_or_else(|| "document.pdf".to_string());

    Part::bytes(file_bytes)
        .file_name(file_name)
        .mime_str("application/pdf")
        .map_err(|e| format!("Failed to set MIME type: {}", e))
}

async fn build_modern_parse_form(file_path: &Path, backend: Option<&str>) -> Result<Form, String> {
    let part = build_pdf_part(file_path).await?;
    let mut form = Form::new()
        .part("files", part)
        .text("return_md", "true")
        .text("return_middle_json", "true")
        .text("return_model_output", "true")
        .text("return_content_list", "true")
        .text("return_images", "true")
        .text("response_format_zip", "true");
    if let Some(backend) = backend {
        form = form.text("backend", backend.to_string());
    }
    Ok(form)
}

async fn read_error_response(response: Response) -> String {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    let body = body.trim();

    let base = if body.is_empty() {
        format!("MinerU returned error: {}", status)
    } else {
        format!(
            "MinerU returned error: {} - {}",
            status,
            truncate_message(body, 400)
        )
    };

    if body.contains("No module named") {
        return format!(
            "{}. MinerU's Python environment is missing a required module. \
             If using Built-in mode, stop MinerU, run Setup Environment, then restart. \
             If using External mode, install the missing module in MinerU's Python environment.",
            base
        );
    }

    base
}

fn describe_task_status_failure(payload: &AsyncTaskStatusResponse) -> String {
    if let Some(message) = payload
        .error
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return message.to_string();
    }

    if let Some(message) = payload
        .message
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return message.to_string();
    }

    if let Some(detail) = payload.detail.as_ref() {
        if let Some(message) = detail
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return message.to_string();
        }
        return detail.to_string();
    }

    "MinerU task failed.".to_string()
}

fn truncate_message(message: &str, max_chars: usize) -> String {
    let total_chars = message.chars().count();
    if total_chars <= max_chars {
        return message.to_string();
    }

    let truncated: String = message.chars().take(max_chars).collect();
    format!("{}...", truncated)
}

pub(crate) fn normalize_mineru_archive_entry_name(entry_name: &str) -> String {
    entry_name.replace('\\', "/")
}

pub(crate) fn mineru_archive_file_name(entry_name: &str) -> String {
    normalize_mineru_archive_entry_name(entry_name)
        .rsplit('/')
        .next()
        .unwrap_or(entry_name)
        .to_ascii_lowercase()
}

pub(crate) fn is_mineru_markdown_file_name(file_name: &str) -> bool {
    file_name == "full.md"
        || file_name == "index.md"
        || file_name.ends_with(".md")
        || file_name.ends_with(".markdown")
}

pub(crate) fn should_prefer_mineru_markdown_entry(
    current_entry_name: Option<&str>,
    candidate_entry_name: &str,
) -> bool {
    let Some(candidate_score) = mineru_markdown_entry_score(candidate_entry_name) else {
        return false;
    };

    let candidate_entry_name = normalize_mineru_archive_entry_name(candidate_entry_name);
    match current_entry_name {
        None => true,
        Some(current_entry_name) => {
            let current_entry_name = normalize_mineru_archive_entry_name(current_entry_name);
            mineru_markdown_entry_score(&current_entry_name).map_or(true, |current_score| {
                candidate_score < current_score
                    || (candidate_score == current_score
                        && candidate_entry_name < current_entry_name)
            })
        }
    }
}

pub(crate) fn is_mineru_layout_json_file_name(file_name: &str) -> bool {
    file_name == "layout.json"
        || file_name == "middle.json"
        || file_name.ends_with("_layout.json")
        || file_name.ends_with("_middle.json")
}

pub(crate) fn is_mineru_content_list_json_file_name(file_name: &str) -> bool {
    file_name == "content_list.json" || file_name.ends_with("_content_list.json")
}

pub(crate) fn is_mineru_model_json_file_name(file_name: &str) -> bool {
    file_name == "model.json" || file_name.ends_with("_model.json")
}

fn mineru_markdown_entry_score(entry_name: &str) -> Option<(u8, usize, usize)> {
    let normalized_entry_name = normalize_mineru_archive_entry_name(entry_name);
    let file_name = mineru_archive_file_name(&normalized_entry_name);
    if !is_mineru_markdown_file_name(&file_name) {
        return None;
    }

    let name_rank = match file_name.as_str() {
        "full.md" => 0,
        "index.md" => 1,
        _ if file_name.ends_with(".md") => 2,
        _ => 3,
    };

    Some((
        name_rank,
        normalized_entry_name.matches('/').count(),
        normalized_entry_name.len(),
    ))
}

fn looks_like_zip_response(bytes: &[u8], content_type: &str) -> bool {
    content_type.contains("zip") || bytes.starts_with(b"PK\x03\x04")
}

fn parse_file_parse_response_bytes(
    bytes: &[u8],
    content_type: &str,
) -> Result<ParseExecution, String> {
    let mut zip_error = None;

    if looks_like_zip_response(bytes, content_type) {
        let archive_bytes = bytes.to_vec();
        match parse_result_from_zip_bytes(&archive_bytes) {
            Ok(parse_result) => {
                return Ok(ParseExecution {
                    parse_result,
                    archive_bytes: Some(archive_bytes),
                });
            }
            Err(error) => zip_error = Some(error),
        }
    }

    let payload = serde_json::from_slice::<ModernParseResponse>(bytes).map_err(|e| {
        if let Some(zip_error) = zip_error {
            format!(
                "{}; MinerU /file_parse response was not valid JSON either: {}",
                zip_error, e
            )
        } else {
            format!("Failed to parse MinerU /file_parse response: {}", e)
        }
    })?;

    let first_result = payload
        .results
        .into_iter()
        .next()
        .map(|(_, result)| result)
        .ok_or_else(|| {
            payload
                .message
                .or(payload.error)
                .unwrap_or_else(|| "MinerU returned no parsing result".to_string())
        })?;

    let markdown = first_result.md_content.unwrap_or_default();
    let json = first_result
        .middle_json
        .or(first_result.content_list)
        .or(first_result.model_output)
        .unwrap_or_else(|| "{}".to_string());
    let structure =
        serde_json::from_str(&json).unwrap_or_else(|_| serde_json::Value::String(json.clone()));

    Ok(ParseExecution {
        parse_result: ParseResult {
            markdown,
            json,
            structure,
        },
        archive_bytes: None,
    })
}

fn parse_result_from_zip_bytes(archive_bytes: &[u8]) -> Result<ParseResult, String> {
    let reader = Cursor::new(archive_bytes);
    let mut archive = ZipArchive::new(reader)
        .map_err(|e| format!("Failed to open MinerU parse archive: {}", e))?;

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
            if should_prefer_mineru_markdown_entry(markdown_entry_name.as_deref(), &entry_name) {
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

    let markdown = markdown
        .ok_or_else(|| "MinerU parse archive did not contain a Markdown result file".to_string())?;
    let json_content = layout_json
        .clone()
        .or_else(|| content_list_json.clone())
        .or_else(|| model_json.clone())
        .unwrap_or_else(|| "{}".to_string());
    let structure_source = content_list_json
        .or(layout_json)
        .or(model_json)
        .unwrap_or_else(|| json_content.clone());
    let structure = serde_json::from_str(&structure_source)
        .unwrap_or_else(|_| serde_json::Value::String(structure_source.clone()));

    Ok(ParseResult {
        markdown,
        json: json_content,
        structure,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        looks_like_zip_response, parse_file_parse_response_bytes,
        should_disable_system_proxy, should_prefer_mineru_markdown_entry,
        ParseExecution,
    };
    use serde_json::json;
    use std::io::{Cursor, Write};
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    fn sample_json_payload() -> Vec<u8> {
        json!({
            "results": {
                "sample.pdf": {
                    "md_content": "# Title",
                    "middle_json": "{\"pdf_info\":[]}"
                }
            }
        })
        .to_string()
        .into_bytes()
    }

    fn sample_zip_payload() -> Vec<u8> {
        let mut buffer = Cursor::new(Vec::new());
        {
            let mut writer = ZipWriter::new(&mut buffer);
            let options = SimpleFileOptions::default();
            writer.start_file("full.md", options).unwrap();
            writer.write_all(b"# Title").unwrap();
            writer.start_file("layout.json", options).unwrap();
            writer.write_all(br#"{"pdf_info":[]}"#).unwrap();
            writer.finish().unwrap();
        }
        buffer.into_inner()
    }

    fn sample_zip_payload_with_named_outputs() -> Vec<u8> {
        let mut buffer = Cursor::new(Vec::new());
        {
            let mut writer = ZipWriter::new(&mut buffer);
            let options = SimpleFileOptions::default();
            writer
                .start_file("document-assets/document.md", options)
                .unwrap();
            writer.write_all(b"# Nested Title").unwrap();
            writer
                .start_file("document-assets/document_middle.json", options)
                .unwrap();
            writer.write_all(br#"{"pdf_info":[{"page":1}]}"#).unwrap();
            writer.finish().unwrap();
        }
        buffer.into_inner()
    }

    fn sample_zip_payload_prefers_full_md() -> Vec<u8> {
        let mut buffer = Cursor::new(Vec::new());
        {
            let mut writer = ZipWriter::new(&mut buffer);
            let options = SimpleFileOptions::default();
            writer.start_file("nested/document.md", options).unwrap();
            writer.write_all(b"# Generic Title").unwrap();
            writer.start_file("nested/full.md", options).unwrap();
            writer.write_all(b"# Preferred Title").unwrap();
            writer.start_file("nested/layout.json", options).unwrap();
            writer.write_all(br#"{"pdf_info":[]}"#).unwrap();
            writer.finish().unwrap();
        }
        buffer.into_inner()
    }

    fn expect_json_execution(result: Result<ParseExecution, String>) -> ParseExecution {
        let execution = result.expect("response should parse successfully");
        assert!(execution.archive_bytes.is_none());
        execution
    }

    #[test]
    fn octet_stream_json_response_falls_back_to_json() {
        let execution = expect_json_execution(parse_file_parse_response_bytes(
            &sample_json_payload(),
            "application/octet-stream",
        ));
        assert_eq!(execution.parse_result.markdown, "# Title");
        assert_eq!(execution.parse_result.json, "{\"pdf_info\":[]}");
    }

    #[test]
    fn declared_zip_json_response_falls_back_to_json() {
        let execution = expect_json_execution(parse_file_parse_response_bytes(
            &sample_json_payload(),
            "application/zip",
        ));
        assert_eq!(execution.parse_result.markdown, "# Title");
        assert_eq!(execution.parse_result.json, "{\"pdf_info\":[]}");
    }

    #[test]
    fn zip_magic_response_is_parsed_as_archive() {
        let execution =
            parse_file_parse_response_bytes(&sample_zip_payload(), "application/octet-stream")
                .expect("zip response should parse successfully");
        assert!(execution.archive_bytes.is_some());
        assert_eq!(execution.parse_result.markdown, "# Title");
        assert_eq!(execution.parse_result.json, "{\"pdf_info\":[]}");
    }

    #[test]
    fn zip_archive_accepts_named_markdown_and_middle_json_outputs() {
        let execution = parse_file_parse_response_bytes(
            &sample_zip_payload_with_named_outputs(),
            "application/octet-stream",
        )
        .expect("named zip response should parse successfully");
        assert!(execution.archive_bytes.is_some());
        assert_eq!(execution.parse_result.markdown, "# Nested Title");
        assert_eq!(execution.parse_result.json, "{\"pdf_info\":[{\"page\":1}]}");
    }

    #[test]
    fn zip_archive_prefers_full_md_when_multiple_markdown_files_exist() {
        let execution = parse_file_parse_response_bytes(
            &sample_zip_payload_prefers_full_md(),
            "application/octet-stream",
        )
        .expect("zip response should parse successfully");
        assert_eq!(execution.parse_result.markdown, "# Preferred Title");
    }

    #[test]
    fn zip_detection_requires_zip_signal_or_magic_header() {
        assert!(looks_like_zip_response(
            b"PK\x03\x04rest",
            "application/octet-stream"
        ));
        assert!(looks_like_zip_response(b"{}", "application/zip"));
        assert!(!looks_like_zip_response(
            br#"{"results":{}}"#,
            "application/octet-stream"
        ));
    }

    #[test]
    fn markdown_entry_preference_keeps_best_candidate() {
        assert!(should_prefer_mineru_markdown_entry(
            None,
            "nested/document.md"
        ));
        assert!(should_prefer_mineru_markdown_entry(
            Some("nested/document.md"),
            "nested/full.md"
        ));
        assert!(should_prefer_mineru_markdown_entry(
            Some("deeply/nested/document.md"),
            "document.md"
        ));
        assert!(!should_prefer_mineru_markdown_entry(
            Some("nested/full.md"),
            "document.md"
        ));
    }

    #[test]
    fn loopback_urls_bypass_system_proxy() {
        assert!(should_disable_system_proxy("http://127.0.0.1:8765"));
        assert!(should_disable_system_proxy("http://localhost:8765"));
        assert!(should_disable_system_proxy("http://[::1]:8765"));
        assert!(!should_disable_system_proxy("http://192.168.1.20:8765"));
        assert!(!should_disable_system_proxy("https://mineru.net"));
        assert!(!should_disable_system_proxy("not a url"));
    }
}
