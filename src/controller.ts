// @ts-nocheck
// Turns an AccountManager into an AccountController so providers don't re-implement list/enable/remove; the provider supplies status/quota/detail/login.

import { isCoolingDown } from "./ratelimit.js";

function out(message) { process.stdout.write(message + "\n"); }

function defaultStatus(account, now) {
  if (account.enabled === false) return "disabled";
  if (isCoolingDown(account, now)) return "cooling-down";
  const lanes = account.rateLimitResetTimes || {};
  if (Object.values(lanes).some((reset) => typeof reset === "number" && reset > now)) return "rate-limited";
  return "active";
}

// soonest epoch ms this account is usable again across ALL lanes (cooldown + every
// per-lane rate-limit reset); `now` when already free, Infinity when disabled.
function soonestAvailable(account, now) {
  if (account.enabled === false) return Infinity;
  let t = now;
  if (typeof account.coolingDownUntil === "number") t = Math.max(t, account.coolingDownUntil);
  const lanes = account.rateLimitResetTimes || {};
  for (const reset of Object.values(lanes)) if (typeof reset === "number") t = Math.max(t, reset);
  return t;
}

// opts: { status?(account,now), detail?(account,now), quota?(account), availableAt?(account,now), login(), refreshQuota?(), refreshQuotaOne?(id) }
// availableAt lets a provider report usability from its own signal (e.g. quota
// pools) instead of the generic per-lane backoff, since a single transient lane limit
// shouldn't read as "the whole account is down" when other lanes still serve.
export function accountControllerFromManager(manager, opts) {
  const options = opts || {};
  return {
    list() {
      const now = Date.now();
      return manager.list().map((account) => ({
        id: account.id,
        email: account.email,
        enabled: account.enabled !== false,
        lastUsed: account.lastUsed,
        status: options.status ? options.status(account, now) : defaultStatus(account, now),
        detail: options.detail ? options.detail(account, now) : undefined,
        quota: options.quota ? options.quota(account) : undefined,
        availableAt: options.availableAt ? options.availableAt(account, now) : soonestAvailable(account, now),
      }));
    },
    enable(id, on) { manager.mutate(id, (account) => { account.enabled = !!on; if (on) account.disabledReason = null; }); },
    remove(id) { manager.remove(id); },
    login: options.login || (async () => null),
    refreshQuota: options.refreshQuota,
    refreshQuotaOne: options.refreshQuotaOne,   // per-account refresh; renders as a core account-detail action
    actions: options.actions,
    accountActions: options.accountActions,
  };
}

// Refresh one account's OAuth token via the manager and report success/failure.
// Fully generic (manager.refresh() already encapsulates the OAuth refresh call),
// so unlike verifyAllAccounts this needs no provider-specific hook.
export async function refreshAccountToken(manager, view) {
  const name = view.email || view.id;
  try {
    out((await manager.refresh(view.id)) ? "✓ refreshed " + name : "✗ no OAuth config / refresh token for " + name);
  } catch (error) {
    out("✗ refresh failed for " + name + ": " + ((error && error.message) || error));
  }
}

// Verify every enabled account, skipping disabled ones, then print a summary. The
// actual ping is provider-specific (each provider hits its own upstream endpoint),
// so it is injected as `verify`; this owns the shared loop/skip/summary shape.
export async function verifyAllAccounts(manager, verify) {
  for (const account of manager.list()) {
    if (account.enabled === false) { out("- " + (account.email || account.id) + ": skipped (disabled)"); continue; }
    await verify(manager, { id: account.id, email: account.email });
  }
  out("Done.");
}
