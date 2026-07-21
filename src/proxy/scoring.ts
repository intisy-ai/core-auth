// @ts-nocheck
export const MAX_ACCOUNTS_PER_PROXY = 3;
export const IP_LIMIT_COOLDOWN_MS = 5 * 60 * 1000;

export function countAssignments(store, url) {
  return Object.values(store.assignments || {}).filter((u) => u === url).length;
}

// lower is better; IP-rate-limit hits dominate (they reflect a burned exit IP)
export function scoreOf(store, proxy) {
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

// coarse UI quality from the same components (independent of assignment count)
export function qualityLabel(proxy) {
  const s = proxy.stats || {};
  const checks = s.checks || 0;
  const failRate = checks ? (s.failures || 0) / checks : 0.5;
  const q = (s.avgLatencyMs || 2000) / 1000 + failRate * 10 + (s.ipRateLimitHits || 0) * 20;
  if (q < 3) return "good";
  if (q < 12) return "fair";
  return "poor";
}

export function isIpLimited(proxy, now = Date.now()) {
  const at = proxy.stats && proxy.stats.lastRateLimitAt;
  return typeof at === "number" && now - at < IP_LIMIT_COOLDOWN_MS;
}
