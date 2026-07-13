// Regression tests for the withLock fail-closed fix (see accounts.ts). The bug: when
// the lock couldn't be acquired, withLock used to `break` out of its wait loop with
// handle===null and then run `fn()` ANYWAY -- unlocked. Two writers racing that path
// would both read-modify-write accounts.json and the second `renameSync` would
// silently clobber the first (a lost update). The fix makes withLock fail-closed:
// it throws (LockTimeoutError) instead of ever running fn() without the lock held.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, existsSync, statSync, readFileSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { loadAccounts, saveAccounts, updateAccounts, LockTimeoutError } from "./accounts.js";

const pkgRoot = fileURLToPath(new URL("..", import.meta.url));
const distAccounts = join(pkgRoot, "dist", "accounts.js");
const srcAccounts = join(pkgRoot, "src", "accounts.ts");
const workerUrl = new URL("./accounts.lock-worker.mjs", import.meta.url);
const holdWorkerUrl = new URL("./accounts.lock-hold-worker.mjs", import.meta.url);
const contendWorkerUrl = new URL("./accounts.lock-contend-worker.mjs", import.meta.url);

// LOCK_WAIT_MS in accounts.ts -- kept in sync manually since it isn't exported. The
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
  // waits anywhere near LOCK_WAIT_MS. This does NOT exercise the degrade-to-unlocked
  // bug (it would pass on the old buggy code too) -- see the held-lock test below for
  // the genuine regression guard on the timeout->fail-closed path.
  it("two fast concurrent updateAccounts on the same provider both land (no timeout involved)", async () => {
    await Promise.all([runWorker(dir, "worker-a"), runWorker(dir, "worker-b")]);
    const pool = loadAccounts("lock-test-provider", { dir });
    expect(pool.accounts.map((a: any) => a.id).sort()).toEqual(["worker-a", "worker-b"]);
  }, 20000);

  // The genuine regression guard: one real OS thread holds the store's lock file past
  // LOCK_WAIT_MS while a second thread concurrently attempts updateAccounts on the SAME
  // store. On the OLD buggy withLock, the second thread's wait loop would `break` at the
  // deadline and run fn() anyway -- unlocked -- succeeding and silently writing
  // "contender" alongside "seed". The fix must make it fail closed: throw
  // LockTimeoutError and leave the on-disk store untouched.
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
