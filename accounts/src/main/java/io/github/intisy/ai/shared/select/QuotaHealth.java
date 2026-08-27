package io.github.intisy.ai.shared.select;

import java.util.List;

/**
 * Neutral quota-capacity predicate shared by every provider's quota parser. A provider maps its
 * own cachedQuota shape into a list of {@link Pool}s (each pool's remaining capacity normalized
 * to {@code [0, 1]}); this class owns the single decision every provider needs from that list,
 * centralizing the "any pool with capacity remaining -> the account still has quota" check
 * rather than duplicating it in each provider's own quota parser.
 */
public final class QuotaHealth {
    private QuotaHealth() {
    }

    /** One quota pool's remaining capacity fraction, in {@code [0, 1]}. */
    public static final class Pool {
        /** The remaining capacity fraction for this pool, in {@code [0, 1]}. */
        public final double remainingFraction;

        /** @param remainingFraction the remaining capacity fraction for this pool, in {@code [0, 1]} */
        public Pool(double remainingFraction) {
            this.remainingFraction = remainingFraction;
        }
    }

    /**
     * True when at least one pool still has capacity remaining.
     *
     * @param pools the account's quota pools, as mapped by the provider's quota parser
     * @return whether any pool still has capacity
     */
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
     *
     * @param pools the account's quota pools, as mapped by the provider's quota parser
     * @return whether a 429 should be attributed to the proxy rather than the account's quota
     */
    public static boolean ipSuspected(List<Pool> pools) {
        return hasCapacity(pools);
    }
}
