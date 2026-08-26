// Frozen-fixture behavior tests for the report*/nextAvailableAt STATE TRANSITIONS: given this
// pool + a reported rate-limit/error/success, this account is/isn't available, and the reset
// correctly persists onto the same accounts.json a later acquire() reads. All four AccountManager
// methods under test (reportRateLimit/reportError/reportSuccess/nextAvailableAt) are delegated to
// CoreAuthJs (Java) over a live JsStore bridge, so this exercises that exact path over an isolated
// temp store (never the real ~/.claude / ~/.config/opencode).
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initCoreAuth } from "./core-auth-loader.js";
import { createLiveStore, type LiveStoreLike } from "./live-store.js";
import { AccountManager } from "./manager.js";
import { setActivityEmitter } from "./activity.js";

const PROVIDER = "test-provider-report";

function account(id: string, overrides: Record<string, unknown> = {}) {
  return { id, enabled: true, ...overrides };
}

function pool(accounts: ReturnType<typeof account>[], activeIndex = 0, activeIndexByLane: Record<string, number> = {}) {
  return { accounts, activeIndex, activeIndexByLane };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let homeDir: string;
let store: LiveStoreLike;

beforeAll(async () => {
  await initCoreAuth();
}, 30000);

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), "core-auth-manager-"));
  // dirOverride === configDir so the store lands directly at homeDir/accounts.json, matching
  // AccountManager's own `createLiveStore(getConfigDir(), this.store.dir)` when `store: { dir: homeDir }`.
  store = createLiveStore(homeDir, homeDir);
});

afterEach(() => {
  rmSync(homeDir, { recursive: true, force: true });
});

function seed(p: ReturnType<typeof pool>) {
  store.put("accounts.json", JSON.stringify({ version: 1, providers: { [PROVIDER]: p } }));
}

function storedPool() {
  const raw = store.get("accounts.json");
  const doc = raw ? JSON.parse(raw) : { providers: {} };
  return doc.providers[PROVIDER];
}

function manager(opts: Record<string, unknown> = {}) {
  return new AccountManager(PROVIDER, { store: { dir: homeDir }, ...opts });
}

describe("reportRateLimit activity", () => {
  it("records the rate limit as a failed attempt against that account", async () => {
    const seen: any[] = [];
    setActivityEmitter((spec: any) => seen.push(spec));
    try {
      seed(pool([account("a")], 0));
      const mgr = manager({ selection: "sticky" });
      await mgr.acquire("chat");

      const resetAt = Date.now() + 60_000;
      mgr.reportRateLimit("a", "chat", resetAt);

      const rec = seen.find((spec) => spec.action === "rate_limited");
      expect(rec.outcome).toBe("failed");
      expect(rec.impact).toBe("warning");
      expect(rec.subject.id).toBe("a");
      expect(rec.details.resetAt).toBe(resetAt);
    } finally {
      setActivityEmitter(null);
    }
  });
});

describe("reportRateLimit: acquire -> rate-limit -> rotate -> recover", () => {
  it("makes the reported account unavailable for that lane until its reset passes, and a later acquire sees it again", async () => {
    const lane = "chat";
    seed(pool([account("a"), account("b")], 0));
    const mgr = manager({ selection: "sticky" });

    const first = await mgr.acquire(lane);
    expect(first.account.id).toBe("a");

    const resetAt = Date.now() + 150;
    mgr.reportRateLimit("a", lane, resetAt);

    // persisted onto the store, not just in memory: rateLimitResetTimes.chat is set
    expect(storedPool().accounts.find((x: any) => x.id === "a").rateLimitResetTimes.chat).toBe(resetAt);

    const second = await mgr.acquire(lane);
    expect(second.account.id).toBe("b");

    // manually move the lane cursor back onto "a" to isolate the recovery check from
    // sticky/round-robin rotation mechanics (already covered by selection.test.ts) -- this
    // fixture is about the rate-limit reset expiring, not about cursor movement.
    const p = storedPool();
    p.activeIndexByLane[lane] = 0;
    store.put("accounts.json", JSON.stringify({ version: 1, providers: { [PROVIDER]: p } }));

    await sleep(250);
    const third = await mgr.acquire(lane);
    expect(third.account.id).toBe("a");
  });
});

describe("reportError -> reportSuccess: cooldown lifecycle", () => {
  it("reportError sets a coolingDownUntil in the future using the manager's OWN backoff config, and makes the account unavailable", async () => {
    const lane = "chat";
    seed(pool([account("a"), account("b")], 0));
    // Long enough that the assertions below cannot outrun the cooldown they are checking, and far
    // enough from the built-in 1s first attempt to prove the manager's own config is what applied.
    const mgr = manager({ selection: "sticky", backoff: { baseMs: 7000, maxMs: 7000 } });

    const before = Date.now();
    mgr.reportError("a", lane, 0, "boom");
    // Bounded against the clock AFTER the call, not a fixed slack on the clock before it: the
    // cooldown is stamped somewhere inside the call, and a loaded runner can spend longer in it
    // than any slack worth hard-coding.
    const after = Date.now();
    const a = mgr.list().find((x) => x.id === "a");
    expect(a.coolingDownUntil).toBeGreaterThan(before + 1000);
    expect(a.coolingDownUntil).toBeLessThanOrEqual(after + 7000);
    expect(a.cooldownReason).toBe("boom");

    const claimed = await mgr.acquire(lane);
    expect(claimed.account.id).toBe("b");
  });

  it("reportSuccess clears coolingDownUntil/cooldownReason and bumps lastUsed, restoring availability", async () => {
    const lane = "chat";
    seed(pool([account("a", { coolingDownUntil: Date.now() + 60000, cooldownReason: "boom" }), account("b")], 0));
    const mgr = manager({ selection: "sticky" });

    mgr.reportSuccess("a");
    const a = mgr.list().find((x) => x.id === "a");
    expect(a.coolingDownUntil).toBe(0);
    // AccountStore's wire format omits null fields entirely (rather than persisting an explicit
    // null), so a cleared cooldownReason reads back as undefined, not null -- harmless, since
    // the field is typed `string | null` (both falsy) and no consumer does a strict null check.
    expect(a.cooldownReason).toBeFalsy();
    expect(a.lastUsed).toBeGreaterThan(0);

    const claimed = await mgr.acquire(lane);
    expect(claimed.account.id).toBe("a");
  });

  it("falls back to AccountManager's default 1s/5min backoff when the driver configured none", async () => {
    seed(pool([account("a")], 0));
    const mgr = manager();
    const before = Date.now();
    mgr.reportError("a", undefined, 0, undefined); // no known lane: the safe "cools down normally" default
    const a = mgr.list().find((x) => x.id === "a");
    expect(a.cooldownReason).toBe("transient error");
    // attempt 0, base 1000ms, jittered to somewhere in [500, 1000)ms
    expect(a.coolingDownUntil).toBeGreaterThanOrEqual(before + 400);
    expect(a.coolingDownUntil).toBeLessThanOrEqual(before + 1050);
  });
});

describe("reportError yields to an active provider reset (F4: one owner of usable-again)", () => {
  it("same lane: does not set coolingDownUntil while THIS lane's provider-supplied reset is active, and the account recovers once that reset passes (not gated by a separate core backoff)", async () => {
    const lane = "chat";
    seed(pool([account("a"), account("b")], 0));
    const mgr = manager({ selection: "sticky", backoff: { baseMs: 50, maxMs: 50 } });

    const resetAt = Date.now() + 150;
    mgr.reportRateLimit("a", lane, resetAt);
    mgr.reportError("a", lane, 0, "boom"); // same lane as the active reset

    const a = mgr.list().find((x) => x.id === "a");
    expect(a.coolingDownUntil).toBeFalsy(); // core's generic backoff yielded to the provider reset
    expect(a.rateLimitResetTimes.chat).toBe(resetAt);

    // gated by exactly the provider reset while it's active
    const duringReset = await mgr.acquire(lane);
    expect(duringReset.account.id).toBe("b");

    await sleep(200);
    const p = storedPool();
    p.activeIndexByLane[lane] = 0;
    store.put("accounts.json", JSON.stringify({ version: 1, providers: { [PROVIDER]: p } }));

    // available again once the reset passes, not still cooling from a second, independently
    // computed core backoff
    const afterReset = await mgr.acquire(lane);
    expect(afterReset.account.id).toBe("a");
  });

  it("cross lane: an unrelated lane's active reset does NOT suppress this lane's cooldown (would otherwise hot-loop with zero backoff)", async () => {
    seed(pool([account("a")], 0));
    const mgr = manager({ selection: "sticky", backoff: { baseMs: 50, maxMs: 50 } });

    mgr.reportRateLimit("a", "gemini-pro", Date.now() + 60_000); // a DIFFERENT lane's active reset

    const before = Date.now();
    mgr.reportError("a", "gemini-flash", 0, "boom"); // this lane has no reset of its own

    const a = mgr.list().find((x) => x.id === "a");
    // must still cool down via core's own backoff: an unrelated lane's reset must never make a
    // genuinely erroring lane immediately re-selectable with zero backoff
    expect(a.coolingDownUntil).toBeGreaterThan(before);
    expect(a.coolingDownUntil).toBeLessThanOrEqual(before + 60);
    expect(a.cooldownReason).toBe("boom");
    expect(a.rateLimitResetTimes["gemini-pro"]).toBeGreaterThan(before); // untouched by reportError
  });
});

describe("nextAvailableAt", () => {
  it("returns the soonest epoch-ms across the pool, not just one account's", async () => {
    const now = Date.now();
    seed(pool([account("a", { coolingDownUntil: now + 5000 }), account("b", { coolingDownUntil: now + 2000 })]));
    const mgr = manager();
    const next = mgr.nextAvailableAt("chat");
    expect(next).toBeGreaterThanOrEqual(now + 2000 - 100);
    expect(next).toBeLessThanOrEqual(now + 2000 + 200);
  });

  it("returns null (a real JS null, not the truthy string \"null\") when every account is disabled", async () => {
    seed(pool([account("a", { enabled: false }), account("b", { enabled: false })]));
    const mgr = manager();
    const next = mgr.nextAvailableAt("chat");
    expect(next).toBeNull();
  });
});
