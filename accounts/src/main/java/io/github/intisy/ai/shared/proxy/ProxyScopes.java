package io.github.intisy.ai.shared.proxy;

import io.github.intisy.ai.seam.JsonUtil;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Scope resolution over the proxy store: which proxies a given scope may use, in which order.
 * Scopes nest account to provider to global, most specific first.
 *
 * @implNote The selection methods return INDICES into {@code store.proxies} rather than the proxy
 * maps themselves, so the calling side resolves them back to its own objects and identity survives
 * the boundary.
 */
public final class ProxyScopes {
    private static final String GLOBAL = "global";
    private static final String DISABLED = "disabled";
    private static final String MANUAL = "manual";

    private ProxyScopes() {
    }

    /**
     * @param scope the scope map to key, or {@code null} for the global scope
     * @return the scope's storage key
     */
    public static String scopeKey(Map<String, Object> scope) {
        if (scope == null) return GLOBAL;
        String type = JsonUtil.asString(scope.get("type"));
        if (GLOBAL.equals(type)) return GLOBAL;
        // A typeless scope deliberately yields a key that matches nothing rather than defaulting to
        // global: a malformed entry must not silently widen into every provider's pool.
        return type + ":" + JsonUtil.asString(scope.get("id"));
    }

    /**
     * The inverse of {@link #scopeKey}. The global scope carries no id, so the key is absent.
     *
     * @param key the scope storage key to decompose
     * @return the scope map the key was derived from
     */
    public static Map<String, Object> parseScopeKey(String key) {
        Map<String, Object> scope = new LinkedHashMap<String, Object>();
        if (GLOBAL.equals(key)) {
            scope.put("type", GLOBAL);
            return scope;
        }
        int separator = key.indexOf(':');
        scope.put("type", key.substring(0, separator));
        scope.put("id", key.substring(separator + 1));
        return scope;
    }

    /**
     * @param store the proxy store to read modes from
     * @param key the scope storage key to look up
     * @return the scope's configured mode, defaulting to the store default then to disabled
     */
    public static String effectiveMode(Map<String, Object> store, String key) {
        Map<String, Object> modes = store == null ? null : JsonUtil.asMap(store.get("modes"));
        if (modes == null) return DISABLED;
        String mode = JsonUtil.asString(modes.get(key));
        if (mode != null && !mode.isEmpty()) return mode;
        String fallback = JsonUtil.asString(modes.get("default"));
        return fallback != null && !fallback.isEmpty() ? fallback : DISABLED;
    }

    /**
     * Account to provider to global, dropping any scope whose effective mode is disabled.
     *
     * @param store the proxy store to read modes from
     * @param accountId the account id to start the chain at, or {@code null}/empty to skip it
     * @param providerId the provider id to include after the account, or {@code null}/empty to skip it
     * @return the enabled scope keys, most specific first
     */
    public static List<String> resolveChain(Map<String, Object> store, String accountId, String providerId) {
        List<String> keys = new ArrayList<String>();
        if (accountId != null && !accountId.isEmpty()) keys.add("account:" + accountId);
        if (providerId != null && !providerId.isEmpty()) keys.add("provider:" + providerId);
        keys.add(GLOBAL);

        List<String> enabled = new ArrayList<String>();
        for (String key : keys) {
            if (!DISABLED.equals(effectiveMode(store, key))) enabled.add(key);
        }
        return enabled;
    }

    /**
     * @param store the proxy store to read proxies from
     * @param key the scope storage key to filter by
     * @return the indices into {@code store.proxies} belonging to that scope
     */
    public static List<Integer> proxiesInScope(Map<String, Object> store, String key) {
        List<Object> proxies = store == null ? null : JsonUtil.asList(store.get("proxies"));
        List<Integer> indices = new ArrayList<Integer>();
        if (proxies == null) return indices;
        for (int i = 0; i < proxies.size(); i++) {
            Map<String, Object> proxy = JsonUtil.asMap(proxies.get(i));
            if (proxy == null) continue;
            if (scopeKey(JsonUtil.asMap(proxy.get("scope"))).equals(key)) indices.add(Integer.valueOf(i));
        }
        return indices;
    }

    /**
     * Usable proxies for a scope under its mode: manual takes the scope's selected subset,
     * automatic takes all. Minus the cap-bound and the currently IP-limited, best-first.
     *
     * @param store the proxy store to read proxies and scoring state from
     * @param key the scope storage key to resolve candidates for
     * @param now the current epoch ms
     * @return the usable proxy indices, best-scoring first
     */
    public static List<Integer> candidatesForScope(final Map<String, Object> store, String key, long now) {
        String mode = effectiveMode(store, key);
        Set<String> selected = MANUAL.equals(mode) ? manualSelection(store, key) : null;

        List<Integer> pool = new ArrayList<Integer>();
        for (Integer index : proxiesInScope(store, key)) {
            Map<String, Object> proxy = proxyAt(store, index.intValue());
            String url = JsonUtil.asString(proxy.get("url"));
            if (selected != null && !selected.contains(url)) continue;
            if (ProxyScoring.countAssignments(store, url) >= ProxyScoring.MAX_ACCOUNTS_PER_PROXY) continue;
            if (ProxyScoring.isIpLimited(proxy, now)) continue;
            pool.add(index);
        }

        Collections.sort(pool, new Comparator<Integer>() {
            @Override
            public int compare(Integer a, Integer b) {
                double difference = ProxyScoring.scoreOf(store, proxyAt(store, a.intValue()))
                        - ProxyScoring.scoreOf(store, proxyAt(store, b.intValue()));
                return difference < 0 ? -1 : difference > 0 ? 1 : 0;
            }
        });
        return pool;
    }

    /**
     * Whether a proxy the account ALREADY holds is still valid to re-use in this scope. The same
     * checks as {@link #candidatesForScope} minus the per-proxy cap: the account occupies its own
     * slot, and the cap gates NEW assignments, so applying it here would evict the holder. Without
     * that exemption an account on a cap-full proxy fails its own sticky check and churns, or with a
     * one-proxy pool deadlocks to direct.
     *
     * @param store the proxy store to read proxies and scoring state from
     * @param key the scope storage key the account is sticky to
     * @param url the proxy url the account already holds
     * @param now the current epoch ms
     * @return whether the account may keep using that proxy in this scope
     */
    public static boolean stickyUsable(Map<String, Object> store, String key, String url, long now) {
        String mode = effectiveMode(store, key);
        if (DISABLED.equals(mode)) return false;

        for (Integer index : proxiesInScope(store, key)) {
            Map<String, Object> proxy = proxyAt(store, index.intValue());
            if (!url.equals(JsonUtil.asString(proxy.get("url")))) continue;
            if (ProxyScoring.isIpLimited(proxy, now)) return false;
            return !MANUAL.equals(mode) || manualSelection(store, key).contains(url);
        }
        return false;
    }

    private static Map<String, Object> proxyAt(Map<String, Object> store, int index) {
        return JsonUtil.asMap(JsonUtil.asList(store.get("proxies")).get(index));
    }

    private static Set<String> manualSelection(Map<String, Object> store, String key) {
        Set<String> selected = new HashSet<String>();
        Map<String, Object> selection = store == null ? null : JsonUtil.asMap(store.get("manualSelection"));
        List<Object> urls = selection == null ? null : JsonUtil.asList(selection.get(key));
        if (urls == null) return selected;
        for (Object url : urls) {
            String text = JsonUtil.asString(url);
            if (text != null) selected.add(text);
        }
        return selected;
    }
}
