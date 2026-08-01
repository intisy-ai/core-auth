// Hand-authored ambient types for the TeaVM-generated ES module staged into this same directory
// by `npm run build:teavm` (teavm-build.mjs), from java/auth-teavm's CoreAuthJs @JSExport surface.
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
 * `AccountManager.selectAndClaim` for `providerId`/`lane`. Returns the JSON `{accountId, access?}`
 * for the claimed account, or `{none:true}` when nobody in the pool is available.
 */
export function acquireAccount(providerId: string, lane: string, jsStore: CoreAuthJsStore): string;

/** `AccountManager.reportRateLimit` -- persists `account.rateLimitResetTimes[lane] = resetMs`. */
export function reportRateLimit(
  providerId: string,
  id: string,
  lane: string,
  resetMs: number,
  jsStore: CoreAuthJsStore,
): void;

/** `AccountManager.reportError` -- persists a deterministic-backoff `coolingDownUntil`/`cooldownReason`. */
export function reportError(providerId: string, id: string, attempt: number, reason: string, jsStore: CoreAuthJsStore): void;

/** `AccountManager.reportSuccess` -- clears cooldown, bumps `lastUsed`. */
export function reportSuccess(providerId: string, id: string, jsStore: CoreAuthJsStore): void;

/**
 * `AccountManager.nextAvailableAt` -- the soonest epoch-ms any account in the pool becomes
 * available for `lane`, as a bare JSON number, or the literal JSON `"null"` when none ever will.
 */
export function nextAvailableAt(providerId: string, lane: string, jsStore: CoreAuthJsStore): string;

/**
 * `TokenRefresh.accessTokenExpired` -- pure predicate. `accountJson` supplies `{access, expires}`
 * (only fields this predicate reads).
 */
export function accessTokenExpired(accountJson: string, now: number): boolean;

/**
 * `RateLimitMath.calculateBackoffMs` over the `jitter === false` exact-value path. `argsJson` is
 * `{"attempt":number,"baseMs":number,"maxMs":number,"jitter":boolean}`; returns the bare JSON number.
 */
export function calculateBackoffMsJson(argsJson: string): string;

/**
 * `TokenRefresh.refresh` -- the network OAuth refresh call. `oauthConfigJson` supplies
 * `{tokenUrl, clientId, clientSecret?, extraParams?}`. Resolves to `{access, expires, refresh}` on
 * success, or `{revoked:true}` when the token endpoint reported `error=invalid_grant`. Any other
 * failure rejects the promise. Does not persist the result to any store.
 */
export function refreshToken(
  refreshToken: string,
  oauthConfigJson: string,
  httpSend: CoreAuthJsHttpSend,
): Promise<string>;
