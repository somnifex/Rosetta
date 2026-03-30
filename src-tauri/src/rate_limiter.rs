use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Semaphore;

/// 速率限制配置
#[derive(Debug, Clone)]
pub struct RateLimitConfig {
    /// 每分钟最大请求数（0表示不限制）
    pub max_requests_per_minute: u32,
    /// 并发学问数（同时发送的最大请求数）
    pub max_concurrent_requests: usize,
}

impl Default for RateLimitConfig {
    fn default() -> Self {
        Self {
            max_requests_per_minute: 60,    // 默认60个请求/分钟
            max_concurrent_requests: 3,      // 默认3个并发
        }
    }
}

impl RateLimitConfig {
    /// 普通的限制（网络环境一般）
    pub fn moderate() -> Self {
        Self {
            max_requests_per_minute: 60,
            max_concurrent_requests: 3,
        }
    }
}

/// 速率限制器 - 控制请求频率
pub struct RateLimiter {
    /// 每分钟最大请求数
    max_requests_per_minute: u32,
    /// 上一分钟的开始时间
    window_start: std::sync::Mutex<Instant>,
    /// 当前窗口内的请求数
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

    /// 检查是否可以发送请求，如果需要等待则等待
    pub async fn acquire(&self) -> Duration {
        if self.max_requests_per_minute == 0 {
            return Duration::from_secs(0); // 不限制
        }

        let mut waited = Duration::from_secs(0);

        loop {
            let wait_time = {
                let mut window_start = self.window_start.lock().unwrap();
                let mut request_count = self.request_count.lock().unwrap();

                let now = Instant::now();
                let elapsed = now.duration_since(*window_start);

                // 如果窗口已过期（1分钟），重置
                if elapsed >= Duration::from_secs(60) {
                    *window_start = now;
                    *request_count = 0;
                }

                // 检查是否还有配额
                if *request_count >= self.max_requests_per_minute {
                    Some(Duration::from_secs(60) - elapsed)
                } else {
                    // 增加请求计数
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

    /// 获取当前请求数
    pub fn current_count(&self) -> u32 {
        *self.request_count.lock().unwrap()
    }

    /// 获取当前窗口已用时间
    pub fn window_elapsed(&self) -> Duration {
        let window_start = self.window_start.lock().unwrap();
        window_start.elapsed()
    }
}

/// 并发控制器 - 限制同时运行的任务数
pub struct ConcurrencyLimiter {
    semaphore: Arc<Semaphore>,
}

impl ConcurrencyLimiter {
    pub fn new(max_concurrent: usize) -> Self {
        Self {
            semaphore: Arc::new(Semaphore::new(max_concurrent)),
        }
    }

    /// 获取一个并发许可
    pub async fn acquire(&self) -> ConcurrencyGuard {
        let permit = self
            .semaphore
            .clone()
            .acquire_owned()
            .await
            .expect("semaphore should not be closed");

        ConcurrencyGuard {
            _permit: permit,
        }
    }

    /// 获取当前可用的并发数
    pub fn available_permits(&self) -> usize {
        self.semaphore.available_permits()
    }
}

/// 并发许可守卫 - 当DROP时释放许可
pub struct ConcurrencyGuard {
    _permit: tokio::sync::OwnedSemaphorePermit,
}

impl ConcurrencyGuard {
    // 这个结构体只是用来保持permit的生命周期
    // 当drop时，permit会自动释放
}

/// 联合限制器 - 同时进行速率限制和并发控制
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

    /// 执行一个受限的操作
    pub async fn execute<F, Fut, T>(&self, operation: F) -> Result<T, String>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<T, String>>,
    {
        // 首先等待速率限制
        let wait_time = self.rate_limiter.acquire().await;
        if wait_time.as_secs() > 0 {
            log::debug!("Waiting {:?} for rate limit", wait_time);
        }

        // 然后获取并发许可
        let _permit = self.concurrency_limiter.acquire().await;

        // 执行操作
        operation().await
    }

    /// 获取状态信息
    pub fn status(&self) -> LimiterStatus {
        LimiterStatus {
            current_request_count: self.rate_limiter.current_count(),
            window_elapsed: self.rate_limiter.window_elapsed(),
            available_concurrency: self.concurrency_limiter.available_permits(),
        }
    }
}

/// 限制器状态信息
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

        // 前3个请求应该没有延迟
        for _i in 0..3 {
            let wait = limiter.acquire().await;
            assert_eq!(wait.as_secs(), 0);
        }

        // 第4个请求应该有延迟
        let wait = limiter.acquire().await;
        assert!(wait.as_secs() > 0);

        let _elapsed = start.elapsed();
        // 应该大约等待了60秒的延迟（这里我们只检查返回值）
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
