use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

#[derive(Debug, Clone)]
pub struct RateLimitConfig {
    pub max_requests_per_minute: u32,
    pub max_concurrent_requests: usize,
}

impl Default for RateLimitConfig {
    fn default() -> Self {
        Self {
            max_requests_per_minute: 60,
            max_concurrent_requests: 3,
        }
    }
}

impl RateLimitConfig {
    pub fn moderate() -> Self {
        Self::default()
    }
}

pub struct RateLimiter {
    max_requests_per_minute: u32,
    window_start: std::sync::Mutex<Instant>,
    request_count: std::sync::Mutex<u32>,
}

impl RateLimiter {
    pub fn new(max_requests_per_minute: u32) -> Self {
        Self {
            max_requests_per_minute,
            window_start: std::sync::Mutex::new(Instant::now()),
            request_count: std::sync::Mutex::new(0),
        }
    }

    pub async fn acquire(&self) -> Duration {
        if self.max_requests_per_minute == 0 {
            return Duration::from_secs(0);
        }

        let mut waited = Duration::from_secs(0);

        loop {
            let wait_time = {
                let mut window_start = self.window_start.lock().unwrap();
                let mut request_count = self.request_count.lock().unwrap();

                let now = Instant::now();
                let elapsed = now.duration_since(*window_start);

                if elapsed >= Duration::from_secs(60) {
                    *window_start = now;
                    *request_count = 0;
                }

                if *request_count >= self.max_requests_per_minute {
                    Some(Duration::from_secs(60) - elapsed)
                } else {
                    *request_count += 1;
                    None
                }
            };

            if let Some(wait_time) = wait_time {
                log::debug!("Rate limit reached, waiting {:?}", wait_time);
                tokio::time::sleep(wait_time).await;
                waited += wait_time;
                continue;
            }

            return waited;
        }
    }

    pub fn current_count(&self) -> u32 {
        *self.request_count.lock().unwrap()
    }

    pub fn window_elapsed(&self) -> Duration {
        let window_start = self.window_start.lock().unwrap();
        window_start.elapsed()
    }
}

pub struct ConcurrencyLimiter {
    semaphore: Arc<Semaphore>,
}

impl ConcurrencyLimiter {
    pub fn new(max_concurrent: usize) -> Self {
        Self {
            semaphore: Arc::new(Semaphore::new(max_concurrent)),
        }
    }

    pub async fn acquire(&self) -> ConcurrencyGuard {
        let permit = self
            .semaphore
            .clone()
            .acquire_owned()
            .await
            .expect("semaphore should not be closed");

        ConcurrencyGuard { _permit: permit }
    }

    pub fn available_permits(&self) -> usize {
        self.semaphore.available_permits()
    }
}

pub struct ConcurrencyGuard {
    _permit: OwnedSemaphorePermit,
}

pub struct RequestLimiter {
    rate_limiter: RateLimiter,
    concurrency_limiter: ConcurrencyLimiter,
}

impl RequestLimiter {
    pub fn new(config: RateLimitConfig) -> Self {
        Self {
            rate_limiter: RateLimiter::new(config.max_requests_per_minute),
            concurrency_limiter: ConcurrencyLimiter::new(config.max_concurrent_requests),
        }
    }

    pub async fn execute<F, Fut, T>(&self, operation: F) -> Result<T, String>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<T, String>>,
    {
        let wait_time = self.rate_limiter.acquire().await;
        if wait_time.as_secs() > 0 {
            log::debug!("Waiting {:?} for rate limit", wait_time);
        }

        let _permit = self.concurrency_limiter.acquire().await;
        operation().await
    }

    pub fn status(&self) -> LimiterStatus {
        LimiterStatus {
            current_request_count: self.rate_limiter.current_count(),
            window_elapsed: self.rate_limiter.window_elapsed(),
            available_concurrency: self.concurrency_limiter.available_permits(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct LimiterStatus {
    pub current_request_count: u32,
    pub window_elapsed: Duration,
    pub available_concurrency: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    #[test]
    fn test_rate_limiter_config() {
        let moderate = RateLimitConfig::moderate();
        assert_eq!(moderate.max_requests_per_minute, 60);
        assert_eq!(moderate.max_concurrent_requests, 3);

        let custom = RateLimitConfig {
            max_requests_per_minute: 240,
            max_concurrent_requests: 10,
        };
        assert_eq!(custom.max_requests_per_minute, 240);
        assert_eq!(custom.max_concurrent_requests, 10);
    }

    #[tokio::test]
    async fn test_rate_limiter() {
        let limiter = RateLimiter::new(3);

        let start = Instant::now();

        for _ in 0..3 {
            let wait = limiter.acquire().await;
            assert_eq!(wait.as_secs(), 0);
        }

        let wait = limiter.acquire().await;
        assert!(wait.as_secs() > 0);

        let _elapsed = start.elapsed();
        assert!(wait.as_secs() > 50);
    }

    #[tokio::test]
    async fn test_concurrency_limiter() {
        let limiter = ConcurrencyLimiter::new(2);

        let guard1 = limiter.acquire().await;
        assert_eq!(limiter.available_permits(), 1);

        let guard2 = limiter.acquire().await;
        assert_eq!(limiter.available_permits(), 0);

        drop(guard1);
        assert_eq!(limiter.available_permits(), 1);

        drop(guard2);
        assert_eq!(limiter.available_permits(), 2);
    }

    #[tokio::test]
    async fn test_request_limiter() {
        let config = RateLimitConfig {
            max_requests_per_minute: 10,
            max_concurrent_requests: 2,
        };
        let limiter = RequestLimiter::new(config);

        let status = limiter.status();
        assert_eq!(status.available_concurrency, 2);
        assert_eq!(status.current_request_count, 0);
    }
}
