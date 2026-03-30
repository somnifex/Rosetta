use crate::chunking::{Chunk, ChunkingConfig, TextChunker};
use crate::models::LlmSamplingConfig;
use crate::rate_limiter::{RateLimitConfig, RequestLimiter};
use crate::retry::{should_retry_network_error, with_retry, RetryConfig};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

#[derive(Debug, Serialize, Clone)]
struct ChatRequest {
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
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Message {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: Message,
}

/// 翻译结果，包含分片的元数据
#[derive(Debug, Clone)]
pub struct TranslationResult {
    /// 分片的索引
    pub chunk_index: usize,
    /// 翻译后的文本
    pub translated_text: String,
    /// 原始文本位置
    pub start_pos: usize,
    pub end_pos: usize,
    /// 翻译是否成功
    pub success: bool,
    /// 失败原因（如果有）
    pub error: Option<String>,
}

pub struct Translator {
    base_url: String,
    api_key: String,
    model: String,
    sampling: LlmSamplingConfig,
    client: Client,
    retry_config: RetryConfig,
    chunking_config: ChunkingConfig,
    rate_limit_config: RateLimitConfig,
    request_limiter: Arc<RequestLimiter>,
}

impl Translator {
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

        let rate_limit_config = RateLimitConfig::moderate();
        let request_limiter = Arc::new(RequestLimiter::new(rate_limit_config.clone()));

        Self {
            base_url,
            api_key,
            model,
            sampling,
            client,
            retry_config: RetryConfig::for_network(),
            chunking_config: ChunkingConfig::for_translate(),
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

    /// 原始translate方法（向后兼容，但已添加重试）
    pub async fn translate(
        &self,
        text: &str,
        source_lang: &str,
        target_lang: &str,
    ) -> Result<String, String> {
        let system_prompt = format!(
            "You are a professional translator. Translate the following text from {} to {}. Preserve formatting, technical terms, and maintain the original meaning.",
            source_lang, target_lang
        );

        let request = ChatRequest {
            model: self.model.clone(),
            messages: vec![
                Message {
                    role: "system".to_string(),
                    content: system_prompt,
                },
                Message {
                    role: "user".to_string(),
                    content: text.to_string(),
                },
            ],
            temperature: self.sampling.temperature,
            top_p: self.sampling.top_p,
            top_k: self.sampling.top_k,
            max_tokens: self.sampling.max_tokens,
        };

        let url = openai_compatible_url(&self.base_url, "chat/completions");
        let client = self.client.clone();
        let auth_header = format!("Bearer {}", self.api_key);
        let retry_config = self.retry_config.clone();

        let result = with_retry(
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
                        .map_err(|e| format!("Request failed: {}", e))?;

                    if !response.status().is_success() {
                        let status = response.status();
                        let text = response.text().await.unwrap_or_default();
                        return Err(format!("API returned {}: {}", status, text));
                    }

                    let chat_response: ChatResponse = response
                        .json()
                        .await
                        .map_err(|e| format!("Failed to parse response: {}", e))?;

                    chat_response
                        .choices
                        .first()
                        .ok_or_else(|| "No translation returned".to_string())
                        .map(|c| c.message.content.clone())
                }
            },
            should_retry_network_error,
        )
        .await?;

        Ok(result)
    }

    /// 智能翻译：自动分片长文本，返回带位置的翻译结果
    /// 支持并发处理和速率限制
    pub async fn translate_with_chunks(
        &self,
        text: &str,
        source_lang: &str,
        target_lang: &str,
    ) -> Result<Vec<TranslationResult>, String> {
        if text.is_empty() {
            return Ok(Vec::new());
        }

        let chunker = TextChunker::new(self.chunking_config.clone());
        let chunks = chunker.chunk(text);

        if chunks.is_empty() {
            return Err("Failed to chunk text".to_string());
        }

        log::info!(
            "Text split into {} chunks for translation (total chars: {}), using concurrency={}, rate_limit={}/min",
            chunks.len(),
            text.len(),
            self.rate_limit_config.max_concurrent_requests,
            self.rate_limit_config.max_requests_per_minute
        );

        // 转换为可处理的格式
        let mut translation_tasks = Vec::new();

        for chunk in chunks {
            let translator = self.clone_params();
            let source_lang = source_lang.to_string();
            let target_lang = target_lang.to_string();
            let request_limiter = Arc::clone(&self.request_limiter);

            translation_tasks.push(async move {
                // 使用请求限制器控制并发和速率
                let result = request_limiter
                    .execute(|| async {
                        translator
                            .translate_chunk(&chunk, &source_lang, &target_lang)
                            .await
                    })
                    .await;

                match result {
                    Ok(translated_text) => TranslationResult {
                        chunk_index: chunk.index,
                        translated_text,
                        start_pos: chunk.start_pos,
                        end_pos: chunk.end_pos,
                        success: true,
                        error: None,
                    },
                    Err(e) => TranslationResult {
                        chunk_index: chunk.index,
                        translated_text: String::new(),
                        start_pos: chunk.start_pos,
                        end_pos: chunk.end_pos,
                        success: false,
                        error: Some(e),
                    },
                }
            });
        }

        // 并发执行所有任务
        let results: Vec<TranslationResult> = futures::future::join_all(translation_tasks)
            .await;

        // 检查是否有失败的分片
        let failed_chunks: Vec<_> = results
            .iter()
            .filter(|r| !r.success)
            .collect();

        if !failed_chunks.is_empty() {
            log::warn!(
                "Failed to translate {} chunks: {:?}",
                failed_chunks.len(),
                failed_chunks
                    .iter()
                    .map(|r| format!("chunk {}: {}", r.chunk_index, r.error.as_ref().unwrap()))
                    .collect::<Vec<_>>()
            );
        }

        Ok(results)
    }

    /// 克隆translator所需的参数（用于并发处理）
    fn clone_params(&self) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(180))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self {
            base_url: self.base_url.clone(),
            api_key: self.api_key.clone(),
            model: self.model.clone(),
            sampling: self.sampling.clone(),
            client,
            retry_config: self.retry_config.clone(),
            chunking_config: self.chunking_config.clone(),
            rate_limit_config: self.rate_limit_config.clone(),
            request_limiter: Arc::clone(&self.request_limiter),
        }
    }

    /// 翻译单个分片（内部方法，带重试）
    async fn translate_chunk(
        &self,
        chunk: &Chunk,
        source_lang: &str,
        target_lang: &str,
    ) -> Result<String, String> {
        let system_prompt = format!(
            "You are a professional translator. Translate the following text from {} to {}. Preserve formatting, technical terms, and maintain the original meaning.",
            source_lang, target_lang
        );

        let request = ChatRequest {
            model: self.model.clone(),
            messages: vec![
                Message {
                    role: "system".to_string(),
                    content: system_prompt,
                },
                Message {
                    role: "user".to_string(),
                    content: chunk.text.clone(),
                },
            ],
            temperature: self.sampling.temperature,
            top_p: self.sampling.top_p,
            top_k: self.sampling.top_k,
            max_tokens: self.sampling.max_tokens,
        };

        let url = openai_compatible_url(&self.base_url, "chat/completions");
        let client = self.client.clone();
        let auth_header = format!("Bearer {}", self.api_key);
        let retry_config = self.retry_config.clone();
        let chunk_index = chunk.index;

        let result = with_retry(
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
                        .map_err(|e| format!("Request failed: {}", e))?;

                    if !response.status().is_success() {
                        let status = response.status();
                        let text = response.text().await.unwrap_or_default();
                        return Err(format!("API returned {}: {}", status, text));
                    }

                    let chat_response: ChatResponse = response
                        .json()
                        .await
                        .map_err(|e| format!("Failed to parse response: {}", e))?;

                    chat_response
                        .choices
                        .first()
                        .ok_or_else(|| "No translation returned".to_string())
                        .map(|c| c.message.content.clone())
                }
            },
            should_retry_network_error,
        )
        .await;

        match result {
            Ok(translation) => {
                log::debug!("Successfully translated chunk {}", chunk_index);
                Ok(translation)
            }
            Err(e) => {
                log::error!(
                    "Failed to translate chunk {} after retries: {}",
                    chunk_index,
                    e
                );
                Err(e)
            }
        }
    }

    /// 重试失败的翻译分片
    pub async fn retry_failed_chunks(
        &self,
        failed_results: Vec<TranslationResult>,
        chunks: &HashMap<usize, Chunk>,
        source_lang: &str,
        target_lang: &str,
    ) -> Result<Vec<TranslationResult>, String> {
        let mut retried_results = Vec::new();

        for failed in failed_results {
            if let Some(chunk) = chunks.get(&failed.chunk_index) {
                log::info!(
                    "Retrying translation for chunk {}",
                    failed.chunk_index
                );

                let result = self
                    .translate_chunk(chunk, source_lang, target_lang)
                    .await;

                retried_results.push(TranslationResult {
                    chunk_index: chunk.index,
                    translated_text: result.as_ref().unwrap_or(&String::new()).clone(),
                    start_pos: chunk.start_pos,
                    end_pos: chunk.end_pos,
                    success: result.is_ok(),
                    error: result.err(),
                });
            }
        }

        Ok(retried_results)
    }

    /// 拼接翻译结果为完整文本
    pub fn merge_translation_results(
        results: &[TranslationResult],
    ) -> Result<String, String> {
        if results.is_empty() {
            return Ok(String::new());
        }

        // 检查是否所有翻译都成功
        for result in results {
            if !result.success {
                return Err(format!(
                    "Cannot merge: chunk {} failed with error: {}",
                    result.chunk_index,
                    result.error.as_ref().unwrap_or(&"Unknown error".to_string())
                ));
            }
        }

        // 按chunk_index排序后拼接
        let mut sorted_results = results.to_vec();
        sorted_results.sort_by_key(|r| r.chunk_index);

        let merged = sorted_results
            .iter()
            .map(|r| r.translated_text.clone())
            .collect::<Vec<_>>()
            .join(" ");

        Ok(merged)
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
