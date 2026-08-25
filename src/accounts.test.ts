// Regression tests for withLock's fail-closed contract (see store-lock.ts): when the lock
// cannot be acquired, withLock must throw (LockTimeoutError) rather than run `fn()`
// unlocked. Running `fn()` unlocked would let two writers racing the same store both
// read-modify-write accounts.json, with the second `renameSync` silently clobbering the
// first (a lost update).
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, existsSync, statSync, readFileSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { loadAccounts, saveAccounts, updateAccounts, addAccount, removeAccount, LockTimeoutError } from "./accounts.js";
import { setActivityEmitter } from "./activity.js";

const pkgRoot = fileURLToPath(new URL("..", import.meta.url));
const distAccounts = join(pkgRoot, "dist", "accounts.js");
const srcAccounts = join(pkgRoot, "src", "accounts.ts");
const workerUrl = new URL("./accounts.lock-worker.mjs", import.meta.url);
const holdWorkerUrl = new URL("./accounts.lock-hold-worker.mjs", import.meta.url);
const contendWorkerUrl = new URL("./accounts.lock-contend-worker.mjs", import.meta.url);

// LOCK_WAIT_MS in store-lock.ts -- kept in sync manually since it isn't exported. The
// held-lock cross-thread test below must hold the lock for longer than this so the
// contender genuinely times out rather than racing a lock that's released early.
const LOCK_WAIT_MS = 5000;

// The cross-thread concurrency test below runs a real worker_thread against the BUILT
// dist/accounts.js (worker_threads can't run vitest's on-the-fly TS transform) so it
// exercises the exact code that ships. Rebuild first if dist is missing or stale.
beforeAll(() => {
  const stale = !existsSync(distAccounts) || statSync(distAccounts).mtimeMs < statSync(srcAccounts).mtimeMs;
  if (stale) execSync("npx tsc", { cwd: pkgRoot, stdio: "inherit" });
}, 60000);

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "core-auth-accounts-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("withLock fail-closed", () => {
  it("held lock: updateAccounts throws LockTimeoutError instead of writing unlocked", () => {
    saveAccounts("p", { accounts: [{ id: "seed" }], activeIndex: 0, activeIndexByLane: {} }, { dir });

    // Simulate another process holding the lock: create the lock file with a FRESH
    // mtime so it isn't reclaimed as stale.
    mkdirSync(dir, { recursive: true });
    const lockPath = join(dir, "accounts.json.lock");
    writeFileSync(lockPath, "");

    try {
      expect(() =>
        updateAccounts("p", (pool) => { pool.accounts.push({ id: "intruder" }); }, { dir }),
      ).toThrow(LockTimeoutError);

      // fn() must never have run: the on-disk store is untouched.
      const raw = JSON.parse(readFileSync(join(dir, "accounts.json"), "utf8"));
      expect(raw.providers.p.accounts.map((a: any) => a.id)).toEqual(["seed"]);
    } finally {
      rmSync(lockPath, { force: true });
    }
  }, 8000);

  it("stale lock (older than the staleness threshold) is reclaimed, not treated as a timeout", () => {
    const lockPath = join(dir, "accounts.json.lock");
    mkdirSync(dir, { recursive: true });
    writeFileSync(lockPath, "");
    const old = new Date(Date.now() - 60 * 1000); // well past LOCK_STALE_MS (15s)
    utimesSync(lockPath, old, old);

    expect(() =>
      updateAccounts("p", (pool) => { pool.accounts.push({ id: "reclaimed" }); }, { dir }),
    ).not.toThrow();
    const pool = loadAccounts("p", { dir });
    expect(pool.accounts.map((a: any) => a.id)).toEqual(["reclaimed"]);
  });

  it("happy path (lock free) is unchanged: sequential updateAccounts calls both land", () => {
    updateAccounts("p", (pool) => { pool.accounts.push({ id: "a" }); }, { dir });
    updateAccounts("p", (pool) => { pool.accounts.push({ id: "b" }); }, { dir });
    const pool = loadAccounts("p", { dir });
    expect(pool.accounts.map((a: any) => a.id).sort()).toEqual(["a", "b"]);
  });
});

describe("cross-thread concurrency", () => {
  function runWorker(workerDir: string, id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(workerUrl, { workerData: { dir: workerDir, id } });
      worker.once("message", () => { worker.terminate(); resolve(); });
      worker.once("error", (err) => { worker.terminate(); reject(err); });
    });
  }

  // Happy path only: both writers hit an unlocked/quickly-released lock, so neither
  // waits anywhere near LOCK_WAIT_MS. This alone does not exercise the fail-closed
  // guarantee -- see the held-lock test below for the genuine regression guard on
  // the timeout->fail-closed path.
  it("two fast concurrent updateAccounts on the same provider both land (no timeout involved)", async () => {
    await Promise.all([runWorker(dir, "worker-a"), runWorker(dir, "worker-b")]);
    const pool = loadAccounts("lock-test-provider", { dir });
    expect(pool.accounts.map((a: any) => a.id).sort()).toEqual(["worker-a", "worker-b"]);
  }, 20000);

  // The genuine regression guard: one real OS thread holds the store's lock file past
  // LOCK_WAIT_MS while a second thread concurrently attempts updateAccounts on the SAME
  // store. withLock must fail closed here: throw LockTimeoutError and leave the on-disk
  // store untouched, never run fn() unlocked and silently write "contender" alongside
  // "seed".
  it("lock held by another thread past LOCK_WAIT_MS: a concurrent updateAccounts throws LockTimeoutError instead of degrading to unlocked", async () => {
    saveAccounts("lock-test-provider", { accounts: [{ id: "seed" }], activeIndex: 0, activeIndexByLane: {} }, { dir });

    const holdMs = LOCK_WAIT_MS + 2000;
    const holder = new Worker(holdWorkerUrl, { workerData: { dir, holdMs } });

    // Wait for the holder to confirm it actually holds the lock before starting the
    // contender -- deterministic sequencing instead of a timing-based guess.
    const lockedMsg = await new Promise<any>((resolve, reject) => {
      holder.once("message", resolve);
      holder.once("error", reject);
    });
    expect(lockedMsg.locked).toBe(true);

    const contender = new Worker(contendWorkerUrl, { workerData: { dir } });
    const result = await new Promise<any>((resolve, reject) => {
      contender.once("message", resolve);
      contender.once("error", reject);
    });
    await contender.terminate();

    expect(result.ok).toBe(false);
    expect(result.name).toBe("LockTimeoutError");

    // Let the holder finish releasing the lock and clean it up.
    const releasedMsg = await new Promise<any>((resolve, reject) => {
      holder.once("message", resolve);
      holder.once("error", reject);
    });
    expect(releasedMsg.released).toBe(true);
    await holder.terminate();

    // fn() must never have run unlocked: the seed write is untouched, no "contender".
    const pool = loadAccounts("lock-test-provider", { dir });
    expect(pool.accounts.map((a: any) => a.id)).toEqual(["seed"]);
  }, 20000);
});

describe("activity emit", () => {
  afterEach(() => setActivityEmitter(null));

  it("emits account_added when an account is stored", () => {
    const seen: any[] = [];
    setActivityEmitter((spec: any, source: any) => seen.push({ spec, source }));

    addAccount("activity-provider", { id: "user@example.com", email: "user@example.com", refresh: "r" }, { dir });

    expect(loadAccounts("activity-provider", { dir }).accounts.map((a: any) => a.id)).toEqual(["user@example.com"]);
    const added = seen.find((s) => s.spec.action === "account_added");
    expect(added).toBeDefined();
    expect(added.source).toBe("activity-provider");
    expect(added.spec.subject).toEqual({ kind: "account", id: "user@example.com", label: "user@example.com" });
    expect(added.spec.details).toEqual({ provider: "activity-provider" });
  });

  it("records an add once, an update only on a real change, and nothing for a no-op", () => {
    const opts = { dir };
    const seen: any[] = [];
    setActivityEmitter((spec: any) => seen.push(spec));

    addAccount("p", { id: "a1", email: "a@b.c", refresh: "r1" }, opts);
    addAccount("p", { id: "a1", email: "a@b.c", refresh: "r1" }, opts); // identical upsert
    addAccount("p", { id: "a1", email: "a@b.c", refresh: "r2" }, opts); // real change

    expect(seen.map((s) => s.action)).toEqual(["account_added", "account_updated"]);
    expect(seen[0].outcome).toBe("ok");
  });

  it("records a removal only when the account was there", () => {
    const opts = { dir };
    const seen: any[] = [];
    addAccount("p", { id: "a1", email: "a@b.c" }, opts);
    setActivityEmitter((spec: any) => seen.push(spec));

    removeAccount("p", "nope", opts);
    removeAccount("p", "a1", opts);

    expect(seen.map((s) => s.action)).toEqual(["account_removed"]);
  });

  it("re-upserting an object-valued field with the same content in a different key order emits nothing", () => {
    const opts = { dir };
    const seen: any[] = [];
    addAccount("p", { id: "a1", email: "a@b.c", meta: { a: 1, b: 2 } }, opts);
    setActivityEmitter((spec: any) => seen.push(spec));

    addAccount("p", { id: "a1", email: "a@b.c", meta: { b: 2, a: 1 } }, opts);

    expect(seen).toEqual([]);
  });

  it("re-upserting an object-valued field with genuinely different content emits one account_updated", () => {
    const opts = { dir };
    const seen: any[] = [];
    addAccount("p", { id: "a1", email: "a@b.c", meta: { a: 1, b: 2 } }, opts);
    setActivityEmitter((spec: any) => seen.push(spec));

    addAccount("p", { id: "a1", email: "a@b.c", meta: { a: 1, b: 3 } }, opts);

    expect(seen.map((s) => s.action)).toEqual(["account_updated"]);
  });

  it("same content with reordered keys two levels deep emits nothing", () => {
    const opts = { dir };
    const seen: any[] = [];
    addAccount("p", { id: "a1", email: "a@b.c", meta: { outer: { a: 1, b: 2 } } }, opts);
    setActivityEmitter((spec: any) => seen.push(spec));

    addAccount("p", { id: "a1", email: "a@b.c", meta: { outer: { b: 2, a: 1 } } }, opts);

    expect(seen).toEqual([]);
  });

  it("reordering an array-valued field's elements emits one account_updated (array order is real content)", () => {
    const opts = { dir };
    const seen: any[] = [];
    addAccount("p", { id: "a1", email: "a@b.c", tags: ["x", "y"] }, opts);
    setActivityEmitter((spec: any) => seen.push(spec));

    addAccount("p", { id: "a1", email: "a@b.c", tags: ["y", "x"] }, opts);

    expect(seen.map((s) => s.action)).toEqual(["account_updated"]);
  });
});

// The store engine is Java (AccountStore) reached over the live-store bridge, and it must be
// byte-faithful to what a JS writer would have kept: the typed Account model is narrower than the
// file, so a narrowing read-modify-write would silently destroy a provider's own field.
describe("fidelity of the delegated store", () => {
  it("keeps a field outside the declared account shape across an update", () => {
    const opts = { dir };
    addAccount("fidelity-provider", { id: "a1", refresh: "r1" }, opts);
    updateAccounts("fidelity-provider", (pool: any) => {
      pool.accounts[0].vendorOnly = { nested: [1, 2] };
    }, opts);

    updateAccounts("fidelity-provider", (pool: any) => {
      pool.accounts[0].access = "tok";
    }, opts);

    const stored = loadAccounts("fidelity-provider", opts).accounts[0] as any;
    expect(stored.vendorOnly).toEqual({ nested: [1, 2] });
    expect(stored.access).toBe("tok");
  });

  it("reads an absent provider as an empty pool with its fields defaulted", () => {
    expect(loadAccounts("never-written", { dir })).toEqual({ accounts: [], activeIndex: 0, activeIndexByLane: {} });
  });

  it("keeps a lane cursor a caller saved", () => {
    const opts = { dir };
    saveAccounts("cursor-provider", { accounts: [{ id: "a1" }], activeIndex: 1, activeIndexByLane: { fast: 2 } }, opts);

    expect(loadAccounts("cursor-provider", opts)).toEqual({
      accounts: [{ id: "a1" }],
      activeIndex: 1,
      activeIndexByLane: { fast: 2 },
    });
  });

  it("leaves another provider's pool untouched when one is written", () => {
    const opts = { dir };
    addAccount("provider-a", { id: "a1", refresh: "ra" }, opts);
    addAccount("provider-b", { id: "b1", refresh: "rb" }, opts);

    removeAccount("provider-a", "a1", opts);

    expect(loadAccounts("provider-a", opts).accounts).toEqual([]);
    expect(loadAccounts("provider-b", opts).accounts.map((a: any) => a.id)).toEqual(["b1"]);
  });
});
