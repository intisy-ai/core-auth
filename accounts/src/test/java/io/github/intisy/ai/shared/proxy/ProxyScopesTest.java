package io.github.intisy.ai.shared.proxy;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static io.github.intisy.ai.shared.proxy.ProxyScoringTest.map;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ProxyScopesTest {

    private static Map<String, Object> store(Object... over) {
        Map<String, Object> store = map(
                "version", 2L,
                "modes", map("default", "automatic"),
                "providers", map(),
                "assignments", map(),
                "manualSelection", map(),
                "proxies", new ArrayList<Object>());
        for (int i = 0; i < over.length; i += 2) store.put((String) over[i], over[i + 1]);
        return store;
    }

    private static Map<String, Object> proxy(String url, Map<String, Object> scope, Map<String, Object> stats) {
        return map("url", url, "provider", "manual", "scope", scope, "stats", stats);
    }

    private static List<String> urls(Map<String, Object> store, List<Integer> indices) {
        List<Object> proxies = (List<Object>) store.get("proxies");
        List<String> out = new ArrayList<>();
        for (Integer index : indices) {
            out.add((String) ((Map<String, Object>) proxies.get(index.intValue())).get("url"));
        }
        return out;
    }

    @Test
    void scopeKeyFormatsEachScopeType() {
        assertEquals("global", ProxyScopes.scopeKey(map("type", "global")));
        assertEquals("provider:antigravity", ProxyScopes.scopeKey(map("type", "provider", "id", "antigravity")));
        assertEquals("account:a@b", ProxyScopes.scopeKey(map("type", "account", "id", "a@b")));
        assertEquals("global", ProxyScopes.scopeKey(null));
    }

    @Test
    void parseScopeKeyInvertsScopeKey() {
        assertEquals(map("type", "global"), ProxyScopes.parseScopeKey("global"));
        assertEquals(map("type", "provider", "id", "antigravity"), ProxyScopes.parseScopeKey("provider:antigravity"));
        assertEquals(map("type", "account", "id", "a@b"), ProxyScopes.parseScopeKey("account:a@b"));
    }

    @Test
    void effectiveModeFallsBackToDefault() {
        Map<String, Object> store = store("modes", map("default", "automatic", "global", "disabled"));
        assertEquals("disabled", ProxyScopes.effectiveMode(store, "global"));
        assertEquals("automatic", ProxyScopes.effectiveMode(store, "account:x"));
    }

    @Test
    void effectiveModeIsDisabledWhenNothingIsConfigured() {
        assertEquals("disabled", ProxyScopes.effectiveMode(map(), "global"));
    }

    @Test
    void resolveChainDropsDisabledScopesMostSpecificFirst() {
        Map<String, Object> store = store("modes", map("default", "automatic", "provider:p", "disabled"));
        assertEquals(Arrays.asList("account:acc", "global"), ProxyScopes.resolveChain(store, "acc", "p"));
    }

    @Test
    void resolveChainOmitsScopesWithNoIdentity() {
        Map<String, Object> store = store();
        assertEquals(Arrays.asList("global"), ProxyScopes.resolveChain(store, null, null));
        assertEquals(Arrays.asList("provider:p", "global"), ProxyScopes.resolveChain(store, "", "p"));
    }

    @Test
    void candidatesExcludeIpLimitedAndCapBoundBestFirst() {
        long now = 1000000L;
        Map<String, Object> global = map("type", "global");
        Map<String, Object> store = store("proxies", new ArrayList<Object>(Arrays.asList(
                proxy("slow", global, map("checks", 5L, "failures", 0L, "avgLatencyMs", 1500L, "ipRateLimitHits", 0L)),
                proxy("fast", global, map("checks", 5L, "failures", 0L, "avgLatencyMs", 100L, "ipRateLimitHits", 0L)),
                proxy("limited", global, map("lastRateLimitAt", now - 1000L)))));

        assertEquals(Arrays.asList("fast", "slow"), urls(store, ProxyScopes.candidatesForScope(store, "global", now)));
    }

    @Test
    void candidatesDropAProxyAtTheAssignmentCap() {
        long now = 1000000L;
        Map<String, Object> global = map("type", "global");
        Map<String, Object> stats = map("checks", 5L, "failures", 0L, "avgLatencyMs", 100L);
        Map<String, Object> store = store(
                "assignments", map("a", "full", "b", "full", "c", "full"),
                "proxies", new ArrayList<Object>(Arrays.asList(
                        proxy("full", global, stats),
                        proxy("free", global, stats))));

        assertEquals(Arrays.asList("free"), urls(store, ProxyScopes.candidatesForScope(store, "global", now)));
    }

    @Test
    void manualModeTakesOnlyTheSelectedSubset() {
        long now = 1000000L;
        Map<String, Object> global = map("type", "global");
        Map<String, Object> stats = map("checks", 5L, "failures", 0L, "avgLatencyMs", 100L);
        Map<String, Object> store = store(
                "modes", map("default", "manual"),
                "manualSelection", map("global", new ArrayList<Object>(Arrays.asList("picked"))),
                "proxies", new ArrayList<Object>(Arrays.asList(
                        proxy("picked", global, stats),
                        proxy("ignored", global, stats))));

        assertEquals(Arrays.asList("picked"), urls(store, ProxyScopes.candidatesForScope(store, "global", now)));
    }

    @Test
    void proxiesInScopeSelectsByScopeKeyOnly() {
        Map<String, Object> stats = map("checks", 5L, "failures", 0L, "avgLatencyMs", 100L);
        Map<String, Object> store = store("proxies", new ArrayList<Object>(Arrays.asList(
                proxy("g", map("type", "global"), stats),
                proxy("p", map("type", "provider", "id", "x"), stats))));

        assertEquals(Arrays.asList("g"), urls(store, ProxyScopes.proxiesInScope(store, "global")));
        assertEquals(Arrays.asList("p"), urls(store, ProxyScopes.proxiesInScope(store, "provider:x")));
    }

    /**
     * The held proxy keeps its own slot: applying the per-proxy cap here would evict the account
     * that is already on it, so a cap-full proxy stays sticky-usable while it is dropped as a
     * candidate for a NEW assignment.
     */
    @Test
    void stickyUsableIgnoresTheCapButNotTheIpLimit() {
        long now = 1000000L;
        Map<String, Object> global = map("type", "global");
        Map<String, Object> stats = map("checks", 5L, "failures", 0L, "avgLatencyMs", 100L);
        Map<String, Object> store = store(
                "assignments", map("a", "held", "b", "held", "c", "held"),
                "proxies", new ArrayList<Object>(Arrays.asList(
                        proxy("held", global, stats),
                        proxy("burned", global, map("lastRateLimitAt", now - 1000L)))));

        assertTrue(ProxyScopes.stickyUsable(store, "global", "held", now));
        assertEquals(new ArrayList<String>(), urls(store, ProxyScopes.candidatesForScope(store, "global", now)));
        assertFalse(ProxyScopes.stickyUsable(store, "global", "burned", now));
        assertFalse(ProxyScopes.stickyUsable(store, "global", "absent", now));
    }

    @Test
    void stickyUsableRefusesADisabledScopeAndAnUnselectedManualProxy() {
        long now = 1000000L;
        Map<String, Object> global = map("type", "global");
        Map<String, Object> stats = map("checks", 5L, "failures", 0L, "avgLatencyMs", 100L);
        List<Object> proxies = new ArrayList<Object>(Arrays.asList(proxy("u", global, stats)));

        assertFalse(ProxyScopes.stickyUsable(
                store("modes", map("default", "disabled"), "proxies", proxies), "global", "u", now));
        assertFalse(ProxyScopes.stickyUsable(
                store("modes", map("default", "manual"), "proxies", proxies), "global", "u", now));
        assertTrue(ProxyScopes.stickyUsable(
                store("modes", map("default", "manual"),
                        "manualSelection", map("global", new ArrayList<Object>(Arrays.asList("u"))),
                        "proxies", proxies), "global", "u", now));
    }
}
