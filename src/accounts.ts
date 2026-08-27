// Generic per-provider account store, keyed by provider id. The store ENGINE is Java
// (AccountStore, java/accounts) reached through CoreAuthJs; what lives here is the transport it
// runs over: the cross-process lock, and the activity events a host sees.

import { getCoreAuth } from "./core-auth-loader.js";
import { createLiveStore, type LiveStoreLike } from "./live-store.js";
import { withLock, type StoreLockOpts } from "./store-lock.js";
import { getConfigDir } from "./env.js";
import { emitActivity } from "./activity.js";
import type { AccountPool, CoreAccount } from "./types.js";
import type { CoreAuthJsStore } from "./generated/core-auth.teavm.js";

export { LockTimeoutError, withLock } from "./store-lock.js";

const STORE_KEY = "accounts.json";

/**
 * Where a provider's account pool is stored, when it is not the default location.
 *
 * @remarks
 * Re-exports store-lock.ts's `StoreLockOpts` under the public name this store's callers use.
 * `file` is real, not speculative: `withLock`'s other caller (live-store.ts) sets it per-key for
 * per-key locking. accounts.ts's own writers never forward a caller's `file`, though -- `lockOpts`
 * below always pins it to `STORE_KEY`, since this store keeps exactly one file per provider.
 */
export type AccountStoreLocation = StoreLockOpts;

function lockOpts(opts: AccountStoreLocation | null | undefined): StoreLockOpts {
  return { dir: opts?.dir, file: STORE_KEY };
}

// LiveStoreLike.get() may report an absent key as undefined as well as null (it also serves the
// npm core's own LiveStoreLike contract); CoreAuthJsStore only knows null, so normalize at the
// crossing rather than widening the Java-facing type.
function asJsStore(store: LiveStoreLike): CoreAuthJsStore {
  return {
    get: (key) => store.get(key) ?? null,
    put: (key, value) => store.put(key, value),
    exists: (key) => store.exists(key),
    delete: (key) => store.delete(key),
    listKeys: (prefix) => store.listKeys(prefix),
  };
}

// Reads take no lock (a torn read is impossible: every write lands by atomic rename).
function readingStore(opts: AccountStoreLocation | null | undefined): CoreAuthJsStore {
  return asJsStore(createLiveStore(getConfigDir(), opts?.dir));
}

// Writes hold the lock out here, across the whole Java call, so the store's read-modify-write is
// atomic against another PROCESS too -- which the store bridge's own per-op locking cannot give,
// since it locks the read and the write separately.
function writing<T>(opts: AccountStoreLocation | null | undefined, fn: (store: CoreAuthJsStore) => T): T {
  return withLock(lockOpts(opts), () => fn(asJsStore(createLiveStore(getConfigDir(), opts?.dir, { locked: false }))));
}

export function loadAccounts(provider: string, opts?: AccountStoreLocation): AccountPool {
  return JSON.parse(getCoreAuth().poolLoad(provider, readingStore(opts)));
}

export function saveAccounts(provider: string, pool: AccountPool, opts?: AccountStoreLocation): void {
  writing(opts, (store) => getCoreAuth().poolSave(provider, JSON.stringify(pool), store));
}

// atomic read-modify-write: mutator mutates the freshly-read pool in place.
export function updateAccounts(provider: string, mutator: (pool: AccountPool) => void, opts?: AccountStoreLocation): AccountPool {
  return writing(opts, (store) => {
    const pool: AccountPool = JSON.parse(getCoreAuth().poolLoad(provider, store));
    mutator(pool);
    getCoreAuth().poolSave(provider, JSON.stringify(pool), store);
    return pool;
  });
}

export function listAccounts(provider: string, opts?: AccountStoreLocation): CoreAccount[] { return loadAccounts(provider, opts).accounts; }

export function addAccount(provider: string, account: CoreAccount, opts?: AccountStoreLocation): void {
  // "unchanged" is a login refresh re-upserting the same account, which happens on every call:
  // reporting it would bury the real changes in the activity feed.
  const outcome = writing(opts, (store) =>
    getCoreAuth().accountUpsert(provider, JSON.stringify(account), store),
  );
  if (outcome === "unchanged") return;
  const subjectId = account.email || account.id;
  emitActivity({ topic: "account", action: outcome === "added" ? "account_added" : "account_updated", impact: "notice", outcome: "ok", subject: { kind: "account", id: subjectId, label: subjectId }, details: { provider } }, provider);
}

export function removeAccount(provider: string, id: string, opts?: AccountStoreLocation): void {
  const removed = writing(opts, (store) => getCoreAuth().accountRemove(provider, id, store));
  if (!removed) return;
  emitActivity({ topic: "account", action: "account_removed", impact: "notice", outcome: "ok", subject: { kind: "account", id, label: id }, details: { provider } }, provider);
}

export function clearAccounts(provider: string, opts?: AccountStoreLocation): void {
  saveAccounts(provider, { accounts: [], activeIndex: 0, activeIndexByLane: {} }, opts);
}
