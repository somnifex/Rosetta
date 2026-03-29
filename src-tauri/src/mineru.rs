use reqwest::multipart::{Form, Part};
use reqwest::{Client, Response, StatusCode};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

#[derive(Debug, Deserialize)]
pub struct ParseResult {
    pub markdown: String,
    pub json: String,
    pub structure: serde_json::Value,
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

pub struct MinerUClient {
    base_url: String,
    client: Client,
    preferred_backend: Option<String>,
}

impl MinerUClient {
    pub fn new(base_url: String) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(300))
            .build()
            .unwrap_or_else(|_| Client::new());

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

    pub async fn parse_pdf(&self, file_path: &Path) -> Result<ParseResult, String> {
        match self
            .try_parse_with_file_parse_endpoint(file_path, self.preferred_backend.as_deref())
            .await
        {
            Ok(Some(result)) => return Ok(result),
            Ok(None) => {}
            Err(err) => {
                if self.preferred_backend.as_deref() == Some("hybrid-auto-engine") {
                    log::warn!(
                        "MinerU file_parse failed with hybrid-auto-engine, retrying with pipeline: {}",
                        err
                    );
                    match self
                        .try_parse_with_file_parse_endpoint(file_path, Some("pipeline"))
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

    async fn try_parse_with_file_parse_endpoint(
        &self,
        file_path: &Path,
        backend: Option<&str>,
    ) -> Result<Option<ParseResult>, String> {
        let url = format!("{}/file_parse", self.base_url.trim_end_matches('/'));
        let part = build_pdf_part(file_path).await?;
        let mut form = Form::new()
            .part("files", part)
            .text("return_md", "true")
            .text("return_middle_json", "true");
        if let Some(backend) = backend {
            form = form.text("backend", backend.to_string());
        }

        let response = self
            .client
            .post(&url)
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

        let payload = response
            .json::<ModernParseResponse>()
            .await
            .map_err(|e| format!("Failed to parse MinerU /file_parse response: {}", e))?;

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

        Ok(Some(ParseResult {
            markdown,
            json,
            structure,
        }))
    }

    async fn try_parse_with_legacy_endpoint(
        &self,
        file_path: &Path,
    ) -> Result<ParseResult, String> {
        let url = format!("{}/parse", self.base_url.trim_end_matches('/'));
        let part = build_pdf_part(file_path).await?;
        let form = Form::new().part("file", part);

        let response = self
            .client
            .post(&url)
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

        Ok(ParseResult {
            markdown: result.markdown,
            json: result.json,
            structure: result.structure,
        })
    }

    pub async fn health_check(&self) -> Result<bool, String> {
        let url = format!("{}/health", self.base_url.trim_end_matches('/'));

        match self.client.get(&url).send().await {
            Ok(resp) => Ok(resp.status().is_success()),
            Err(_) => Ok(false),
        }
    }
}

async fn build_pdf_part(file_path: &Path) -> Result<Part, String> {
    let file_bytes = tokio::fs::read(file_path)
        .await
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let file_name = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file.pdf")
        .to_string();

    Part::bytes(file_bytes)
        .file_name(file_name)
        .mime_str("application/pdf")
        .map_err(|e| format!("Failed to set MIME type: {}", e))
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

fn truncate_message(message: &str, max_chars: usize) -> String {
    let total_chars = message.chars().count();
    if total_chars <= max_chars {
        return message.to_string();
    }

    let truncated: String = message.chars().take(max_chars).collect();
    format!("{}...", truncated)
}
