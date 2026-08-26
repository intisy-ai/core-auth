package io.github.intisy.ai.js.surface;

import io.github.intisy.ai.tsemit.TsModule;
import io.github.intisy.ai.tsemit.TsNullable;
import java.util.concurrent.CompletionStage;
import java.util.function.BiFunction;
import java.util.function.Function;

/**
 * The JavaScript module surface {@link io.github.intisy.ai.js.CoreAuthJs} exports, typed for a
 * TypeScript consumer.
 *
 * @implNote Never implemented, only emitted: {@link TsModule} renders its members as free functions,
 * which is the shape a TeaVM ES2015 module actually exports. Compound values cross as JSON in both
 * directions, because the engines behind them are transpiled Java with no shared object model, and
 * the index-returning proxy members hand back positions into the caller's own array so proxy
 * identity survives the crossing.
 */
@TsModule
public interface CoreAuthSurface {

    /**
     * Selects and claims an account for a lane.
     *
     * @param strategy one of sticky, round-robin or hybrid; anything else falls back to hybrid
     * @param available the provider's own availability predicate over an account's JSON and the
     * lane, or null when it has none. It is ANDed onto the built-in enabled, cooldown and
     * rate-limit check, never replacing it.
     * @return {@code {accountId, access?}} for the claimed account, or {@code {none:true}} when
     * nobody in the pool is available
     */
    String acquireAccount(String providerId,
                          String lane,
                          String strategy,
                          @TsNullable BiFunction<String, String, Boolean> available,
                          CoreAuthJsStore jsStore);

    /** Persists the lane's rate-limit reset instant against the account. */
    void reportRateLimit(String providerId, String id, String lane, double resetMs, CoreAuthJsStore jsStore);

    /**
     * Persists a jittered-backoff cooldown against the account.
     *
     * @implNote Skipped when the lane already carries an active provider-supplied rate-limit reset,
     * which owns usable-again for that lane instead. An empty lane means no same-lane reset is
     * known, so it cools down normally, which is the safe default.
     * @param baseMs the caller's own backoff floor, or the engine's default when it has none
     * @param maxMs the caller's own backoff ceiling, likewise
     */
    void reportError(String providerId,
                     String id,
                     String lane,
                     int attempt,
                     String reason,
                     double baseMs,
                     double maxMs,
                     CoreAuthJsStore jsStore);

    /** Clears the account's cooldown and bumps its last-used instant. */
    void reportSuccess(String providerId, String id, CoreAuthJsStore jsStore);

    /**
     * The soonest instant any account in the pool becomes available for the lane.
     *
     * @return a bare JSON number, or the literal JSON null when none ever will
     */
    String nextAvailableAt(String providerId, String lane, CoreAuthJsStore jsStore);

    /**
     * The provider's pool as stored.
     *
     * @return {@code {accounts, activeIndex, activeIndexByLane}}, all three always present
     */
    String poolLoad(String providerId, CoreAuthJsStore jsStore);

    /** Replaces this provider's pool, leaving every other one be. */
    void poolSave(String providerId, String poolJson, CoreAuthJsStore jsStore);

    /**
     * Upserts an account by id, else by refresh token, merging the incoming fields over the stored
     * record.
     *
     * @return added, updated or unchanged; a caller reports an activity event for the first two only
     */
    String accountUpsert(String providerId, String accountJson, CoreAuthJsStore jsStore);

    /** Whether an account with this id was there to remove. */
    boolean accountRemove(String providerId, String id, CoreAuthJsStore jsStore);

    /** Whether the account's access token has expired, reading only its access and expiry fields. */
    boolean accessTokenExpired(String accountJson, double now);

    /**
     * The expiry instant for a token, shared by both OAuth grants.
     *
     * @param expiresInSeconds NaN when the token endpoint reported none, so the default applies
     */
    double calculateTokenExpiry(double requestTimeMs, double expiresInSeconds);

    /**
     * The exact backoff delay, with jitter off.
     *
     * @param argsJson {@code {attempt, baseMs, maxMs, jitter}}
     * @return the bare JSON number
     */
    String calculateBackoffMsJson(String argsJson);

    /**
     * Whether a provider's mapped quota pools still have capacity.
     *
     * @implNote One decision answers both whether the account has quota left and whether a 429 is an
     * IP or proxy limit. A missing or non-numeric remaining fraction counts as zero.
     * @param poolsJson the pools as {@code [{remainingFraction}]}
     */
    boolean quotaHasCapacity(String poolsJson);

    /**
     * Performs the network OAuth refresh call, persisting nothing.
     *
     * @param oauthConfigJson {@code {tokenUrl, clientId, clientSecret?, extraParams?}}
     * @param httpSend the transport, taking a request's JSON and resolving the response's
     * @return {@code {access, expires, refresh}} on success, or
     * {@code {failed:{message, revoked, status?, code?, description?}}} for an outcome the token
     * endpoint reported. Only a failure of the transport itself rejects.
     */
    CompletionStage<String> refreshToken(String refreshToken,
                                         String oauthConfigJson,
                                         Function<String, CompletionStage<String>> httpSend);

    /** The caps the proxy scoring engine enforces, as {@code {maxAccountsPerProxy, ipLimitCooldownMs}}. */
    String proxyLimits();

    /** The bare key for a {@code {type, id}} scope, not a JSON string. */
    String proxyScopeKey(String scopeJson);

    /** The scope a key names, as JSON; the global scope carries no id. */
    String proxyParseScopeKey(String key);

    /** The bare mode in force for a scope key, falling back to the store default. */
    String proxyEffectiveMode(String storeJson, String key);

    /** The scope keys that apply, most specific first, with the disabled ones dropped. */
    String proxyResolveChain(String storeJson, String accountId, String providerId);

    /**
     * The proxies a scope may use.
     *
     * @return indices into the store's proxy array, so the caller maps them back onto its own
     * objects and proxy identity survives the crossing
     */
    String proxyProxiesInScope(String storeJson, String key);

    /** The usable proxies for a scope, as indices into the store's proxy array, best first. */
    String proxyCandidatesForScope(String storeJson, String key, double now);

    /** Whether a proxy the account already holds may be re-used. */
    boolean proxyStickyUsable(String storeJson, String key, String url, double now);

    /** A proxy's score, where lower is better. */
    double proxyScoreOf(String storeJson, String proxyJson);

    /** A proxy's quality as good, fair or poor, as a bare string. */
    String proxyQualityLabel(String proxyJson);

    /** Whether the proxy's exit IP is still inside its cooldown. */
    boolean proxyIsIpLimited(String proxyJson, double now);

    /** How many accounts currently hold this proxy url. */
    double proxyCountAssignments(String storeJson, String url);

    /** The bare matching key a caller stores each fetched leaderboard score under. */
    String leaderboardNormalize(String name);

    /** The compact provenance tag for a leaderboard row hint, as a bare string. */
    String leaderboardSourceShort(String source);

    /**
     * Orders model ids by leaderboard score, best first.
     *
     * @param argsJson {@code {ids, names, scores}}, where names holds each id's display name at the
     * same position
     * @return the ids as a JSON array
     */
    String leaderboardOrder(String argsJson);

    /**
     * The leaderboard score for each id that matched a live score.
     *
     * @param argsJson the same shape leaderboardOrder takes
     */
    String leaderboardScores(String argsJson);

    /**
     * Reads a pasted OAuth callback: a full redirect url, a bare code and state pair, or a code
     * alone.
     *
     * @return {@code {code, state}} as JSON, or the literal JSON null when nothing was pasted
     */
    String parsePastedCallback(String input);

    /** Packs an already-serialised OAuth state payload as unpadded url-safe base64. */
    String encodeState(String payloadJson);

    /**
     * Unpacks an OAuth state payload.
     *
     * @implNote The refusal crosses as data rather than as a throw, so the caller raises an error its
     * own surrounding JavaScript recognises.
     * @return {@code {payload}} carrying the decoded JSON text, or {@code {error}} when the state
     * carries no PKCE verifier
     */
    String decodeState(String state);

    /**
     * The response to send for a terminal provider failure, as {@code {status, body, headers}}.
     *
     * @implNote The caller constructs the Response itself, which has no Java equivalent.
     */
    String chatError(String message, String optsJson);
}
