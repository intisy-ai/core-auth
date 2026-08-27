// The cross-process file lock every writer of a store file takes. Its own module so the account
// store and the live-store adapter can both take it without importing each other.

import { existsSync, mkdirSync, openSync, closeSync, unlinkSync, statSync } from "fs";
import { join } from "path";
import { configFolder } from "./env.js";

const DEFAULT_FILE = "accounts.json";
const LOCK_STALE_MS = 15 * 1000;
const LOCK_WAIT_MS = 5 * 1000;
const LOCK_POLL_MS = 25;

/** Where a locked store file lives, relative to the resolved config dir and its default filename. */
export interface StoreLockOpts {
  /** Overrides the resolved config directory. */
  dir?: string;
  /** Overrides the default store filename. */
  file?: string;
}

/** The resolved directory a locked store file lives in: `opts.dir` when given, else the app's config folder. */
export function storeDir(opts?: StoreLockOpts): string {
  return (opts && opts.dir) || configFolder();
}

function storeFile(opts?: StoreLockOpts): string {
  return join(storeDir(opts), (opts && opts.file) || DEFAULT_FILE);
}

function sleepSync(ms: number): void {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch {}
}

function errnoCode(error: unknown): string | undefined {
  return error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
}

/**
 * Thrown by `withLock` when the lock could not be acquired within its wait window.
 *
 * @remarks Callers must treat this as a hard failure (retry later / surface to the user); there is no unlocked fallback.
 */
export class LockTimeoutError extends Error {
  /** Path to the lock file that could not be acquired. */
  readonly lockPath: string;
  constructor(lockPath: string) {
    super("withLock: timed out waiting for lock: " + lockPath);
    this.name = "LockTimeoutError";
    this.lockPath = lockPath;
  }
}

function acquireLockSync(lockPath: string, deadline: number): number {
  for (;;) {
    try {
      return openSync(lockPath, "wx");
    } catch (error) {
      // Any error other than "lock file already exists" is unexpected (permissions,
      // disk full, ...) -- surface it immediately rather than pretending we're unlocked.
      if (errnoCode(error) !== "EEXIST") throw error;
      try {
        // Stale lock (holder crashed mid-write without cleaning up): reclaim it.
        if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) { unlinkSync(lockPath); continue; }
      } catch {}
      if (Date.now() > deadline) throw new LockTimeoutError(lockPath);
      sleepSync(LOCK_POLL_MS);
    }
  }
}

/**
 * Runs `fn()` under a cross-process exclusive lock, via an atomic lock file (`open(..., "wx")`
 * fails if it already exists).
 *
 * @remarks
 * FAIL-CLOSED: if the lock cannot be acquired before the deadline, or on any other unexpected fs
 * error, this THROWS and never runs `fn()` unlocked. Running unlocked would let two writers both
 * read-modify-write the store and have the second `renameSync` silently clobber the first (a lost
 * update: corrupted tokens or rate-limit state).
 *
 * NOT re-entrant: the lock file is the whole mechanism, so taking the same `{dir, file}` twice in
 * one call stack spins to the deadline and throws. A helper called from inside a held lock must
 * take an already-unlocked store rather than locking again.
 *
 * @throws {LockTimeoutError} if the lock could not be acquired in time
 */
export function withLock<T>(opts: StoreLockOpts | undefined, fn: () => T): T {
  const dir = storeDir(opts);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const lockPath = storeFile(opts) + ".lock";
  const handle = acquireLockSync(lockPath, Date.now() + LOCK_WAIT_MS);
  try {
    return fn();
  } finally {
    try { closeSync(handle); } catch {}
    try { unlinkSync(lockPath); } catch {}
  }
}
