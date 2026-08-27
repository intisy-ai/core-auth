// Quality scoring for the configured proxies a provider can route an account through. The maths is
// single-sourced in Java (ProxyScoring, accounts/proxy) behind CoreAuthJs's proxy* exports; what
// stays here is the export surface consumers already import.
import { getCoreAuth } from "../core-auth-loader.js";

const LIMITS = JSON.parse(getCoreAuth().proxyLimits());

export const MAX_ACCOUNTS_PER_PROXY = LIMITS.maxAccountsPerProxy;
export const IP_LIMIT_COOLDOWN_MS = LIMITS.ipLimitCooldownMs;

export function countAssignments(store: unknown, url: string): number {
  return getCoreAuth().proxyCountAssignments(JSON.stringify(store || {}), url);
}

export function scoreOf(store: unknown, proxy: unknown): number {
  return getCoreAuth().proxyScoreOf(JSON.stringify(store || {}), JSON.stringify(proxy || {}));
}

export function qualityLabel(proxy: unknown): string {
  return getCoreAuth().proxyQualityLabel(JSON.stringify(proxy || {}));
}

export function isIpLimited(proxy: unknown, now: number = Date.now()): boolean {
  return getCoreAuth().proxyIsIpLimited(JSON.stringify(proxy || {}), now);
}
