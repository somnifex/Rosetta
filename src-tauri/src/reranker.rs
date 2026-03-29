use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct RerankDocument {
    pub id: String,
    pub content: String,
}

#[derive(Debug, Clone)]
pub struct RerankResult {
    pub id: String,
    pub score: f32,
}

#[derive(Debug, Serialize)]
struct RerankRequest {
    model: String,
    query: String,
    documents: Vec<RerankDocPayload>,
    top_n: usize,
}

#[derive(Debug, Serialize)]
struct RerankDocPayload {
    text: String,
}

#[derive(Debug, Deserialize)]
struct RerankResponse {
    results: Vec<RerankResponseItem>,
}

#[derive(Debug, Deserialize)]
struct RerankResponseItem {
    index: usize,
    relevance_score: f32,
}

fn openai_compatible_url(base_url: &str, path: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/v1") {
        format!("{trimmed}/{path}")
    } else {
        format!("{trimmed}/v1/{path}")
    }
}

pub async fn rerank_remote(
    base_url: &str,
    api_key: &str,
    model: &str,
    query: &str,
    documents: &[RerankDocument],
    top_n: usize,
) -> Result<Vec<RerankResult>, String> {
    if documents.is_empty() {
        return Ok(Vec::new());
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let url = openai_compatible_url(base_url, "rerank");

    let request = RerankRequest {
        model: model.to_string(),
        query: query.to_string(),
        documents: documents
            .iter()
            .map(|doc| RerankDocPayload {
                text: doc.content.clone(),
            })
            .collect(),
        top_n,
    };

    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Rerank request failed: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Rerank API returned {}: {}", status, text));
    }

    let rerank_response: RerankResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse rerank response: {e}"))?;

    let results = rerank_response
        .results
        .into_iter()
        .filter_map(|item| {
            documents.get(item.index).map(|doc| RerankResult {
                id: doc.id.clone(),
                score: item.relevance_score,
            })
        })
        .collect();

    Ok(results)
}
