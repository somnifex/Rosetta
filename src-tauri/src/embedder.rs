use crate::chunking::{Chunk, ChunkingConfig, TextChunker};
use crate::rate_limiter::{RateLimitConfig, RequestLimiter};
use crate::retry::{should_retry_network_error, with_retry, RetryConfig};
use futures::stream::FuturesUnordered;
use futures::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;

#[derive(Debug, Serialize)]
struct EmbeddingRequest {
    model: String,
    input: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    dimensions: Option<usize>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingResponse {
    data: Vec<EmbeddingData>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingData {
    embedding: Vec<f32>,
}

#[derive(Debug, Clone)]
pub struct EmbedResult {
    pub chunk_index: usize,
    pub text: String,
    pub embedding: Vec<f32>,
    pub start_pos: usize,
    pub end_pos: usize,
}

pub struct Embedder {
    base_url: String,
    api_key: String,
    model: String,
    dimensions: Option<usize>,
    client: Client,
    retry_config: RetryConfig,
    chunking_config: ChunkingConfig,
    rate_limit_config: RateLimitConfig,
    request_limiter: Arc<RequestLimiter>,
}

impl Embedder {
    pub fn new(
        base_url: String,
        api_key: String,
        model: String,
        dimensions: Option<usize>,
    ) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .unwrap_or_else(|_| Client::new());

        let rate_limit_config = RateLimitConfig::moderate();
        let request_limiter = Arc::new(RequestLimiter::new(rate_limit_config.clone()));

        Self {
            base_url,
            api_key,
            model,
            dimensions,
            client,
            retry_config: RetryConfig::for_network(),
            chunking_config: ChunkingConfig::for_embed(),
            rate_limit_config,
            request_limiter,
        }
    }

    pub fn with_retry_config(mut self, config: RetryConfig) -> Self {
        self.retry_config = config;
        self
    }

    pub fn with_chunking_config(mut self, config: ChunkingConfig) -> Self {
        self.chunking_config = config;
        self
    }

    pub fn with_rate_limit_config(mut self, config: RateLimitConfig) -> Self {
        self.rate_limit_config = config.clone();
        self.request_limiter = Arc::new(RequestLimiter::new(config));
        self
    }

    pub fn rate_limit_config(&self) -> &RateLimitConfig {
        &self.rate_limit_config
    }

    pub fn limiter_status(&self) -> crate::rate_limiter::LimiterStatus {
        self.request_limiter.status()
    }

    pub async fn embed(&self, texts: Vec<String>) -> Result<Vec<Vec<f32>>, String> {
        let request = EmbeddingRequest {
            model: self.model.clone(),
            input: texts,
            dimensions: self.dimensions,
        };

        let url = openai_compatible_url(&self.base_url, "embeddings");
        let client = self.client.clone();
        let auth_header = format!("Bearer {}", self.api_key);
        let retry_config = self.retry_config.clone();

        let result = with_retry(
            &retry_config,
            || {
                let req = EmbeddingRequest {
                    model: request.model.clone(),
                    input: request.input.clone(),
                    dimensions: request.dimensions,
                };
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
                        .map_err(|e| format!("Request failed: {}", e))?;

                    if !response.status().is_success() {
                        let status = response.status();
                        let text = response.text().await.unwrap_or_default();
                        return Err(format!("API returned {}: {}", status, text));
                    }

                    let embedding_response: EmbeddingResponse = response
                        .json()
                        .await
                        .map_err(|e| format!("Failed to parse response: {}", e))?;

                    Ok(embedding_response
                        .data
                        .into_iter()
                        .map(|d| d.embedding)
                        .collect())
                }
            },
            should_retry_network_error,
        )
        .await?;

        Ok(result)
    }

    pub async fn embed_with_chunks_incremental<F>(
        &self,
        text: &str,
        mut on_chunk_result: F,
    ) -> Result<Vec<EmbedResult>, String>
    where
        F: FnMut(usize, usize, &EmbedResult, bool),
    {
        if text.is_empty() {
            return Ok(Vec::new());
        }

        let chunker = TextChunker::new(self.chunking_config.clone());
        let chunks = chunker.chunk(text);

        if chunks.is_empty() {
            return Err("Failed to chunk text".to_string());
        }

        log::info!(
            "Text split into {} chunks for incremental embedding (total chars: {}), using concurrency={}, rate_limit={}/min",
            chunks.len(),
            text.len(),
            self.rate_limit_config.max_concurrent_requests,
            self.rate_limit_config.max_requests_per_minute
        );

        let total_chunks = chunks.len();
        let mut embed_tasks = FuturesUnordered::new();

        for chunk in chunks {
            let embedder = self.clone_params();
            let request_limiter = Arc::clone(&self.request_limiter);

            embed_tasks.push(async move {
                let result = request_limiter
                    .execute(|| async { embedder.embed_chunk(&chunk).await })
                    .await;

                match result {
                    Ok(embedding) => (
                        EmbedResult {
                            chunk_index: chunk.index,
                            text: chunk.text.clone(),
                            embedding,
                            start_pos: chunk.start_pos,
                            end_pos: chunk.end_pos,
                        },
                        true,
                    ),
                    Err(e) => {
                        log::error!("Failed to embed chunk {}: {}", chunk.index, e);
                        (
                            EmbedResult {
                                chunk_index: chunk.index,
                                text: chunk.text.clone(),
                                embedding: Vec::new(),
                                start_pos: chunk.start_pos,
                                end_pos: chunk.end_pos,
                            },
                            false,
                        )
                    }
                }
            });
        }

        let mut completed = 0usize;
        let mut results: Vec<EmbedResult> = Vec::with_capacity(total_chunks);
        let mut failed_count = 0usize;
        while let Some((result, success)) = embed_tasks.next().await {
            completed += 1;
            on_chunk_result(completed, total_chunks, &result, success);
            if !success {
                failed_count += 1;
            }
            results.push(result);
        }

        if failed_count > 0 {
            log::warn!(
                "Failed to embed {} out of {} chunks",
                failed_count,
                total_chunks
            );
        }

        Ok(results)
    }

    #[allow(dead_code)]
    pub async fn embed_specific_chunks<F>(
        &self,
        chunks: Vec<Chunk>,
        total_chunks: usize,
        initial_completed: usize,
        mut on_chunk_result: F,
    ) -> Result<Vec<EmbedResult>, String>
    where
        F: FnMut(usize, usize, &EmbedResult, bool),
    {
        if chunks.is_empty() {
            return Ok(Vec::new());
        }

        log::info!(
            "Embedding {} specific chunks (of {} total), using concurrency={}, rate_limit={}/min",
            chunks.len(),
            total_chunks,
            self.rate_limit_config.max_concurrent_requests,
            self.rate_limit_config.max_requests_per_minute
        );

        let mut embed_tasks = FuturesUnordered::new();

        for chunk in chunks {
            let embedder = self.clone_params();
            let request_limiter = Arc::clone(&self.request_limiter);

            embed_tasks.push(async move {
                let result = request_limiter
                    .execute(|| async { embedder.embed_chunk(&chunk).await })
                    .await;

                match result {
                    Ok(embedding) => (
                        EmbedResult {
                            chunk_index: chunk.index,
                            text: chunk.text.clone(),
                            embedding,
                            start_pos: chunk.start_pos,
                            end_pos: chunk.end_pos,
                        },
                        true,
                    ),
                    Err(e) => {
                        log::error!("Failed to embed chunk {}: {}", chunk.index, e);
                        (
                            EmbedResult {
                                chunk_index: chunk.index,
                                text: chunk.text.clone(),
                                embedding: Vec::new(),
                                start_pos: chunk.start_pos,
                                end_pos: chunk.end_pos,
                            },
                            false,
                        )
                    }
                }
            });
        }

        let mut completed = initial_completed;
        let mut results: Vec<EmbedResult> = Vec::new();
        while let Some((result, success)) = embed_tasks.next().await {
            completed += 1;
            on_chunk_result(completed, total_chunks, &result, success);
            results.push(result);
        }

        Ok(results)
    }

    #[allow(dead_code)]
    pub async fn embed_with_chunks(&self, text: &str) -> Result<Vec<EmbedResult>, String> {
        if text.is_empty() {
            return Ok(Vec::new());
        }

        let chunker = TextChunker::new(self.chunking_config.clone());
        let chunks = chunker.chunk(text);

        if chunks.is_empty() {
            return Err("Failed to chunk text".to_string());
        }

        log::info!(
            "Text split into {} chunks for embedding (total chars: {}), using concurrency={}, rate_limit={}/min",
            chunks.len(),
            text.len(),
            self.rate_limit_config.max_concurrent_requests,
            self.rate_limit_config.max_requests_per_minute
        );

        let estimated_tokens: usize = chunks
            .iter()
            .map(|chunk| chunk.estimate_tokens(self.chunking_config.tokens_per_char_estimate))
            .sum();
        log::debug!(
            "Embedding chunk plan: estimated_total_tokens={} tokens_per_char_estimate={}",
            estimated_tokens,
            self.chunking_config.tokens_per_char_estimate
        );

        let mut embed_tasks = Vec::new();

        for chunk in chunks {
            let embedder = self.clone_params();
            let request_limiter = Arc::clone(&self.request_limiter);

            embed_tasks.push(async move {
                let result = request_limiter
                    .execute(|| async { embedder.embed_chunk(&chunk).await })
                    .await;

                match result {
                    Ok(embedding) => EmbedResult {
                        chunk_index: chunk.index,
                        text: chunk.text.clone(),
                        embedding,
                        start_pos: chunk.start_pos,
                        end_pos: chunk.end_pos,
                    },
                    Err(e) => {
                        log::error!("Failed to embed chunk {}: {}", chunk.index, e);
                        EmbedResult {
                            chunk_index: chunk.index,
                            text: chunk.text.clone(),
                            embedding: Vec::new(), // 返回空向量表示失败
                            start_pos: chunk.start_pos,
                            end_pos: chunk.end_pos,
                        }
                    }
                }
            });
        }

        let results: Vec<EmbedResult> = futures::future::join_all(embed_tasks).await;

        let failed_embeds: Vec<_> = results.iter().filter(|r| r.embedding.is_empty()).collect();

        if !failed_embeds.is_empty() {
            log::warn!("Failed to embed {} chunks", failed_embeds.len());
            return Err(format!(
                "Failed to embed {} out of {} chunks",
                failed_embeds.len(),
                results.len()
            ));
        }

        Ok(results)
    }

    fn clone_params(&self) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .unwrap_or_else(|_| Client::new());

        Self {
            base_url: self.base_url.clone(),
            api_key: self.api_key.clone(),
            model: self.model.clone(),
            dimensions: self.dimensions,
            client,
            retry_config: self.retry_config.clone(),
            chunking_config: self.chunking_config.clone(),
            rate_limit_config: self.rate_limit_config.clone(),
            request_limiter: Arc::clone(&self.request_limiter),
        }
    }

    async fn embed_chunk(&self, chunk: &Chunk) -> Result<Vec<f32>, String> {
        let request = EmbeddingRequest {
            model: self.model.clone(),
            input: vec![chunk.text.clone()],
            dimensions: self.dimensions,
        };

        let url = openai_compatible_url(&self.base_url, "embeddings");
        let client = self.client.clone();
        let auth_header = format!("Bearer {}", self.api_key);
        let retry_config = self.retry_config.clone();
        let chunk_index = chunk.index;

        let result = with_retry(
            &retry_config,
            || {
                let req = EmbeddingRequest {
                    model: request.model.clone(),
                    input: request.input.clone(),
                    dimensions: request.dimensions,
                };
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
                        .map_err(|e| format!("Request failed: {}", e))?;

                    if !response.status().is_success() {
                        let status = response.status();
                        let text = response.text().await.unwrap_or_default();
                        return Err(format!("API returned {}: {}", status, text));
                    }

                    let embedding_response: EmbeddingResponse = response
                        .json()
                        .await
                        .map_err(|e| format!("Failed to parse response: {}", e))?;

                    embedding_response
                        .data
                        .first()
                        .map(|d| d.embedding.clone())
                        .ok_or_else(|| "No embedding returned".to_string())
                }
            },
            should_retry_network_error,
        )
        .await;

        match result {
            Ok(embedding) => {
                log::debug!("Successfully embedded chunk {}", chunk_index);
                Ok(embedding)
            }
            Err(e) => {
                log::error!("Failed to embed chunk {} after retries: {}", chunk_index, e);
                Err(e)
            }
        }
    }
}

fn openai_compatible_url(base_url: &str, path: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/v1") {
        format!("{trimmed}/{path}")
    } else {
        format!("{trimmed}/v1/{path}")
    }
}
