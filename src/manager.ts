// @ts-nocheck
// AccountManager: the generic multi-account engine (storage, selection, rate-limit/cooldown, OAuth refresh) a driver gets for free.

import { loadAccounts, saveAccounts, updateAccounts, removeAccount } from "./accounts.js";
import { accessTokenExpired, refreshAccessToken, TokenRefreshError } from "./oauth.js";
import { proxyManager } from "./proxy/manager.js";
import { initCoreAuth, getCoreAuth } from "./core-auth-loader.js";
import { createLiveStore } from "./live-store.js";
import { getConfigDir } from "./env.js";

// token refresh rides the account's sticky proxy so Google sees the same IP for
// refresh as for requests; null when proxying is off -> direct refresh as before
function oauthWithProxy(oauth, id, providerId) {
  const proxy = proxyManager.selectForAccount(id, providerId);
  return proxy ? { ...oauth, proxy } : oauth;
}

export class AccountManager {
  constructor(providerId, opts) {
    this.providerId = providerId;
    const options = opts || {};
    this.strategy = options.selection || "hybrid";
    this.oauth = options.oauth || null;       // { tokenUrl, clientId, clientSecret?, extraParams? }
    this.backoff = options.backoff || {};     // { baseMs?, maxMs?, jitter? }
    this.store = options.store || null;       // { dir?, file? } store location override
    this.extraAvailable = typeof options.isAvailable === "function" ? options.isAvailable : null;
  }

  load() { return loadAccounts(this.providerId, this.store); }
  save(pool) { saveAccounts(this.providerId, pool, this.store); }
  list() { return this.load().accounts; }

  // Same live JsStore bridge (over this same accounts.json) every CoreAuthJs export below runs
  // against; kept as one helper since acquire/report*/nextAvailableAt all build it identically.
  jsStore() {
    return createLiveStore(getConfigDir(), this.store && this.store.dir);
  }

  // Selection + the lastUsed claim delegate to CoreAuthJs.acquireAccount (Java), which runs
  // the same sticky/round-robin/hybrid strategy over a live JsStore bridged onto this same
  // accounts.json; the network token refresh still runs out here, outside that call, so a
  // slow refresh never blocks another writer.
  async acquire(lane) {
    await initCoreAuth();
    const jsStore = this.jsStore();
    const available = this.extraAvailable
      ? (accountJson, laneArg) => this.extraAvailable(JSON.parse(accountJson), laneArg || undefined, Date.now())
      : undefined;
    const raw = getCoreAuth().acquireAccount(this.providerId, lane || "", this.strategy, available, jsStore);
    const result = JSON.parse(raw);
    if (result.none) return null;
    const claimedId = result.accountId;
    const access = await this.ensureAccess(claimedId);
    const account = this.load().accounts.find((candidate) => candidate.id === claimedId);
    return { account, access };
  }

  // a revoked refresh token disables the account so selection skips it.
  async ensureAccess(id) {
    const account = this.load().accounts.find((candidate) => candidate.id === id);
    if (!account) return undefined;
    if (!accessTokenExpired(account)) return account.access;
    if (!this.oauth || !account.refresh) return account.access;
    try {
      const refreshed = await refreshAccessToken(account.refresh, oauthWithProxy(this.oauth, id, this.providerId));
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
  // the exact state this call just wrote.
  async reportRateLimit(id, lane, resetMs) {
    await initCoreAuth();
    getCoreAuth().reportRateLimit(this.providerId, id, lane || "", resetMs, this.jsStore());
  }

  // baseMs/maxMs are computed here (not left to CoreAuthJs's own ManagerOptions default) so a
  // provider's configured backoff (e.g. antigravity's retryBackoffMs) survives the delegation
  // instead of silently reverting to the built-in 1s/5min default.
  async reportError(id, attempt, reason) {
    await initCoreAuth();
    const baseMs = (this.backoff && this.backoff.baseMs) || 1000;
    const maxMs = (this.backoff && this.backoff.maxMs) || 5 * 60 * 1000;
    getCoreAuth().reportError(this.providerId, id, attempt || 0, reason || "transient error", baseMs, maxMs, this.jsStore());
  }

  async reportSuccess(id) {
    await initCoreAuth();
    getCoreAuth().reportSuccess(this.providerId, id, this.jsStore());
  }

  // Java returns the bare JSON number, or the literal JSON "null" when no account will ever
  // become available; JSON.parse turns that into a real `null`, never a truthy string.
  async nextAvailableAt(lane) {
    await initCoreAuth();
    const raw = getCoreAuth().nextAvailableAt(this.providerId, lane || "", this.jsStore());
    return JSON.parse(raw);
  }

  mutate(id, fn) {
    updateAccounts(this.providerId, (pool) => {
      const account = pool.accounts.find((candidate) => candidate.id === id);
      if (account) fn(account);
    }, this.store);
  }

  remove(id) {
    removeAccount(this.providerId, id, this.store);
  }

  // force a token refresh regardless of expiry (manual "refresh token" action)
  async refresh(id) {
    const account = this.load().accounts.find((candidate) => candidate.id === id);
    if (!account || !this.oauth || !account.refresh) return false;
    const refreshed = await refreshAccessToken(account.refresh, oauthWithProxy(this.oauth, id, this.providerId));
    this.mutate(id, (a) => {
      a.access = refreshed.access;
      a.expires = refreshed.expires;
      if (refreshed.refresh) a.refresh = refreshed.refresh;
    });
    return true;
  }
}
