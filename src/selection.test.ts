// Frozen-fixture behavior tests for account selection: given this pool + strategy + cursor +
// availability, this account is picked. Selection itself is delegated to CoreAuthJs.acquireAccount
// (Java), so these exercise that exact path over an isolated temp store (never the real
// ~/.claude / ~/.config/opencode) -- a wrong marshaling or a dropped isAvailable seam fails here.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initCoreAuth, getCoreAuth } from "./core-auth-loader.js";
import { createLiveStore, type LiveStoreLike } from "./live-store.js";

// Selection now runs on the real system clock inside the delegated Java call (CoreAuthJs
// pins Clock to System.currentTimeMillis(), not an injectable value), so cooldown fixtures
// must be anchored to the actual current time rather than an arbitrary fixed epoch.
const NOW = Date.now();
const PROVIDER = "test-provider";

function account(id: string, overrides: Record<string, unknown> = {}) {
  return { id, enabled: true, ...overrides };
}

function pool(accounts: ReturnType<typeof account>[], activeIndex = 0, activeIndexByLane: Record<string, number> = {}) {
  return { accounts, activeIndex, activeIndexByLane };
}

let homeDir: string;
let store: LiveStoreLike;

beforeAll(async () => {
  await initCoreAuth();
}, 30000);

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), "core-auth-selection-"));
  store = createLiveStore(homeDir);
});

afterEach(() => {
  rmSync(homeDir, { recursive: true, force: true });
});

function seed(p: ReturnType<typeof pool>) {
  store.put("accounts.json", JSON.stringify({ version: 1, providers: { [PROVIDER]: p } }));
}

function acquire(lane: string | undefined, strategy: string, available?: (accountJson: string, lane: string) => boolean) {
  const raw = getCoreAuth().acquireAccount(PROVIDER, lane || "", strategy, available as any, store as any);
  return JSON.parse(raw);
}

function storedPool() {
  const raw = store.get("accounts.json");
  const doc = raw ? JSON.parse(raw) : { providers: {} };
  return doc.providers[PROVIDER];
}

describe("acquireAccount: sticky", () => {
  it("keeps the cursor while it stays available", () => {
    seed(pool([account("a"), account("b"), account("c")], 1));
    expect(acquire(undefined, "sticky").accountId).toBe("b");
  });

  it("moves off the cursor once it becomes unavailable", () => {
    seed(pool([account("a"), account("b", { enabled: false }), account("c")], 1));
    expect(acquire(undefined, "sticky").accountId).toBe("c");
  });

  it("reports none when every account is unavailable", () => {
    seed(pool([account("a", { enabled: false }), account("b", { enabled: false })], 0));
    expect(acquire(undefined, "sticky").none).toBe(true);
  });
});

describe("acquireAccount: round-robin", () => {
  it("advances past the cursor on every call, wrapping around the pool", () => {
    seed(pool([account("a"), account("b"), account("c")], 0));
    expect(acquire(undefined, "round-robin").accountId).toBe("b");
    expect(acquire(undefined, "round-robin").accountId).toBe("c");
    expect(acquire(undefined, "round-robin").accountId).toBe("a");
  });

  it("skips a disabled account while advancing", () => {
    seed(pool([account("a"), account("b", { enabled: false }), account("c")], 0));
    expect(acquire(undefined, "round-robin").accountId).toBe("c");
  });
});

describe("acquireAccount: hybrid", () => {
  it("prefers the sticky cursor, like sticky, when it is available", () => {
    seed(pool([account("a"), account("b"), account("c")], 2));
    expect(acquire(undefined, "hybrid").accountId).toBe("c");
  });

  it("falls back to the soonest-free account as a last resort when nobody is currently available", () => {
    seed(
      pool(
        [
          account("a", { coolingDownUntil: NOW + 5000 }),
          account("b", { coolingDownUntil: NOW + 1000 }),
          account("c", { coolingDownUntil: NOW + 9000 }),
        ],
        0,
      ),
    );
    expect(acquire(undefined, "hybrid").accountId).toBe("b");
  });
});

describe("acquireAccount: per-lane cursor", () => {
  it("tracks a separate cursor per lane instead of the pool's default activeIndex", () => {
    seed(pool([account("a"), account("b"), account("c")], 0, { fast: 2 }));
    expect(acquire("fast", "sticky").accountId).toBe("c");
    seed(pool([account("a"), account("b"), account("c")], 0, { fast: 2 }));
    expect(acquire("slow", "sticky").accountId).toBe("a");
  });

  it("writes the advanced round-robin index back onto the lane's own cursor, not the default", () => {
    seed(pool([account("a"), account("b"), account("c")], 0, { fast: 0 }));
    acquire("fast", "round-robin");
    const p = storedPool();
    expect(p.activeIndexByLane.fast).toBe(1);
    expect(p.activeIndex).toBe(0);
  });
});

describe("acquireAccount: caller-supplied availability predicate (the isAvailable extension seam)", () => {
  it("skips an account the predicate rejects even though the built-in availability check would accept it", () => {
    seed(pool([account("a"), account("b"), account("c")], 0));
    const skipB = (accountJson: string) => JSON.parse(accountJson).id !== "b";
    expect(acquire(undefined, "round-robin", skipB).accountId).toBe("c");
  });

  it("reports none for round-robin/sticky when the predicate rejects every account", () => {
    seed(pool([account("a"), account("b")], 0));
    const rejectAll = () => false;
    expect(acquire(undefined, "round-robin", rejectAll).none).toBe(true);
  });

  it("skips an account pending verification, matching antigravity's isAvailable gate, with meta surviving the Java round trip", () => {
    seed(pool([account("a"), account("b", { meta: { verificationRequired: true } }), account("c")], 0));
    const skipPendingVerification = (accountJson: string) => {
      const acc = JSON.parse(accountJson);
      return !(acc.meta && acc.meta.verificationRequired);
    };
    expect(acquire(undefined, "round-robin", skipPendingVerification).accountId).toBe("c");
  });
});
