// Generated from Java sources. Do not edit.

/**
 * A host-provided key-value store the account engines read and write, as a TypeScript consumer sees
 * it.
 *
 * @remarks
 * Never implemented, only emitted: the Java bridge it describes speaks JSO types that mean
 * nothing to a TypeScript caller. Every member is synchronous, because the engines call them from
 * transpiled Java that has no way to await.
 */
export interface CoreAuthJsStore {
  /**
   * Removes the key.
   *
   * @param key - the key to remove
   */
  delete(key: string): void;
  /**
   * Whether the key is present.
   *
   * @param key - the key to check
   * @returns true when the key is present
   */
  exists(key: string): boolean;
  /**
   * The stored value, or null when the key is absent or unreadable.
   *
   * @param key - the key to read
   * @returns the stored value, or null when the key is absent or unreadable
   */
  get(key: string): string | null;
  /**
   * Every key under the prefix.
   *
   * @param prefix - the prefix to list keys under
   * @returns every key under the prefix
   */
  listKeys(prefix: string): string[];
  /**
   * Stores a value.
   *
   * @param key - the key to write
   * @param value - the value to store
   */
  put(key: string, value: string): void;
}

/**
 * Whether the account's access token has expired, reading only its access and expiry fields.
 *
 * @param accountJson - the account, as JSON with `access` and `expires`
 * @param now - the current epoch-ms
 * @returns true when the stored access token is expired as of `now`
 */
export declare function accessTokenExpired(accountJson: string, now: number): boolean;
/**
 * Whether an account with this id was there to remove.
 *
 * @param providerId - the provider whose pool to remove from
 * @param id - the account id to remove
 * @param jsStore - the live account store to write into
 * @returns true when an account with this id was removed
 */
export declare function accountRemove(providerId: string, id: string, jsStore: CoreAuthJsStore): boolean;
/**
 * Upserts an account by id, else by refresh token, merging the incoming fields over the stored
 * record.
 *
 * @param providerId - the provider whose pool to upsert into
 * @param accountJson - the incoming account fields to merge over the stored record
 * @param jsStore - the live account store to write into
 * @returns added, updated or unchanged; a caller reports an activity event for the first two only
 */
export declare function accountUpsert(providerId: string, accountJson: string, jsStore: CoreAuthJsStore): string;
/**
 * Selects and claims an account for a lane.
 *
 * @param providerId - the provider whose pool to select from
 * @param lane - which upstream lane the request is for
 * @param strategy - one of sticky, round-robin or hybrid; anything else falls back to hybrid
 * @param available - the provider's own availability predicate over an account's JSON and the
 * lane, or null when it has none. It is ANDed onto the built-in enabled, cooldown and
 * rate-limit check, never replacing it.
 * @param jsStore - the live account store to select against and claim into
 * @returns the claimed account as JSON with `accountId` and an optional `access`,
 * or JSON with `none` set to `true` when nobody in the pool is available
 */
export declare function acquireAccount(providerId: string, lane: string, strategy: string, available: ((a: string, b: string) => boolean) | null, jsStore: CoreAuthJsStore): string;
/**
 * The backoff delay: exact when `jitter` is `false`, randomized (halved, then
 * scaled back up by a random fraction of that half) when `jitter` is `true`.
 *
 * @param argsJson - JSON with `attempt`, `baseMs`, `maxMs` and `jitter`
 * @returns the bare JSON number
 */
export declare function calculateBackoffMsJson(argsJson: string): string;
/**
 * The expiry instant for a token, shared by both OAuth grants.
 *
 * @param requestTimeMs - the epoch-ms the token request was sent
 * @param expiresInSeconds - NaN when the token endpoint reported none, so the default applies
 * @returns the computed expiry as epoch-ms
 */
export declare function calculateTokenExpiry(requestTimeMs: number, expiresInSeconds: number): number;
/**
 * The response to send for a terminal provider failure, as JSON with `status`,
 * `body` and `headers`.
 *
 * @remarks
 * The caller constructs the Response itself, which has no Java equivalent.
 * @param message - the terminal failure message
 * @param optsJson - the response-shaping options the underlying builder accepts
 * @returns JSON with `status`, `body` and `headers`
 */
export declare function chatError(message: string, optsJson: string): string;
/**
 * Unpacks an OAuth state payload.
 *
 * @remarks
 * The refusal crosses as data rather than as a throw, so the caller raises an error its
 * own surrounding JavaScript recognises.
 * @param state - the base64 state string round-tripped from the OAuth redirect
 * @returns JSON with `payload` carrying the decoded JSON text, or JSON with `error`
 * when the state carries no PKCE verifier
 */
export declare function decodeState(state: string): string;
/**
 * Packs an already-serialised OAuth state payload as unpadded url-safe base64.
 *
 * @param payloadJson - the already-serialised state payload
 * @returns the payload as unpadded URL-safe base64
 */
export declare function encodeState(payloadJson: string): string;
/**
 * The bare matching key a caller stores each fetched leaderboard score under.
 *
 * @param name - the raw display name to normalize
 * @returns the bare matching key
 */
export declare function leaderboardNormalize(name: string): string;
/**
 * Orders model ids by leaderboard score, best first.
 *
 * @param argsJson - JSON with `ids`, `names` and `scores`, where names holds
 * each id's display name at the same position
 * @returns the ids as a JSON array
 */
export declare function leaderboardOrder(argsJson: string): string;
/**
 * The leaderboard score for each id that matched a live score.
 *
 * @param argsJson - the same shape leaderboardOrder takes
 * @returns a JSON object of id to score, omitting ids with no live score
 */
export declare function leaderboardScores(argsJson: string): string;
/**
 * The compact provenance tag for a leaderboard row hint, as a bare string.
 *
 * @param source - the raw source string
 * @returns the compact provenance tag
 */
export declare function leaderboardSourceShort(source: string): string;
/**
 * The soonest instant any account in the pool becomes available for the lane.
 *
 * @param providerId - the provider whose pool to check
 * @param lane - which upstream lane to check
 * @param jsStore - the live account store to read
 * @returns a bare JSON number, or the literal JSON null when none ever will
 */
export declare function nextAvailableAt(providerId: string, lane: string, jsStore: CoreAuthJsStore): string;
/**
 * Reads a pasted OAuth callback: a full redirect url, a bare code and state pair, or a code
 * alone.
 *
 * @param input - the text the user pasted back from the OAuth redirect
 * @returns JSON with `code` and `state`, or the literal JSON null when nothing was
 * pasted
 */
export declare function parsePastedCallback(input: string): string;
/**
 * The provider's pool as stored.
 *
 * @param providerId - the provider whose pool to load
 * @param jsStore - the live account store to read
 * @returns JSON with `accounts`, `activeIndex` and `activeIndexByLane`, all
 * three always present
 */
export declare function poolLoad(providerId: string, jsStore: CoreAuthJsStore): string;
/**
 * Replaces this provider's pool, leaving every other one be.
 *
 * @param providerId - the provider whose pool to replace
 * @param poolJson - the full pool to store, replacing whatever was there
 * @param jsStore - the live account store to write into
 */
export declare function poolSave(providerId: string, poolJson: string, jsStore: CoreAuthJsStore): void;
/**
 * The usable proxies for a scope, as indices into the store's proxy array, best first.
 *
 * @param storeJson - the account/proxy store to read
 * @param key - the scope key to resolve candidates for
 * @param now - the current epoch-ms, for cooldown filtering
 * @returns a JSON array of indices into the store's proxy array, best first
 */
export declare function proxyCandidatesForScope(storeJson: string, key: string, now: number): string;
/**
 * How many accounts currently hold this proxy url.
 *
 * @param storeJson - the account/proxy store to read
 * @param url - the proxy url to count assignments for
 * @returns how many accounts currently hold this proxy
 */
export declare function proxyCountAssignments(storeJson: string, url: string): number;
/**
 * The bare mode in force for a scope key, falling back to the store default.
 *
 * @param storeJson - the account/proxy store to read
 * @param key - the scope key to resolve the mode for
 * @returns the bare effective mode
 */
export declare function proxyEffectiveMode(storeJson: string, key: string): string;
/**
 * Whether the proxy's exit IP is still inside its cooldown.
 *
 * @param proxyJson - the proxy to check
 * @param now - the current epoch-ms
 * @returns true when the proxy's exit IP is still cooling down
 */
export declare function proxyIsIpLimited(proxyJson: string, now: number): boolean;
/**
 * The caps the proxy scoring engine enforces, as JSON with `maxAccountsPerProxy` and
 * `ipLimitCooldownMs`.
 *
 * @returns JSON with `maxAccountsPerProxy` and `ipLimitCooldownMs`
 */
export declare function proxyLimits(): string;
/**
 * The scope a key names, as JSON; the global scope carries no id.
 *
 * @param key - the scope key to parse
 * @returns the scope, as a JSON object
 */
export declare function proxyParseScopeKey(key: string): string;
/**
 * The proxies a scope may use.
 *
 * @param storeJson - the account/proxy store to read
 * @param key - the scope key to resolve proxies for
 * @returns indices into the store's proxy array, so the caller maps them back onto its own
 * objects and proxy identity survives the crossing
 */
export declare function proxyProxiesInScope(storeJson: string, key: string): string;
/**
 * A proxy's quality as good, fair or poor, as a bare string.
 *
 * @param proxyJson - the proxy to label
 * @returns the bare quality label
 */
export declare function proxyQualityLabel(proxyJson: string): string;
/**
 * The scope keys that apply, most specific first, with the disabled ones dropped.
 *
 * @param storeJson - the account/proxy store to read
 * @param accountId - the account to resolve the scope chain for
 * @param providerId - the provider the account belongs to
 * @returns a JSON array of scope keys
 */
export declare function proxyResolveChain(storeJson: string, accountId: string, providerId: string): string;
/**
 * The bare key for a scope carrying `type` and `id`, not a JSON string.
 *
 * @param scopeJson - the scope object to key
 * @returns the bare scope key
 */
export declare function proxyScopeKey(scopeJson: string): string;
/**
 * A proxy's score, where lower is better.
 *
 * @param storeJson - the account/proxy store to read
 * @param proxyJson - the proxy to score
 * @returns the proxy's score, lower is better
 */
export declare function proxyScoreOf(storeJson: string, proxyJson: string): number;
/**
 * Whether a proxy the account already holds may be re-used.
 *
 * @param storeJson - the account/proxy store to read
 * @param key - the scope key the account is sticky within
 * @param url - the proxy url the account already holds
 * @param now - the current epoch-ms, for cooldown filtering
 * @returns true when the held proxy may still be reused
 */
export declare function proxyStickyUsable(storeJson: string, key: string, url: string, now: number): boolean;
/**
 * Whether a provider's mapped quota pools still have capacity.
 *
 * @remarks
 * One decision answers both whether the account has quota left and whether a 429 is an
 * IP or proxy limit. A missing or non-numeric remaining fraction counts as zero.
 * @param poolsJson - the pools as a JSON array of objects, each with a `remainingFraction`
 * @returns true when any pool still has capacity
 */
export declare function quotaHasCapacity(poolsJson: string): boolean;
/**
 * Performs the network OAuth refresh call, persisting nothing.
 *
 * @param refreshToken - the stored refresh token to exchange
 * @param oauthConfigJson - JSON with `tokenUrl`, `clientId`, an optional
 * `clientSecret` and optional `extraParams`
 * @param httpSend - the transport, taking a request's JSON and resolving the response's
 * @returns JSON with `access`, `expires` and `refresh` on success, or JSON
 * with a `failed` object carrying `message`, `revoked` and optional
 * `status`, `code` and `description` for an outcome the token endpoint
 * reported. Only a failure of the transport itself rejects.
 */
export declare function refreshToken(refreshToken: string, oauthConfigJson: string, httpSend: ((value: string) => Promise<string>)): Promise<string>;
/**
 * Persists a jittered-backoff cooldown against the account.
 *
 * @remarks
 * Skipped when the lane already carries an active provider-supplied rate-limit reset,
 * which owns usable-again for that lane instead. An empty lane means no same-lane reset is
 * known, so it cools down normally, which is the safe default.
 * @param providerId - the provider whose account is being reported on
 * @param id - the account id
 * @param lane - the failing request's lane, or empty when unknown
 * @param attempt - the retry attempt number this cooldown is for
 * @param reason - a short machine string recorded as the cooldown reason
 * @param baseMs - the caller's own backoff floor, or the engine's default when it has none
 * @param maxMs - the caller's own backoff ceiling, likewise
 * @param jsStore - the live account store to persist the cooldown into
 */
export declare function reportError(providerId: string, id: string, lane: string, attempt: number, reason: string, baseMs: number, maxMs: number, jsStore: CoreAuthJsStore): void;
/**
 * Persists the lane's rate-limit reset instant against the account.
 *
 * @param providerId - the provider whose account is being reported on
 * @param id - the account id
 * @param lane - which upstream lane hit the rate limit
 * @param resetMs - the epoch-ms this lane becomes usable again
 * @param jsStore - the live account store to persist the reset into
 */
export declare function reportRateLimit(providerId: string, id: string, lane: string, resetMs: number, jsStore: CoreAuthJsStore): void;
/**
 * Clears the account's cooldown and bumps its last-used instant.
 *
 * @param providerId - the provider whose account succeeded
 * @param id - the account id
 * @param jsStore - the live account store to persist the update into
 */
export declare function reportSuccess(providerId: string, id: string, jsStore: CoreAuthJsStore): void;

