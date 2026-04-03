use crate::chunking::{ChunkingConfig, TextChunker};
use crate::models::{DocumentMetadataField, ExtractionTemplate, LlmSamplingConfig};
use crate::retry::{should_retry_network_error, with_retry, RetryConfig};
use chrono::Utc;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

const META_JSON_FILENAME: &str = "meta.json";
const META_EXTRACTION_KEY: &str = "extraction";
const JSON_RESPONSE_FALLBACK_HINTS: &[&str] = &[
    "response_format",
    "json_object",
    "json schema",
    "json_schema",
    "unsupported value",
    "invalid parameter",
];

#[derive(Debug, Clone, Copy)]
pub struct BuiltinExtractionTemplateDefinition {
    pub id: &'static str,
    pub name: &'static str,
    pub field_key: &'static str,
    pub description: &'static str,
    pub system_prompt: &'static str,
    pub user_prompt: &'static str,
    pub default_enabled: bool,
}

impl BuiltinExtractionTemplateDefinition {
    pub fn to_template(self, enabled: bool) -> ExtractionTemplate {
        ExtractionTemplate {
            id: self.id.to_string(),
            name: self.name.to_string(),
            field_key: self.field_key.to_string(),
            description: Some(self.description.to_string()),
            system_prompt: self.system_prompt.to_string(),
            user_prompt: self.user_prompt.to_string(),
            is_enabled: enabled,
            is_builtin: true,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }
}

const BUILTIN_EXTRACTION_TEMPLATES: &[BuiltinExtractionTemplateDefinition] = &[
    BuiltinExtractionTemplateDefinition {
        id: "builtin:title",
        name: "Title",
        field_key: "title",
        description: "Extract the document title from the opening pages.",
        system_prompt: "Identify the formal title of the document. Prefer the actual article or paper title, not the filename or running header.",
        user_prompt: "Extract the document title from the text below.\n\n{{document_text}}",
        default_enabled: true,
    },
    BuiltinExtractionTemplateDefinition {
        id: "builtin:authors",
        name: "Authors",
        field_key: "authors",
        description: "Extract the author list in original order.",
        system_prompt: "Extract the author names from the document header. Preserve the original order and return a concise semicolon-separated list.",
        user_prompt: "Extract the author list from the text below.\n\n{{document_text}}",
        default_enabled: true,
    },
    BuiltinExtractionTemplateDefinition {
        id: "builtin:doi",
        name: "DOI",
        field_key: "doi",
        description: "Extract the document DOI when available.",
        system_prompt: "Extract the DOI only. Return the DOI string without labels or prefixes. If none is available, return an empty string.",
        user_prompt: "Extract the DOI from the text below.\n\n{{document_text}}",
        default_enabled: true,
    },
    BuiltinExtractionTemplateDefinition {
        id: "builtin:publication_date",
        name: "Publication Date",
        field_key: "publication_date",
        description: "Extract the publication date or year.",
        system_prompt: "Extract the publication date. Prefer ISO-like forms such as YYYY-MM-DD, YYYY-MM, or YYYY when possible. If only a textual date is present, return the clearest exact form found.",
        user_prompt: "Extract the publication date from the text below.\n\n{{document_text}}",
        default_enabled: true,
    },
    BuiltinExtractionTemplateDefinition {
        id: "builtin:journal",
        name: "Journal or Venue",
        field_key: "journal",
        description: "Extract the journal, conference, or venue name.",
        system_prompt: "Extract the journal, conference, or venue name for this document. Prefer the primary publication venue only.",
        user_prompt: "Extract the journal or venue name from the text below.\n\n{{document_text}}",
        default_enabled: false,
    },
    BuiltinExtractionTemplateDefinition {
        id: "builtin:keywords",
        name: "Keywords",
        field_key: "keywords",
        description: "Extract the keywords line when present.",
        system_prompt: "Extract the keyword list. Return a semicolon-separated list without adding extra keywords.",
        user_prompt: "Extract the keywords from the text below.\n\n{{document_text}}",
        default_enabled: false,
    },
    BuiltinExtractionTemplateDefinition {
        id: "builtin:abstract",
        name: "Abstract",
        field_key: "abstract",
        description: "Extract the abstract text from the document header.",
        system_prompt: "Extract the abstract text only. Remove heading labels such as 'Abstract' or '摘要'. Preserve the original wording as much as possible.",
        user_prompt: "Extract the abstract from the text below.\n\n{{document_text}}",
        default_enabled: false,
    },
    BuiltinExtractionTemplateDefinition {
        id: "builtin:institution",
        name: "Institution",
        field_key: "institution",
        description: "Extract the primary affiliation or institution names.",
        system_prompt: "Extract the main institution or affiliation names associated with the authors. Return a concise semicolon-separated list.",
        user_prompt: "Extract the institution or affiliation names from the text below.\n\n{{document_text}}",
        default_enabled: false,
    },
];

#[derive(Debug, Serialize, Clone)]
struct ExtractionChatRequest {
    model: String,
    messages: Vec<Message>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    top_p: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    top_k: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_format: Option<ResponseFormat>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Message {
    role: String,
    content: String,
}

#[derive(Debug, Serialize, Clone)]
struct ResponseFormat {
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: Message,
}

pub struct Extractor {
    base_url: String,
    api_key: String,
    model: String,
    sampling: LlmSamplingConfig,
    client: Client,
    retry_config: RetryConfig,
}

impl Extractor {
    pub fn new(
        base_url: String,
        api_key: String,
        model: String,
        sampling: LlmSamplingConfig,
    ) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(180))
            .build()
            .unwrap_or_else(|_| Client::new());

        Self {
            base_url,
            api_key,
            model,
            sampling,
            client,
            retry_config: RetryConfig::for_network(),
        }
    }

    pub fn with_retry_config(mut self, config: RetryConfig) -> Self {
        self.retry_config = config;
        self
    }

    pub async fn extract_field(
        &self,
        template: &ExtractionTemplate,
        document_text: &str,
    ) -> Result<Option<String>, String> {
        if document_text.trim().is_empty() {
            return Ok(None);
        }

        let request_with_json = self.build_request(template, document_text, true);
        match self.send_request(request_with_json).await {
            Ok(raw) => return Ok(parse_structured_value(&raw).or_else(|| parse_plain_value(&raw))),
            Err(error) if supports_json_fallback(&error) => {
                log::warn!(
                    "Falling back to plain-text extraction for field '{}' because JSON mode failed: {}",
                    template.field_key,
                    error
                );
            }
            Err(error) => return Err(error),
        }

        let request_plain = self.build_request(template, document_text, false);
        let raw = self.send_request(request_plain).await?;
        Ok(parse_structured_value(&raw).or_else(|| parse_plain_value(&raw)))
    }

    fn build_request(
        &self,
        template: &ExtractionTemplate,
        document_text: &str,
        use_json_response: bool,
    ) -> ExtractionChatRequest {
        let system_prompt = format!(
            "{}\n\nReturn exactly one metadata field named `{}`. Never invent values. If the value is not available, return an empty string. When JSON mode is enabled, return exactly {{\"value\": \"...\"}}.",
            template.system_prompt.trim(),
            template.field_key
        );

        let rendered_user_prompt = render_user_prompt(template, document_text);

        ExtractionChatRequest {
            model: self.model.clone(),
            messages: vec![
                Message {
                    role: "system".to_string(),
                    content: system_prompt,
                },
                Message {
                    role: "user".to_string(),
                    content: rendered_user_prompt,
                },
            ],
            temperature: self.sampling.temperature.or(Some(0.1)),
            top_p: self.sampling.top_p,
            top_k: self.sampling.top_k,
            max_tokens: self.sampling.max_tokens.or(Some(800)),
            response_format: use_json_response.then(|| ResponseFormat {
                kind: "json_object".to_string(),
            }),
        }
    }

    async fn send_request(&self, request: ExtractionChatRequest) -> Result<String, String> {
        let url = openai_compatible_url(&self.base_url, "chat/completions");
        let client = self.client.clone();
        let auth_header = format!("Bearer {}", self.api_key);
        let retry_config = self.retry_config.clone();

        with_retry(
            &retry_config,
            || {
                let req = request.clone();
                let url = url.clone();
                let auth = auth_header.clone();
                let client = client.clone();
                async move {
                    let response = client
                        .post(&url)
                        .header("Authorization", auth)
                        .json(&req)
                        .send()
                        .await
                        .map_err(|e| format!("Extraction request failed: {e}"))?;

                    if !response.status().is_success() {
                        let status = response.status();
                        let text = response.text().await.unwrap_or_default();
                        return Err(format!("Extraction API returned {}: {}", status, text));
                    }

                    let chat_response: ChatResponse = response
                        .json()
                        .await
                        .map_err(|e| format!("Failed to parse extraction response: {e}"))?;

                    chat_response
                        .choices
                        .first()
                        .map(|choice| choice.message.content.clone())
                        .filter(|content| !content.trim().is_empty())
                        .ok_or_else(|| "Extraction API returned an empty completion".to_string())
                }
            },
            should_retry_network_error,
        )
        .await
    }
}

pub fn builtin_templates() -> &'static [BuiltinExtractionTemplateDefinition] {
    BUILTIN_EXTRACTION_TEMPLATES
}

pub fn builtin_template_by_field_key(
    field_key: &str,
) -> Option<&'static BuiltinExtractionTemplateDefinition> {
    builtin_templates()
        .iter()
        .find(|template| template.field_key == field_key)
}

pub fn is_builtin_field_key(field_key: &str) -> bool {
    builtin_template_by_field_key(field_key).is_some()
}

pub fn prepare_extraction_input(text: &str, max_tokens_per_chunk: usize) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let mut config = ChunkingConfig::for_translate();
    config.max_tokens_per_chunk = max_tokens_per_chunk.max(256);
    config.overlap_tokens = 0;
    let chunker = TextChunker::new(config);
    chunker
        .chunk(trimmed)
        .into_iter()
        .next()
        .map(|chunk| chunk.text)
        .unwrap_or_else(|| trimmed.to_string())
}

pub fn read_meta_json(
    app_dir: &Path,
    document_id: &str,
) -> Result<Vec<DocumentMetadataField>, String> {
    let path = meta_json_path(app_dir, document_id);
    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let root_value = serde_json::from_str::<Value>(&content).map_err(|e| {
        format!(
            "Failed to parse extraction metadata file {}: {}",
            path.display(),
            e
        )
    })?;

    let fields = root_value
        .get(META_EXTRACTION_KEY)
        .and_then(|value| value.get("fields"))
        .and_then(|value| value.as_object())
        .cloned()
        .unwrap_or_default();

    let mut rows = Vec::with_capacity(fields.len());
    for (field_key, value) in fields {
        let field_value = value
            .get("value")
            .and_then(json_value_to_string)
            .filter(|value| !value.trim().is_empty());
        let provider_id = value
            .get("provider_id")
            .and_then(|raw| raw.as_str())
            .map(|raw| raw.to_string());
        let model_name = value
            .get("model_name")
            .and_then(|raw| raw.as_str())
            .map(|raw| raw.to_string());
        let extracted_at = value
            .get("extracted_at")
            .and_then(|raw| raw.as_str())
            .unwrap_or_default()
            .to_string();
        let error = value
            .get("error")
            .and_then(|raw| raw.as_str())
            .map(|raw| raw.to_string());

        rows.push(DocumentMetadataField {
            id: String::new(),
            document_id: document_id.to_string(),
            field_key,
            field_value,
            provider_id,
            model_name,
            extracted_at,
            error,
        });
    }

    rows.sort_by(|left, right| left.field_key.cmp(&right.field_key));
    Ok(rows)
}

pub fn write_meta_json(
    app_dir: &Path,
    document_id: &str,
    rows: &[DocumentMetadataField],
) -> Result<(), String> {
    let path = meta_json_path(app_dir, document_id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mut root = if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str::<Map<String, Value>>(&content).unwrap_or_default()
    } else {
        Map::new()
    };

    if rows.is_empty() {
        root.remove(META_EXTRACTION_KEY);
    } else {
        let mut fields = Map::new();
        for row in rows {
            let mut field = Map::new();
            field.insert(
                "value".to_string(),
                row.field_value
                    .as_ref()
                    .map(|value| Value::String(value.clone()))
                    .unwrap_or(Value::Null),
            );
            field.insert(
                "provider_id".to_string(),
                row.provider_id
                    .as_ref()
                    .map(|value| Value::String(value.clone()))
                    .unwrap_or(Value::Null),
            );
            field.insert(
                "model_name".to_string(),
                row.model_name
                    .as_ref()
                    .map(|value| Value::String(value.clone()))
                    .unwrap_or(Value::Null),
            );
            field.insert(
                "extracted_at".to_string(),
                Value::String(row.extracted_at.clone()),
            );
            field.insert(
                "error".to_string(),
                row.error
                    .as_ref()
                    .map(|value| Value::String(value.clone()))
                    .unwrap_or(Value::Null),
            );
            fields.insert(row.field_key.clone(), Value::Object(field));
        }

        root.insert(
            META_EXTRACTION_KEY.to_string(),
            json!({
                "version": 1,
                "updated_at": Utc::now().to_rfc3339(),
                "fields": fields,
            }),
        );
    }

    let serialized = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    fs::write(&path, serialized).map_err(|e| e.to_string())
}

fn render_user_prompt(template: &ExtractionTemplate, document_text: &str) -> String {
    let mut prompt = template
        .user_prompt
        .replace("{{document_text}}", document_text)
        .replace("{{field_key}}", &template.field_key)
        .replace("{{template_name}}", &template.name);

    if !template.user_prompt.contains("{{document_text}}") {
        prompt.push_str("\n\nDocument text:\n");
        prompt.push_str(document_text);
    }

    prompt
}

fn parse_structured_value(raw: &str) -> Option<String> {
    let structured = parse_json_payload(raw)?;
    structured
        .get("value")
        .and_then(json_value_to_string)
        .map(normalize_value)
        .filter(|value| !value.is_empty())
}

fn parse_plain_value(raw: &str) -> Option<String> {
    let cleaned = normalize_value(strip_code_fence(raw));
    (!cleaned.is_empty()).then_some(cleaned)
}

fn normalize_value(raw: impl AsRef<str>) -> String {
    raw.as_ref()
        .trim()
        .trim_matches(|ch| matches!(ch, '"' | '\'' | '`'))
        .replace("\r\n", "\n")
        .trim()
        .to_string()
}

fn parse_json_payload(raw: &str) -> Option<Value> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    serde_json::from_str::<Value>(trimmed)
        .ok()
        .or_else(|| serde_json::from_str::<Value>(&strip_code_fence(trimmed)).ok())
        .or_else(|| {
            let start = trimmed.find('{')?;
            let end = trimmed.rfind('}')?;
            if end <= start {
                return None;
            }
            serde_json::from_str::<Value>(&trimmed[start..=end]).ok()
        })
}

fn strip_code_fence(raw: &str) -> String {
    let trimmed = raw.trim();
    if !trimmed.starts_with("```") {
        return trimmed.to_string();
    }

    let mut lines = trimmed.lines();
    let _ = lines.next();
    let mut body = lines.collect::<Vec<_>>();
    if matches!(body.last(), Some(last) if last.trim_start().starts_with("```")) {
        let _ = body.pop();
    }
    body.join("\n")
}

fn json_value_to_string(value: &Value) -> Option<String> {
    match value {
        Value::Null => None,
        Value::String(raw) => Some(raw.clone()),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(flag) => Some(flag.to_string()),
        Value::Array(values) => {
            let items = values
                .iter()
                .filter_map(json_value_to_string)
                .map(|value| normalize_value(value))
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>();
            (!items.is_empty()).then(|| items.join("; "))
        }
        Value::Object(_) => Some(value.to_string()),
    }
}

fn supports_json_fallback(error: &str) -> bool {
    let lower = error.to_ascii_lowercase();
    JSON_RESPONSE_FALLBACK_HINTS
        .iter()
        .any(|hint| lower.contains(hint))
}

fn meta_json_path(app_dir: &Path, document_id: &str) -> PathBuf {
    crate::app_dirs::document_contents_dir(app_dir)
        .join(document_id)
        .join(META_JSON_FILENAME)
}

fn openai_compatible_url(base_url: &str, path: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/v1") {
        format!("{trimmed}/{path}")
    } else {
        format!("{trimmed}/v1/{path}")
    }
}
