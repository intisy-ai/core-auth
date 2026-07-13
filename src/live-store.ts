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
import { withLock } from "./accounts.js";

// Matches the npm core's `LiveStoreLike` (js/npm/index.d.ts) exactly so a
// `createLiveStore(configDir)` instance is a drop-in `opts.store` for its fine-grained
// exports (acquireAccount, reportRateLimit, reportError, reportSuccess,
// nextAvailableAt, resolveTiers, resolveModelMap).
export interface LiveStoreLike {
  /** Returns the stored JSON string for `key`, or `null`/`undefined` when absent. */
  get(key: string): string | null | undefined;
  put(key: string, value: string): void;
  exists(key: string): boolean;
  delete(key: string): void;
  /** Every stored key starting with `prefix`. */
  listKeys(prefix: string): string[];
}

// `configDir` is the app home (e.g. ~/.claude), matching core-auth's own
// `getConfigDir()` convention: every key lives at `<configDir>/config/<key>`
// (accounts.json, models.json, a routing profile's configFile, ...) -- the same
// location core-auth's own default store (accounts.ts) already uses.
export function createLiveStore(configDir: string): LiveStoreLike {
  const dir = join(configDir, "config");
  const filePath = (key: string): string => join(dir, key);
  // `withLock`'s lock file is derived from {dir, file}, so each key gets its own
  // independent lock -- concurrent ops on different keys never contend.
  const lockOpts = (key: string) => ({ dir, file: key });

  return {
    get(key: string): string | null {
      return withLock(lockOpts(key), () => {
        try {
          const file = filePath(key);
          return existsSync(file) ? readFileSync(file, "utf8") : null;
        } catch {
          return null;
        }
      });
    },
    put(key: string, value: string): void {
      withLock(lockOpts(key), () => {
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        const target = filePath(key);
        // atomic write: same temp-then-rename pattern as core-auth's own writeStore.
        const tmp = target + "." + randomBytes(6).toString("hex") + ".tmp";
        writeFileSync(tmp, value, { encoding: "utf8", mode: 0o600 });
        renameSync(tmp, target);
      });
    },
    exists(key: string): boolean {
      return withLock(lockOpts(key), () => existsSync(filePath(key)));
    },
    delete(key: string): void {
      withLock(lockOpts(key), () => {
        try { unlinkSync(filePath(key)); } catch {}
      });
    },
    // A directory listing, not a single file's contents -- no per-key lock applies.
    // `put`'s rename is atomic, so a listing can only ever observe fully-written files.
    listKeys(prefix: string): string[] {
      try {
        if (!existsSync(dir)) return [];
        return readdirSync(dir).filter((f) => f.startsWith(prefix));
      } catch {
        return [];
      }
    },
  };
}
