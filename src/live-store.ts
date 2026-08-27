// LiveStoreLike adapter: presents the npm `@intisy-ai/ai-core` package's synchronous
// Store interface (see js/npm/index.d.ts's `LiveStoreLike`: get/put/exists/delete/
// listKeys) over core-auth's own file-backed config store, so the npm core's
// fine-grained ops (acquireAccount, report*, resolveModelMap, ...) can run against the
// SAME on-disk files core-auth already reads/writes -- `accounts.json`, `models.json`,
// a routing profile's `configFile`, etc. -- without losing the existing cross-process
// file lock. Every op is routed through the fixed (fail-closed) `withLock`, keyed
// per-file so unrelated keys never contend with each other.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";
import { withLock } from "./store-lock.js";
import { CONFIG_SUBDIR } from "./env.js";

/**
 * A synchronous key/value store, matching the npm core's `LiveStoreLike` (`js/npm/index.d.ts`)
 * exactly so a {@link createLiveStore} instance is a drop-in `opts.store` for its fine-grained
 * exports (`acquireAccount`, `reportRateLimit`, `reportError`, `reportSuccess`,
 * `nextAvailableAt`, `resolveTiers`, `resolveModelMap`).
 */
export interface LiveStoreLike {
  /** Returns the stored JSON string for `key`, or `null`/`undefined` when absent. */
  get(key: string): string | null | undefined;
  /** Overwrites `key`'s stored value. */
  put(key: string, value: string): void;
  /** Whether `key` is stored. */
  exists(key: string): boolean;
  /** Removes `key`; a no-op if it was not stored. */
  delete(key: string): void;
  /** Every stored key starting with `prefix`. */
  listKeys(prefix: string): string[];
}

/** Options to {@link createLiveStore}. */
export interface LiveStoreOpts {
  /**
   * Set false when the CALLER already holds the lock for the keys this store will touch, which is
   * what a read-modify-write spanning several ops needs: the lock is not re-entrant, so an inner
   * lock would spin to its deadline and throw.
   */
  locked?: boolean;
}

/**
 * Adapts core-auth's own file-backed config store into a {@link LiveStoreLike}, so the npm core's
 * fine-grained ops can run against the SAME on-disk files core-auth already reads and writes
 * (`accounts.json`, `models.json`, a routing profile's `configFile`, etc.) without losing the
 * existing cross-process file lock.
 *
 * @param configDir the app home (e.g. `~/.claude`), matching `getConfigDir()`'s convention: every key lives at `<configDir>/config/<key>`, the same location core-auth's own default store (`accounts.ts`) already uses
 * @param dirOverride when given, replaces `<configDir>/config` outright, matching `accounts.ts`'s `opts.dir` store-location override (AccountManager's `options.store.dir`)
 */
export function createLiveStore(configDir: string, dirOverride?: string, opts?: LiveStoreOpts): LiveStoreLike {
  const dir = dirOverride || join(configDir, CONFIG_SUBDIR);
  const filePath = (key: string): string => join(dir, key);
  // `withLock`'s lock file is derived from {dir, file}, so each key gets its own
  // independent lock -- concurrent ops on different keys never contend.
  const locking = opts?.locked !== false;
  const withLockFor = <T>(key: string, fn: () => T): T => (locking ? withLock({ dir, file: key }, fn) : fn());

  return {
    get(key: string): string | null {
      return withLockFor(key, () => {
        try {
          const file = filePath(key);
          return existsSync(file) ? readFileSync(file, "utf8") : null;
        } catch {
          return null;
        }
      });
    },
    put(key: string, value: string): void {
      withLockFor(key, () => {
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        const target = filePath(key);
        // atomic write: a reader can only ever observe a fully-written file.
        const tmp = target + "." + randomBytes(6).toString("hex") + ".tmp";
        writeFileSync(tmp, value, { encoding: "utf8", mode: 0o600 });
        renameSync(tmp, target);
      });
    },
    exists(key: string): boolean {
      return withLockFor(key, () => existsSync(filePath(key)));
    },
    delete(key: string): void {
      withLockFor(key, () => {
        try { unlinkSync(filePath(key)); } catch {}
      });
    },
    // A directory listing, not a single file's contents -- no per-key lock applies.
    // `put`'s rename is atomic, so a listing can only ever observe fully-written files.
    // Excludes the adapter's own lock (`<key>.lock`) and in-flight temp-write
    // (`<key>.<hex>.tmp`, see `put` above) artifacts -- those are bookkeeping, not
    // stored keys, and must never surface to a consumer's `get()`. Matches the JVM
    // `FileStore.listKeys`, which excludes `.lock`/`.tmp` the same way.
    listKeys(prefix: string): string[] {
      try {
        if (!existsSync(dir)) return [];
        return readdirSync(dir).filter(
          (f) => f.startsWith(prefix) && !f.endsWith(".lock") && !f.endsWith(".tmp"),
        );
      } catch {
        return [];
      }
    },
  };
}
