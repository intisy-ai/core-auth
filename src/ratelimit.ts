// The availability/backoff MATH (isEnabled, isLaneRateLimited, isAvailable, availableAt,
// calculateBackoffMs) is single-sourced in Java (RateLimitMath, accounts) behind
// AccountManager's report*/nextAvailableAt exports; manager.ts delegates to those instead of
// reimplementing this math in TS. isCoolingDown stays here as a thin, stateless host shim: it's a
// pure sync read over an already-loaded account object, used by controller.ts's list-view status
// label (no store I/O, no Java call needed for a single boolean check).
import type { CoreAccount } from "./types.js";

/** Whether an account is within a transient backoff window across all lanes. */
export function isCoolingDown(account: CoreAccount, now: number): boolean {
  return typeof account.coolingDownUntil === "number" && account.coolingDownUntil > now;
}
