use crate::commands::{
    execute_index_job_with_embedding_provider, load_llm_sampling_config, DirectEmbeddingProvider,
};
use crate::embedder::Embedder;
use crate::models::LlmSamplingConfig;
use crate::AppState;
use reqwest::Client;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

const EVENT_CHAT_CHUNK: &str = "rag-chat-chunk";
const EVENT_CHAT_DONE: &str = "rag-chat-done";
const EVENT_CHAT_ERROR: &str = "rag-chat-error";

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiChannelConfig {
    pub name: Option<String>,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub max_retries: Option<i32>,
    #[serde(default)]
    pub dimensions: Option<usize>,
    #[serde(default)]
    pub rerank_top_n: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RagChatMessageInput {
    pub role: String,
    pub content: String,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagChatAttachment {
    pub document_id: String,
    pub title: String,
    pub filename: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagChatRequest {
    pub request_id: String,
    pub chat_channel: OpenAiChannelConfig,
    pub embed_channel: OpenAiChannelConfig,
    pub rerank_channel: Option<OpenAiChannelConfig>,
    pub messages: Vec<RagChatMessageInput>,
    #[serde(default)]
    pub attachments: Vec<RagChatAttachment>,
    pub top_k: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RagChatSource {
    pub document_id: String,
    pub document_title: String,
    pub chunk_id: String,
    pub chunk_index: i32,
    pub score: f32,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RagChatChunkEvent {
    request_id: String,
    delta: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RagChatDoneEvent {
    request_id: String,
    sources: Vec<RagChatSource>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RagChatErrorEvent {
    request_id: String,
    message: String,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionChunk {
    choices: Vec<ChatCompletionChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionChoice {
    delta: ChatCompletionDelta,
}

#[derive(Debug, Default, Deserialize)]
struct ChatCompletionDelta {
    content: Option<String>,
}

#[derive(Debug, Clone)]
struct RetrievedChunkRow {
    chunk_id: String,
    document_id: String,
    document_title: String,
    content: String,
    chunk_index: i32,
}

fn take_chat_request_handle(
    state: &AppState,
    request_id: &str,
) -> Result<Option<tauri::async_runtime::JoinHandle<()>>, String> {
    let mut handles = state
        .chat_request_handles
        .lock()
        .map_err(|e| e.to_string())?;
    Ok(handles.remove(request_id))
}

fn openai_compatible_url(base_url: &str, path: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/v1") {
        format!("{trimmed}/{path}")
    } else {
        format!("{trimmed}/v1/{path}")
    }
}

fn emit_chunk(app: &AppHandle, request_id: &str, delta: &str) -> Result<(), String> {
    app.emit(
        EVENT_CHAT_CHUNK,
        RagChatChunkEvent {
            request_id: request_id.to_string(),
            delta: delta.to_string(),
        },
    )
    .map_err(|e| e.to_string())
}

fn emit_done(
    app: &AppHandle,
    request_id: &str,
    sources: Vec<RagChatSource>,
) -> Result<(), String> {
    app.emit(
        EVENT_CHAT_DONE,
        RagChatDoneEvent {
            request_id: request_id.to_string(),
            sources,
        },
    )
    .map_err(|e| e.to_string())
}

fn emit_error(app: &AppHandle, request_id: &str, message: &str) -> Result<(), String> {
    app.emit(
        EVENT_CHAT_ERROR,
        RagChatErrorEvent {
            request_id: request_id.to_string(),
            message: message.to_string(),
        },
    )
    .map_err(|e| e.to_string())
}

fn latest_user_message(messages: &[RagChatMessageInput]) -> Result<&str, String> {
    messages
        .iter()
        .rev()
        .find(|message| message.role == "user" && !message.content.trim().is_empty())
        .map(|message| message.content.trim())
        .ok_or_else(|| "No user message was provided for the chat request".to_string())
}

fn dedupe_document_ids(attachments: &[RagChatAttachment]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();

    for attachment in attachments {
        if seen.insert(attachment.document_id.clone()) {
            result.push(attachment.document_id.clone());
        }
    }

    result
}

async fn ensure_documents_indexed(
    state: &AppState,
    app_dir: &Path,
    document_ids: &[String],
    provider: &DirectEmbeddingProvider,
    expected_collection_key: Option<&str>,
) -> Result<(), String> {
    if document_ids.is_empty() {
        return Ok(());
    }

    let expected_backend = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();
        let rag_settings = crate::zvec::load_rag_settings(conn)?;
        let zvec_settings = crate::zvec::load_zvec_settings(conn, app_dir)?;
        if crate::zvec::should_use_zvec(
            &rag_settings,
            app_dir,
            &zvec_settings,
            &state.zvec_availability_cache,
        ) {
            "zvec"
        } else {
            "sqlite"
        }
        .to_string()
    };

    for document_id in document_ids {
        let needs_index = {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            let conn = db.get_connection();

            let (title, has_parsed_content, has_chunks) = conn
                .query_row(
                    "SELECT d.title,
                            EXISTS(SELECT 1 FROM parsed_contents pc WHERE pc.document_id = d.id),
                            EXISTS(SELECT 1 FROM chunks c WHERE c.document_id = d.id)
                     FROM documents d
                     WHERE d.id = ?1",
                    [document_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, i64>(1)? != 0,
                            row.get::<_, i64>(2)? != 0,
                        ))
                    },
                )
                .optional()
                .map_err(|e| e.to_string())?
                .ok_or_else(|| format!("Document {document_id} was not found"))?;

            if !has_parsed_content {
                return Err(format!(
                    "Document \"{}\" has not been parsed yet, so it cannot participate in RAG chat.",
                    title
                ));
            }

            let record = crate::zvec::load_document_index_record(conn, document_id)?;

            match record {
                Some(record)
                    if has_chunks
                        && record.backend.eq_ignore_ascii_case(&expected_backend)
                        && record.embedding_model.as_deref() == Some(provider.embedding_model.as_str())
                        && record.collection_key.as_deref() == expected_collection_key =>
                {
                    false
                }
                _ => true,
            }
        };

        if needs_index {
            execute_index_job_with_embedding_provider(state, app_dir, document_id, provider).await?;
        }
    }

    Ok(())
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm_a == 0.0 || norm_b == 0.0 {
        0.0
    } else {
        dot / (norm_a * norm_b)
    }
}

fn load_chunk_rows_by_ids(
    conn: &rusqlite::Connection,
    chunk_ids: &[String],
) -> Result<HashMap<String, RetrievedChunkRow>, String> {
    if chunk_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let placeholders = (1..=chunk_ids.len())
        .map(|idx| format!("?{idx}"))
        .collect::<Vec<_>>()
        .join(", ");

    let sql = format!(
        "SELECT c.id, c.document_id, d.title, c.content, c.chunk_index
         FROM chunks c
         JOIN documents d ON d.id = c.document_id
         WHERE c.id IN ({placeholders})"
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(chunk_ids.iter()), |row| {
            Ok(RetrievedChunkRow {
                chunk_id: row.get(0)?,
                document_id: row.get(1)?,
                document_title: row.get(2)?,
                content: row.get(3)?,
                chunk_index: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .map(|row| (row.chunk_id.clone(), row))
        .collect::<HashMap<_, _>>())
}

fn row_matches_filter(row: &RetrievedChunkRow, document_filter: &Option<HashSet<String>>) -> bool {
    document_filter
        .as_ref()
        .map(|filter| filter.contains(&row.document_id))
        .unwrap_or(true)
}

fn search_sqlite_chunks(
    conn: &rusqlite::Connection,
    query_embedding: &[f32],
    embedding_model: &str,
    document_filter: &Option<HashSet<String>>,
    limit: usize,
) -> Result<Vec<RagChatSource>, String> {
    let dimension = query_embedding.len();
    let fetch_limit = if document_filter.is_some() {
        limit.saturating_mul(8)
    } else {
        limit.saturating_mul(4)
    }
    .max(limit);

    let query_bytes: Vec<u8> = query_embedding
        .iter()
        .flat_map(|f| f.to_le_bytes())
        .collect();

    // Try vec0 KNN search first
    if let Ok(hits) =
        crate::zvec::vec0_search(conn, dimension, &query_bytes, embedding_model, fetch_limit)
    {
        if !hits.is_empty() {
            let chunk_ids: Vec<String> = hits.iter().map(|(id, _)| id.clone()).collect();
            let row_map = load_chunk_rows_by_ids(conn, &chunk_ids)?;

            let mut results: Vec<RagChatSource> = hits
                .into_iter()
                .filter_map(|(chunk_id, distance)| {
                    row_map.get(&chunk_id).and_then(|row| {
                        if !row_matches_filter(row, document_filter) {
                            return None;
                        }
                        Some(RagChatSource {
                            document_id: row.document_id.clone(),
                            document_title: row.document_title.clone(),
                            chunk_id: row.chunk_id.clone(),
                            chunk_index: row.chunk_index,
                            score: 1.0 - distance,
                            content: row.content.clone(),
                        })
                    })
                })
                .collect();

            results.truncate(limit);
            return Ok(results);
        }
    }

    // Fallback: brute-force cosine similarity over embeddings BLOB
    log::info!("vec0 search returned no results, falling back to brute-force cosine similarity");

    let mut stmt = conn
        .prepare(
            "SELECT c.id, c.document_id, d.title, c.content, c.chunk_index, e.vector
             FROM chunks c
             JOIN embeddings e ON e.chunk_id = c.id
             JOIN documents d ON d.id = c.document_id
             WHERE e.model = ?1
             ORDER BY c.created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([embedding_model], |row| {
            Ok((
                RetrievedChunkRow {
                    chunk_id: row.get(0)?,
                    document_id: row.get(1)?,
                    document_title: row.get(2)?,
                    content: row.get(3)?,
                    chunk_index: row.get(4)?,
                },
                row.get::<_, Vec<u8>>(5)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut results = rows
        .into_iter()
        .filter_map(|(row, vector_bytes)| {
            if !row_matches_filter(&row, document_filter) {
                return None;
            }

            let embedding = vector_bytes
                .chunks_exact(4)
                .map(|bytes| f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
                .collect::<Vec<_>>();

            Some(RagChatSource {
                document_id: row.document_id,
                document_title: row.document_title,
                chunk_id: row.chunk_id,
                chunk_index: row.chunk_index,
                score: cosine_similarity(query_embedding, &embedding),
                content: row.content,
            })
        })
        .collect::<Vec<_>>();

    results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    results.truncate(limit);
    Ok(results)
}

fn search_zvec_chunks(
    conn: &rusqlite::Connection,
    app_dir: &Path,
    zvec_settings: &crate::zvec::ZvecSettings,
    query_embedding: &[f32],
    embedding_model: &str,
    document_filter: &Option<HashSet<String>>,
    limit: usize,
) -> Result<Vec<RagChatSource>, String> {
    let collection_key = crate::zvec::collection_key_for_model(embedding_model, query_embedding.len());
    let hit_limit = if document_filter.is_some() {
        limit.saturating_mul(8)
    } else {
        limit.saturating_mul(4)
    }
    .max(limit);

    let hits = crate::zvec::search_embeddings(
        app_dir,
        zvec_settings,
        &collection_key,
        query_embedding,
        hit_limit,
    )?;

    if hits.is_empty() {
        return Ok(Vec::new());
    }

    let chunk_ids = hits.iter().map(|hit| hit.id.clone()).collect::<Vec<_>>();
    let row_map = load_chunk_rows_by_ids(conn, &chunk_ids)?;

    let mut results = hits
        .into_iter()
        .filter_map(|hit| {
            row_map.get(&hit.id).and_then(|row| {
                if !row_matches_filter(row, document_filter) {
                    return None;
                }

                Some(RagChatSource {
                    document_id: row.document_id.clone(),
                    document_title: row.document_title.clone(),
                    chunk_id: row.chunk_id.clone(),
                    chunk_index: row.chunk_index,
                    score: hit.score.unwrap_or(0.0),
                    content: row.content.clone(),
                })
            })
        })
        .collect::<Vec<_>>();

    results.truncate(limit);
    Ok(results)
}

fn apply_rerank_scores(
    sources: Vec<RagChatSource>,
    reranked: &[(String, f32)],
    limit: usize,
) -> Vec<RagChatSource> {
    let score_map: HashMap<String, f32> = reranked.iter().cloned().collect();
    let mut results: Vec<RagChatSource> = sources
        .into_iter()
        .filter_map(|mut source| {
            score_map.get(&source.chunk_id).map(|&score| {
                source.score = score;
                source
            })
        })
        .collect();
    results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    results.truncate(limit);
    results
}

async fn retrieve_context(
    state: &AppState,
    app_dir: &Path,
    request: &RagChatRequest,
) -> Result<Vec<RagChatSource>, String> {
    let query = latest_user_message(&request.messages)?.to_string();
    let provider = DirectEmbeddingProvider {
        base_url: request.embed_channel.base_url.clone(),
        api_key: request.embed_channel.api_key.clone(),
        embedding_model: request.embed_channel.model.clone(),
        dimensions: request.embed_channel.dimensions,
    };
    let top_k = request.top_k.unwrap_or(6).clamp(1, 12);

    let embedder = Embedder::new(
        provider.base_url.clone(),
        provider.api_key.clone(),
        provider.embedding_model.clone(),
        provider.dimensions,
    );
    let query_embeddings = embedder.embed(vec![query.clone()]).await?;
    let query_embedding = query_embeddings
        .first()
        .ok_or_else(|| "Embedding provider returned no vectors".to_string())?;

    let document_ids = dedupe_document_ids(&request.attachments);
    let document_filter = if document_ids.is_empty() {
        None
    } else {
        Some(document_ids.iter().cloned().collect::<HashSet<_>>())
    };

    let (rag_settings, zvec_settings, use_zvec_retrieval, expected_collection_key) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();
        let rag_settings = crate::zvec::load_rag_settings(conn)?;
        let zvec_settings = crate::zvec::load_zvec_settings(conn, app_dir)?;
        let use_zvec = crate::zvec::should_use_zvec(
            &rag_settings,
            app_dir,
            &zvec_settings,
            &state.zvec_availability_cache,
        );
        let expected_collection_key = if use_zvec {
            Some(crate::zvec::collection_key_for_model(
                &provider.embedding_model,
                query_embedding.len(),
            ))
        } else {
            None
        };

        (rag_settings, zvec_settings, use_zvec, expected_collection_key)
    };

    if crate::zvec::vector_backend_is_zvec(&rag_settings) && !use_zvec_retrieval {
        log::warn!("zvec unavailable; falling back to sqlite-vec for RAG retrieval");
    }

    let reranker_mode = rag_settings.reranker_mode.clone();
    let reranker_top_n = rag_settings.reranker_top_n;

    let fetch_limit = if reranker_mode != "disabled" {
        top_k.saturating_mul(4).max(top_k)
    } else {
        top_k
    };

    if !document_ids.is_empty() {
        ensure_documents_indexed(
            state,
            app_dir,
            &document_ids,
            &provider,
            expected_collection_key.as_deref(),
        )
        .await?;
    }

    let mut sources = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.get_connection();

        if use_zvec_retrieval {
            search_zvec_chunks(
                conn,
                app_dir,
                &zvec_settings,
                query_embedding,
                &provider.embedding_model,
                &document_filter,
                fetch_limit,
            )
        } else {
            search_sqlite_chunks(
                conn,
                query_embedding,
                &provider.embedding_model,
                &document_filter,
                fetch_limit,
            )
        }
    }?;

    if sources.is_empty() {
        return Ok(sources);
    }

    if reranker_mode == "local" {
        let docs: Vec<(String, String)> = sources
            .iter()
            .map(|s| (s.chunk_id.clone(), s.content.clone()))
            .collect();
        let reranked = crate::zvec::rerank_via_bridge(
            app_dir,
            &zvec_settings,
            &query,
            &docs,
            reranker_top_n.min(top_k),
        )?;
        let scored: Vec<(String, f32)> = reranked
            .into_iter()
            .map(|hit| (hit.id, hit.score.unwrap_or(0.0)))
            .collect();
        sources = apply_rerank_scores(sources, &scored, top_k);
    } else if reranker_mode == "remote" {
        if let Some(ref rerank_channel) = request.rerank_channel {
            let docs: Vec<crate::reranker::RerankDocument> = sources
                .iter()
                .map(|s| crate::reranker::RerankDocument {
                    id: s.chunk_id.clone(),
                    content: s.content.clone(),
                })
                .collect();
            let effective_top_n = rerank_channel
                .rerank_top_n
                .filter(|top_n| *top_n > 0)
                .unwrap_or(reranker_top_n)
                .min(top_k);
            let reranked = crate::reranker::rerank_remote(
                &rerank_channel.base_url,
                &rerank_channel.api_key,
                &rerank_channel.model,
                &query,
                &docs,
                effective_top_n,
            )
            .await?;
            let scored: Vec<(String, f32)> = reranked
                .into_iter()
                .map(|r| (r.id, r.score))
                .collect();
            sources = apply_rerank_scores(sources, &scored, top_k);
        }
    }

    sources.truncate(top_k);
    Ok(sources)
}

fn build_system_prompt(request: &RagChatRequest, sources: &[RagChatSource]) -> String {
    let attachment_scope = if request.attachments.is_empty() {
        "The user did not attach specific documents for this turn. Search results may come from any indexed document in the library.".to_string()
    } else {
        let titles = request
            .attachments
            .iter()
            .map(|attachment| attachment.title.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        format!("The user attached these documents for this turn: {titles}.")
    };

    let retrieved_context = if sources.is_empty() {
        "No relevant document context was retrieved from the local library for this request."
            .to_string()
    } else {
        sources
            .iter()
            .enumerate()
            .map(|(index, source)| {
                format!(
                    "[Source {}]\nDocument: {}\nChunk: {}\nSimilarity: {:.4}\nContent:\n{}",
                    index + 1,
                    source.document_title,
                    source.chunk_index + 1,
                    source.score,
                    source.content
                )
            })
            .collect::<Vec<_>>()
            .join("\n\n")
    };

    format!(
        "You are a helpful document-grounded assistant for a PDF library.\n\
         Use the retrieved context first when it is relevant to the user's question.\n\
         If the retrieved context is insufficient, say so clearly before using cautious general knowledge.\n\
         Do not fabricate citations, quotes, or claims about a document that are not supported by the retrieved context.\n\
         When you cite retrieved context, mention the document title in square brackets.\n\n\
         {attachment_scope}\n\n\
         Retrieved context:\n{retrieved_context}"
    )
}

fn build_chat_payload(
    request: &RagChatRequest,
    sources: &[RagChatSource],
    sampling: &LlmSamplingConfig,
) -> serde_json::Value {
    let mut messages = Vec::with_capacity(request.messages.len() + 1);
    messages.push(json!({
        "role": "system",
        "content": build_system_prompt(request, sources),
    }));

    for message in &request.messages {
        if message.content.trim().is_empty() {
            continue;
        }

        if matches!(message.role.as_str(), "user" | "assistant" | "system") {
            messages.push(json!({
                "role": message.role,
                "content": message.content,
            }));
        }
    }

    let mut payload = json!({
        "model": request.chat_channel.model,
        "messages": messages,
        "stream": true,
    });

    if let Some(temperature) = sampling.temperature {
        payload["temperature"] = json!(temperature);
    }
    if let Some(top_p) = sampling.top_p {
        payload["top_p"] = json!(top_p);
    }
    if let Some(top_k) = sampling.top_k {
        payload["top_k"] = json!(top_k);
    }
    if let Some(max_tokens) = sampling.max_tokens {
        payload["max_tokens"] = json!(max_tokens);
    }

    payload
}

async fn stream_chat_completion(
    app: &AppHandle,
    request: &RagChatRequest,
    sources: Vec<RagChatSource>,
    sampling: LlmSamplingConfig,
) -> Result<(), String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    let payload = build_chat_payload(request, &sources, &sampling);
    let url = openai_compatible_url(&request.chat_channel.base_url, "chat/completions");

    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header(
            "Authorization",
            format!("Bearer {}", request.chat_channel.api_key),
        )
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Chat request failed: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!(
            "Chat API returned {}: {}",
            status,
            text
        ));
    }

    let mut response = response;
    let mut buffer = String::new();

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("Failed to read streaming response: {e}"))?
    {
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        let mut lines = buffer
            .split('\n')
            .map(|line| line.to_string())
            .collect::<Vec<_>>();
        buffer = lines.pop().unwrap_or_default();

        for line in lines {
            let trimmed = line.trim();
            if !trimmed.starts_with("data: ") {
                continue;
            }

            let data = trimmed.trim_start_matches("data: ").trim();
            if data == "[DONE]" {
                emit_done(app, &request.request_id, sources.clone())?;
                return Ok(());
            }

            let parsed: ChatCompletionChunk = match serde_json::from_str(data) {
                Ok(parsed) => parsed,
                Err(_) => continue,
            };

            if let Some(delta) = parsed
                .choices
                .first()
                .and_then(|choice| choice.delta.content.as_deref())
            {
                emit_chunk(app, &request.request_id, delta)?;
            }
        }
    }

    emit_done(app, &request.request_id, sources)?;
    Ok(())
}

async fn run_rag_chat(
    app: &AppHandle,
    state: &AppState,
    request: &RagChatRequest,
) -> Result<(), String> {
    let app_dir = crate::app_dirs::runtime_app_dir(app)?;
    let sources = retrieve_context(state, &app_dir, request).await?;
    let sampling = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        load_llm_sampling_config(db.get_connection(), "chat")?
    };
    stream_chat_completion(app, request, sources, sampling).await
}

#[tauri::command]
pub async fn start_rag_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    request: RagChatRequest,
) -> Result<(), String> {
    if request.request_id.trim().is_empty() {
        return Err("Missing request id".to_string());
    }

    if request.messages.is_empty() {
        return Err("No chat messages were provided".to_string());
    }

    if let Some(handle) = take_chat_request_handle(state.inner(), &request.request_id)? {
        handle.abort();
    }

    let request_id = request.request_id.clone();
    let app_clone = app.clone();
    let request_clone = request.clone();
    let state_clone = state.inner().clone();

    let handle = tauri::async_runtime::spawn(async move {
        let result = run_rag_chat(&app_clone, &state_clone, &request_clone).await;

        if let Ok(mut handles) = state_clone.chat_request_handles.lock() {
            handles.remove(&request_id);
        }

        if let Err(error) = result {
            let _ = emit_error(&app_clone, &request_id, &error);
        }
    });

    let mut handles = state
        .chat_request_handles
        .lock()
        .map_err(|e| e.to_string())?;
    handles.insert(request.request_id.clone(), handle);

    Ok(())
}

#[tauri::command]
pub fn cancel_rag_chat(state: State<'_, AppState>, request_id: String) -> Result<(), String> {
    if let Some(handle) = take_chat_request_handle(state.inner(), &request_id)? {
        handle.abort();
    }
    Ok(())
}
