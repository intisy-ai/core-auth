// Plain-JS worker helper for accounts.test.ts's cross-thread contention test. Acts as
// "another process" that already holds the store's lock file: opens it directly (the
// same atomic open(...,"wx") withLock uses) and holds it, synchronously blocking this
// thread for `holdMs` -- long enough to outlast LOCK_WAIT_MS -- before releasing.
// Reports back once locked, and again once released, so the test can deterministically
// sequence a contender against a lock it KNOWS is held.
import { parentPort, workerData } from "node:worker_threads";
import { openSync, closeSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const { dir, holdMs } = workerData;
const lockPath = join(dir, "accounts.json.lock");

const handle = openSync(lockPath, "wx");
parentPort.postMessage({ locked: true });

const sab = new Int32Array(new SharedArrayBuffer(4));
Atomics.wait(sab, 0, 0, holdMs);

closeSync(handle);
unlinkSync(lockPath);
parentPort.postMessage({ released: true });
