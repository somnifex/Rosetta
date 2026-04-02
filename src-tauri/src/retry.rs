use std::time::{Duration, SystemTime};

#[derive(Debug, Clone)]
pub struct RetryConfig {
    pub max_retries: usize,
    pub initial_delay_ms: u64,
    pub backoff_multiplier: f64,
    pub max_delay_ms: u64,
    pub use_jitter: bool,
}

impl Default for RetryConfig {
    fn default() -> Self {
        Self {
            max_retries: 3,
            initial_delay_ms: 500,
            backoff_multiplier: 1.5,
            max_delay_ms: 30000,
            use_jitter: true,
        }
    }
}

impl RetryConfig {
    pub fn for_network() -> Self {
        Self {
            max_retries: 5,
            initial_delay_ms: 200,
            backoff_multiplier: 2.0,
            max_delay_ms: 60000,
            use_jitter: true,
        }
    }

    pub fn for_batch_processing() -> Self {
        Self {
            max_retries: 3,
            initial_delay_ms: 100,
            backoff_multiplier: 1.5,
            max_delay_ms: 10000,
            use_jitter: true,
        }
    }

    pub fn delay_for_attempt(&self, attempt: usize) -> Duration {
        if attempt == 0 {
            return Duration::from_millis(0);
        }

        let base_delay = (self.initial_delay_ms as f64
            * self.backoff_multiplier.powi((attempt - 1) as i32))
        .min(self.max_delay_ms as f64);

        let delay_ms = if self.use_jitter {
            let jitter_factor = simple_random_jitter();
            let jitter = base_delay * 0.2 * jitter_factor;
            (base_delay + jitter) as u64
        } else {
            base_delay as u64
        };

        Duration::from_millis(delay_ms)
    }
}

fn simple_random_jitter() -> f64 {
    match SystemTime::now().duration_since(SystemTime::UNIX_EPOCH) {
        Ok(duration) => {
            let nanos = duration.subsec_nanos() as u64;
            ((nanos % 1000) as f64) / 1000.0
        }
        Err(_) => 0.5,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetryDecision {
    Retry,
    Fail,
}

pub fn should_retry_network_error(error: &str) -> RetryDecision {
    let lower = error.to_lowercase();

    if lower.contains("timeout")
        || lower.contains("connection refused")
        || lower.contains("connection reset")
        || lower.contains("broken pipe")
        || lower.contains("connection aborted")
        || lower.contains("temporarily unavailable")
    {
        return RetryDecision::Retry;
    }

    if lower.contains("500")
        || lower.contains("502")
        || lower.contains("503")
        || lower.contains("504")
    {
        return RetryDecision::Retry;
    }

    if lower.contains("429") {
        return RetryDecision::Retry;
    }

    RetryDecision::Fail
}

pub async fn with_retry<F, Fut, T>(
    config: &RetryConfig,
    mut operation: F,
    predicate: fn(&str) -> RetryDecision,
) -> Result<T, String>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, String>>,
{
    let mut last_error = String::new();

    for attempt in 0..=config.max_retries {
        match operation().await {
            Ok(result) => return Ok(result),
            Err(error) => {
                last_error = error.clone();

                if attempt >= config.max_retries {
                    break;
                }

                if predicate(&error) == RetryDecision::Fail {
                    return Err(error);
                }

                let delay = config.delay_for_attempt(attempt + 1);
                log::warn!(
                    "Operation failed (attempt {}): {}. Retrying after {:?}",
                    attempt + 1,
                    error,
                    delay
                );

                tokio::time::sleep(delay).await;
            }
        }
    }

    Err(format!(
        "Operation failed after {} retries: {}",
        config.max_retries + 1,
        last_error
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_retry_config_delays() {
        let config = RetryConfig {
            initial_delay_ms: 100,
            backoff_multiplier: 2.0,
            max_delay_ms: 1000,
            use_jitter: false,
            ..Default::default()
        };

        let delay0 = config.delay_for_attempt(0);
        let delay1 = config.delay_for_attempt(1);
        let delay2 = config.delay_for_attempt(2);

        assert_eq!(delay0.as_millis(), 0);
        assert_eq!(delay1.as_millis(), 100);
        assert_eq!(delay2.as_millis(), 200);
    }

    #[test]
    fn test_should_retry_network_error() {
        assert_eq!(should_retry_network_error("timeout"), RetryDecision::Retry);
        assert_eq!(
            should_retry_network_error("HTTP 503 Service Unavailable"),
            RetryDecision::Retry
        );
        assert_eq!(
            should_retry_network_error("HTTP 401 Unauthorized"),
            RetryDecision::Fail
        );
    }
}
