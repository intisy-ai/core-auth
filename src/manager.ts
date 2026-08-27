// AccountManager: the generic multi-account engine (storage, selection, rate-limit/cooldown, OAuth refresh) a driver gets for free.

import { loadAccounts, saveAccounts, updateAccounts, removeAccount, asJsStore, type AccountStoreLocation } from "./accounts.js";
import { accessTokenExpired, refreshAccessToken, TokenRefreshError } from "./oauth.js";
import { proxyManager } from "./proxy/manager.js";
import { getCoreAuth } from "./core-auth-loader.js";
import { createLiveStore } from "./live-store.js";
import { getConfigDir } from "./env.js";
import { emitActivity } from "./activity.js";
import type { ProxiedFetchOpts } from "./net.js";
import type { OauthConfig } from "./login.js";
import type { AccountSelectionStrategy } from "./provider-common.js";
import type { CoreAuthJsStore } from "./generated/core-auth.teavm.js";
import type { AccountPool, CoreAccount } from "./types.js";

// A token refresh rides the account's sticky proxy so upstream sees the same IP for a refresh as
// for the requests it authorizes; the transport picks and reports it, and refreshes directly when
// proxying is off.
function transportFor(id: string, providerId: string): ProxiedFetchOpts {
  return { proxyManager, accountId: id, providerId };
}

/** Retry timing overrides for {@link AccountManager.reportError}; unset fields fall back to the engine's own default. */
export interface AccountManagerBackoff {
  /** Base cooldown, in milliseconds. */
  baseMs?: number;
  /** Cap on the exponential backoff, in milliseconds. */
  maxMs?: number;
}

type AcquireResult =
  | { none: true }
  | { none?: false; accountId: string; access?: string };

/** How a caller configures the account engine for one provider. */
export interface AccountManagerOptions {
  /** Which selection strategy to use; defaults to `hybrid`. */
  selection?: AccountSelectionStrategy;
  /** The token endpoint and client credentials, when this provider refreshes OAuth tokens. */
  oauth?: OauthConfig | null;
  /** Retry timing overrides. */
  backoff?: AccountManagerBackoff;
  /** Where the pool is stored, when it is not the default location. */
  store?: AccountStoreLocation | null;
  /** An extra availability predicate a provider supplies beyond the engine's own. */
  isAvailable?: ((account: CoreAccount, lane: string | undefined, now: number) => boolean) | null;
}

/** The generic multi-account engine (storage, selection, rate-limit/cooldown, OAuth refresh) a driver gets for free, for one provider's account pool. */
export class AccountManager {
  /** The provider id every stored account and API call is keyed under. */
  readonly providerId: string;
  /** Which account selection strategy this manager uses. */
  readonly strategy: AccountSelectionStrategy;
  /** The token endpoint and client credentials this provider refreshes with, or `null` when it does not use OAuth refresh. */
  readonly oauth: OauthConfig | null;
  /** Retry timing overrides for {@link reportError}. */
  readonly backoff: AccountManagerBackoff;
  /** Where this provider's pool is stored, or `null` for the default location. */
  readonly store: AccountStoreLocation | null;
  /** The provider's own extra availability predicate, or `null` when it supplies none. */
  readonly extraAvailable: ((account: CoreAccount, lane: string | undefined, now: number) => boolean) | null;

  constructor(providerId: string, opts?: AccountManagerOptions) {
    this.providerId = providerId;
    const options = opts || {};
    this.strategy = options.selection || "hybrid";
    this.oauth = options.oauth || null;       // { tokenUrl, clientId, clientSecret? }
    this.backoff = options.backoff || {};     // { baseMs?, maxMs? }
    this.store = options.store || null;       // { dir? } store location override
    this.extraAvailable = typeof options.isAvailable === "function" ? options.isAvailable : null;
  }

  /** Reads this provider's stored account pool. */
  load(): AccountPool { return loadAccounts(this.providerId, this.store ?? undefined); }
  /** Overwrites this provider's whole account pool. */
  save(pool: AccountPool): void { saveAccounts(this.providerId, pool, this.store ?? undefined); }
  /** Just the accounts array from the stored pool. */
  list(): CoreAccount[] { return this.load().accounts; }

  /**
   * The live JsStore bridge (over this same `accounts.json`) every CoreAuthJs export below runs
   * against; kept as one helper since acquire, the report methods, and nextAvailableAt all build
   * it identically.
   */
  jsStore(): CoreAuthJsStore {
    return asJsStore(createLiveStore(getConfigDir(), this.store?.dir));
  }

  /**
   * Selects the next account to use for `lane` and ensures its access token is fresh.
   *
   * @remarks
   * Selection and the `lastUsed` claim delegate to CoreAuthJs.acquireAccount (Java), which runs
   * the same sticky/round-robin/hybrid strategy over a live JsStore bridged onto this same
   * `accounts.json`; the network token refresh still runs out here, outside that call, so a slow
   * refresh never blocks another writer.
   * @returns `null` when no account is available for `lane`
   */
  async acquire(lane?: string): Promise<{
    /** The selected account, or `undefined` if it disappeared between selection and load. */
    account: CoreAccount | undefined;
    /** Its fresh access token. */
    access: string | undefined;
  } | null> {
    const jsStore = this.jsStore();
    const predicate = this.extraAvailable;
    const available: ((a: string, b: string) => boolean) | null = predicate
      ? (accountJson: string, laneArg: string) => predicate(JSON.parse(accountJson) as CoreAccount, laneArg || undefined, Date.now())
      : null;
    const raw = getCoreAuth().acquireAccount(this.providerId, lane || "", this.strategy, available, jsStore);
    const result: AcquireResult = JSON.parse(raw);
    if (result.none) return null;
    const claimedId = result.accountId;
    const access = await this.ensureAccess(claimedId);
    const account = this.load().accounts.find((candidate) => candidate.id === claimedId);
    return { account, access };
  }

  /**
   * Ensures an account's access token is fresh, refreshing it if expired.
   *
   * @remarks A revoked refresh token disables the account so selection skips it.
   * @returns `undefined` if the account is not found
   */
  async ensureAccess(id: string): Promise<string | undefined> {
    const account = this.load().accounts.find((candidate) => candidate.id === id);
    if (!account) return undefined;
    if (!accessTokenExpired(account)) return account.access;
    if (!this.oauth || !account.refresh) return account.access;
    try {
      const refreshed = await refreshAccessToken(account.refresh, this.oauth, transportFor(id, this.providerId));
      if (!refreshed) throw new Error("token refresh returned no result");
      this.mutate(id, (a) => {
        a.access = refreshed.access;
        a.expires = refreshed.expires;
        if (refreshed.refresh) a.refresh = refreshed.refresh;
      });
      return refreshed.access;
    } catch (error) {
      if (error instanceof TokenRefreshError && error.revoked) {
        this.mutate(id, (a) => { a.enabled = false; a.disabledReason = "refresh token revoked"; });
      }
      throw error;
    }
  }

  /**
   * Records that an account hit a rate limit on `lane`, until `resetMs`.
   *
   * @remarks
   * Delegates to CoreAuthJs (Java), which persists `rateLimitResetTimes` onto this same
   * `accounts.json` via the jsStore bridge, so a subsequent {@link acquire} sees the exact state
   * this call just wrote. Sync because callers invoke it unawaited over the Java orchestrator's
   * own sync callbacks.
   */
  reportRateLimit(id: string, lane: string | undefined, resetMs: number): void {
    getCoreAuth().reportRateLimit(this.providerId, id, lane || "", resetMs, this.jsStore());
    emitActivity({ topic: "account.rate_limited", action: "rate_limited", impact: "warning", outcome: "failed", subject: { kind: "account", id, label: id }, details: { provider: this.providerId, resetAt: resetMs } }, this.providerId);
  }

  /**
   * Records a transient failure for an account, applying exponential cooldown backoff.
   *
   * @param lane the failing request's lane; an active provider-supplied reset on that lane takes sole ownership of usable-again instead of layering the generic backoff on top. Pass `undefined` when the lane is not known.
   * @remarks `baseMs`/`maxMs` are computed here (not left to CoreAuthJs's own default) so a provider's configured {@link backoff} (e.g. `retryBackoffMs`) survives the delegation instead of silently reverting to the built-in 1s/5min default.
   */
  reportError(id: string, lane: string | undefined, attempt: number | undefined, reason: string | undefined): void {
    const baseMs = (this.backoff && this.backoff.baseMs) || 1000;
    const maxMs = (this.backoff && this.backoff.maxMs) || 5 * 60 * 1000;
    getCoreAuth().reportError(this.providerId, id, lane || "", attempt || 0, reason || "transient error", baseMs, maxMs, this.jsStore());
  }

  /** Records a successful request, clearing any transient cooldown. */
  reportSuccess(id: string): void {
    getCoreAuth().reportSuccess(this.providerId, id, this.jsStore());
  }

  /**
   * Epoch ms when the next account becomes available for `lane`.
   *
   * @returns `null` when no account will ever become available (e.g. all are disabled)
   */
  nextAvailableAt(lane?: string): number | null {
    const raw = getCoreAuth().nextAvailableAt(this.providerId, lane || "", this.jsStore());
    return JSON.parse(raw) as number | null;
  }

  /** Atomic read-modify-write on one account: `fn` mutates it in place, a no-op if `id` is not found. */
  mutate(id: string, fn: (account: CoreAccount) => void): void {
    updateAccounts(this.providerId, (pool) => {
      const account = pool.accounts.find((candidate) => candidate.id === id);
      if (account) fn(account);
    }, this.store ?? undefined);
  }

  /** Removes an account from the pool by id. */
  remove(id: string): void {
    removeAccount(this.providerId, id, this.store ?? undefined);
  }

  /**
   * Forces a token refresh regardless of expiry, for a manual "refresh token" action.
   *
   * @returns `false` when the account has no OAuth config or no refresh token to use
   */
  async refresh(id: string): Promise<boolean> {
    const account = this.load().accounts.find((candidate) => candidate.id === id);
    if (!account || !this.oauth || !account.refresh) return false;
    const refreshed = await refreshAccessToken(account.refresh, this.oauth, transportFor(id, this.providerId));
    if (!refreshed) throw new Error("token refresh returned no result");
    this.mutate(id, (a) => {
      a.access = refreshed.access;
      a.expires = refreshed.expires;
      if (refreshed.refresh) a.refresh = refreshed.refresh;
    });
    return true;
  }
}
