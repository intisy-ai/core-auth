// @ts-nocheck
// Generic per-provider account store, keyed by provider id; writes use a cross-process lock + atomic temp-rename so plugin and CLI don't clobber each other.

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, openSync, closeSync, unlinkSync, statSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";
import { configFolder } from "./env.js";

const DEFAULT_FILE = "accounts.json";
const LOCK_STALE_MS = 15 * 1000;
const LOCK_WAIT_MS = 5 * 1000;
const LOCK_POLL_MS = 25;

function storeFile(opts) {
  return join((opts && opts.dir) || configFolder(), (opts && opts.file) || DEFAULT_FILE);
}

function ensureDir(opts) {
  const dir = (opts && opts.dir) || configFolder();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch {}
}

// Thrown by withLock when the lock couldn't be acquired within LOCK_WAIT_MS. Callers
// must treat this as a hard failure (retry later / surface to the user) -- there is no
// unlocked fallback.
export class LockTimeoutError extends Error {
  constructor(lockPath) {
    super("withLock: timed out waiting for lock: " + lockPath);
    this.name = "LockTimeoutError";
    this.lockPath = lockPath;
  }
}

function acquireLockSync(lockPath, deadline) {
  for (;;) {
    try {
      return openSync(lockPath, "wx");
    } catch (error) {
      // Any error other than "lock file already exists" is unexpected (permissions,
      // disk full, ...) -- surface it immediately rather than pretending we're unlocked.
      if (!error || error.code !== "EEXIST") throw error;
      try {
        // Stale lock (holder crashed mid-write without cleaning up): reclaim it.
        if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) { unlinkSync(lockPath); continue; }
      } catch {}
      if (Date.now() > deadline) throw new LockTimeoutError(lockPath);
      sleepSync(LOCK_POLL_MS);
    }
  }
}

// Cross-process exclusive lock via an atomic lock-file (open(...,"wx") fails if it
// already exists). FAIL-CLOSED: if the lock can't be acquired before the deadline (or
// on any other unexpected fs error), this THROWS -- it never runs `fn()` unlocked.
// Running unlocked would let two writers both read-modify-write the store and have the
// second `renameSync` silently clobber the first (a lost update: corrupted tokens /
// rate-limit state). The happy path (lock free) is unchanged from before.
export function withLock(opts, fn) {
  ensureDir(opts);
  const lockPath = storeFile(opts) + ".lock";
  const handle = acquireLockSync(lockPath, Date.now() + LOCK_WAIT_MS);
  try {
    return fn();
  } finally {
    try { closeSync(handle); } catch {}
    try { unlinkSync(lockPath); } catch {}
  }
}

function readStore(opts) {
  try {
    const file = storeFile(opts);
    if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) || {};
  } catch {}
  return { version: 1, providers: {} };
}

function writeStore(store, opts) {
  ensureDir(opts);
  const file = storeFile(opts);
  const tmp = file + "." + randomBytes(6).toString("hex") + ".tmp";
  writeFileSync(tmp, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, file);
}

function emptyPool() { return { accounts: [], activeIndex: 0, activeIndexByLane: {} }; }

function poolFrom(store, provider) {
  const p = store.providers && store.providers[provider];
  if (!p || !Array.isArray(p.accounts)) return emptyPool();
  return { accounts: p.accounts, activeIndex: p.activeIndex || 0, activeIndexByLane: p.activeIndexByLane || {} };
}

export function loadAccounts(provider, opts) {
  return poolFrom(readStore(opts), provider);
}

export function saveAccounts(provider, pool, opts) {
  withLock(opts, () => {
    const store = readStore(opts);
    store.version = 1;
    store.providers = store.providers || {};
    store.providers[provider] = {
      accounts: pool.accounts || [],
      activeIndex: pool.activeIndex || 0,
      activeIndexByLane: pool.activeIndexByLane || {},
    };
    writeStore(store, opts);
  });
}

// atomic read-modify-write: mutator mutates the freshly-read pool in place.
export function updateAccounts(provider, mutator, opts) {
  const pool = withLock(opts, () => {
    const store = readStore(opts);
    store.version = 1;
    store.providers = store.providers || {};
    const current = poolFrom(store, provider);
    mutator(current);
    store.providers[provider] = {
      accounts: current.accounts || [],
      activeIndex: current.activeIndex || 0,
      activeIndexByLane: current.activeIndexByLane || {},
    };
    writeStore(store, opts);
    return current;
  });
  return pool;
}

export function listAccounts(provider, opts) { return loadAccounts(provider, opts).accounts; }

export function addAccount(provider, account, opts) {
  updateAccounts(provider, (pool) => {
    const i = pool.accounts.findIndex((a) => (account.id && a.id === account.id) || (account.refresh && a.refresh === account.refresh));
    if (i >= 0) pool.accounts[i] = { ...pool.accounts[i], ...account };
    else pool.accounts.push(account);
  }, opts);
}

export function removeAccount(provider, id, opts) {
  updateAccounts(provider, (pool) => { pool.accounts = pool.accounts.filter((a) => a.id !== id); }, opts);
}

export function clearAccounts(provider, opts) { saveAccounts(provider, emptyPool(), opts); }
