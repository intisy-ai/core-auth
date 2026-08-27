import { loadProxyStore, updateProxyStore, type ProxyStore, type ProxyEntry, type ProxyScope } from "./store.js";
import { fetchEnabledProxies } from "./providers.js";
import { scoreOf, countAssignments, MAX_ACCOUNTS_PER_PROXY } from "./scoring.js";
import { effectiveMode, resolveChain, candidatesForScope, proxiesInScope, stickyUsable } from "./scopes.js";

export type { ProxyEntry, ProxyScope, ProxyStore, ProxyStats } from "./store.js";
/** A {@link ProxyEntry} annotated for display: its quality score and how many accounts currently use it. */
export type ScoredProxyEntry = ProxyEntry & {
  /** Quality score, lower meaning more preferred by selection. */
  score: number;
  /** How many accounts currently have this proxy assigned. */
  inUse: number;
};

/** Options to {@link ProxyManager.reportRateLimit}. */
export interface ReportRateLimitOpts {
  /** Only an IP-suspected rate limit reflects on proxy quality; a non-IP limit is left unrecorded. */
  ipSuspected?: boolean;
}

function scored(store: ProxyStore, proxies: ProxyEntry[]): ScoredProxyEntry[] {
  return proxies.map((p) => ({ ...p, score: scoreOf(store, p), inUse: countAssignments(store, p.url) })).sort((a, b) => a.score - b.score);
}

/** Reads, mutates and scores the shared proxy pool; the one instance every provider shares is {@link proxyManager}. */
export class ProxyManager {
  /** Reads the whole shared proxy store. */
  load(): ProxyStore { return loadProxyStore(); }

  /** The proxy mode in effect for a scope key. */
  getMode(key = "default"): string { return effectiveMode(this.load(), key); }
  /** Sets a scope key's proxy mode. */
  setMode(key: string, mode: string): void { updateProxyStore((s) => { s.modes = s.modes || { default: "disabled" }; s.modes[key] = mode; }); }

  /** Enables or disables a proxy-list source, optionally setting its API key. */
  enableProvider(name: string, on: boolean, key?: string): void {
    updateProxyStore((s) => { s.providers = s.providers || {}; s.providers[name] = { ...(s.providers[name] || {}), enabled: !!on, ...(key !== undefined ? { key } : {}) }; });
  }
  /** Per-source config for every proxy-list source. */
  providersConfig(): ProxyStore["providers"] { return this.load().providers || {}; }

  /** Every proxy, best-first, annotated with score and in-use count for the UI. */
  list(): ScoredProxyEntry[] {
    const store = this.load();
    return scored(store, [...store.proxies]);
  }
  /** Every proxy in a scope, best-first, annotated with score and in-use count. */
  proxiesForScope(key: string): ScoredProxyEntry[] {
    const store = this.load();
    return scored(store, proxiesInScope(store, key));
  }
  /** One proxy by URL, annotated with score and in-use count; `null` if not found. */
  get(url: string): ScoredProxyEntry | null {
    const store = this.load();
    const p = store.proxies.find((x) => x.url === url);
    return p ? { ...p, score: scoreOf(store, p), inUse: countAssignments(store, p.url) } : null;
  }

  /** Adds a hand-entered proxy to the pool, prefixing `http://` when no scheme is given; a no-op if the (normalized) URL is already present. */
  addManual(url: string, scope?: ProxyScope): string {
    const clean = url.startsWith("http") ? url : "http://" + url;
    const sc: ProxyScope = scope?.type ? scope : { type: "global" };
    updateProxyStore((s) => { if (!s.proxies.find((p) => p.url === clean)) s.proxies.push({ url: clean, provider: "manual", scope: sc, addedAt: Date.now(), stats: { checks: 0, failures: 0, avgLatencyMs: 0, ipRateLimitHits: 0, lastOkAt: 0 } }); });
    return clean;
  }
  /** Removes a proxy from the pool and clears any assignments or manual selections pointing at it. */
  remove(url: string): void {
    updateProxyStore((s) => {
      s.proxies = s.proxies.filter((p) => p.url !== url);
      for (const [acc, u] of Object.entries(s.assignments)) if (u === url) delete s.assignments[acc];
      for (const key of Object.keys(s.manualSelection)) s.manualSelection[key] = (s.manualSelection[key] || []).filter((u) => u !== url);
    });
  }

  /** URLs a user picked as candidates for a scope key, when its mode is `"manual"`. */
  getScopeSelection(key: string): string[] { return this.load().manualSelection[key] || []; }
  /** Sets a scope key's manual candidate URLs. */
  setScopeSelection(key: string, urls: string[]): void { updateProxyStore((s) => { s.manualSelection[key] = urls; }); }

  /**
   * Selects a proxy URL for an account, walking account, then provider, then global scope, and
   * falling through on an empty or exhausted scope. Keeps a sticky per-account assignment while
   * it is still usable in some scope in the chain.
   *
   * @returns `null` when no scope in the chain has a candidate
   */
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
      const cands = candidatesForScope(store, key, accountId ?? null);
      if (cands.length) {
        const chosen = cands[0].url;
        if (accountId) updateProxyStore((s) => { s.assignments[accountId] = chosen; });
        return chosen;
      }
    }
    return null;
  }

  /** Selects a proxy URL to use for a login attempt, before an account exists to bind it to. */
  pickForLogin(providerId: string | null): string | null {
    const store = this.load();
    const chain = resolveChain(store, null, providerId);   // no account scope yet
    for (const key of chain) {
      const cands = candidatesForScope(store, key, null);
      if (cands.length) return cands[0].url;
    }
    return null;
  }

  /** Binds an account to a proxy URL after a successful login, registering it as a manual selection when the account's scope mode is `"manual"`. A no-op if `url` is `null`. */
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

  /** Records a rate limit against a proxy, clearing its assignments; a no-op unless the limit was IP-suspected. */
  reportRateLimit(url: string, opts?: ReportRateLimitOpts): void {
    if (!opts || opts.ipSuspected !== true) return;   // only IP-suspected limits reflect proxy quality
    updateProxyStore((s) => {
      const p = s.proxies.find((x) => x.url === url);
      if (p) { p.stats = p.stats || {}; p.stats.ipRateLimitHits = (p.stats.ipRateLimitHits || 0) + 1; p.stats.lastRateLimitAt = Date.now(); }
      for (const [acc, u] of Object.entries(s.assignments)) if (u === url) delete s.assignments[acc];
    });
  }

  /** Records a proxy's success or failure and rolling average latency, feeding its quality score. */
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

  /** Fetches from every enabled proxy-list source and adds any new proxies to the pool. */
  async refresh(): Promise<number> {
    const fetched = await fetchEnabledProxies(this.providersConfig());
    updateProxyStore((s) => {
      const have = new Set(s.proxies.map((p) => p.url));
      for (const f of fetched) if (!have.has(f.url)) { s.proxies.push({ url: f.url, provider: f.provider, scope: { type: "global" }, addedAt: Date.now(), stats: { checks: 0, failures: 0, avgLatencyMs: 0, ipRateLimitHits: 0, lastOkAt: 0 } }); have.add(f.url); }
    });
    return fetched.length;
  }
}

/** The shared {@link ProxyManager} instance every provider and menu uses. */
export const proxyManager = new ProxyManager();
