use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<Message>,
    temperature: f64,
    max_tokens: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize)]
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

pub struct Translator {
    base_url: String,
    api_key: String,
    model: String,
    temperature: f64,
    max_tokens: Option<i32>,
    client: Client,
}

impl Translator {
    pub fn new(
        base_url: String,
        api_key: String,
        model: String,
        temperature: f64,
        max_tokens: Option<i32>,
    ) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .unwrap_or_else(|_| Client::new());

        Self {
            base_url,
            api_key,
            model,
            temperature,
            max_tokens,
            client,
        }
    }

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
            temperature: self.temperature,
            max_tokens: self.max_tokens,
        };

        let url = openai_compatible_url(&self.base_url, "chat/completions");

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&request)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("API returned error: {}", response.status()));
        }

        let chat_response: ChatResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        chat_response
            .choices
            .first()
            .map(|c| c.message.content.clone())
            .ok_or_else(|| "No translation returned".to_string())
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
