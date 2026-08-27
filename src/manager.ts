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

/** Retry timing overrides for {@link reportError}; unset fields fall back to the engine's own default. */
interface AccountManagerBackoff {
  baseMs?: number;
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

export class AccountManager {
  readonly providerId: string;
  readonly strategy: AccountSelectionStrategy;
  readonly oauth: OauthConfig | null;
  readonly backoff: AccountManagerBackoff;
  readonly store: AccountStoreLocation | null;
  readonly extraAvailable: ((account: CoreAccount, lane: string | undefined, now: number) => boolean) | null;

  constructor(providerId: string, opts?: AccountManagerOptions) {
    this.providerId = providerId;
    const options = opts || {};
    this.strategy = options.selection || "hybrid";
    this.oauth = options.oauth || null;       // { tokenUrl, clientId, clientSecret? }
    this.backoff = options.backoff || {};     // { baseMs?, maxMs? }
    this.store = options.store || null;       // { dir?, file? } store location override
    this.extraAvailable = typeof options.isAvailable === "function" ? options.isAvailable : null;
  }

  load(): AccountPool { return loadAccounts(this.providerId, this.store ?? undefined); }
  save(pool: AccountPool): void { saveAccounts(this.providerId, pool, this.store ?? undefined); }
  list(): CoreAccount[] { return this.load().accounts; }

  // Same live JsStore bridge (over this same accounts.json) every CoreAuthJs export below runs
  // against; kept as one helper since acquire/report*/nextAvailableAt all build it identically.
  jsStore(): CoreAuthJsStore {
    return asJsStore(createLiveStore(getConfigDir(), this.store?.dir));
  }

  // Selection + the lastUsed claim delegate to CoreAuthJs.acquireAccount (Java), which runs
  // the same sticky/round-robin/hybrid strategy over a live JsStore bridged onto this same
  // accounts.json; the network token refresh still runs out here, outside that call, so a
  // slow refresh never blocks another writer.
  async acquire(lane?: string): Promise<{ account: CoreAccount | undefined; access: string | undefined } | null> {
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

  // a revoked refresh token disables the account so selection skips it.
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

  // reportRateLimit/reportError/reportSuccess/nextAvailableAt delegate to CoreAuthJs (Java),
  // which persists the same rateLimitResetTimes/coolingDownUntil/cooldownReason fields onto this
  // same accounts.json via the jsStore bridge, so a subsequent acquire() (also delegated) sees
  // the exact state this call just wrote. They are sync because callers invoke them unawaited
  // over the Java orchestrator's own sync callbacks.
  reportRateLimit(id: string, lane: string | undefined, resetMs: number): void {
    getCoreAuth().reportRateLimit(this.providerId, id, lane || "", resetMs, this.jsStore());
    emitActivity({ topic: "account.rate_limited", action: "rate_limited", impact: "warning", outcome: "failed", subject: { kind: "account", id, label: id }, details: { provider: this.providerId, resetAt: resetMs } }, this.providerId);
  }

  // baseMs/maxMs are computed here (not left to CoreAuthJs's own ManagerOptions default) so a
  // provider's configured backoff (e.g. antigravity's retryBackoffMs) survives the delegation
  // instead of silently reverting to the built-in 1s/5min default.
  //
  // lane (2nd positional arg, matching reportRateLimit's shape) is the failing request's lane, so
  // an active provider-supplied reset on THAT lane can take sole ownership of usable-again instead
  // of core also layering its own backoff on top. A caller that doesn't know the lane passes
  // none; the exported lane || "" default cools down normally (CoreAuthJs.reportError's
  // documented "no same-lane reset known" contract -- an undefined/null lane must never reach the
  // exported string parameter as-is).
  reportError(id: string, lane: string | undefined, attempt: number | undefined, reason: string | undefined): void {
    const baseMs = (this.backoff && this.backoff.baseMs) || 1000;
    const maxMs = (this.backoff && this.backoff.maxMs) || 5 * 60 * 1000;
    getCoreAuth().reportError(this.providerId, id, lane || "", attempt || 0, reason || "transient error", baseMs, maxMs, this.jsStore());
  }

  reportSuccess(id: string): void {
    getCoreAuth().reportSuccess(this.providerId, id, this.jsStore());
  }

  // Java returns the bare JSON number, or the literal JSON "null" when no account will ever
  // become available; JSON.parse turns that into a real `null`, never a truthy string.
  nextAvailableAt(lane?: string): number | null {
    const raw = getCoreAuth().nextAvailableAt(this.providerId, lane || "", this.jsStore());
    return JSON.parse(raw) as number | null;
  }

  mutate(id: string, fn: (account: CoreAccount) => void): void {
    updateAccounts(this.providerId, (pool) => {
      const account = pool.accounts.find((candidate) => candidate.id === id);
      if (account) fn(account);
    }, this.store ?? undefined);
  }

  remove(id: string): void {
    removeAccount(this.providerId, id, this.store ?? undefined);
  }

  // force a token refresh regardless of expiry (manual "refresh token" action)
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
