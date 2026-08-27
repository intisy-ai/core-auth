// Turns an AccountManager into an AccountController so providers don't re-implement list/enable/remove; the provider supplies status/quota/detail/login.

import { isCoolingDown } from "./ratelimit.js";
import type { AccountController, AccountQuota, AccountStatus, AccountView, CoreAccount, MenuAction } from "./types.js";

function out(message: string): void { process.stdout.write(message + "\n"); }

function defaultStatus(account: CoreAccount, now: number): AccountStatus {
  if (account.enabled === false) return "disabled";
  if (isCoolingDown(account, now)) return "cooling-down";
  const lanes = account.rateLimitResetTimes || {};
  if (Object.values(lanes).some((reset) => typeof reset === "number" && reset > now)) return "rate-limited";
  return "active";
}

// soonest epoch ms this account is usable again across ALL lanes (cooldown + every
// per-lane rate-limit reset); `now` when already free, Infinity when disabled.
function soonestAvailable(account: CoreAccount, now: number): number {
  if (account.enabled === false) return Infinity;
  let t = now;
  if (typeof account.coolingDownUntil === "number") t = Math.max(t, account.coolingDownUntil);
  const lanes = account.rateLimitResetTimes || {};
  for (const reset of Object.values(lanes)) if (typeof reset === "number") t = Math.max(t, reset);
  return t;
}

/** The minimal AccountManager surface accountControllerFromManager needs, so this module never depends on manager.ts. */
export interface AccountManagerLike {
  list(): CoreAccount[];
  mutate(id: string, fn: (account: CoreAccount) => void): void;
  remove(id: string): void;
  refresh(id: string): Promise<boolean>;
}

/** An AccountView plus the availableAt signal the shared menu model reads for "free in Xm" hints. */
export interface AccountControllerView extends AccountView {
  availableAt: number;
}

/**
 * @remarks
 * `refreshQuotaOne` renders as a per-account "Refresh quota" action; `AccountController` (types.ts)
 * does not declare it, so it is added here rather than force-fit into that interface.
 */
export interface AccountControllerImpl extends AccountController {
  list(): AccountControllerView[];
  refreshQuotaOne?(id: string): Promise<void>;
}

export interface AccountControllerOptions {
  status?: (account: CoreAccount, now: number) => AccountStatus;
  detail?: (account: CoreAccount, now: number) => string | undefined;
  quota?: (account: CoreAccount) => AccountQuota[] | undefined;
  // availableAt lets a provider report usability from its own signal (e.g. quota pools) instead of
  // the generic per-lane backoff, since a single transient lane limit shouldn't read as "the whole
  // account is down" when other lanes still serve.
  availableAt?: (account: CoreAccount, now: number) => number;
  login?: () => Promise<AccountView | null>;
  refreshQuota?: () => Promise<void>;
  refreshQuotaOne?: (id: string) => Promise<void>;
  actions?: () => MenuAction[];
  accountActions?: (view: AccountView) => MenuAction[];
}

export function accountControllerFromManager(manager: AccountManagerLike, opts?: AccountControllerOptions): AccountControllerImpl {
  const options = opts || {};
  return {
    list(): AccountControllerView[] {
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
    enable(id: string, on: boolean): void { manager.mutate(id, (account) => { account.enabled = !!on; if (on) account.disabledReason = null; }); },
    remove(id: string): void { manager.remove(id); },
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
export async function refreshAccountToken(manager: AccountManagerLike, view: Pick<CoreAccount, "id" | "email">): Promise<void> {
  const name = view.email || view.id;
  try {
    out((await manager.refresh(view.id)) ? "✓ refreshed " + name : "✗ no OAuth config / refresh token for " + name);
  } catch (error) {
    out("✗ refresh failed for " + name + ": " + (error instanceof Error ? error.message : String(error)));
  }
}

// Verify every enabled account, skipping disabled ones, then print a summary. The
// actual ping is provider-specific (each provider hits its own upstream endpoint),
// so it is injected as `verify`; this owns the shared loop/skip/summary shape.
export async function verifyAllAccounts(
  manager: AccountManagerLike,
  verify: (manager: AccountManagerLike, account: Pick<CoreAccount, "id" | "email">) => Promise<void>,
): Promise<void> {
  for (const account of manager.list()) {
    if (account.enabled === false) { out("- " + (account.email || account.id) + ": skipped (disabled)"); continue; }
    await verify(manager, { id: account.id, email: account.email });
  }
  out("Done.");
}
