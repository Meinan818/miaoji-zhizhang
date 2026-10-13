package cn.miaoji;

import cn.miaoji.auth.AuthAttemptLimiter;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class AuthAttemptLimiterTest {
    @Test void limitDoesNotExtendLockoutAndWindowExpiresPrecisely() {
        var time = new AtomicLong();
        var limiter = new AuthAttemptLimiter(2, 10, Duration.ofSeconds(60), time::get);
        assertThat(limiter.acquire("a")).isZero();
        assertThat(limiter.acquire("a")).isZero();
        assertThat(limiter.acquire("a")).isEqualTo(60);
        time.set(59_100_000_000L);
        assertThat(limiter.acquire("a")).isEqualTo(1);
        time.set(60_000_000_000L);
        assertThat(limiter.acquire("a")).isZero();
    }

    @Test void capacityNeverEvictsAnActiveLimitToAllowBypass() {
        var time = new AtomicLong();
        var limiter = new AuthAttemptLimiter(1, 2, Duration.ofSeconds(60), time::get);
        assertThat(limiter.acquire("a")).isZero();
        assertThat(limiter.acquire("b")).isZero();
        assertThat(limiter.acquire("c")).isEqualTo(60);
        assertThat(limiter.acquire("a")).isEqualTo(60);
        time.set(60_000_000_000L);
        assertThat(limiter.acquire("c")).isZero();
    }

    @Test void concurrentAttemptsCannotExceedTheLimit() throws Exception {
        var limiter = new AuthAttemptLimiter(5, 10, Duration.ofSeconds(60), () -> 0L);
        try (var pool = Executors.newFixedThreadPool(10)) {
            var tasks = new java.util.ArrayList<java.util.concurrent.Callable<Long>>();
            for (int i = 0; i < 30; i++) tasks.add(() -> limiter.acquire("same-address"));
            long accepted = 0;
            for (var result : pool.invokeAll(tasks)) if (result.get() == 0) accepted++;
            assertThat(accepted).isEqualTo(5);
        }
    }
}
