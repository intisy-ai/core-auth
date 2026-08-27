package io.github.intisy.ai.shared.proxy;

import io.github.intisy.ai.seam.JsonUtil;

import java.util.Collections;
import java.util.Map;

/**
 * Quality scoring for the configured HTTP proxies a provider can route an account through, over the
 * parsed proxy-store shape. Lower is better, and an IP-rate-limit hit dominates every other term
 * because it reflects an exit IP the upstream has already burned.
 *
 * @implNote {@link #truthyNumber} reproduces JavaScript's {@code value || fallback}, in which a
 * stored zero is falsy and therefore takes the fallback. That is load-bearing rather than
 * incidental: a proxy with {@code avgLatencyMs: 0} has never been measured, so it must score as the
 * 2000ms unknown-latency default rather than as the fastest proxy in the pool.
 */
public final class ProxyScoring {
    /** The cap on accounts one proxy may hold at once, so no proxy absorbs too much traffic. */
    public static final int MAX_ACCOUNTS_PER_PROXY = 3;
    /** How long a proxy stays excluded after an upstream IP rate-limit hit. */
    public static final long IP_LIMIT_COOLDOWN_MS = 5L * 60L * 1000L;

    private static final double UNKNOWN_LATENCY_MS = 2000;
    private static final double UNKNOWN_FAIL_RATE = 0.5;

    private ProxyScoring() {
    }

    /**
     * How many accounts currently hold an assignment to {@code url}.
     *
     * @param store the proxy store to read assignments from
     * @param url the proxy url to count assignments for
     * @return the number of accounts assigned to that url
     */
    public static int countAssignments(Map<String, Object> store, String url) {
        Map<String, Object> assignments = store == null ? null : JsonUtil.asMap(store.get("assignments"));
        if (assignments == null) return 0;
        int count = 0;
        for (Object assigned : assignments.values()) {
            if (assigned instanceof String && assigned.equals(url)) count++;
        }
        return count;
    }

    /**
     * Ranking score for choosing between candidate proxies; lower is better.
     *
     * @param store the proxy store to read assignments from
     * @param proxy the proxy to score
     * @return the ranking score, combining base quality, current load, and a preference for
     * manually entered proxies (their score is reduced, which makes them rank better)
     */
    public static double scoreOf(Map<String, Object> store, Map<String, Object> proxy) {
        int inUse = countAssignments(store, JsonUtil.asString(proxy.get("url")));
        boolean manual = "manual".equals(JsonUtil.asString(proxy.get("provider")));
        return baseQuality(proxy) + inUse * 5 - (manual ? 10 : 0);
    }

    /**
     * Coarse UI quality from the same components, independent of how many accounts hold it.
     *
     * @param proxy the proxy to label
     * @return {@code "good"}, {@code "fair"}, or {@code "poor"}
     */
    public static String qualityLabel(Map<String, Object> proxy) {
        double quality = baseQuality(proxy);
        if (quality < 3) return "good";
        if (quality < 12) return "fair";
        return "poor";
    }

    /**
     * @param proxy the proxy to check
     * @param now the current epoch ms
     * @return whether the proxy is still inside its {@link #IP_LIMIT_COOLDOWN_MS} exclusion window
     */
    public static boolean isIpLimited(Map<String, Object> proxy, long now) {
        Map<String, Object> stats = statsOf(proxy);
        Object at = stats.get("lastRateLimitAt");
        if (!(at instanceof Number)) return false;
        return now - ((Number) at).doubleValue() < IP_LIMIT_COOLDOWN_MS;
    }

    private static double baseQuality(Map<String, Object> proxy) {
        Map<String, Object> stats = statsOf(proxy);
        double checks = truthyNumber(stats, "checks", 0);
        double failRate = checks != 0 ? truthyNumber(stats, "failures", 0) / checks : UNKNOWN_FAIL_RATE;
        return truthyNumber(stats, "avgLatencyMs", UNKNOWN_LATENCY_MS) / 1000
                + failRate * 10
                + truthyNumber(stats, "ipRateLimitHits", 0) * 20;
    }

    private static Map<String, Object> statsOf(Map<String, Object> proxy) {
        Map<String, Object> stats = proxy == null ? null : JsonUtil.asMap(proxy.get("stats"));
        return stats == null ? Collections.<String, Object>emptyMap() : stats;
    }

    private static double truthyNumber(Map<String, Object> obj, String field, double fallback) {
        Object value = obj.get(field);
        if (!(value instanceof Number)) return fallback;
        double number = ((Number) value).doubleValue();
        return number != 0 ? number : fallback;
    }
}
