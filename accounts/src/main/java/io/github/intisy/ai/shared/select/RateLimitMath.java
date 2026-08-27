package io.github.intisy.ai.shared.select;

import io.github.intisy.ai.shared.model.Account;
import io.github.intisy.ai.api.seam.Random;

/**
 * Generic availability + backoff math; "lanes" are arbitrary strings a driver uses to
 * partition rate limits.
 */
public final class RateLimitMath {
    private RateLimitMath() {
    }

    /**
     * Whether the account is eligible for selection before cooldown or rate limits are considered.
     *
     * @param account the account to check
     * @return {@code true} unless the account is explicitly disabled
     */
    public static boolean isEnabled(Account account) {
        return account.enabled == null || account.enabled;
    }

    /**
     * Whether the account is inside a cooldown window set elsewhere in the engine.
     *
     * @param account the account to check
     * @param now the current epoch ms
     * @return {@code true} while {@code now} is before the account's cooldown deadline
     */
    public static boolean isCoolingDown(Account account, long now) {
        return account.coolingDownUntil != null && account.coolingDownUntil > now;
    }

    /**
     * Whether {@code lane} specifically has an active rate-limit reset time on this account.
     *
     * @param account the account to check
     * @param lane the rate-limit lane to check, or {@code null}/empty for none
     * @param now the current epoch ms
     * @return {@code true} while {@code now} is before that lane's reset time
     */
    public static boolean isLaneRateLimited(Account account, String lane, long now) {
        if (lane == null || lane.isEmpty() || account.rateLimitResetTimes == null) return false;
        Long until = account.rateLimitResetTimes.get(lane);
        return until != null && until > now;
    }

    /**
     * Whether the account can be selected right now for {@code lane}.
     *
     * @param account the account to check
     * @param lane the lane the caller wants to use, or {@code null}/empty for none
     * @param now the current epoch ms
     * @return {@code true} when the account is enabled, not cooling down, and not lane rate limited
     */
    public static boolean isAvailable(Account account, String lane, long now) {
        if (!isEnabled(account)) return false;
        if (isCoolingDown(account, now)) return false;
        if (isLaneRateLimited(account, lane, now)) return false;
        return true;
    }

    /**
     * Soonest epoch ms this account is usable again for {@code lane}; {@code Long.MAX_VALUE}
     * (the "Infinity" sentinel) if the account is disabled. Floors to {@code now} (matches JS
     * {@code Math.max(t, now)}) so an account whose cooldown/rate-limit timestamps are already
     * in the past (but is still unavailable via a custom predicate) reports "now", not a stale
     * past instant.
     *
     * @param account the account to check
     * @param lane the lane to check, or {@code null}/empty for none
     * @param now the current epoch ms
     * @return the soonest epoch ms the account becomes usable, or {@code Long.MAX_VALUE} if disabled
     */
    public static long availableAt(Account account, String lane, long now) {
        if (!isEnabled(account)) return Long.MAX_VALUE;
        long t = 0L;
        if (account.coolingDownUntil != null) t = Math.max(t, account.coolingDownUntil);
        if (lane != null && !lane.isEmpty() && account.rateLimitResetTimes != null) {
            Long until = account.rateLimitResetTimes.get(lane);
            if (until != null) t = Math.max(t, until);
        }
        return Math.max(t, now);
    }

    /**
     * {@code min(maxMs, baseMs * 2^attempt)}, halved + jittered unless {@code jitter} is
     * {@code false} (in which case the result is the raw value with NO randomness --
     * {@code jitterFactor} is not consulted at all).
     *
     * @param attempt the zero-based retry attempt number
     * @param baseMs the backoff for attempt zero
     * @param maxMs the ceiling the exponential growth is clamped to
     * @param jitter whether to halve and randomize the result
     * @param jitterFactor a value in {@code [0, 1)}, e.g. from {@link Random#next()}; ignored
     *                      when {@code jitter} is {@code false}.
     * @return the backoff delay in ms
     */
    public static long calculateBackoffMs(int attempt, long baseMs, long maxMs, boolean jitter, double jitterFactor) {
        long raw = Math.min(maxMs, (long) (baseMs * Math.pow(2, Math.max(0, attempt))));
        if (!jitter) return raw;
        return (long) Math.floor(raw / 2.0 + jitterFactor * (raw / 2.0));
    }

    /**
     * SPI-based seam: consults {@code rng.next()} only when {@code jitter} is {@code true},
     * so callers stay fully deterministic in tests by injecting a fixed {@link Random}.
     *
     * @param attempt the zero-based retry attempt number
     * @param baseMs the backoff for attempt zero
     * @param maxMs the ceiling the exponential growth is clamped to
     * @param jitter whether to halve and randomize the result
     * @param rng the source of randomness, consulted only when {@code jitter} is {@code true}
     * @return the backoff delay in ms
     */
    public static long calculateBackoffMs(int attempt, long baseMs, long maxMs, boolean jitter, Random rng) {
        double jitterFactor = jitter ? rng.next() : 0.0;
        return calculateBackoffMs(attempt, baseMs, maxMs, jitter, jitterFactor);
    }

    /**
     * Convenience overload for the {@code jitter == false} path, where no randomness is
     * needed at all -- exact {@code min(maxMs, baseMs * 2^attempt)}.
     *
     * @param attempt the zero-based retry attempt number
     * @param baseMs the backoff for attempt zero
     * @param maxMs the ceiling the exponential growth is clamped to
     * @param jitter whether to halve and randomize the result
     * @return the backoff delay in ms
     */
    public static long calculateBackoffMs(int attempt, long baseMs, long maxMs, boolean jitter) {
        return calculateBackoffMs(attempt, baseMs, maxMs, jitter, 0.0);
    }
}
