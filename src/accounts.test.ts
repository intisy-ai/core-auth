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

  it("two concurrent updateAccounts on the same provider don't lose an update", async () => {
    await Promise.all([runWorker(dir, "worker-a"), runWorker(dir, "worker-b")]);
    const pool = loadAccounts("lock-test-provider", { dir });
    expect(pool.accounts.map((a: any) => a.id).sort()).toEqual(["worker-a", "worker-b"]);
  }, 20000);
});
