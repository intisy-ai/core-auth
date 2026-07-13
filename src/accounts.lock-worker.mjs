// Plain-JS worker helper for accounts.test.ts's cross-thread lock test. Runs on a real
// OS thread via node:worker_threads (NOT through vitest's transform, so it must be
// valid JS as-is and import the BUILT output, exercising the exact code that ships).
// `npm run build` must have produced dist/accounts.js before this runs.
import { parentPort, workerData } from "node:worker_threads";
import { updateAccounts } from "../dist/accounts.js";

const { dir, id } = workerData;
updateAccounts(
  "lock-test-provider",
  (pool) => { pool.accounts.push({ id, refresh: "r-" + id }); },
  { dir },
);
parentPort.postMessage({ done: true });
