// @ts-nocheck
import { loadProxyStore, saveProxyStore, updateProxyStore } from "./store.js";
import { fetchEnabledProxies } from "./providers.js";

const MAX_ACCOUNTS_PER_PROXY = 3;

function countAssignments(store, url) {
  return Object.values(store.assignments || {}).filter((u) => u === url).length;
}

// lower is better
function scoreOf(store, proxy) {
  const s = proxy.stats || {};
  const checks = s.checks || 0;
  const failRate = checks ? (s.failures || 0) / checks : 0.5;
  const inUse = countAssignments(store, proxy.url);
  return (s.avgLatencyMs || 2000) / 1000
    + failRate * 10
    + (s.ipRateLimitHits || 0) * 20
    + inUse * 5
    - (proxy.provider === "manual" ? 10 : 0);
}

export class ProxyManager {
  load() { return loadProxyStore(); }

  getMode() { return this.load().mode || "disabled"; }
  setMode(mode) { updateProxyStore((s) => { s.mode = mode; }); }

  enableProvider(name, on, key) {
    updateProxyStore((s) => { s.providers[name] = { ...(s.providers[name] || {}), enabled: !!on, ...(key !== undefined ? { key } : {}) }; });
  }
  providersConfig() { return this.load().providers || {}; }

  // proxies sorted best-first (lowest score)
  list() {
    const store = this.load();
    return [...store.proxies].map((p) => ({ ...p, score: scoreOf(store, p), inUse: countAssignments(store, p.url) })).sort((a, b) => a.score - b.score);
  }
  // global view (account-only proxies are excluded; they show in their account's menu)
  byProvider() {
    const groups = {};
    for (const p of this.list()) if (!p.owner) (groups[p.provider] = groups[p.provider] || []).push(p);
    return groups;
  }
  // proxies visible to one account: all global + the account's own
  accountProxies(accountId) {
    return this.list().filter((p) => !p.owner || p.owner === accountId);
  }
  get(url) { return this.list().find((p) => p.url === url) || null; }

  // owner set -> account-only (visible + auto-used for that account only); else global
  addManual(url, owner) {
    const clean = url.startsWith("http") ? url : "http://" + url;
    updateProxyStore((s) => { if (!s.proxies.find((p) => p.url === clean)) s.proxies.push({ url: clean, provider: "manual", owner: owner || undefined, addedAt: Date.now(), stats: { checks: 0, failures: 0, avgLatencyMs: 0, ipRateLimitHits: 0, lastOkAt: 0 } }); });
    return clean;
  }
  remove(url) {
    updateProxyStore((s) => {
      s.proxies = s.proxies.filter((p) => p.url !== url);
      for (const [acc, u] of Object.entries(s.assignments)) if (u === url) delete s.assignments[acc];
      for (const acc of Object.keys(s.manualSelection)) s.manualSelection[acc] = (s.manualSelection[acc] || []).filter((u) => u !== url);
    });
  }

  // manual-mode per-account selection (urls from the pool)
  getAccountSelection(accountId) { return this.load().manualSelection[accountId] || []; }
  setAccountSelection(accountId, urls) { updateProxyStore((s) => { s.manualSelection[accountId] = urls; }); }

  // pick a proxy url for an account per mode; sticks until freed (rate-limit) or cap-bound
  selectForAccount(accountId) {
    const store = this.load();
    if (store.mode === "disabled") return null;

    if (store.mode === "manual") {
      const owned = store.proxies.filter((p) => p.owner === accountId).map((p) => p.url);
      const pool = [...new Set([...(store.manualSelection[accountId] || []), ...owned])].filter((u) => store.proxies.find((p) => p.url === u));
      if (!pool.length) return null;
      const current = store.assignments[accountId];
      if (current && pool.includes(current)) return current;
      const chosen = pool[0];
      updateProxyStore((s) => { s.assignments[accountId] = chosen; });
      return chosen;
    }

    // automatic — global proxies + this account's own, under the per-proxy cap
    const current = store.assignments[accountId];
    if (current && store.proxies.find((p) => p.url === current)) return current;
    const candidates = store.proxies.filter((p) => (!p.owner || p.owner === accountId) && countAssignments(store, p.url) < MAX_ACCOUNTS_PER_PROXY).sort((a, b) => scoreOf(store, a) - scoreOf(store, b));
    if (!candidates.length) return null;
    const chosen = candidates[0].url;
    updateProxyStore((s) => { s.assignments[accountId] = chosen; });
    return chosen;
  }

  reportRateLimit(url) {
    updateProxyStore((s) => {
      const p = s.proxies.find((x) => x.url === url);
      if (p) { p.stats = p.stats || {}; p.stats.ipRateLimitHits = (p.stats.ipRateLimitHits || 0) + 1; p.stats.lastRateLimitAt = Date.now(); }
      for (const [acc, u] of Object.entries(s.assignments)) if (u === url) delete s.assignments[acc];
    });
  }

  reportResult(url, ok, latencyMs) {
    updateProxyStore((s) => {
      const p = s.proxies.find((x) => x.url === url);
      if (!p) return;
      const st = p.stats = p.stats || { checks: 0, failures: 0, avgLatencyMs: 0, ipRateLimitHits: 0 };
      st.checks = (st.checks || 0) + 1;
      if (!ok) st.failures = (st.failures || 0) + 1;
      else { st.lastOkAt = Date.now(); if (typeof latencyMs === "number") st.avgLatencyMs = st.avgLatencyMs ? Math.round(st.avgLatencyMs * 0.7 + latencyMs * 0.3) : latencyMs; }
    });
  }

  async refresh() {
    const fetched = await fetchEnabledProxies(this.providersConfig());
    updateProxyStore((s) => {
      const have = new Set(s.proxies.map((p) => p.url));
      for (const f of fetched) if (!have.has(f.url)) { s.proxies.push({ url: f.url, provider: f.provider, addedAt: Date.now(), stats: { checks: 0, failures: 0, avgLatencyMs: 0, ipRateLimitHits: 0, lastOkAt: 0 } }); have.add(f.url); }
    });
    return fetched.length;
  }
}

export const proxyManager = new ProxyManager();
