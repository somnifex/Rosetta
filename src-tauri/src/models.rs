use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Document {
    pub id: String,
    pub title: String,
    pub filename: String,
    pub file_path: String,
    pub file_size: i64,
    pub page_count: i32,
    pub source_language: Option<String>,
    pub target_language: Option<String>,
    pub category_id: Option<String>,
    pub folder_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub parse_status: String,
    pub translation_status: String,
    pub index_status: String,
    pub sync_status: String,
    pub category_name: Option<String>,
    pub folder_name: Option<String>,
    pub tags: Option<Vec<Tag>>,
    pub is_file_missing: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParseJob {
    pub id: String,
    pub document_id: String,
    pub status: String,
    pub progress: f64,
    pub error_message: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslationJob {
    pub id: String,
    pub document_id: String,
    pub provider_id: String,
    pub status: String,
    pub progress: f64,
    pub total_chunks: i32,
    pub completed_chunks: i32,
    pub error_message: Option<String>,
    pub config: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    pub max_retries: i32,
    pub priority: i32,
    pub models: Vec<ProviderModel>,
    pub chat_model: Option<String>,
    pub translate_model: Option<String>,
    pub embedding_model: Option<String>,
    pub rerank_model: Option<String>,
    pub headers: Option<String>,
    pub organization: Option<String>,
    pub timeout: Option<i32>,
    pub concurrency: i32,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderModel {
    pub id: String,
    pub provider_id: String,
    pub name: String,
    pub model_type: String,
    pub model_name: String,
    pub supports_vision: bool,
    pub is_active: bool,
    pub priority: i32,
    pub config: Option<ProviderModelConfig>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProviderModelConfig {
    pub dimensions: Option<usize>,
    pub rerank_top_n: Option<usize>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LlmSamplingConfig {
    pub temperature: Option<f64>,
    pub top_p: Option<f64>,
    pub top_k: Option<i32>,
    pub max_tokens: Option<i32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUpsertInput {
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    pub max_retries: Option<i32>,
    pub priority: Option<i32>,
    pub headers: Option<String>,
    pub organization: Option<String>,
    pub timeout: Option<i32>,
    pub concurrency: Option<i32>,
    pub is_active: Option<bool>,
    #[serde(default)]
    pub models: Vec<ProviderModelInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelInput {
    pub id: Option<String>,
    pub name: String,
    pub model_type: String,
    pub model_name: String,
    pub supports_vision: Option<bool>,
    pub is_active: Option<bool>,
    pub priority: Option<i32>,
    pub config: Option<ProviderModelConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Category {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub parent_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Chunk {
    pub id: String,
    pub document_id: String,
    pub content: String,
    pub translated_content: Option<String>,
    pub chunk_index: i32,
    pub page_number: Option<i32>,
    pub section_title: Option<String>,
    pub metadata: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedContent {
    pub id: String,
    pub document_id: String,
    pub version: i32,
    pub markdown_content: String,
    pub json_content: String,
    pub structure_tree: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslatedContent {
    pub id: String,
    pub document_id: String,
    pub version: i32,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentOutput {
    pub id: String,
    pub document_id: String,
    pub output_type: String,
    pub file_path: String,
    pub created_at: String,
    pub updated_at: String,
    pub is_file_missing: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchActionFailure {
    pub document_id: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchActionReport {
    pub requested: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub failures: Vec<BatchActionFailure>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentCleanupIssue {
    pub resource_type: String,
    pub path: Option<String>,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermanentDeleteOutcome {
    pub document_id: String,
    pub title: String,
    pub deleted: bool,
    pub resources_deleted: usize,
    pub resources_missing: usize,
    pub issues: Vec<DocumentCleanupIssue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermanentDeleteReport {
    pub requested: usize,
    pub deleted: usize,
    pub failed: usize,
    pub outcomes: Vec<PermanentDeleteOutcome>,
}
