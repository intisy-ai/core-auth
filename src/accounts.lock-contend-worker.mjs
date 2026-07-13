// Plain-JS worker helper for accounts.test.ts's cross-thread contention test. Attempts
// a real `updateAccounts` against a store whose lock the test's other worker is
// currently holding. Runs against the BUILT dist/accounts.js (worker_threads can't run
// vitest's on-the-fly TS transform), exercising the exact fail-closed code that ships.
// Reports the outcome back rather than letting an uncaught throw hit the 'error' event,
// so the test can assert on the error's name/message without relying on how Node
// clones a custom Error subclass across the thread boundary.
import { parentPort, workerData } from "node:worker_threads";
import { updateAccounts } from "../dist/accounts.js";

const { dir } = workerData;
try {
  updateAccounts(
    "lock-test-provider",
    (pool) => { pool.accounts.push({ id: "contender" }); },
    { dir },
  );
  parentPort.postMessage({ ok: true });
} catch (err) {
  parentPort.postMessage({ ok: false, name: err && err.name, message: err && err.message });
}
