use crate::chunking::{Chunk, ChunkingConfig, TextChunker};
use crate::rate_limiter::{RateLimitConfig, RequestLimiter};
use crate::retry::{should_retry_network_error, with_retry, RetryConfig};
use futures;
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

/// Embed结果，包含分片的元数据
#[derive(Debug, Clone)]
pub struct EmbedResult {
    /// 分片的索引
    pub chunk_index: usize,
    /// 分片文本
    pub text: String,
    /// 嵌入向量
    pub embedding: Vec<f32>,
    /// 原始文本位置
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

    /// 配置重试策略
    pub fn with_retry_config(mut self, config: RetryConfig) -> Self {
        self.retry_config = config;
        self
    }

    /// 配置分片策略
    pub fn with_chunking_config(mut self, config: ChunkingConfig) -> Self {
        self.chunking_config = config;
        self
    }

    /// 配置速率限制和并发
    pub fn with_rate_limit_config(mut self, config: RateLimitConfig) -> Self {
        self.rate_limit_config = config.clone();
        self.request_limiter = Arc::new(RequestLimiter::new(config));
        self
    }

    /// 获取当前速率限制配置
    pub fn rate_limit_config(&self) -> &RateLimitConfig {
        &self.rate_limit_config
    }

    /// 获取当前限制器状态
    pub fn limiter_status(&self) -> crate::rate_limiter::LimiterStatus {
        self.request_limiter.status()
    }

    /// 原始embed方法（向后兼容，但已添加重试）
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

    /// 智能embed：自动分片长文本，返回带位置的embed结果
    /// 支持并发处理和速率限制
    pub async fn embed_with_chunks(
        &self,
        text: &str,
    ) -> Result<Vec<EmbedResult>, String> {
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

        // 转换为可处理的格式
        let mut embed_tasks = Vec::new();

        for chunk in chunks {
            let embedder = self.clone_params();
            let request_limiter = Arc::clone(&self.request_limiter);

            embed_tasks.push(async move {
                // 使用请求限制器控制并发和速率
                let result = request_limiter
                    .execute(|| async {
                        embedder.embed_chunk(&chunk).await
                    })
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
                            embedding: Vec::new(),  // 返回空向量表示失败
                            start_pos: chunk.start_pos,
                            end_pos: chunk.end_pos,
                        }
                    }
                }
            });
        }

        // 并发执行所有任务
        let results: Vec<EmbedResult> = futures::future::join_all(embed_tasks)
            .await;

        // 检查是否有失败的任务（空embedding）
        let failed_embeds: Vec<_> = results
            .iter()
            .filter(|r| r.embedding.is_empty())
            .collect();

        if !failed_embeds.is_empty() {
            log::warn!(
                "Failed to embed {} chunks",
                failed_embeds.len()
            );
            return Err(format!("Failed to embed {} out of {} chunks", failed_embeds.len(), results.len()));
        }

        Ok(results)
    }

    /// 克隆embedder所需的参数（用于并发处理）
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

    /// 嵌入单个分片（内部方法，带重试）
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
