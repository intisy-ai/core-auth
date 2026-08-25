package io.github.intisy.ai.js;

import io.github.intisy.ai.shared.manager.AccountManager;
import io.github.intisy.ai.shared.manager.Acquired;
import io.github.intisy.ai.shared.manager.ManagerOptions;
import io.github.intisy.ai.shared.model.Account;
import io.github.intisy.ai.shared.oauth.OAuthConfig;
import io.github.intisy.ai.shared.oauth.OAuthWire;
import io.github.intisy.ai.shared.oauth.Refreshed;
import io.github.intisy.ai.shared.oauth.TokenRefresh;
import io.github.intisy.ai.shared.oauth.TokenRefreshError;
import io.github.intisy.ai.shared.select.QuotaHealth;
import io.github.intisy.ai.shared.select.RateLimitMath;
import io.github.intisy.ai.shared.select.Strategy;
import io.github.intisy.ai.api.seam.Clock;
import io.github.intisy.ai.api.seam.HttpClient;
import io.github.intisy.ai.api.seam.JsonCodec;
import io.github.intisy.ai.api.seam.Random;
import io.github.intisy.ai.api.seam.Store;
import io.github.intisy.ai.shared.store.AccountStore;
import io.github.intisy.ai.seam.JsonUtil;
import io.github.intisy.ai.seam.SimpleJsonCodec;

import org.teavm.jso.JSExport;
import org.teavm.jso.core.JSObjects;
import org.teavm.jso.core.JSPromise;
import org.teavm.jso.core.JSString;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.BiPredicate;

/**
 * TeaVM JS export surface over core-auth's account/oauth engine, relocated from ai-java's
 * {@code AiJavaJs} (Phase 4 Task 2), ACCOUNT-ONLY: this is exactly the set of exports Phase 4
 * Task 1 EXCLUDED when trimming {@code AiJavaJs} down to {@code core-proxy}'s {@code CoreProxyJs}
 * (routing-only). {@code SimpleJsonCodec}/{@code JsStoreBridge}/{@code JsHttpClientBridge} are
 * NOT duplicated here, this class lives in the same package ({@code io.github.intisy.ai.js}) as
 * core-proxy's {@code :teavm} module (a Gradle project dependency, see
 * {@code core-auth/java/teavm/build.gradle}), so it references those classes unqualified exactly
 * like the original single-module {@code AiJavaJs} did.
 */
public final class CoreAuthJs {
    private CoreAuthJs() {
    }

    /**
     * Builds an {@link AccountManager} over the LIVE store for {@code providerId} and the given
     * (already-resolved) {@code opts}, wired with a {@link HttpClient} that always throws: every
     * export below except {@link #refreshToken} never triggers {@code AccountManager}'s internal
     * network refresh path ({@code ensureAccess}/{@code refresh}) -- {@link
     * AccountManager#selectAndClaim} and the reportRateLimit/reportError/reportSuccess/
     * nextAvailableAt methods never call it, so the throwing stub is provably unreachable rather
     * than silently wrong.
     */
    private static AccountManager accountManagerFor(String providerId, Store store, JsonCodec json, ManagerOptions opts) {
        AccountStore accountStore = new AccountStore(store, json);
        HttpClient unreachable = req -> {
            throw new UnsupportedOperationException(
                    "CoreAuthJs's fine-grained account exports never perform a network token "
                            + "refresh internally; call refreshToken(...) explicitly instead");
        };
        Clock clock = System::currentTimeMillis;
        Random random = Math::random;
        return new AccountManager(providerId, accountStore, unreachable, clock, random, json, opts);
    }

    /**
     * {@code strategy} is one of {@code "sticky"} / {@code "round-robin"} / {@code "hybrid"}
     * (matching the string values {@code commonManagerOptions}/{@code manager.ts} already use);
     * {@code null}, empty, or anything unrecognized falls back to {@link ManagerOptions}'s own
     * {@link Strategy#HYBRID} default.
     */
    private static Strategy parseStrategy(String strategy) {
        if (strategy == null) return Strategy.HYBRID;
        switch (strategy) {
            case "sticky":
                return Strategy.STICKY;
            case "round-robin":
                return Strategy.ROUND_ROBIN;
            case "hybrid":
                return Strategy.HYBRID;
            default:
                return Strategy.HYBRID;
        }
    }

    /**
     * {@code AccountManager.selectAndClaim} -- selection + the {@code lastUsed} claim ONLY (the
     * store write persists via the live store); NO network refresh (see {@link #refreshToken}).
     * Returns {@code {accountId, access?}} (the claimed account's CURRENT stored access token,
     * possibly stale/expired -- check via {@link #accessTokenExpired}), or {@code {none:true}}
     * when nobody in the pool is available.
     *
     * <p>{@code available} is the JS side of a provider's {@code isAvailable} option (see JS
     * {@code manager.ts}'s {@code extraAvailable}, e.g. antigravity's "skip accounts pending
     * Google verification" gate) -- pass {@code null}/{@code undefined} when the provider
     * supplied none, matching {@link ManagerOptions#extraAvailable}'s own null-means-"built-in
     * check only" contract.
     */
    @JSExport
    public static String acquireAccount(String providerId, String lane, String strategy,
                                         JsAvailabilityBridge.JsAvailable available, JsStoreBridge.JsStore jsStore) {
        JsonCodec json = new SimpleJsonCodec();
        Store store = new JsStoreBridge(jsStore);

        ManagerOptions opts = new ManagerOptions();
        opts.strategy = parseStrategy(strategy);
        if (available != null && !JSObjects.isUndefined(available)) {
            String laneArg = lane != null ? lane : "";
            opts.extraAvailable = (account, l) ->
                    available.test(JSString.valueOf(json.stringify(accountToJson(account))), JSString.valueOf(laneArg));
        }

        AccountManager manager = accountManagerFor(providerId, store, json, opts);
        Acquired acquired = manager.selectAndClaim(lane);

        Map<String, Object> out = new LinkedHashMap<>();
        if (acquired == null) {
            out.put("none", true);
        } else {
            out.put("accountId", acquired.account.id);
            if (acquired.access != null) out.put("access", acquired.access);
        }
        return json.stringify(out);
    }

    /**
     * {@code AccountManager.reportRateLimit} -- persists {@code account.rateLimitResetTimes[lane]
     * = resetMs}. {@code resetMs} is a {@code double} (not {@code long}) at this exported
     * boundary: a raw JS {@code number} handed directly to a declared Java {@code long} parameter
     * is NOT re-marshalled into TeaVM's internal (BigInt-backed) {@code Long} representation --
     * it is passed through as-is, corrupting any later 64-bit Long arithmetic/formatting on that
     * value (confirmed via a {@code BigInt.asUintN} crash on an epoch-ms-sized value). A {@code
     * double} parameter needs no such remarshalling (JS numbers ARE doubles), so the explicit
     * {@code (long)} cast below constructs a well-formed Java {@code long} from it.
     */
    @JSExport
    public static void reportRateLimit(String providerId, String id, String lane, double resetMs, JsStoreBridge.JsStore jsStore) {
        JsonCodec json = new SimpleJsonCodec();
        Store store = new JsStoreBridge(jsStore);
        accountManagerFor(providerId, store, json, new ManagerOptions()).reportRateLimit(id, lane, (long) resetMs);
    }

    /**
     * {@code AccountManager.reportError} -- persists a jittered-backoff {@code coolingDownUntil}/
     * {@code cooldownReason}, UNLESS {@code lane} already has an active provider-supplied
     * {@code rateLimitResetTimes} entry (that reset owns usable-again for this lane instead).
     * {@code lane} is {@code ""} when the caller doesn't know the failing request's lane (treated
     * as "no same-lane reset known", so this cools down normally -- the safe default). {@code
     * baseMs}/{@code maxMs} are the CALLER's own backoff config (e.g. a provider's user-
     * configurable retry settings, see {@code provider-common.ts}'s {@code retryBackoffMs}) --
     * passed through as {@code double}s (see {@link #reportRateLimit}'s javadoc for why a raw
     * exported {@code long} is unsafe) rather than hardcoded on {@link ManagerOptions}'s own
     * defaults, so a provider that configures a non-default backoff (e.g. antigravity's 60s/60s)
     * keeps that value across this delegation instead of silently reverting to {@link
     * ManagerOptions}'s 1s/5min built-in default.
     */
    @JSExport
    public static void reportError(String providerId, String id, String lane, int attempt, String reason,
                                    double baseMs, double maxMs, JsStoreBridge.JsStore jsStore) {
        JsonCodec json = new SimpleJsonCodec();
        Store store = new JsStoreBridge(jsStore);
        ManagerOptions opts = new ManagerOptions();
        opts.backoffBaseMs = (long) baseMs;
        opts.backoffMaxMs = (long) maxMs;
        accountManagerFor(providerId, store, json, opts).reportError(id, lane, attempt, reason);
    }

    /** {@code AccountManager.reportSuccess} -- clears cooldown, bumps {@code lastUsed}. */
    @JSExport
    public static void reportSuccess(String providerId, String id, JsStoreBridge.JsStore jsStore) {
        JsonCodec json = new SimpleJsonCodec();
        Store store = new JsStoreBridge(jsStore);
        accountManagerFor(providerId, store, json, new ManagerOptions()).reportSuccess(id);
    }

    /**
     * {@code AccountManager.nextAvailableAt} -- the soonest epoch-ms any account in the pool
     * becomes available for {@code lane}. Returns the bare JSON number, or the literal JSON
     * {@code "null"} when no account will ever become available.
     */
    @JSExport
    public static String nextAvailableAt(String providerId, String lane, JsStoreBridge.JsStore jsStore) {
        JsonCodec json = new SimpleJsonCodec();
        Store store = new JsStoreBridge(jsStore);
        Long next = accountManagerFor(providerId, store, json, new ManagerOptions()).nextAvailableAt(lane);
        return json.stringify(next);
    }

    /**
     * {@code TokenRefresh.accessTokenExpired} -- pure predicate, no store/network involved.
     * {@code accountJson} supplies {@code {access, expires}} (only fields this predicate reads).
     * {@code now} is a {@code double}, not {@code long} -- see {@link #reportRateLimit}'s javadoc
     * for why a raw exported {@code long} parameter is unsafe.
     */
    @JSExport
    public static boolean accessTokenExpired(String accountJson, double now) {
        JsonCodec json = new SimpleJsonCodec();
        return TokenRefresh.accessTokenExpired(accountFromJson(json, accountJson), (long) now);
    }

    /**
     * {@code RateLimitMath.calculateBackoffMs} over the {@code jitter == false} exact-value path
     * (the deterministic one; {@code jitter == true} consults an RNG and is intentionally out of
     * scope for a byte-identical parity check). {@code argsJson} is
     * {@code {"attempt":int,"baseMs":long,"maxMs":long,"jitter":boolean}}; returns the bare JSON
     * number result (a {@code Long}, so a whole value never gets a spurious {@code .0}).
     */
    /**
     * {@code OAuthWire.calculateTokenExpiry} -- the shared expiry maths behind both OAuth grants.
     *
     * <p>A non-finite {@code expiresInSeconds} means the token endpoint reported none, so the
     * default lives on the Java side rather than being restated by each caller. Both parameters are
     * {@code double} because a raw JS number handed to a declared Java {@code long} is not
     * remarshalled at this boundary (see {@link #reportRateLimit}).
     */
    @JSExport
    public static double calculateTokenExpiry(double requestTimeMs, double expiresInSeconds) {
        Double seconds = Double.isNaN(expiresInSeconds) || Double.isInfinite(expiresInSeconds)
                ? null
                : expiresInSeconds;
        return OAuthWire.calculateTokenExpiry((long) requestTimeMs, seconds);
    }

    @JSExport
    public static String calculateBackoffMsJson(String argsJson) {
        JsonCodec json = new SimpleJsonCodec();
        Map<?, ?> args = (Map<?, ?>) json.parse(argsJson);
        int attempt = toInt(args.get("attempt"));
        long baseMs = toLong(args.get("baseMs"));
        long maxMs = toLong(args.get("maxMs"));
        boolean jitter = Boolean.TRUE.equals(args.get("jitter"));
        long result = RateLimitMath.calculateBackoffMs(attempt, baseMs, maxMs, jitter);
        return json.stringify(result);
    }

    /**
     * {@code QuotaHealth.hasCapacity} -- the neutral quota-capacity predicate a provider's quota
     * parser delegates to after mapping its own cachedQuota shape into the neutral list. {@code
     * poolsJson} is a JSON array of {@code {"remainingFraction":number}} objects (missing/non-
     * numeric {@code remainingFraction} treated as 0, so a malformed pool never counts as
     * capacity); returns the bare JSON boolean. The same value answers both "does the account
     * still have quota" and "is a 429 an IP/proxy limit" (ipSuspected), see {@link
     * QuotaHealth#ipSuspected} javadoc.
     */
    @JSExport
    public static boolean quotaHasCapacity(String poolsJson) {
        JsonCodec json = new SimpleJsonCodec();
        return QuotaHealth.hasCapacity(quotaPoolsFromJson(json, poolsJson));
    }

    @SuppressWarnings("unchecked")
    private static List<QuotaHealth.Pool> quotaPoolsFromJson(JsonCodec json, String poolsJson) {
        List<QuotaHealth.Pool> pools = new ArrayList<>();
        Object parsed = poolsJson != null ? json.parse(poolsJson) : null;
        if (!(parsed instanceof List)) return pools;
        for (Object entry : (List<Object>) parsed) {
            if (!(entry instanceof Map)) continue;
            Object rf = ((Map<?, ?>) entry).get("remainingFraction");
            double remainingFraction = rf instanceof Number ? ((Number) rf).doubleValue() : 0.0;
            pools.add(new QuotaHealth.Pool(remainingFraction));
        }
        return pools;
    }

    /**
     * {@code TokenRefresh.refresh} -- the network OAuth refresh call, bridged async via {@link
     * JsHttpClientBridge} (same {@code @Async}/{@code AsyncCallback} mechanism as core-proxy's
     * {@code CoreProxyJs#routeJsonAsync}) so a TS caller can interleave this with its own
     * proxy-aware fetch plumbing, per this file's account-exports javadoc above. Deliberately does
     * NOT persist the result to any store -- the caller decides when/whether to (e.g. via a future
     * store-write export), matching the JS driver's "refresh, then the caller writes it back"
     * split.
     *
     * <p>{@code oauthConfigJson} supplies {@code {tokenUrl, clientId, clientSecret?,
     * extraParams?}}. Resolves to {@code {access, expires, refresh}} on success, or to
     * {@code {failed:{message, revoked, status?, code?, description?}}} for an outcome the token
     * endpoint reported. Only a failure of the BRIDGE itself (the JS transport rejecting, an
     * unreadable config) rejects the promise.
     *
     * @implNote a reported failure resolves as data rather than rejecting because a JS rejection
     * can carry only a string: {@code revoked} decides whether the caller re-auths or retries, so
     * it has to survive the crossing as a field instead of being parsed back out of a message.
     */
    @JSExport
    public static JSPromise<JSString> refreshToken(String refreshToken, String oauthConfigJson,
                                                     JsHttpClientBridge.JsHttpSend httpSend) {
        return new JSPromise<>((resolve, reject) -> new Thread(() -> {
            try {
                JsonCodec json = new SimpleJsonCodec();
                OAuthConfig cfg = oauthConfigFromJson(json, oauthConfigJson);
                HttpClient httpClient = new JsHttpClientBridge(httpSend, json);
                long now = System.currentTimeMillis();

                Map<String, Object> out = new LinkedHashMap<>();
                try {
                    Refreshed refreshed = TokenRefresh.refresh(refreshToken, cfg, httpClient, json, now);
                    if (refreshed == null) {
                        out.put("failed", failure("no refresh token to refresh", true, null, null, null));
                    } else {
                        out.put("access", refreshed.access);
                        out.put("expires", refreshed.expires);
                        out.put("refresh", refreshed.refresh);
                    }
                } catch (TokenRefreshError e) {
                    out.put("failed", failure(e.getMessage(), e.revoked, e.status, e.code, e.description));
                }
                resolve.accept(JSString.valueOf(json.stringify(out)));
            } catch (Throwable e) {
                reject.accept(JSString.valueOf("refreshToken failed: " + e));
            }
        }).start());
    }

    /**
     * {@code AccountStore.loadRaw} -- the provider's pool as stored, with {@code accounts},
     * {@code activeIndex} and {@code activeIndexByLane} always present.
     */
    @JSExport
    public static String poolLoad(String providerId, JsStoreBridge.JsStore jsStore) {
        return accountStoreFor(jsStore).loadRaw(providerId);
    }

    /** {@code AccountStore.saveRaw} -- replaces this provider's pool, leaving every other one be. */
    @JSExport
    public static void poolSave(String providerId, String poolJson, JsStoreBridge.JsStore jsStore) {
        accountStoreFor(jsStore).saveRaw(providerId, poolJson);
    }

    /**
     * {@code AccountStore.upsertRaw} -- upsert by {@code id}, else by {@code refresh}, merging the
     * incoming fields over the stored record. Returns {@code "added"}, {@code "updated"} or
     * {@code "unchanged"}; a caller reports an activity event for the first two only.
     */
    @JSExport
    public static String accountUpsert(String providerId, String accountJson, JsStoreBridge.JsStore jsStore) {
        JsonCodec json = new SimpleJsonCodec();
        Map<String, Object> account = JsonUtil.asMap(json.parse(accountJson == null ? "{}" : accountJson));
        AccountStore.Upsert outcome = accountStoreFor(jsStore)
                .upsertRaw(providerId, account != null ? account : new LinkedHashMap<String, Object>());
        return outcome.name().toLowerCase();
    }

    /** {@code AccountStore.removeRaw} -- true when an account with this id was there to remove. */
    @JSExport
    public static boolean accountRemove(String providerId, String id, JsStoreBridge.JsStore jsStore) {
        return accountStoreFor(jsStore).removeRaw(providerId, id);
    }

    private static AccountStore accountStoreFor(JsStoreBridge.JsStore jsStore) {
        JsonCodec json = new SimpleJsonCodec();
        return new AccountStore(new JsStoreBridge(jsStore), json);
    }

    private static Map<String, Object> failure(String message, boolean revoked, Integer status,
                                               String code, String description) {
        Map<String, Object> failed = new LinkedHashMap<>();
        failed.put("message", message);
        failed.put("revoked", revoked);
        if (status != null) failed.put("status", status);
        if (code != null) failed.put("code", code);
        if (description != null) failed.put("description", description);
        return failed;
    }

    private static Account accountFromJson(JsonCodec json, String accountJson) {
        Account a = new Account();
        Object parsed = accountJson != null ? json.parse(accountJson) : null;
        if (parsed instanceof Map) {
            Map<?, ?> m = (Map<?, ?>) parsed;
            Object access = m.get("access");
            a.access = access instanceof String ? (String) access : null;
            Object expires = m.get("expires");
            a.expires = expires instanceof Number ? ((Number) expires).longValue() : null;
        }
        return a;
    }

    /**
     * The full account shape (same field set {@code AccountStore.accountToMap} serializes to
     * disk, absent-field-omitted the same way) for {@link #acquireAccount}'s {@code available}
     * callback: a provider's {@code isAvailable} predicate (e.g. antigravity's {@code
     * account.meta.verificationRequired} check) must see the SAME account shape it would over
     * the pure-TS path, not a trimmed-down projection. Kept here rather than made public on
     * {@code AccountStore} so {@code :accounts} stays untouched by this JS-boundary concern.
     */
    private static Map<String, Object> accountToJson(Account a) {
        Map<String, Object> m = new LinkedHashMap<>();
        if (a.id != null) m.put("id", a.id);
        if (a.email != null) m.put("email", a.email);
        if (a.refresh != null) m.put("refresh", a.refresh);
        if (a.access != null) m.put("access", a.access);
        if (a.expires != null) m.put("expires", a.expires);
        if (a.addedAt != null) m.put("addedAt", a.addedAt);
        if (a.lastUsed != null) m.put("lastUsed", a.lastUsed);
        if (a.enabled != null) m.put("enabled", a.enabled);
        if (a.rateLimitResetTimes != null) m.put("rateLimitResetTimes", a.rateLimitResetTimes);
        if (a.coolingDownUntil != null) m.put("coolingDownUntil", a.coolingDownUntil);
        if (a.cooldownReason != null) m.put("cooldownReason", a.cooldownReason);
        if (a.disabledReason != null) m.put("disabledReason", a.disabledReason);
        if (a.meta != null) m.put("meta", a.meta);
        return m;
    }

    private static OAuthConfig oauthConfigFromJson(JsonCodec json, String oauthConfigJson) {
        OAuthConfig cfg = new OAuthConfig();
        Object parsed = oauthConfigJson != null ? json.parse(oauthConfigJson) : null;
        if (parsed instanceof Map) {
            Map<?, ?> m = (Map<?, ?>) parsed;
            Object tokenUrl = m.get("tokenUrl");
            cfg.tokenUrl = tokenUrl instanceof String ? (String) tokenUrl : null;
            Object clientId = m.get("clientId");
            cfg.clientId = clientId instanceof String ? (String) clientId : null;
            Object clientSecret = m.get("clientSecret");
            cfg.clientSecret = clientSecret instanceof String ? (String) clientSecret : null;
            Object extraParams = m.get("extraParams");
            if (extraParams instanceof Map) {
                Map<String, String> ep = new LinkedHashMap<>();
                for (Map.Entry<?, ?> e : ((Map<?, ?>) extraParams).entrySet()) {
                    if (e.getKey() != null && e.getValue() != null) {
                        ep.put(String.valueOf(e.getKey()), String.valueOf(e.getValue()));
                    }
                }
                cfg.extraParams = ep;
            }
        }
        return cfg;
    }

    private static int toInt(Object o) {
        return o instanceof Number ? ((Number) o).intValue() : 0;
    }

    private static long toLong(Object o) {
        return o instanceof Number ? ((Number) o).longValue() : 0L;
    }
}
