// @ts-nocheck
// Generic per-provider account store, keyed by provider id; writes use a cross-process lock + atomic temp-rename so plugin and CLI don't clobber each other.

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, openSync, closeSync, unlinkSync, statSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";
import { configFolder } from "./env.js";
import { emitActivity } from "./activity.js";

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

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort()) sorted[key] = sortKeysDeep(value[key]);
    return sorted;
  }
  return value;
}

// Sorts object keys at every depth before serializing so two accounts with the same
// content but differently-ordered nested object fields compare equal; array order is
// real content and is left alone. Returns null on any serialization failure (cycle,
// non-serializable value) so the caller treats that as a real change rather than
// silently treating it as identical.
function stableSerialize(value) {
  try {
    return JSON.stringify(sortKeysDeep(value));
  } catch {
    return null;
  }
}

export function addAccount(provider, account, opts) {
  let action = "account_added";
  updateAccounts(provider, (pool) => {
    const i = pool.accounts.findIndex((a) => (account.id && a.id === account.id) || (account.refresh && a.refresh === account.refresh));
    if (i < 0) { pool.accounts.push(account); return; }
    const before = stableSerialize(pool.accounts[i]);
    pool.accounts[i] = { ...pool.accounts[i], ...account };
    const after = stableSerialize(pool.accounts[i]);
    // A login refresh re-upserts the same account on every call; reporting an identical
    // upsert as a change would bury the real ones in the activity feed.
    action = before !== null && after !== null && after === before ? "" : "account_updated";
  }, opts);
  if (!action) return;
  const subjectId = account.email || account.id;
  emitActivity({ topic: "account", action, impact: "notice", outcome: "ok", subject: { kind: "account", id: subjectId, label: subjectId }, details: { provider } }, provider);
}

export function removeAccount(provider, id, opts) {
  let removed = false;
  updateAccounts(provider, (pool) => {
    const before = pool.accounts.length;
    pool.accounts = pool.accounts.filter((a) => a.id !== id);
    removed = pool.accounts.length !== before;
  }, opts);
  if (!removed) return;
  emitActivity({ topic: "account", action: "account_removed", impact: "notice", outcome: "ok", subject: { kind: "account", id, label: id }, details: { provider } }, provider);
}

export function clearAccounts(provider, opts) { saveAccounts(provider, emptyPool(), opts); }
