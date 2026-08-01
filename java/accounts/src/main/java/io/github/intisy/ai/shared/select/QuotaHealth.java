package io.github.intisy.ai.shared.select;

import java.util.List;

/**
 * Neutral quota-capacity predicate shared by every provider's quota parser. A provider maps its
 * own cachedQuota shape into a list of {@link Pool}s (each pool's remaining capacity normalized
 * to {@code [0, 1]}); this class owns the single decision every provider needs from that list.
 * Ported from the triplicated "any pool with capacity remaining -> the account still has quota"
 * check in claude's {@code accounts-controller.ts}, {@code ClaudeQuotaParser.java}, and
 * antigravity's {@code AntigravityQuotaParser.java}.
 */
public final class QuotaHealth {
    private QuotaHealth() {
    }

    /** One quota pool's remaining capacity fraction, in {@code [0, 1]}. */
    public static final class Pool {
        public final double remainingFraction;

        public Pool(double remainingFraction) {
            this.remainingFraction = remainingFraction;
        }
    }

    /** True when at least one pool still has capacity remaining. */
    public static boolean hasCapacity(List<Pool> pools) {
        if (pools == null) return false;
        for (Pool pool : pools) {
            if (pool != null && pool.remainingFraction > 0) return true;
        }
        return false;
    }

    /**
     * A 429 is an IP/proxy limit (set {@code ipSuspected}), not the account's own quota, exactly
     * when the account still has capacity elsewhere -- the same decision as {@link
     * #hasCapacity}. Kept as its own named entry point since callers reach for it by the concept
     * they need (capacity check vs. proxy-signal decision), even though the value is identical.
     */
    public static boolean ipSuspected(List<Pool> pools) {
        return hasCapacity(pools);
    }
}
