package io.github.intisy.ai.js;

import io.github.intisy.ai.shared.chat.ChatError;
import io.github.intisy.ai.shared.manager.AccountManager;
import io.github.intisy.ai.shared.manager.Acquired;
import io.github.intisy.ai.shared.manager.ManagerOptions;
import io.github.intisy.ai.shared.model.Account;
import io.github.intisy.ai.shared.oauth.OAuthConfig;
import io.github.intisy.ai.shared.oauth.OAuthWire;
import io.github.intisy.ai.shared.oauth.Refreshed;
import io.github.intisy.ai.shared.oauth.TokenRefresh;
import io.github.intisy.ai.shared.oauth.TokenRefreshError;
import io.github.intisy.ai.shared.proxy.ProxyScopes;
import io.github.intisy.ai.shared.proxy.ProxyScoring;
import io.github.intisy.ai.shared.rank.Leaderboard;
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
 * TeaVM JS export surface over core-auth's account/oauth engine, ACCOUNT-ONLY: it exports the
 * account/oauth surface, as distinct from core-proxy's routing-only {@code CoreProxyJs}.
 * {@code SimpleJsonCodec}/{@code JsStoreBridge}/{@code JsHttpClientBridge} are NOT duplicated
 * here; this class lives in the same package ({@code io.github.intisy.ai.js}) as core-proxy's
 * {@code :teavm} module (a Gradle project dependency, see
 * {@code core-auth/auth-teavm/build.gradle}), so it references those classes unqualified.
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
     *
     * @param providerId the provider whose pool to select from
     * @param lane which upstream lane the request is for
     * @param strategy the selection strategy name, see {@link #parseStrategy}
     * @param available the caller's isAvailable predicate, or null for the built-in check only
     * @param jsStore the live account store to select against and claim into
     * @return {@code {accountId, access?}} JSON, or {@code {none:true}} when the pool has none available
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
     *
     * @param providerId the provider whose account is being reported on
     * @param id the account id
     * @param lane which upstream lane hit the rate limit
     * @param resetMs the epoch-ms this lane becomes usable again
     * @param jsStore the live account store to persist the reset into
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
     *
     * @param providerId the provider whose account is being reported on
     * @param id the account id
     * @param lane the failing request's lane, or {@code ""} when unknown
     * @param attempt the retry attempt number this cooldown is for
     * @param reason a short machine string recorded as the cooldown reason
     * @param baseMs the caller's own backoff base, in milliseconds
     * @param maxMs the caller's own backoff cap, in milliseconds
     * @param jsStore the live account store to persist the cooldown into
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

    /**
     * {@code AccountManager.reportSuccess} -- clears cooldown, bumps {@code lastUsed}.
     *
     * @param providerId the provider whose account succeeded
     * @param id the account id
     * @param jsStore the live account store to persist the update into
     */
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
     *
     * @param providerId the provider whose pool to check
     * @param lane which upstream lane to check
     * @param jsStore the live account store to read
     * @return the bare JSON epoch-ms number, or the literal JSON {@code "null"}
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
     *
     * @param accountJson the account, as {@code {access, expires}} JSON
     * @param now the current epoch-ms
     * @return true when the stored access token is expired as of {@code now}
     */
    @JSExport
    public static boolean accessTokenExpired(String accountJson, double now) {
        JsonCodec json = new SimpleJsonCodec();
        return TokenRefresh.accessTokenExpired(accountFromJson(json, accountJson), (long) now);
    }

    /**
     * {@code OAuthWire.calculateTokenExpiry} -- the shared expiry maths behind both OAuth grants.
     *
     * <p>A non-finite {@code expiresInSeconds} means the token endpoint reported none, so the
     * default lives on the Java side rather than being restated by each caller. Both parameters are
     * {@code double} because a raw JS number handed to a declared Java {@code long} is not
     * remarshalled at this boundary (see {@link #reportRateLimit}).
     *
     * @param requestTimeMs the epoch-ms the token request was sent
     * @param expiresInSeconds the token endpoint's reported lifetime, or non-finite when it reported none
     * @return the computed expiry as epoch-ms
     */
    @JSExport
    public static double calculateTokenExpiry(double requestTimeMs, double expiresInSeconds) {
        Double seconds = Double.isNaN(expiresInSeconds) || Double.isInfinite(expiresInSeconds)
                ? null
                : expiresInSeconds;
        return OAuthWire.calculateTokenExpiry((long) requestTimeMs, seconds);
    }

    /**
     * {@code RateLimitMath.calculateBackoffMs} over the {@code Random}-consulting overload: exact
     * when {@code jitter} is {@code false} (the deterministic path, safe for a byte-for-byte
     * output check), randomized via {@code Math::random} when {@code jitter} is {@code true} (not
     * deterministic, so excluded from one). {@code argsJson} is
     * {@code {"attempt":int,"baseMs":long,"maxMs":long,"jitter":boolean}}; returns the bare JSON
     * number result (a {@code Long}, so a whole value never gets a spurious {@code .0}).
     *
     * @param argsJson {@code {"attempt":int,"baseMs":long,"maxMs":long,"jitter":boolean}}
     * @return the bare JSON backoff-ms number
     */
    @JSExport
    public static String calculateBackoffMsJson(String argsJson) {
        JsonCodec json = new SimpleJsonCodec();
        Map<?, ?> args = (Map<?, ?>) json.parse(argsJson);
        int attempt = toInt(args.get("attempt"));
        long baseMs = toLong(args.get("baseMs"));
        long maxMs = toLong(args.get("maxMs"));
        boolean jitter = Boolean.TRUE.equals(args.get("jitter"));
        Random random = Math::random;
        long result = RateLimitMath.calculateBackoffMs(attempt, baseMs, maxMs, jitter, random);
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
     *
     * @param poolsJson a JSON array of {@code {"remainingFraction":number}} objects
     * @return true when any pool still has capacity
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
     *
     * @param refreshToken the stored refresh token to exchange
     * @param oauthConfigJson {@code {tokenUrl, clientId, clientSecret?, extraParams?}}
     * @param httpSend the JS-side transport this refresh call is bridged through
     * @return a promise resolving to {@code {access, expires, refresh}} or {@code {failed:{...}}} JSON
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
     *
     * @param providerId the provider whose pool to load
     * @param jsStore the live account store to read
     * @return the provider's pool, as stored JSON
     */
    @JSExport
    public static String poolLoad(String providerId, JsStoreBridge.JsStore jsStore) {
        return accountStoreFor(jsStore).loadRaw(providerId);
    }

    /**
     * {@code AccountStore.saveRaw} -- replaces this provider's pool, leaving every other one be.
     *
     * @param providerId the provider whose pool to replace
     * @param poolJson the full pool to store, replacing whatever was there
     * @param jsStore the live account store to write into
     */
    @JSExport
    public static void poolSave(String providerId, String poolJson, JsStoreBridge.JsStore jsStore) {
        accountStoreFor(jsStore).saveRaw(providerId, poolJson);
    }

    /**
     * {@code AccountStore.upsertRaw} -- upsert by {@code id}, else by {@code refresh}, merging the
     * incoming fields over the stored record. Returns {@code "added"}, {@code "updated"} or
     * {@code "unchanged"}; a caller reports an activity event for the first two only.
     *
     * @param providerId the provider whose pool to upsert into
     * @param accountJson the incoming account fields to merge over the stored record
     * @param jsStore the live account store to write into
     * @return {@code "added"}, {@code "updated"} or {@code "unchanged"}
     */
    @JSExport
    public static String accountUpsert(String providerId, String accountJson, JsStoreBridge.JsStore jsStore) {
        JsonCodec json = new SimpleJsonCodec();
        Map<String, Object> account = JsonUtil.asMap(json.parse(accountJson == null ? "{}" : accountJson));
        AccountStore.Upsert outcome = accountStoreFor(jsStore)
                .upsertRaw(providerId, account != null ? account : new LinkedHashMap<String, Object>());
        return outcome.name().toLowerCase();
    }

    /**
     * {@code AccountStore.removeRaw} -- true when an account with this id was there to remove.
     *
     * @param providerId the provider whose pool to remove from
     * @param id the account id to remove
     * @param jsStore the live account store to write into
     * @return true when an account with this id was removed
     */
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

    // ---- terminal chat errors (ChatError) -----------------------------------------------------

    /**
     * {@code ChatError.build} -- the response to send for a TERMINAL provider failure, as
     * {@code {status, body, headers}} JSON. The caller constructs the actual Response, which is a
     * web-platform type with no Java equivalent.
     *
     * @param message the terminal failure message
     * @param optsJson the response-shaping options {@link ChatError#build} accepts
     * @return {@code {status, body, headers}} JSON
     */
    @JSExport
    public static String chatError(String message, String optsJson) {
        JsonCodec json = new SimpleJsonCodec();
        return json.stringify(ChatError.build(message, parseObject(optsJson), json));
    }

    // ---- OAuth callback + state wire (OAuthWire) ----------------------------------------------

    /**
     * {@code OAuthWire.parsePastedCallback} -- returns {@code {code, state}} as JSON, or the literal
     * JSON {@code "null"} when nothing was pasted.
     *
     * @param input the text the user pasted back from the OAuth redirect
     * @return {@code {code, state}} JSON, or the literal JSON {@code "null"}
     */
    @JSExport
    public static String parsePastedCallback(String input) {
        JsonCodec json = new SimpleJsonCodec();
        return json.stringify(OAuthWire.parsePastedCallback(input));
    }

    /**
     * {@code OAuthWire.encodeState} -- packs an already-serialised state payload as unpadded
     * URL-safe base64. The caller serialises, so the encoded bytes are exactly its own JSON.
     *
     * @param payloadJson the already-serialised state payload
     * @return the payload as unpadded URL-safe base64
     */
    @JSExport
    public static String encodeState(String payloadJson) {
        return OAuthWire.encodeState(payloadJson);
    }

    /**
     * {@code OAuthWire.decodeState} -- resolves {@code {payload}} carrying the decoded JSON text, or
     * {@code {error}} when the state carries no PKCE verifier.
     *
     * @implNote the refusal crosses as DATA rather than as a thrown Java exception, because only the
     * caller can raise an error the surrounding JS will recognise, and the message decides whether a
     * driver re-runs the login or reports a tampered callback.
     *
     * @param state the base64 state string round-tripped from the OAuth redirect
     * @return {@code {payload}} JSON, or {@code {error}} when the state carries no PKCE verifier
     */
    @JSExport
    public static String decodeState(String state) {
        JsonCodec json = new SimpleJsonCodec();
        Map<String, Object> out = new LinkedHashMap<>();
        try {
            out.put("payload", OAuthWire.decodeState(state, json));
        } catch (RuntimeException e) {
            out.put("error", e.getMessage() != null ? e.getMessage() : "state could not be decoded");
        }
        return json.stringify(out);
    }

    // ---- leaderboard ranking (Leaderboard) ----------------------------------------------------

    /**
     * {@code Leaderboard.normalize} -- the matching key a caller stores each fetched score under.
     * Returns the bare key, not a JSON string.
     *
     * @param name the raw display name to normalize
     * @return the bare matching key
     */
    @JSExport
    public static String leaderboardNormalize(String name) {
        return Leaderboard.normalize(name);
    }

    /**
     * {@code Leaderboard.sourceShort} -- the compact provenance tag for a row hint.
     *
     * @param source the raw source string
     * @return the compact provenance tag
     */
    @JSExport
    public static String leaderboardSourceShort(String source) {
        return Leaderboard.sourceShort(source);
    }

    /**
     * {@code Leaderboard.order} -- {@code argsJson} is
     * {@code {"ids":[..],"names":[..],"scores":[{"norm":..,"score":..}]}}, where {@code names}
     * holds each id's display name at the same position. Returns the ids as a JSON array,
     * best-first.
     *
     * @param argsJson {@code {"ids":[..],"names":[..],"scores":[{"norm":..,"score":..}]}}
     * @return the ids as a JSON array, best-first
     */
    @JSExport
    public static String leaderboardOrder(String argsJson) {
        JsonCodec json = new SimpleJsonCodec();
        Map<String, Object> args = parseObject(argsJson);
        return json.stringify(Leaderboard.order(
                stringList(args.get("ids")), stringList(args.get("names")), scoreList(args.get("scores"))));
    }

    /**
     * {@code Leaderboard.scoresFor} -- the same {@code argsJson} as {@link #leaderboardOrder}.
     * Returns a JSON object of id to score, carrying only the ids that matched a live score.
     *
     * @param argsJson {@code {"ids":[..],"names":[..],"scores":[{"norm":..,"score":..}]}}
     * @return a JSON object of id to score, omitting ids with no live score
     */
    @JSExport
    public static String leaderboardScores(String argsJson) {
        JsonCodec json = new SimpleJsonCodec();
        Map<String, Object> args = parseObject(argsJson);
        return json.stringify(Leaderboard.scoresFor(
                stringList(args.get("ids")), stringList(args.get("names")), scoreList(args.get("scores"))));
    }

    private static List<String> stringList(Object raw) {
        List<String> out = new ArrayList<>();
        List<Object> parsed = JsonUtil.asList(raw);
        if (parsed == null) return out;
        for (Object entry : parsed) out.add(JsonUtil.asString(entry));
        return out;
    }

    private static List<Leaderboard.Score> scoreList(Object raw) {
        List<Leaderboard.Score> out = new ArrayList<>();
        List<Object> parsed = JsonUtil.asList(raw);
        if (parsed == null) return out;
        for (Object entry : parsed) {
            Map<String, Object> m = JsonUtil.asMap(entry);
            if (m == null) continue;
            Object score = m.get("score");
            if (!(score instanceof Number)) continue;
            out.add(new Leaderboard.Score(JsonUtil.asString(m.get("norm")), ((Number) score).doubleValue()));
        }
        return out;
    }

    // ---- proxy selection (ProxyScoring/ProxyScopes) -------------------------------------------

    /**
     * The caps the scoring engine enforces, as {@code {maxAccountsPerProxy, ipLimitCooldownMs}}, so
     * a caller states them once from here instead of restating the numbers on its own side.
     *
     * @return {@code {maxAccountsPerProxy, ipLimitCooldownMs}} JSON
     */
    @JSExport
    public static String proxyLimits() {
        JsonCodec json = new SimpleJsonCodec();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("maxAccountsPerProxy", (long) ProxyScoring.MAX_ACCOUNTS_PER_PROXY);
        out.put("ipLimitCooldownMs", ProxyScoring.IP_LIMIT_COOLDOWN_MS);
        return json.stringify(out);
    }

    /**
     * {@code ProxyScopes.scopeKey} -- returns the bare key, not a JSON string.
     *
     * @param scopeJson the scope object to key
     * @return the bare scope key
     */
    @JSExport
    public static String proxyScopeKey(String scopeJson) {
        return ProxyScopes.scopeKey(parseObject(scopeJson));
    }

    /**
     * {@code ProxyScopes.parseScopeKey} -- returns the scope as a JSON object.
     *
     * @param key the scope key to parse
     * @return the scope, as a JSON object
     */
    @JSExport
    public static String proxyParseScopeKey(String key) {
        JsonCodec json = new SimpleJsonCodec();
        return json.stringify(ProxyScopes.parseScopeKey(key));
    }

    /**
     * {@code ProxyScopes.effectiveMode} -- returns the bare mode, not a JSON string.
     *
     * @param storeJson the account/proxy store to read
     * @param key the scope key to resolve the mode for
     * @return the bare effective mode
     */
    @JSExport
    public static String proxyEffectiveMode(String storeJson, String key) {
        return ProxyScopes.effectiveMode(parseObject(storeJson), key);
    }

    /**
     * {@code ProxyScopes.resolveChain} -- returns a JSON array of scope keys.
     *
     * @param storeJson the account/proxy store to read
     * @param accountId the account to resolve the scope chain for
     * @param providerId the provider the account belongs to
     * @return a JSON array of scope keys, most-specific first, disabled scopes dropped
     */
    @JSExport
    public static String proxyResolveChain(String storeJson, String accountId, String providerId) {
        JsonCodec json = new SimpleJsonCodec();
        return json.stringify(ProxyScopes.resolveChain(parseObject(storeJson), accountId, providerId));
    }

    /**
     * {@code ProxyScopes.proxiesInScope} -- a JSON array of INDICES into {@code store.proxies}, so
     * the caller maps them back onto its own proxy objects and identity survives the crossing.
     *
     * @param storeJson the account/proxy store to read
     * @param key the scope key to resolve proxies for
     * @return a JSON array of indices into {@code store.proxies}
     */
    @JSExport
    public static String proxyProxiesInScope(String storeJson, String key) {
        JsonCodec json = new SimpleJsonCodec();
        return json.stringify(ProxyScopes.proxiesInScope(parseObject(storeJson), key));
    }

    /**
     * {@code ProxyScopes.candidatesForScope} -- a JSON array of indices into {@code store.proxies},
     * best-first. {@code now} is a {@code double}, not {@code long}: see {@link #reportRateLimit}.
     *
     * @param storeJson the account/proxy store to read
     * @param key the scope key to resolve candidates for
     * @param now the current epoch-ms, for cooldown filtering
     * @return a JSON array of indices into {@code store.proxies}, best-first
     */
    @JSExport
    public static String proxyCandidatesForScope(String storeJson, String key, double now) {
        JsonCodec json = new SimpleJsonCodec();
        return json.stringify(ProxyScopes.candidatesForScope(parseObject(storeJson), key, (long) now));
    }

    /**
     * {@code ProxyScopes.stickyUsable} -- whether a proxy the account already holds may be re-used.
     *
     * @param storeJson the account/proxy store to read
     * @param key the scope key the account is sticky within
     * @param url the proxy url the account already holds
     * @param now the current epoch-ms, for cooldown filtering
     * @return true when the held proxy may still be reused
     */
    @JSExport
    public static boolean proxyStickyUsable(String storeJson, String key, String url, double now) {
        return ProxyScopes.stickyUsable(parseObject(storeJson), key, url, (long) now);
    }

    /**
     * {@code ProxyScoring.scoreOf} -- lower is better.
     *
     * @param storeJson the account/proxy store to read
     * @param proxyJson the proxy to score
     * @return the proxy's score, lower is better
     */
    @JSExport
    public static double proxyScoreOf(String storeJson, String proxyJson) {
        return ProxyScoring.scoreOf(parseObject(storeJson), parseObject(proxyJson));
    }

    /**
     * {@code ProxyScoring.qualityLabel} -- returns the bare label, not a JSON string.
     *
     * @param proxyJson the proxy to label
     * @return the bare quality label
     */
    @JSExport
    public static String proxyQualityLabel(String proxyJson) {
        return ProxyScoring.qualityLabel(parseObject(proxyJson));
    }

    /**
     * {@code ProxyScoring.isIpLimited} -- whether the proxy's exit IP is still cooling down.
     *
     * @param proxyJson the proxy to check
     * @param now the current epoch-ms
     * @return true when the proxy's exit IP is still cooling down
     */
    @JSExport
    public static boolean proxyIsIpLimited(String proxyJson, double now) {
        return ProxyScoring.isIpLimited(parseObject(proxyJson), (long) now);
    }

    /**
     * {@code ProxyScoring.countAssignments} -- how many accounts currently hold {@code url}.
     *
     * @param storeJson the account/proxy store to read
     * @param url the proxy url to count assignments for
     * @return how many accounts currently hold this proxy
     */
    @JSExport
    public static int proxyCountAssignments(String storeJson, String url) {
        return ProxyScoring.countAssignments(parseObject(storeJson), url);
    }

    private static Map<String, Object> parseObject(String objectJson) {
        Map<String, Object> parsed = objectJson == null
                ? null
                : JsonUtil.asMap(new SimpleJsonCodec().parse(objectJson));
        return parsed == null ? new LinkedHashMap<String, Object>() : parsed;
    }

    private static int toInt(Object o) {
        return o instanceof Number ? ((Number) o).intValue() : 0;
    }

    private static long toLong(Object o) {
        return o instanceof Number ? ((Number) o).longValue() : 0L;
    }
}
