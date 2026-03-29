use reqwest::Client;
use std::time::Duration;

pub struct WebDAVClient {
    base_url: String,
    username: String,
    password: String,
    client: Client,
}

impl WebDAVClient {
    pub fn new(base_url: String, username: String, password: String) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| Client::new());

        Self {
            base_url,
            username,
            password,
            client,
        }
    }

    pub async fn test_connection(&self) -> Result<bool, String> {
        let response = self
            .client
            .request(
                reqwest::Method::from_bytes(b"PROPFIND").unwrap(),
                &self.base_url,
            )
            .basic_auth(&self.username, Some(&self.password))
            .header("Depth", "0")
            .send()
            .await
            .map_err(|e| format!("Connection failed: {}", e))?;

        Ok(response.status().is_success())
    }

    pub async fn upload_file(&self, remote_path: &str, content: Vec<u8>) -> Result<(), String> {
        let url = format!(
            "{}/{}",
            self.base_url.trim_end_matches('/'),
            remote_path.trim_start_matches('/')
        );

        let response = self
            .client
            .put(&url)
            .basic_auth(&self.username, Some(&self.password))
            .body(content)
            .send()
            .await
            .map_err(|e| format!("Upload failed: {}", e))?;

        if response.status().is_success() {
            Ok(())
        } else {
            Err(format!("Upload failed with status: {}", response.status()))
        }
    }

    pub async fn create_directory(&self, remote_path: &str) -> Result<(), String> {
        let url = format!(
            "{}/{}",
            self.base_url.trim_end_matches('/'),
            remote_path.trim_start_matches('/').trim_end_matches('/')
        );

        let response = self
            .client
            .request(
                reqwest::Method::from_bytes(b"MKCOL").unwrap(),
                &format!("{}/", url),
            )
            .basic_auth(&self.username, Some(&self.password))
            .send()
            .await
            .map_err(|e| format!("MKCOL failed: {}", e))?;

        // 201 Created or 405 Method Not Allowed (already exists) are both OK
        if response.status().is_success()
            || response.status().as_u16() == 405
            || response.status().as_u16() == 301
        {
            Ok(())
        } else {
            Err(format!(
                "Failed to create directory, status: {}",
                response.status()
            ))
        }
    }

    pub async fn download_file(&self, remote_path: &str) -> Result<Vec<u8>, String> {
        let url = format!(
            "{}/{}",
            self.base_url.trim_end_matches('/'),
            remote_path.trim_start_matches('/')
        );

        let response = self
            .client
            .get(&url)
            .basic_auth(&self.username, Some(&self.password))
            .send()
            .await
            .map_err(|e| format!("Download failed: {}", e))?;

        if response.status().is_success() {
            response
                .bytes()
                .await
                .map(|b| b.to_vec())
                .map_err(|e| format!("Failed to read response: {}", e))
        } else {
            Err(format!(
                "Download failed with status: {}",
                response.status()
            ))
        }
    }
}
