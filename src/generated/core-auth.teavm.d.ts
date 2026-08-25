// Hand-authored ambient types for the TeaVM-generated ES module staged into this same directory
// by `npm run build:teavm` (teavm-build.mjs), from auth-teavm's CoreAuthJs @JSExport surface.
// The generated core-auth.teavm.js itself is gitignored (build output); this .d.ts is committed
// source so tsc can type-check consumers of `getCoreAuth()` without needing the build to have run
// first. Export names verified against the actual generated file's `export { ... }` statement.

/** Live JS-backed store: `get`/`put`/`exists`/`delete`/`listKeys`, all synchronous. */
export interface CoreAuthJsStore {
  get(key: string): string | undefined | null;
  put(key: string, value: string): void;
  exists(key: string): boolean;
  delete(key: string): void;
  listKeys(prefix: string): string[];
}

/** JS-provided async HTTP transport backing the Java-side HttpClient bridge. */
export type CoreAuthJsHttpSend = (requestJson: string) => Promise<string>;

/**
 * JS-provided synchronous availability predicate: the JS side of a provider's `isAvailable`
 * option (e.g. antigravity's `(account) => !(account.meta && account.meta.verificationRequired)`).
 * `accountJson` is the full account shape (same field set the account store persists, absent
 * fields omitted); `lane` is `""` when no lane was given. AND-ed onto the built-in
 * enabled/cooldown/rate-limit check on the Java side, never replacing it.
 */
export type CoreAuthJsAvailable = (accountJson: string, lane: string) => boolean;

/**
 * `AccountManager.selectAndClaim` for `providerId`/`lane`. `strategy` is `"sticky"` /
 * `"round-robin"` / `"hybrid"` (unrecognized or `undefined` falls back to `"hybrid"`).
 * `available` is the provider's `isAvailable` predicate; pass `undefined`/`null` when the
 * provider supplied none (built-in availability check only). Returns the JSON
 * `{accountId, access?}` for the claimed account, or `{none:true}` when nobody in the pool is
 * available.
 */
export function acquireAccount(
  providerId: string,
  lane: string,
  strategy: string | undefined,
  available: CoreAuthJsAvailable | undefined | null,
  jsStore: CoreAuthJsStore,
): string;

/** `AccountManager.reportRateLimit` -- persists `account.rateLimitResetTimes[lane] = resetMs`. */
export function reportRateLimit(
  providerId: string,
  id: string,
  lane: string,
  resetMs: number,
  jsStore: CoreAuthJsStore,
): void;

/**
 * `AccountManager.reportError` -- persists a jittered-backoff `coolingDownUntil`/`cooldownReason`,
 * UNLESS `lane` already has an active provider-supplied `rateLimitResetTimes` entry (that reset
 * owns usable-again for this lane instead). `lane` is `""` when the caller doesn't know the
 * failing request's lane (treated as "no same-lane reset known", so this cools down normally --
 * the safe default). `baseMs`/`maxMs` are the caller's own backoff config (falls back to
 * `AccountManager`'s built-in 1s/5min default when the caller has none), so a provider with a
 * custom backoff keeps it.
 */
export function reportError(
  providerId: string,
  id: string,
  lane: string,
  attempt: number,
  reason: string,
  baseMs: number,
  maxMs: number,
  jsStore: CoreAuthJsStore,
): void;

/** `AccountManager.reportSuccess` -- clears cooldown, bumps `lastUsed`. */
export function reportSuccess(providerId: string, id: string, jsStore: CoreAuthJsStore): void;

/**
 * `AccountManager.nextAvailableAt` -- the soonest epoch-ms any account in the pool becomes
 * available for `lane`, as a bare JSON number, or the literal JSON `"null"` when none ever will.
 */
export function nextAvailableAt(providerId: string, lane: string, jsStore: CoreAuthJsStore): string;

/**
 * `AccountStore.loadRaw` -- the provider's pool as stored, as the JSON
 * `{accounts, activeIndex, activeIndexByLane}` with all three always present.
 */
export function poolLoad(providerId: string, jsStore: CoreAuthJsStore): string;

/** `AccountStore.saveRaw` -- replaces this provider's pool, leaving every other one be. */
export function poolSave(providerId: string, poolJson: string, jsStore: CoreAuthJsStore): void;

/**
 * `AccountStore.upsertRaw` -- upsert by `id`, else by `refresh`, merging the incoming fields over
 * the stored record. Returns `"added"`, `"updated"` or `"unchanged"`; a caller reports an activity
 * event for the first two only.
 */
export function accountUpsert(providerId: string, accountJson: string, jsStore: CoreAuthJsStore): string;

/** `AccountStore.removeRaw` -- true when an account with this id was there to remove. */
export function accountRemove(providerId: string, id: string, jsStore: CoreAuthJsStore): boolean;

/**
 * `TokenRefresh.accessTokenExpired` -- pure predicate. `accountJson` supplies `{access, expires}`
 * (only fields this predicate reads).
 */
export function accessTokenExpired(accountJson: string, now: number): boolean;

/**
 * `OAuthWire.calculateTokenExpiry` -- the shared expiry maths behind both OAuth grants. Pass `NaN`
 * for `expiresInSeconds` when the token endpoint reported none; the default lives on the Java side.
 */
export function calculateTokenExpiry(requestTimeMs: number, expiresInSeconds: number): number;

/**
 * `RateLimitMath.calculateBackoffMs` over the `jitter === false` exact-value path. `argsJson` is
 * `{"attempt":number,"baseMs":number,"maxMs":number,"jitter":boolean}`; returns the bare JSON number.
 */
export function calculateBackoffMsJson(argsJson: string): string;

/**
 * `QuotaHealth.hasCapacity` -- the neutral quota-capacity predicate over a provider's mapped
 * `{remainingFraction: number}[]`. `poolsJson` is that list as JSON (a missing/non-numeric
 * `remainingFraction` counts as 0). The same decision answers both "does the account still have
 * quota" and "is a 429 an IP/proxy limit" (ipSuspected).
 */
export function quotaHasCapacity(poolsJson: string): boolean;

/**
 * `TokenRefresh.refresh` -- the network OAuth refresh call. `oauthConfigJson` supplies
 * `{tokenUrl, clientId, clientSecret?, extraParams?}`. Resolves to `{access, expires, refresh}` on
 * success, or to `{failed:{message, revoked, status?, code?, description?}}` for an outcome the
 * token endpoint reported; only a failure of the bridge itself rejects. Does not persist the
 * result to any store.
 */
export function refreshToken(
  refreshToken: string,
  oauthConfigJson: string,
  httpSend: CoreAuthJsHttpSend,
): Promise<string>;

/** The caps the scoring engine enforces, as `{maxAccountsPerProxy, ipLimitCooldownMs}` JSON. */
export function proxyLimits(): string;

/** `ProxyScopes.scopeKey` -- the bare key for a `{type, id}` scope, not a JSON string. */
export function proxyScopeKey(scopeJson: string): string;

/** `ProxyScopes.parseScopeKey` -- the scope as a JSON object; the global scope carries no `id`. */
export function proxyParseScopeKey(key: string): string;

/** `ProxyScopes.effectiveMode` -- the bare mode for a scope key, falling back to the store default. */
export function proxyEffectiveMode(storeJson: string, key: string): string;

/** `ProxyScopes.resolveChain` -- a JSON array of scope keys, most specific first, disabled dropped. */
export function proxyResolveChain(storeJson: string, accountId: string, providerId: string): string;

/**
 * `ProxyScopes.proxiesInScope` -- a JSON array of INDICES into `store.proxies`, so the caller maps
 * them back onto its own proxy objects and identity survives the crossing.
 */
export function proxyProxiesInScope(storeJson: string, key: string): string;

/** `ProxyScopes.candidatesForScope` -- a JSON array of indices into `store.proxies`, best-first. */
export function proxyCandidatesForScope(storeJson: string, key: string, now: number): string;

/** `ProxyScopes.stickyUsable` -- whether a proxy the account already holds may be re-used. */
export function proxyStickyUsable(storeJson: string, key: string, url: string, now: number): boolean;

/** `ProxyScoring.scoreOf` -- lower is better. */
export function proxyScoreOf(storeJson: string, proxyJson: string): number;

/** `ProxyScoring.qualityLabel` -- `"good"`, `"fair"` or `"poor"`, as a bare string. */
export function proxyQualityLabel(proxyJson: string): string;

/** `ProxyScoring.isIpLimited` -- whether the proxy's exit IP is still inside its cooldown. */
export function proxyIsIpLimited(proxyJson: string, now: number): boolean;

/** `ProxyScoring.countAssignments` -- how many accounts currently hold `url`. */
export function proxyCountAssignments(storeJson: string, url: string): number;

/** `Leaderboard.normalize` -- the bare matching key a caller stores each fetched score under. */
export function leaderboardNormalize(name: string): string;

/** `Leaderboard.sourceShort` -- the compact provenance tag for a row hint, as a bare string. */
export function leaderboardSourceShort(source: string): string;

/**
 * `Leaderboard.order` -- `argsJson` is `{"ids":[..],"names":[..],"scores":[{"norm":..,"score":..}]}`,
 * where `names` holds each id's display name at the same position. Returns the ids as a JSON array,
 * best-first.
 */
export function leaderboardOrder(argsJson: string): string;

/**
 * `Leaderboard.scoresFor` -- the same `argsJson` as `leaderboardOrder`. Returns a JSON object of id
 * to score, carrying only the ids that matched a live score.
 */
export function leaderboardScores(argsJson: string): string;
