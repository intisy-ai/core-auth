// Quality scoring for the configured proxies a provider can route an account through. The maths is
// single-sourced in Java (ProxyScoring, accounts/proxy) behind CoreAuthJs's proxy* exports; what
// stays here is the export surface consumers already import.
import { getCoreAuth } from "../core-auth-loader.js";
import type { ProxyEntry, ProxyStore } from "./store.js";

const LIMITS = JSON.parse(getCoreAuth().proxyLimits());

/** How many accounts may share one proxy before selection stops assigning more to it. */
export const MAX_ACCOUNTS_PER_PROXY = LIMITS.maxAccountsPerProxy;
/** How long a proxy is treated as IP-rate-limited after upstream reports one. */
export const IP_LIMIT_COOLDOWN_MS = LIMITS.ipLimitCooldownMs;

/** How many live assignments a proxy currently has, in a store. */
export function countAssignments(store: ProxyStore, url: string): number {
  return getCoreAuth().proxyCountAssignments(JSON.stringify(store || {}), url);
}

/** A proxy's quality score within a store, lower meaning more preferred by selection. */
export function scoreOf(store: ProxyStore, proxy: ProxyEntry): number {
  return getCoreAuth().proxyScoreOf(JSON.stringify(store || {}), JSON.stringify(proxy || {}));
}

/** Human-readable quality label for a proxy, e.g. for a menu row. */
export function qualityLabel(proxy: ProxyEntry): string {
  return getCoreAuth().proxyQualityLabel(JSON.stringify(proxy || {}));
}

/** Whether a proxy is currently within its {@link IP_LIMIT_COOLDOWN_MS} window after an IP rate limit. */
export function isIpLimited(proxy: ProxyEntry, now: number = Date.now()): boolean {
  return getCoreAuth().proxyIsIpLimited(JSON.stringify(proxy || {}), now);
}
