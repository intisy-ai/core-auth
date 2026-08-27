// Scope resolution over the proxy store: which proxies a scope may use, in which order. The
// decisions are single-sourced in Java (ProxyScopes, accounts/proxy) behind CoreAuthJs's proxy*
// exports; the selection calls return INDICES into store.proxies, which this module maps back onto
// the caller's own objects so proxy identity survives the crossing.
import { getCoreAuth } from "../core-auth-loader.js";

export interface ProxyStoreLike {
  proxies?: unknown[];
}

function pick(store: ProxyStoreLike, indices: number[]): unknown[] {
  const proxies = store.proxies || [];
  return indices.map((i) => proxies[i]);
}

export function scopeKey(scope: unknown): string {
  return getCoreAuth().proxyScopeKey(JSON.stringify(scope || null));
}

export function parseScopeKey(key: string): unknown {
  return JSON.parse(getCoreAuth().proxyParseScopeKey(key));
}

export function effectiveMode(store: ProxyStoreLike, key: string): string {
  return getCoreAuth().proxyEffectiveMode(JSON.stringify(store || {}), key);
}

export function resolveChain(store: ProxyStoreLike, accountId: string | null, providerId: string | null): string[] {
  return JSON.parse(getCoreAuth().proxyResolveChain(JSON.stringify(store || {}), accountId || "", providerId || ""));
}

export function proxiesInScope(store: ProxyStoreLike, key: string): unknown[] {
  return pick(store, JSON.parse(getCoreAuth().proxyProxiesInScope(JSON.stringify(store || {}), key)));
}

export function candidatesForScope(store: ProxyStoreLike, key: string, accountId: string | null, now: number = Date.now()): unknown[] {
  return pick(store, JSON.parse(getCoreAuth().proxyCandidatesForScope(JSON.stringify(store || {}), key, now)));
}

export function stickyUsable(store: ProxyStoreLike, key: string, url: string, now: number = Date.now()): boolean {
  return getCoreAuth().proxyStickyUsable(JSON.stringify(store || {}), key, url, now);
}
