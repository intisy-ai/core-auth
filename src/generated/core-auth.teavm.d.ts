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
  /** Removes the key. */
  delete(key: string): void;
  /** Whether the key is present. */
  exists(key: string): boolean;
  /** The stored value, or null when the key is absent or unreadable. */
  get(key: string): string | null;
  /** Every key under the prefix. */
  listKeys(prefix: string): string[];
  /** Stores a value. */
  put(key: string, value: string): void;
}

/** Whether the account's access token has expired, reading only its access and expiry fields. */
export declare function accessTokenExpired(accountJson: string, now: number): boolean;
/** Whether an account with this id was there to remove. */
export declare function accountRemove(providerId: string, id: string, jsStore: CoreAuthJsStore): boolean;
/**
 * Upserts an account by id, else by refresh token, merging the incoming fields over the stored
 * record.
 *
 * @returns added, updated or unchanged; a caller reports an activity event for the first two only
 */
export declare function accountUpsert(providerId: string, accountJson: string, jsStore: CoreAuthJsStore): string;
/**
 * Selects and claims an account for a lane.
 *
 * @param strategy - one of sticky, round-robin or hybrid; anything else falls back to hybrid
 * @param available - the provider's own availability predicate over an account's JSON and the
 * lane, or null when it has none. It is ANDed onto the built-in enabled, cooldown and
 * rate-limit check, never replacing it.
 * @returns `{accountId, access?`} for the claimed account, or `{none:true`} when
 * nobody in the pool is available
 */
export declare function acquireAccount(providerId: string, lane: string, strategy: string, available: ((a: string, b: string) => boolean) | null, jsStore: CoreAuthJsStore): string;
/**
 * The exact backoff delay, with jitter off.
 *
 * @param argsJson - `{attempt, baseMs, maxMs, jitter`}
 * @returns the bare JSON number
 */
export declare function calculateBackoffMsJson(argsJson: string): string;
/**
 * The expiry instant for a token, shared by both OAuth grants.
 *
 * @param expiresInSeconds - NaN when the token endpoint reported none, so the default applies
 */
export declare function calculateTokenExpiry(requestTimeMs: number, expiresInSeconds: number): number;
/**
 * The response to send for a terminal provider failure, as `{status, body, headers`}.
 *
 * @remarks
 * The caller constructs the Response itself, which has no Java equivalent.
 */
export declare function chatError(message: string, optsJson: string): string;
/**
 * Unpacks an OAuth state payload.
 *
 * @remarks
 * The refusal crosses as data rather than as a throw, so the caller raises an error its
 * own surrounding JavaScript recognises.
 * @returns `{payload`} carrying the decoded JSON text, or `{error`} when the state
 * carries no PKCE verifier
 */
export declare function decodeState(state: string): string;
/** Packs an already-serialised OAuth state payload as unpadded url-safe base64. */
export declare function encodeState(payloadJson: string): string;
/** The bare matching key a caller stores each fetched leaderboard score under. */
export declare function leaderboardNormalize(name: string): string;
/**
 * Orders model ids by leaderboard score, best first.
 *
 * @param argsJson - `{ids, names, scores`}, where names holds each id's display name at the
 * same position
 * @returns the ids as a JSON array
 */
export declare function leaderboardOrder(argsJson: string): string;
/**
 * The leaderboard score for each id that matched a live score.
 *
 * @param argsJson - the same shape leaderboardOrder takes
 */
export declare function leaderboardScores(argsJson: string): string;
/** The compact provenance tag for a leaderboard row hint, as a bare string. */
export declare function leaderboardSourceShort(source: string): string;
/**
 * The soonest instant any account in the pool becomes available for the lane.
 *
 * @returns a bare JSON number, or the literal JSON null when none ever will
 */
export declare function nextAvailableAt(providerId: string, lane: string, jsStore: CoreAuthJsStore): string;
/**
 * Reads a pasted OAuth callback: a full redirect url, a bare code and state pair, or a code
 * alone.
 *
 * @returns `{code, state`} as JSON, or the literal JSON null when nothing was pasted
 */
export declare function parsePastedCallback(input: string): string;
/**
 * The provider's pool as stored.
 *
 * @returns `{accounts, activeIndex, activeIndexByLane`}, all three always present
 */
export declare function poolLoad(providerId: string, jsStore: CoreAuthJsStore): string;
/** Replaces this provider's pool, leaving every other one be. */
export declare function poolSave(providerId: string, poolJson: string, jsStore: CoreAuthJsStore): void;
/** The usable proxies for a scope, as indices into the store's proxy array, best first. */
export declare function proxyCandidatesForScope(storeJson: string, key: string, now: number): string;
/** How many accounts currently hold this proxy url. */
export declare function proxyCountAssignments(storeJson: string, url: string): number;
/** The bare mode in force for a scope key, falling back to the store default. */
export declare function proxyEffectiveMode(storeJson: string, key: string): string;
/** Whether the proxy's exit IP is still inside its cooldown. */
export declare function proxyIsIpLimited(proxyJson: string, now: number): boolean;
/** The caps the proxy scoring engine enforces, as `{maxAccountsPerProxy, ipLimitCooldownMs`}. */
export declare function proxyLimits(): string;
/** The scope a key names, as JSON; the global scope carries no id. */
export declare function proxyParseScopeKey(key: string): string;
/**
 * The proxies a scope may use.
 *
 * @returns indices into the store's proxy array, so the caller maps them back onto its own
 * objects and proxy identity survives the crossing
 */
export declare function proxyProxiesInScope(storeJson: string, key: string): string;
/** A proxy's quality as good, fair or poor, as a bare string. */
export declare function proxyQualityLabel(proxyJson: string): string;
/** The scope keys that apply, most specific first, with the disabled ones dropped. */
export declare function proxyResolveChain(storeJson: string, accountId: string, providerId: string): string;
/** The bare key for a `{type, id`} scope, not a JSON string. */
export declare function proxyScopeKey(scopeJson: string): string;
/** A proxy's score, where lower is better. */
export declare function proxyScoreOf(storeJson: string, proxyJson: string): number;
/** Whether a proxy the account already holds may be re-used. */
export declare function proxyStickyUsable(storeJson: string, key: string, url: string, now: number): boolean;
/**
 * Whether a provider's mapped quota pools still have capacity.
 *
 * @remarks
 * One decision answers both whether the account has quota left and whether a 429 is an
 * IP or proxy limit. A missing or non-numeric remaining fraction counts as zero.
 * @param poolsJson - the pools as `[{remainingFraction`]}
 */
export declare function quotaHasCapacity(poolsJson: string): boolean;
/**
 * Performs the network OAuth refresh call, persisting nothing.
 *
 * @param oauthConfigJson - `{tokenUrl, clientId, clientSecret?, extraParams?`}
 * @param httpSend - the transport, taking a request's JSON and resolving the response's
 * @returns `{access, expires, refresh`} on success, or
 * `{failed:{message, revoked, status?, code?, description?`}} for an outcome the token
 * endpoint reported. Only a failure of the transport itself rejects.
 */
export declare function refreshToken(refreshToken: string, oauthConfigJson: string, httpSend: ((value: string) => Promise<string>)): Promise<string>;
/**
 * Persists a jittered-backoff cooldown against the account.
 *
 * @remarks
 * Skipped when the lane already carries an active provider-supplied rate-limit reset,
 * which owns usable-again for that lane instead. An empty lane means no same-lane reset is
 * known, so it cools down normally, which is the safe default.
 * @param baseMs - the caller's own backoff floor, or the engine's default when it has none
 * @param maxMs - the caller's own backoff ceiling, likewise
 */
export declare function reportError(providerId: string, id: string, lane: string, attempt: number, reason: string, baseMs: number, maxMs: number, jsStore: CoreAuthJsStore): void;
/** Persists the lane's rate-limit reset instant against the account. */
export declare function reportRateLimit(providerId: string, id: string, lane: string, resetMs: number, jsStore: CoreAuthJsStore): void;
/** Clears the account's cooldown and bumps its last-used instant. */
export declare function reportSuccess(providerId: string, id: string, jsStore: CoreAuthJsStore): void;

