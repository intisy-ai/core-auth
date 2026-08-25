package io.github.intisy.ai.shared.proxy;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ProxyScoringTest {

    static Map<String, Object> map(Object... pairs) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) out.put((String) pairs[i], pairs[i + 1]);
        return out;
    }

    private static Map<String, Object> proxy(String url, String provider, Map<String, Object> stats) {
        return map("url", url, "provider", provider, "stats", stats);
    }

    private static final Map<String, Object> NO_ASSIGNMENTS = map("assignments", map());

    @Test
    void penalizesIpRateLimitHitsBecauseLowerIsBetter() {
        Map<String, Object> clean = proxy("a", "manual",
                map("checks", 10L, "failures", 0L, "avgLatencyMs", 200L, "ipRateLimitHits", 0L));
        Map<String, Object> limited = proxy("b", "manual",
                map("checks", 10L, "failures", 0L, "avgLatencyMs", 200L, "ipRateLimitHits", 3L));

        assertTrue(ProxyScoring.scoreOf(NO_ASSIGNMENTS, clean) < ProxyScoring.scoreOf(NO_ASSIGNMENTS, limited));
    }

    @Test
    void qualityLabelReflectsIpLimitHistory() {
        assertEquals("good", ProxyScoring.qualityLabel(
                proxy("a", "manual", map("checks", 20L, "failures", 0L, "avgLatencyMs", 150L, "ipRateLimitHits", 0L))));
        assertEquals("poor", ProxyScoring.qualityLabel(
                proxy("b", "manual", map("checks", 20L, "failures", 10L, "avgLatencyMs", 150L, "ipRateLimitHits", 5L))));
    }

    @Test
    void ipLimitIsTimeBoxed() {
        long now = 1000000L;
        assertTrue(ProxyScoring.isIpLimited(proxy("a", "manual", map("lastRateLimitAt", now - 1000L)), now));
        assertFalse(ProxyScoring.isIpLimited(
                proxy("a", "manual", map("lastRateLimitAt", now - ProxyScoring.IP_LIMIT_COOLDOWN_MS - 1)), now));
        assertFalse(ProxyScoring.isIpLimited(proxy("a", "manual", map()), now));
    }

    /**
     * A proxy that has never been measured stores a zero latency, and must score as the unknown
     * 2000ms default rather than as the fastest in the pool.
     */
    @Test
    void zeroLatencyScoresAsUnmeasuredRatherThanAsFastest() {
        Map<String, Object> unmeasured = proxy("a", "cloud", map("checks", 4L, "failures", 0L, "avgLatencyMs", 0L));
        Map<String, Object> fast = proxy("b", "cloud", map("checks", 4L, "failures", 0L, "avgLatencyMs", 50L));

        assertTrue(ProxyScoring.scoreOf(NO_ASSIGNMENTS, fast) < ProxyScoring.scoreOf(NO_ASSIGNMENTS, unmeasured));
    }

    @Test
    void unmeasuredProxyTakesTheHalfFailRate() {
        Map<String, Object> never = proxy("a", "cloud", map("checks", 0L, "failures", 0L, "avgLatencyMs", 1000L));
        assertEquals(1 + 0.5 * 10, ProxyScoring.scoreOf(NO_ASSIGNMENTS, never), 1e-9);
    }

    @Test
    void manualProxiesAreFavouredAndHeldAssignmentsPenalized() {
        Map<String, Object> stats = map("checks", 10L, "failures", 0L, "avgLatencyMs", 1000L);
        Map<String, Object> store = map("assignments", map("acc1", "u", "acc2", "u", "other", "elsewhere"));

        assertEquals(1 + 2 * 5 - 10, ProxyScoring.scoreOf(store, proxy("u", "manual", stats)), 1e-9);
        assertEquals(1 + 2 * 5, ProxyScoring.scoreOf(store, proxy("u", "cloud", stats)), 1e-9);
    }

    @Test
    void countsOnlyAssignmentsToTheGivenUrl() {
        Map<String, Object> store = map("assignments", map("a", "one", "b", "two", "c", "one"));
        assertEquals(2, ProxyScoring.countAssignments(store, "one"));
        assertEquals(0, ProxyScoring.countAssignments(store, "missing"));
        assertEquals(0, ProxyScoring.countAssignments(map(), "one"));
    }
}
