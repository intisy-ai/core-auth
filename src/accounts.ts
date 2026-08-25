// @ts-nocheck
// Generic per-provider account store, keyed by provider id. The store ENGINE is Java
// (AccountStore, java/accounts) reached through CoreAuthJs; what lives here is the transport it
// runs over: the cross-process lock, and the activity events a host sees.

import { getCoreAuth } from "./core-auth-loader.js";
import { createLiveStore } from "./live-store.js";
import { withLock } from "./store-lock.js";
import { getConfigDir } from "./env.js";
import { emitActivity } from "./activity.js";

export { LockTimeoutError, withLock } from "./store-lock.js";

const STORE_KEY = "accounts.json";

function lockOpts(opts) {
  return { dir: opts && opts.dir, file: STORE_KEY };
}

// Reads take no lock (a torn read is impossible: every write lands by atomic rename).
function readingStore(opts) {
  return createLiveStore(getConfigDir(), opts && opts.dir);
}

// Writes hold the lock out here, across the whole Java call, so the store's read-modify-write is
// atomic against another PROCESS too -- which the store bridge's own per-op locking cannot give,
// since it locks the read and the write separately.
function writing(opts, fn) {
  return withLock(lockOpts(opts), () => fn(createLiveStore(getConfigDir(), opts && opts.dir, { locked: false })));
}

export function loadAccounts(provider, opts) {
  return JSON.parse(getCoreAuth().poolLoad(provider, readingStore(opts)));
}

export function saveAccounts(provider, pool, opts) {
  writing(opts, (store) => getCoreAuth().poolSave(provider, JSON.stringify(pool), store));
}

// atomic read-modify-write: mutator mutates the freshly-read pool in place.
export function updateAccounts(provider, mutator, opts) {
  return writing(opts, (store) => {
    const pool = JSON.parse(getCoreAuth().poolLoad(provider, store));
    mutator(pool);
    getCoreAuth().poolSave(provider, JSON.stringify(pool), store);
    return pool;
  });
}

export function listAccounts(provider, opts) { return loadAccounts(provider, opts).accounts; }

export function addAccount(provider, account, opts) {
  // "unchanged" is a login refresh re-upserting the same account, which happens on every call:
  // reporting it would bury the real changes in the activity feed.
  const outcome = writing(opts, (store) =>
    getCoreAuth().accountUpsert(provider, JSON.stringify(account), store),
  );
  if (outcome === "unchanged") return;
  const subjectId = account.email || account.id;
  emitActivity({ topic: "account", action: outcome === "added" ? "account_added" : "account_updated", impact: "notice", outcome: "ok", subject: { kind: "account", id: subjectId, label: subjectId }, details: { provider } }, provider);
}

export function removeAccount(provider, id, opts) {
  const removed = writing(opts, (store) => getCoreAuth().accountRemove(provider, id, store));
  if (!removed) return;
  emitActivity({ topic: "account", action: "account_removed", impact: "notice", outcome: "ok", subject: { kind: "account", id, label: id }, details: { provider } }, provider);
}

export function clearAccounts(provider, opts) {
  saveAccounts(provider, { accounts: [], activeIndex: 0, activeIndexByLane: {} }, opts);
}
