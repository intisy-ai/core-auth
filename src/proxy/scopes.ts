// @ts-nocheck
// Scope resolution over the proxy store: which proxies a scope may use, in which order. The
// decisions are single-sourced in Java (ProxyScopes, accounts/proxy) behind CoreAuthJs's proxy*
// exports; the selection calls return INDICES into store.proxies, which this module maps back onto
// the caller's own objects so proxy identity survives the crossing.
import { getCoreAuth } from "../core-auth-loader.js";

function pick(store, indices) {
  const proxies = store.proxies || [];
  return indices.map((i) => proxies[i]);
}

export function scopeKey(scope) {
  return getCoreAuth().proxyScopeKey(JSON.stringify(scope || null));
}

export function parseScopeKey(key) {
  return JSON.parse(getCoreAuth().proxyParseScopeKey(key));
}

export function effectiveMode(store, key) {
  return getCoreAuth().proxyEffectiveMode(JSON.stringify(store || {}), key);
}

export function resolveChain(store, accountId, providerId) {
  return JSON.parse(getCoreAuth().proxyResolveChain(JSON.stringify(store || {}), accountId || "", providerId || ""));
}

export function proxiesInScope(store, key) {
  return pick(store, JSON.parse(getCoreAuth().proxyProxiesInScope(JSON.stringify(store || {}), key)));
}

export function candidatesForScope(store, key, accountId, now = Date.now()) {
  return pick(store, JSON.parse(getCoreAuth().proxyCandidatesForScope(JSON.stringify(store || {}), key, now)));
}

export function stickyUsable(store, key, url, now = Date.now()) {
  return getCoreAuth().proxyStickyUsable(JSON.stringify(store || {}), key, url, now);
}
