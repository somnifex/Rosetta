use reqwest::multipart::{Form, Part};
use reqwest::{Client, Response, StatusCode};
use serde::Deserialize;
use std::collections::HashMap;
use std::io::{Cursor, Read};
use std::path::Path;
use std::time::Duration;
use zip::ZipArchive;

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

    pub async fn parse_pdf(&self, file_path: &Path) -> Result<ParseExecution, String> {
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
    ) -> Result<Option<ParseExecution>, String> {
        let url = format!("{}/file_parse", self.base_url.trim_end_matches('/'));
        let part = build_pdf_part(file_path).await?;
        let mut form = Form::new()
            .part("files", part)
            .text("return_md", "true")
            .text("return_middle_json", "true")
            // Best-effort: newer mineru-api builds can return the full parse archive,
            // which includes extracted images and other assets we need for layout replay.
            .text("response_format_zip", "true");
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

        let entry_name = file.name().replace('\\', "/");
        let file_name = entry_name
            .rsplit('/')
            .next()
            .unwrap_or(entry_name.as_str())
            .to_ascii_lowercase();

        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)
            .map_err(|e| format!("Failed to read archive entry '{}': {}", entry_name, e))?;
        let text = String::from_utf8_lossy(&bytes).to_string();

        if file_name == "full.md" {
            markdown = Some(text);
            continue;
        }

        if file_name == "layout.json" || file_name == "middle.json" {
            if layout_json.is_none() {
                layout_json = Some(text);
            }
            continue;
        }

        if file_name == "content_list.json" || file_name.ends_with("_content_list.json") {
            if content_list_json.is_none() {
                content_list_json = Some(text);
            }
            continue;
        }

        if file_name == "model.json" || file_name.ends_with("_model.json") {
            if model_json.is_none() {
                model_json = Some(text);
            }
        }
    }

    let markdown = markdown.ok_or_else(|| {
        "MinerU parse archive did not contain the expected full.md file".to_string()
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
    use super::{looks_like_zip_response, parse_file_parse_response_bytes, ParseExecution};
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
}
