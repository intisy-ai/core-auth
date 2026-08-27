import { loadProxyStore, updateProxyStore, type ProxyStore, type ProxyEntry, type ProxyScope } from "./store.js";
import { fetchEnabledProxies } from "./providers.js";
import { scoreOf, countAssignments, MAX_ACCOUNTS_PER_PROXY } from "./scoring.js";
import { effectiveMode, resolveChain, candidatesForScope, proxiesInScope, stickyUsable } from "./scopes.js";

export type { ProxyEntry, ProxyScope, ProxyStore } from "./store.js";
export type ScoredProxyEntry = ProxyEntry & { score: number; inUse: number };

export interface ReportRateLimitOpts {
  ipSuspected?: boolean;
}

// scopes.ts's proxy* lookups are typed generically (ProxyStoreLike / unknown[]) so that layer
// stays agnostic to the store's concrete shape; every pick they return is an element of THIS
// module's own store.proxies, so re-asserting the result as ProxyEntry[] here is honest.
function asProxyEntries(list: unknown[]): ProxyEntry[] {
  return list as ProxyEntry[];
}

function scored(store: ProxyStore, proxies: ProxyEntry[]): ScoredProxyEntry[] {
  return proxies.map((p) => ({ ...p, score: scoreOf(store, p), inUse: countAssignments(store, p.url) })).sort((a, b) => a.score - b.score);
}

export class ProxyManager {
  load(): ProxyStore { return loadProxyStore(); }

  getMode(key = "default"): string { return effectiveMode(this.load(), key); }
  setMode(key: string, mode: string): void { updateProxyStore((s) => { s.modes = s.modes || { default: "disabled" }; s.modes[key] = mode; }); }

  enableProvider(name: string, on: boolean, key?: string): void {
    updateProxyStore((s) => { s.providers = s.providers || {}; s.providers[name] = { ...(s.providers[name] || {}), enabled: !!on, ...(key !== undefined ? { key } : {}) }; });
  }
  providersConfig(): ProxyStore["providers"] { return this.load().providers || {}; }

  // all proxies best-first, annotated with score + inUse (for the UI)
  list(): ScoredProxyEntry[] {
    const store = this.load();
    return scored(store, [...store.proxies]);
  }
  proxiesForScope(key: string): ScoredProxyEntry[] {
    const store = this.load();
    return scored(store, asProxyEntries(proxiesInScope(store, key)));
  }
  get(url: string): ScoredProxyEntry | null {
    const store = this.load();
    const p = store.proxies.find((x) => x.url === url);
    return p ? { ...p, score: scoreOf(store, p), inUse: countAssignments(store, p.url) } : null;
  }

  addManual(url: string, scope?: ProxyScope): string {
    const clean = url.startsWith("http") ? url : "http://" + url;
    const sc: ProxyScope = scope?.type ? scope : { type: "global" };
    updateProxyStore((s) => { if (!s.proxies.find((p) => p.url === clean)) s.proxies.push({ url: clean, provider: "manual", scope: sc, addedAt: Date.now(), stats: { checks: 0, failures: 0, avgLatencyMs: 0, ipRateLimitHits: 0, lastOkAt: 0 } }); });
    return clean;
  }
  remove(url: string): void {
    updateProxyStore((s) => {
      s.proxies = s.proxies.filter((p) => p.url !== url);
      for (const [acc, u] of Object.entries(s.assignments)) if (u === url) delete s.assignments[acc];
      for (const key of Object.keys(s.manualSelection)) s.manualSelection[key] = (s.manualSelection[key] || []).filter((u) => u !== url);
    });
  }

  getScopeSelection(key: string): string[] { return this.load().manualSelection[key] || []; }
  setScopeSelection(key: string, urls: string[]): void { updateProxyStore((s) => { s.manualSelection[key] = urls; }); }

  // walk account -> provider -> global; sticky per account; fall through on empty/exhausted
  selectForAccount(accountId?: string, providerId?: string): string | null {
    const store = this.load();
    const chain = resolveChain(store, accountId ?? null, providerId ?? null);
    if (!chain.length) return null;
    const current = accountId ? store.assignments[accountId] : undefined;
    // keep a sticky assignment if it's still usable in some chain scope: the
    // account already holds this slot, so the per-proxy cap must NOT evict it
    // (that would churn, or deadlock to direct with a one-proxy pool).
    if (current) {
      for (const key of chain) if (stickyUsable(store, key, current)) return current;
    }
    for (const key of chain) {
      const cands = asProxyEntries(candidatesForScope(store, key, accountId ?? null));
      if (cands.length) {
        const chosen = cands[0].url;
        if (accountId) updateProxyStore((s) => { s.assignments[accountId] = chosen; });
        return chosen;
      }
    }
    return null;
  }

  pickForLogin(providerId: string | null): string | null {
    const store = this.load();
    const chain = resolveChain(store, null, providerId);   // no account scope yet
    for (const key of chain) {
      const cands = asProxyEntries(candidatesForScope(store, key, null));
      if (cands.length) return cands[0].url;
    }
    return null;
  }

  bindAccountProxy(accountId: string, url: string | null): void {
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

  reportRateLimit(url: string, opts?: ReportRateLimitOpts): void {
    if (!opts || opts.ipSuspected !== true) return;   // only IP-suspected limits reflect proxy quality
    updateProxyStore((s) => {
      const p = s.proxies.find((x) => x.url === url);
      if (p) { p.stats = p.stats || {}; p.stats.ipRateLimitHits = (p.stats.ipRateLimitHits || 0) + 1; p.stats.lastRateLimitAt = Date.now(); }
      for (const [acc, u] of Object.entries(s.assignments)) if (u === url) delete s.assignments[acc];
    });
  }

  reportResult(url: string, ok: boolean, latencyMs?: number): void {
    updateProxyStore((s) => {
      const p = s.proxies.find((x) => x.url === url);
      if (!p) return;
      const st = p.stats = p.stats || { checks: 0, failures: 0, avgLatencyMs: 0, ipRateLimitHits: 0 };
      st.checks = (st.checks || 0) + 1;
      if (!ok) st.failures = (st.failures || 0) + 1;
      else { st.lastOkAt = Date.now(); if (typeof latencyMs === "number") st.avgLatencyMs = st.avgLatencyMs ? Math.round(st.avgLatencyMs * 0.7 + latencyMs * 0.3) : latencyMs; }
    });
  }

  async refresh(): Promise<number> {
    const fetched = await fetchEnabledProxies(this.providersConfig());
    updateProxyStore((s) => {
      const have = new Set(s.proxies.map((p) => p.url));
      for (const f of fetched) if (!have.has(f.url)) { s.proxies.push({ url: f.url, provider: f.provider, scope: { type: "global" }, addedAt: Date.now(), stats: { checks: 0, failures: 0, avgLatencyMs: 0, ipRateLimitHits: 0, lastOkAt: 0 } }); have.add(f.url); }
    });
    return fetched.length;
  }
}

export const proxyManager = new ProxyManager();
