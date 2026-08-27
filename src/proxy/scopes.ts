// Scope resolution over the proxy store: which proxies a scope may use, in which order. The
// decisions are single-sourced in Java (ProxyScopes, accounts/proxy) behind CoreAuthJs's proxy*
// exports; the selection calls return INDICES into store.proxies, which this module maps back onto
// the caller's own objects so proxy identity survives the crossing.
import { getCoreAuth } from "../core-auth-loader.js";

/** The minimal store shape scope resolution needs: just the proxies array. */
export interface ProxyStoreLike {
  /** Every proxy in the store, picked by index. */
  proxies?: unknown[];
}

function pick(store: ProxyStoreLike, indices: number[]): unknown[] {
  const proxies = store.proxies || [];
  return indices.map((i) => proxies[i]);
}

/** The stable string key for a `ProxyScope`, e.g. `"account:<id>"`. */
export function scopeKey(scope: unknown): string {
  return getCoreAuth().proxyScopeKey(JSON.stringify(scope || null));
}

/** Recovers a `ProxyScope` from a key produced by {@link scopeKey}. */
export function parseScopeKey(key: string): unknown {
  return JSON.parse(getCoreAuth().proxyParseScopeKey(key));
}

/** The proxy mode actually in effect for a scope key, falling back through parent scopes to the default. */
export function effectiveMode(store: ProxyStoreLike, key: string): string {
  return getCoreAuth().proxyEffectiveMode(JSON.stringify(store || {}), key);
}

/** The scope keys to try, in precedence order, when resolving a proxy for an account/provider pair. */
export function resolveChain(store: ProxyStoreLike, accountId: string | null, providerId: string | null): string[] {
  return JSON.parse(getCoreAuth().proxyResolveChain(JSON.stringify(store || {}), accountId || "", providerId || ""));
}

/** Every proxy entry that belongs to a scope key. */
export function proxiesInScope(store: ProxyStoreLike, key: string): unknown[] {
  return pick(store, JSON.parse(getCoreAuth().proxyProxiesInScope(JSON.stringify(store || {}), key)));
}

/** Proxy entries eligible right now for a scope key and account: in scope, enabled, and not IP rate-limited. */
export function candidatesForScope(store: ProxyStoreLike, key: string, accountId: string | null, now: number = Date.now()): unknown[] {
  return pick(store, JSON.parse(getCoreAuth().proxyCandidatesForScope(JSON.stringify(store || {}), key, now)));
}

/** Whether the scope's currently sticky-assigned proxy is still `url` and still usable. */
export function stickyUsable(store: ProxyStoreLike, key: string, url: string, now: number = Date.now()): boolean {
  return getCoreAuth().proxyStickyUsable(JSON.stringify(store || {}), key, url, now);
}
