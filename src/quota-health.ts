// Neutral quota/health SPI (single-sourced in Java, CoreAuthJs.quotaHasCapacity over
// QuotaHealth.hasCapacity, accounts). A provider maps its own cachedQuota shape into
// { remainingFraction }[] and delegates here instead of reimplementing the "any pool with
// capacity remaining" predicate itself.
import { getCoreAuth } from "./core-auth-loader.js";

/** A provider's own quota pool, mapped into this neutral shape for {@link hasCapacity} and {@link ipSuspected}. */
export interface QuotaPool {
  /** `0` to `1`. */
  remainingFraction: number;
}

/** Does the account still have capacity in at least one pool? */
export function hasCapacity(pools: QuotaPool[]): boolean {
  return getCoreAuth().quotaHasCapacity(JSON.stringify(pools || []));
}

/**
 * Is a 429 an IP/proxy limit (the account itself still has quota elsewhere), not the account's
 * own limit? Identical decision to hasCapacity, exposed under its own name since callers reach
 * for it by the proxy-signal concept (feeds proxyManager.reportRateLimit(url, { ipSuspected })).
 */
export function ipSuspected(pools: QuotaPool[]): boolean {
  return hasCapacity(pools);
}
