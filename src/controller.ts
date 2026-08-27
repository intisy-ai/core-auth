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
  /** Every stored account. */
  list(): CoreAccount[];
  /** Atomic read-modify-write on one account. */
  mutate(id: string, fn: (account: CoreAccount) => void): void;
  /** Removes an account by id. */
  remove(id: string): void;
  /** Forces a token refresh; resolves `false` when the account cannot be refreshed. */
  refresh(id: string): Promise<boolean>;
}

/** Provider hooks {@link accountControllerFromManager} layers onto a generic AccountManager. */
export interface AccountControllerOptions {
  /** Computes an account's selection eligibility; defaults to the generic enabled/cooldown/rate-limit rules. */
  status?: (account: CoreAccount, now: number) => AccountStatus;
  /** Computes a human-readable status note for an account. */
  detail?: (account: CoreAccount, now: number) => string | undefined;
  /** Computes an account's quota readings. */
  quota?: (account: CoreAccount) => AccountQuota[] | undefined;
  /** Reports usability from the provider's own signal (e.g. quota pools) instead of the generic per-lane backoff, since a single transient lane limit shouldn't read as "the whole account is down" when other lanes still serve. */
  availableAt?: (account: CoreAccount, now: number) => number;
  /** Runs the provider's login flow. */
  login?: () => Promise<AccountView | null>;
  /** Refreshes quota for every account. */
  refreshQuota?: () => Promise<void>;
  /** Refreshes quota for one account. */
  refreshQuotaOne?: (id: string) => Promise<void>;
  /** Extra top-level menu items. */
  actions?: () => MenuAction[];
  /** Extra per-account menu items. */
  accountActions?: (view: AccountView) => MenuAction[];
}

/** Builds an {@link AccountController} from a generic AccountManager, so a provider need only supply its status/quota/detail/login hooks rather than re-implement list/enable/remove. */
export function accountControllerFromManager(manager: AccountManagerLike, opts?: AccountControllerOptions): AccountController {
  const options = opts || {};
  return {
    list(): AccountView[] {
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

/**
 * Refreshes one account's OAuth token via the manager and prints success/failure.
 *
 * @remarks Fully generic (`manager.refresh()` already encapsulates the OAuth refresh call), so unlike {@link verifyAllAccounts} this needs no provider-specific hook.
 */
export async function refreshAccountToken(manager: AccountManagerLike, view: Pick<CoreAccount, "id" | "email">): Promise<void> {
  const name = view.email || view.id;
  try {
    out((await manager.refresh(view.id)) ? "✓ refreshed " + name : "✗ no OAuth config / refresh token for " + name);
  } catch (error) {
    out("✗ refresh failed for " + name + ": " + (error instanceof Error ? error.message : String(error)));
  }
}

/**
 * Verifies every enabled account, skipping disabled ones, then prints a summary.
 *
 * @param verify the provider-specific ping against its own upstream endpoint; this owns only the shared loop/skip/summary shape
 */
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
