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
     * @param providerId the provider whose pool to select from
     * @param lane which upstream lane the request is for
     * @param strategy one of sticky, round-robin or hybrid; anything else falls back to hybrid
     * @param available the provider's own availability predicate over an account's JSON and the
     * lane, or null when it has none. It is ANDed onto the built-in enabled, cooldown and
     * rate-limit check, never replacing it.
     * @param jsStore the live account store to select against and claim into
     * @return the claimed account as JSON with {@code accountId} and an optional {@code access},
     * or JSON with {@code none} set to {@code true} when nobody in the pool is available
     */
    String acquireAccount(String providerId,
                          String lane,
                          String strategy,
                          @TsNullable BiFunction<String, String, Boolean> available,
                          CoreAuthJsStore jsStore);

    /**
     * Persists the lane's rate-limit reset instant against the account.
     *
     * @param providerId the provider whose account is being reported on
     * @param id the account id
     * @param lane which upstream lane hit the rate limit
     * @param resetMs the epoch-ms this lane becomes usable again
     * @param jsStore the live account store to persist the reset into
     */
    void reportRateLimit(String providerId, String id, String lane, double resetMs, CoreAuthJsStore jsStore);

    /**
     * Persists a jittered-backoff cooldown against the account.
     *
     * @implNote Skipped when the lane already carries an active provider-supplied rate-limit reset,
     * which owns usable-again for that lane instead. An empty lane means no same-lane reset is
     * known, so it cools down normally, which is the safe default.
     * @param providerId the provider whose account is being reported on
     * @param id the account id
     * @param lane the failing request's lane, or empty when unknown
     * @param attempt the retry attempt number this cooldown is for
     * @param reason a short machine string recorded as the cooldown reason
     * @param baseMs the caller's own backoff floor, or the engine's default when it has none
     * @param maxMs the caller's own backoff ceiling, likewise
     * @param jsStore the live account store to persist the cooldown into
     */
    void reportError(String providerId,
                     String id,
                     String lane,
                     int attempt,
                     String reason,
                     double baseMs,
                     double maxMs,
                     CoreAuthJsStore jsStore);

    /**
     * Clears the account's cooldown and bumps its last-used instant.
     *
     * @param providerId the provider whose account succeeded
     * @param id the account id
     * @param jsStore the live account store to persist the update into
     */
    void reportSuccess(String providerId, String id, CoreAuthJsStore jsStore);

    /**
     * The soonest instant any account in the pool becomes available for the lane.
     *
     * @param providerId the provider whose pool to check
     * @param lane which upstream lane to check
     * @param jsStore the live account store to read
     * @return a bare JSON number, or the literal JSON null when none ever will
     */
    String nextAvailableAt(String providerId, String lane, CoreAuthJsStore jsStore);

    /**
     * The provider's pool as stored.
     *
     * @param providerId the provider whose pool to load
     * @param jsStore the live account store to read
     * @return JSON with {@code accounts}, {@code activeIndex} and {@code activeIndexByLane}, all
     * three always present
     */
    String poolLoad(String providerId, CoreAuthJsStore jsStore);

    /**
     * Replaces this provider's pool, leaving every other one be.
     *
     * @param providerId the provider whose pool to replace
     * @param poolJson the full pool to store, replacing whatever was there
     * @param jsStore the live account store to write into
     */
    void poolSave(String providerId, String poolJson, CoreAuthJsStore jsStore);

    /**
     * Upserts an account by id, else by refresh token, merging the incoming fields over the stored
     * record.
     *
     * @param providerId the provider whose pool to upsert into
     * @param accountJson the incoming account fields to merge over the stored record
     * @param jsStore the live account store to write into
     * @return added, updated or unchanged; a caller reports an activity event for the first two only
     */
    String accountUpsert(String providerId, String accountJson, CoreAuthJsStore jsStore);

    /**
     * Whether an account with this id was there to remove.
     *
     * @param providerId the provider whose pool to remove from
     * @param id the account id to remove
     * @param jsStore the live account store to write into
     * @return true when an account with this id was removed
     */
    boolean accountRemove(String providerId, String id, CoreAuthJsStore jsStore);

    /**
     * Whether the account's access token has expired, reading only its access and expiry fields.
     *
     * @param accountJson the account, as JSON with {@code access} and {@code expires}
     * @param now the current epoch-ms
     * @return true when the stored access token is expired as of {@code now}
     */
    boolean accessTokenExpired(String accountJson, double now);

    /**
     * The expiry instant for a token, shared by both OAuth grants.
     *
     * @param requestTimeMs the epoch-ms the token request was sent
     * @param expiresInSeconds NaN when the token endpoint reported none, so the default applies
     * @return the computed expiry as epoch-ms
     */
    double calculateTokenExpiry(double requestTimeMs, double expiresInSeconds);

    /**
     * The backoff delay: exact when {@code jitter} is {@code false}, randomized (halved, then
     * scaled back up by a random fraction of that half) when {@code jitter} is {@code true}.
     *
     * @param argsJson JSON with {@code attempt}, {@code baseMs}, {@code maxMs} and {@code jitter}
     * @return the bare JSON number
     */
    String calculateBackoffMsJson(String argsJson);

    /**
     * Whether a provider's mapped quota pools still have capacity.
     *
     * @implNote One decision answers both whether the account has quota left and whether a 429 is an
     * IP or proxy limit. A missing or non-numeric remaining fraction counts as zero.
     * @param poolsJson the pools as a JSON array of objects, each with a {@code remainingFraction}
     * @return true when any pool still has capacity
     */
    boolean quotaHasCapacity(String poolsJson);

    /**
     * Performs the network OAuth refresh call, persisting nothing.
     *
     * @param refreshToken the stored refresh token to exchange
     * @param oauthConfigJson JSON with {@code tokenUrl}, {@code clientId}, an optional
     * {@code clientSecret} and optional {@code extraParams}
     * @param httpSend the transport, taking a request's JSON and resolving the response's
     * @return JSON with {@code access}, {@code expires} and {@code refresh} on success, or JSON
     * with a {@code failed} object carrying {@code message}, {@code revoked} and optional
     * {@code status}, {@code code} and {@code description} for an outcome the token endpoint
     * reported. Only a failure of the transport itself rejects.
     */
    CompletionStage<String> refreshToken(String refreshToken,
                                         String oauthConfigJson,
                                         Function<String, CompletionStage<String>> httpSend);

    /**
     * The caps the proxy scoring engine enforces, as JSON with {@code maxAccountsPerProxy} and
     * {@code ipLimitCooldownMs}.
     *
     * @return JSON with {@code maxAccountsPerProxy} and {@code ipLimitCooldownMs}
     */
    String proxyLimits();

    /**
     * The bare key for a scope carrying {@code type} and {@code id}, not a JSON string.
     *
     * @param scopeJson the scope object to key
     * @return the bare scope key
     */
    String proxyScopeKey(String scopeJson);

    /**
     * The scope a key names, as JSON; the global scope carries no id.
     *
     * @param key the scope key to parse
     * @return the scope, as a JSON object
     */
    String proxyParseScopeKey(String key);

    /**
     * The bare mode in force for a scope key, falling back to the store default.
     *
     * @param storeJson the account/proxy store to read
     * @param key the scope key to resolve the mode for
     * @return the bare effective mode
     */
    String proxyEffectiveMode(String storeJson, String key);

    /**
     * The scope keys that apply, most specific first, with the disabled ones dropped.
     *
     * @param storeJson the account/proxy store to read
     * @param accountId the account to resolve the scope chain for
     * @param providerId the provider the account belongs to
     * @return a JSON array of scope keys
     */
    String proxyResolveChain(String storeJson, String accountId, String providerId);

    /**
     * The proxies a scope may use.
     *
     * @param storeJson the account/proxy store to read
     * @param key the scope key to resolve proxies for
     * @return indices into the store's proxy array, so the caller maps them back onto its own
     * objects and proxy identity survives the crossing
     */
    String proxyProxiesInScope(String storeJson, String key);

    /**
     * The usable proxies for a scope, as indices into the store's proxy array, best first.
     *
     * @param storeJson the account/proxy store to read
     * @param key the scope key to resolve candidates for
     * @param now the current epoch-ms, for cooldown filtering
     * @return a JSON array of indices into the store's proxy array, best first
     */
    String proxyCandidatesForScope(String storeJson, String key, double now);

    /**
     * Whether a proxy the account already holds may be re-used.
     *
     * @param storeJson the account/proxy store to read
     * @param key the scope key the account is sticky within
     * @param url the proxy url the account already holds
     * @param now the current epoch-ms, for cooldown filtering
     * @return true when the held proxy may still be reused
     */
    boolean proxyStickyUsable(String storeJson, String key, String url, double now);

    /**
     * A proxy's score, where lower is better.
     *
     * @param storeJson the account/proxy store to read
     * @param proxyJson the proxy to score
     * @return the proxy's score, lower is better
     */
    double proxyScoreOf(String storeJson, String proxyJson);

    /**
     * A proxy's quality as good, fair or poor, as a bare string.
     *
     * @param proxyJson the proxy to label
     * @return the bare quality label
     */
    String proxyQualityLabel(String proxyJson);

    /**
     * Whether the proxy's exit IP is still inside its cooldown.
     *
     * @param proxyJson the proxy to check
     * @param now the current epoch-ms
     * @return true when the proxy's exit IP is still cooling down
     */
    boolean proxyIsIpLimited(String proxyJson, double now);

    /**
     * How many accounts currently hold this proxy url.
     *
     * @param storeJson the account/proxy store to read
     * @param url the proxy url to count assignments for
     * @return how many accounts currently hold this proxy
     */
    double proxyCountAssignments(String storeJson, String url);

    /**
     * The bare matching key a caller stores each fetched leaderboard score under.
     *
     * @param name the raw display name to normalize
     * @return the bare matching key
     */
    String leaderboardNormalize(String name);

    /**
     * The compact provenance tag for a leaderboard row hint, as a bare string.
     *
     * @param source the raw source string
     * @return the compact provenance tag
     */
    String leaderboardSourceShort(String source);

    /**
     * Orders model ids by leaderboard score, best first.
     *
     * @param argsJson JSON with {@code ids}, {@code names} and {@code scores}, where names holds
     * each id's display name at the same position
     * @return the ids as a JSON array
     */
    String leaderboardOrder(String argsJson);

    /**
     * The leaderboard score for each id that matched a live score.
     *
     * @param argsJson the same shape leaderboardOrder takes
     * @return a JSON object of id to score, omitting ids with no live score
     */
    String leaderboardScores(String argsJson);

    /**
     * Reads a pasted OAuth callback: a full redirect url, a bare code and state pair, or a code
     * alone.
     *
     * @param input the text the user pasted back from the OAuth redirect
     * @return JSON with {@code code} and {@code state}, or the literal JSON null when nothing was
     * pasted
     */
    String parsePastedCallback(String input);

    /**
     * Packs an already-serialised OAuth state payload as unpadded url-safe base64.
     *
     * @param payloadJson the already-serialised state payload
     * @return the payload as unpadded URL-safe base64
     */
    String encodeState(String payloadJson);

    /**
     * Unpacks an OAuth state payload.
     *
     * @implNote The refusal crosses as data rather than as a throw, so the caller raises an error its
     * own surrounding JavaScript recognises.
     * @param state the base64 state string round-tripped from the OAuth redirect
     * @return JSON with {@code payload} carrying the decoded JSON text, or JSON with {@code error}
     * when the state carries no PKCE verifier
     */
    String decodeState(String state);

    /**
     * The response to send for a terminal provider failure, as JSON with {@code status},
     * {@code body} and {@code headers}.
     *
     * @implNote The caller constructs the Response itself, which has no Java equivalent.
     * @param message the terminal failure message
     * @param optsJson the response-shaping options the underlying builder accepts
     * @return JSON with {@code status}, {@code body} and {@code headers}
     */
    String chatError(String message, String optsJson);
}
