// @ts-nocheck
import { loadProxyStore, updateProxyStore } from "./store.js";
import { fetchEnabledProxies } from "./providers.js";
import { scoreOf, countAssignments, MAX_ACCOUNTS_PER_PROXY } from "./scoring.js";
import { effectiveMode, resolveChain, candidatesForScope, proxiesInScope } from "./scopes.js";

export class ProxyManager {
  load() { return loadProxyStore(); }

  getMode(key = "default") { return effectiveMode(this.load(), key); }
  setMode(key, mode) { updateProxyStore((s) => { s.modes = s.modes || { default: "disabled" }; s.modes[key] = mode; }); }

  enableProvider(name, on, key) {
    updateProxyStore((s) => { s.providers = s.providers || {}; s.providers[name] = { ...(s.providers[name] || {}), enabled: !!on, ...(key !== undefined ? { key } : {}) }; });
  }
  providersConfig() { return this.load().providers || {}; }

  // all proxies best-first, annotated with score + inUse (for the UI)
  list() {
    const store = this.load();
    return [...store.proxies].map((p) => ({ ...p, score: scoreOf(store, p), inUse: countAssignments(store, p.url) })).sort((a, b) => a.score - b.score);
  }
  proxiesForScope(key) {
    const store = this.load();
    return proxiesInScope(store, key).map((p) => ({ ...p, score: scoreOf(store, p), inUse: countAssignments(store, p.url) })).sort((a, b) => a.score - b.score);
  }
  get(url) { const store = this.load(); const p = store.proxies.find((x) => x.url === url); return p ? { ...p, score: scoreOf(store, p), inUse: countAssignments(store, p.url) } : null; }

  addManual(url, scope) {
    const clean = url.startsWith("http") ? url : "http://" + url;
    const sc = scope && scope.type ? scope : { type: "global" };
    updateProxyStore((s) => { if (!s.proxies.find((p) => p.url === clean)) s.proxies.push({ url: clean, provider: "manual", scope: sc, addedAt: Date.now(), stats: { checks: 0, failures: 0, avgLatencyMs: 0, ipRateLimitHits: 0, lastOkAt: 0 } }); });
    return clean;
  }
  remove(url) {
    updateProxyStore((s) => {
      s.proxies = s.proxies.filter((p) => p.url !== url);
      for (const [acc, u] of Object.entries(s.assignments)) if (u === url) delete s.assignments[acc];
      for (const key of Object.keys(s.manualSelection)) s.manualSelection[key] = (s.manualSelection[key] || []).filter((u) => u !== url);
    });
  }

  getScopeSelection(key) { return this.load().manualSelection[key] || []; }
  setScopeSelection(key, urls) { updateProxyStore((s) => { s.manualSelection[key] = urls; }); }

  // walk account -> provider -> global; sticky per account; fall through on empty/exhausted
  selectForAccount(accountId, providerId) {
    const store = this.load();
    const chain = resolveChain(store, accountId, providerId);
    if (!chain.length) return null;
    const current = store.assignments[accountId];
    // keep a sticky assignment only if it's still a usable candidate in some chain scope
    if (current) {
      for (const key of chain) if (candidatesForScope(store, key, accountId).some((p) => p.url === current)) return current;
    }
    for (const key of chain) {
      const cands = candidatesForScope(store, key, accountId);
      if (cands.length) { const chosen = cands[0].url; updateProxyStore((s) => { s.assignments[accountId] = chosen; }); return chosen; }
    }
    return null;
  }

  pickForLogin(providerId) {
    const store = this.load();
    const chain = resolveChain(store, null, providerId);   // no account scope yet
    for (const key of chain) { const cands = candidatesForScope(store, key, null); if (cands.length) return cands[0].url; }
    return null;
  }

  bindAccountProxy(accountId, url) {
    if (!url) return;
    updateProxyStore((s) => {
      const key = "account:" + accountId;
      if (effectiveMode(s, key) === "manual") {
        const sel = s.manualSelection[key] || [];
        if (!sel.includes(url)) sel.push(url);
        s.manualSelection[key] = sel;
      }
      s.assignments[accountId] = url;
    });
  }

  reportRateLimit(url, opts) {
    if (!opts || opts.ipSuspected !== true) return;   // only IP-suspected limits reflect proxy quality
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
      for (const f of fetched) if (!have.has(f.url)) { s.proxies.push({ url: f.url, provider: f.provider, scope: { type: "global" }, addedAt: Date.now(), stats: { checks: 0, failures: 0, avgLatencyMs: 0, ipRateLimitHits: 0, lastOkAt: 0 } }); have.add(f.url); }
    });
    return fetched.length;
  }
}

export const proxyManager = new ProxyManager();
