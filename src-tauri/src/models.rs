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
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub parse_status: String,
    pub translation_status: String,
    pub index_status: String,
    pub sync_status: String,
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
    pub chat_model: Option<String>,
    pub embedding_model: Option<String>,
    pub rerank_model: Option<String>,
    pub headers: Option<String>,
    pub organization: Option<String>,
    pub max_tokens: Option<i32>,
    pub temperature: Option<f64>,
    pub timeout: Option<i32>,
    pub concurrency: i32,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
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
