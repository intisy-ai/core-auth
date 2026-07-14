package io.github.intisy.ai.js;

import io.github.intisy.ai.shared.manager.AccountManager;
import io.github.intisy.ai.shared.manager.Acquired;
import io.github.intisy.ai.shared.manager.ManagerOptions;
import io.github.intisy.ai.shared.model.Account;
import io.github.intisy.ai.shared.oauth.OAuthConfig;
import io.github.intisy.ai.shared.oauth.Refreshed;
import io.github.intisy.ai.shared.oauth.TokenRefresh;
import io.github.intisy.ai.shared.oauth.TokenRefreshError;
import io.github.intisy.ai.shared.select.RateLimitMath;
import io.github.intisy.ai.shared.select.Strategy;
import io.github.intisy.ai.shared.spi.Clock;
import io.github.intisy.ai.shared.spi.HttpClient;
import io.github.intisy.ai.shared.spi.JsonCodec;
import io.github.intisy.ai.shared.spi.Random;
import io.github.intisy.ai.shared.spi.Store;
import io.github.intisy.ai.shared.store.AccountStore;

import org.teavm.jso.JSExport;
import org.teavm.jso.core.JSPromise;
import org.teavm.jso.core.JSString;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * TeaVM JS export surface over core-auth's account/oauth engine — relocated from ai-java's
 * {@code AiJavaJs} (Phase 4 Task 2), ACCOUNT-ONLY: this is exactly the set of exports Phase 4
 * Task 1 EXCLUDED when trimming {@code AiJavaJs} down to {@code core-proxy}'s {@code CoreProxyJs}
 * (routing-only). {@code SimpleJsonCodec}/{@code JsStoreBridge}/{@code JsHttpClientBridge} are
 * NOT duplicated here — this class lives in the same package ({@code io.github.intisy.ai.js}) as
 * core-proxy's {@code :teavm} module (a Gradle project dependency, see
 * {@code core-auth/java/teavm/build.gradle}), so it references those classes unqualified exactly
 * like the original single-module {@code AiJavaJs} did.
 */
public final class CoreAuthJs {
    private CoreAuthJs() {
    }

    /**
     * Builds an {@link AccountManager} over the LIVE store for {@code providerId}, wired with a
     * {@link HttpClient} that always throws: every export below except {@link #refreshToken}
     * never triggers {@code AccountManager}'s internal network refresh path ({@code
     * ensureAccess}/{@code refresh}) -- {@link AccountManager#selectAndClaim} and the reportRateLimit/
     * reportError/reportSuccess/nextAvailableAt methods never call it, so the throwing stub is
     * provably unreachable rather than silently wrong.
     *
     * <p>Strategy is pinned to {@link Strategy#ROUND_ROBIN} (not {@link ManagerOptions}'s own
     * {@code HYBRID} default): these fine-grained exports have no per-call strategy parameter, so
     * a single, predictable, load-spreading default is used.
     */
    private static AccountManager accountManagerFor(String providerId, Store store, JsonCodec json) {
        AccountStore accountStore = new AccountStore(store, json);
        HttpClient unreachable = req -> {
            throw new UnsupportedOperationException(
                    "CoreAuthJs's fine-grained account exports never perform a network token "
                            + "refresh internally; call refreshToken(...) explicitly instead");
        };
        Clock clock = System::currentTimeMillis;
        Random random = Math::random;
        ManagerOptions opts = new ManagerOptions();
        opts.strategy = Strategy.ROUND_ROBIN;
        return new AccountManager(providerId, accountStore, unreachable, clock, random, json, opts);
    }

    /**
     * {@code AccountManager.selectAndClaim} -- selection + the {@code lastUsed} claim ONLY (the
     * store write persists via the live store); NO network refresh (see {@link #refreshToken}).
     * Returns {@code {accountId, access?}} (the claimed account's CURRENT stored access token,
     * possibly stale/expired -- check via {@link #accessTokenExpired}), or {@code {none:true}}
     * when nobody in the pool is available.
     */
    @JSExport
    public static String acquireAccount(String providerId, String lane, JsStoreBridge.JsStore jsStore) {
        JsonCodec json = new SimpleJsonCodec();
        Store store = new JsStoreBridge(jsStore);
        AccountManager manager = accountManagerFor(providerId, store, json);
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
        accountManagerFor(providerId, store, json).reportRateLimit(id, lane, (long) resetMs);
    }

    /** {@code AccountManager.reportError} -- persists a deterministic-backoff {@code coolingDownUntil}/{@code cooldownReason}. */
    @JSExport
    public static void reportError(String providerId, String id, int attempt, String reason, JsStoreBridge.JsStore jsStore) {
        JsonCodec json = new SimpleJsonCodec();
        Store store = new JsStoreBridge(jsStore);
        accountManagerFor(providerId, store, json).reportError(id, attempt, reason);
    }

    /** {@code AccountManager.reportSuccess} -- clears cooldown, bumps {@code lastUsed}. */
    @JSExport
    public static void reportSuccess(String providerId, String id, JsStoreBridge.JsStore jsStore) {
        JsonCodec json = new SimpleJsonCodec();
        Store store = new JsStoreBridge(jsStore);
        accountManagerFor(providerId, store, json).reportSuccess(id);
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
        Long next = accountManagerFor(providerId, store, json).nextAvailableAt(lane);
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
     * {@code TokenRefresh.refresh} -- the network OAuth refresh call, bridged async via {@link
     * JsHttpClientBridge} (same {@code @Async}/{@code AsyncCallback} mechanism as core-proxy's
     * {@code CoreProxyJs#routeJsonAsync}) so a TS caller can interleave this with its own
     * proxy-aware fetch plumbing, per this file's account-exports javadoc above. Deliberately does
     * NOT persist the result to any store -- the caller decides when/whether to (e.g. via a future
     * store-write export), matching the JS driver's "refresh, then the caller writes it back"
     * split.
     *
     * <p>{@code oauthConfigJson} supplies {@code {tokenUrl, clientId, clientSecret?,
     * extraParams?}}. Resolves to {@code {access, expires, refresh}} on success, or {@code
     * {revoked:true}} when the token endpoint reported {@code error=invalid_grant} (the refresh
     * token itself was revoked -- not a transient failure). Any OTHER failure (network error,
     * non-2xx/non-invalid_grant, unparseable body) rejects the promise.
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
                        out.put("revoked", true); // no refresh token was supplied to refresh
                    } else {
                        out.put("access", refreshed.access);
                        out.put("expires", refreshed.expires);
                        out.put("refresh", refreshed.refresh);
                    }
                } catch (TokenRefreshError e) {
                    if (!e.revoked) throw e; // non-revocation failure -> reject below
                    out.put("revoked", true);
                }
                resolve.accept(JSString.valueOf(json.stringify(out)));
            } catch (Throwable e) {
                reject.accept(JSString.valueOf("refreshToken failed: " + e));
            }
        }).start());
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
