// @ts-nocheck
import { scoreOf, countAssignments, isIpLimited, MAX_ACCOUNTS_PER_PROXY } from "./scoring.js";

export function scopeKey(scope) {
  if (!scope || scope.type === "global") return "global";
  return scope.type + ":" + scope.id;
}
export function parseScopeKey(key) {
  if (key === "global") return { type: "global" };
  const i = key.indexOf(":");
  return { type: key.slice(0, i), id: key.slice(i + 1) };
}

export function effectiveMode(store, key) {
  const m = store.modes || {};
  return m[key] || m.default || "disabled";
}

// account -> provider -> global, dropping scopes whose effective mode is disabled
export function resolveChain(store, accountId, providerId) {
  const keys = [];
  if (accountId) keys.push("account:" + accountId);
  if (providerId) keys.push("provider:" + providerId);
  keys.push("global");
  return keys.filter((k) => effectiveMode(store, k) !== "disabled");
}

export function proxiesInScope(store, key) {
  return (store.proxies || []).filter((p) => scopeKey(p.scope) === key);
}

// usable proxies for a scope under its mode: manual = the scope's selected subset,
// automatic = all; minus cap-bound + currently IP-limited; sorted best-first.
export function candidatesForScope(store, key, accountId, now = Date.now()) {
  const mode = effectiveMode(store, key);
  let pool = proxiesInScope(store, key);
  if (mode === "manual") {
    const sel = new Set(store.manualSelection[key] || []);
    pool = pool.filter((p) => sel.has(p.url));
  }
  return pool
    .filter((p) => countAssignments(store, p.url) < MAX_ACCOUNTS_PER_PROXY && !isIpLimited(p, now))
    .sort((a, b) => scoreOf(store, a) - scoreOf(store, b));
}
