package cn.miaoji.auth;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.function.LongSupplier;

/** 单进程固定窗口，使用单调时钟；地址只在有界内存中短暂保留。 */
public class AuthAttemptLimiter {
    private record Window(long started, int count) {}
    private final Map<String, Window> windows = new HashMap<>();
    private final int limit;
    private final int capacity;
    private final long windowNanos;
    private final LongSupplier clock;

    public AuthAttemptLimiter(int limit, int capacity, Duration window, LongSupplier clock) {
        if (limit < 1 || capacity < 1 || window.isNegative() || window.isZero()) {
            throw new IllegalArgumentException("认证限流配置必须为正数");
        }
        this.limit = limit;
        this.capacity = capacity;
        this.windowNanos = window.toNanos();
        this.clock = clock;
    }

    /** 返回0为允许，否则为应等待的秒数；检查与计数在同一临界区。 */
    public synchronized long acquire(String address) {
        long now = clock.getAsLong();
        var current = windows.get(address);
        if (current == null || now - current.started() >= windowNanos) {
            windows.entrySet().removeIf(entry -> now - entry.getValue().started() >= windowNanos);
            if (windows.size() >= capacity) return Math.max(1, (windowNanos + 999_999_999L) / 1_000_000_000L);
            windows.put(address, new Window(now, 1));
            return 0;
        }
        if (current.count() >= limit) {
            return Math.max(1, (windowNanos - (now - current.started()) + 999_999_999L) / 1_000_000_000L);
        }
        windows.put(address, new Window(current.started(), current.count() + 1));
        return 0;
    }
}
