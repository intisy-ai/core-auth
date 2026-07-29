// @ts-nocheck
// AccountManager: the generic multi-account engine (storage, selection, rate-limit/cooldown, OAuth refresh) a driver gets for free.

import { loadAccounts, saveAccounts, updateAccounts, removeAccount } from "./accounts.js";
import { selectIndex } from "./selection.js";
import { isAvailable as builtinAvailable, availableAt, calculateBackoffMs } from "./ratelimit.js";
import { accessTokenExpired, refreshAccessToken, TokenRefreshError } from "./oauth.js";
import { proxyManager } from "./proxy/manager.js";

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
    this.available = (account, lane, now) =>
      builtinAvailable(account, lane, now) && (!this.extraAvailable || this.extraAvailable(account, lane, now));
  }

  load() { return loadAccounts(this.providerId, this.store); }
  save(pool) { saveAccounts(this.providerId, pool, this.store); }
  list() { return this.load().accounts; }

  // selection + lastUsed claim run under the store lock; the network token refresh runs outside it so a slow refresh never blocks other writers.
  async acquire(lane) {
    const now = Date.now();
    let claimedId = null;
    updateAccounts(this.providerId, (pool) => {
      const index = selectIndex(pool, lane, now, this.strategy, this.available);
      if (index < 0) return;
      const account = pool.accounts[index];
      // No availability re-check: selectIndex already prefers an AVAILABLE account
      // and only returns an unavailable (soonest-free) one as a LAST RESORT when
      // every account is rate-limited for this lane. In that case we still claim it
      // and let the caller attempt: a rate-limit window is a heuristic that may have
      // lifted or been recorded inaccurately, so a last-ditch try beats failing
      // outright; a genuine 429 just re-arms the backoff. (hybrid strategy only;
      // sticky/round-robin return -1 when none are free and still hard-stop.)
      account.lastUsed = now;
      claimedId = account.id;
    }, this.store);
    if (!claimedId) return null;
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

  reportRateLimit(id, lane, resetMs) {
    this.mutate(id, (account) => {
      account.rateLimitResetTimes = account.rateLimitResetTimes || {};
      account.rateLimitResetTimes[lane] = resetMs;
    });
  }

  reportError(id, attempt, reason) {
    const ms = calculateBackoffMs(attempt || 0, this.backoff);
    this.mutate(id, (account) => {
      account.coolingDownUntil = Date.now() + ms;
      account.cooldownReason = reason || "transient error";
    });
  }

  reportSuccess(id) {
    this.mutate(id, (account) => {
      account.coolingDownUntil = 0;
      account.cooldownReason = null;
      account.lastUsed = Date.now();
    });
  }

  nextAvailableAt(lane) {
    const now = Date.now();
    let best = Infinity;
    for (const account of this.load().accounts) best = Math.min(best, availableAt(account, lane, now));
    return best === Infinity ? null : best;
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
