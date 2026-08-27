// Accessor for the TeaVM-generated ESM staged into src/generated/ by `npm run build:teavm`.
//
// Statically imported, so getCoreAuth() cannot fail and no caller has to sequence an init first:
// the account store itself runs in Java, and its reads (listAccounts and friends) are synchronous
// entry points reached from hosts that never had an init step to add. The cost is one 426 KB parse
// per process, measured at 15.5 ms.
import * as coreAuth from "./generated/core-auth.teavm.js";

/** The TeaVM-generated Java account-store engine, statically imported so this never fails and callers need no init step. */
export function getCoreAuth(): typeof coreAuth {
  return coreAuth;
}

/**
 * Kept as a resolved no-op: callers across the ecosystem await this at startup, and there is
 * nothing left to wait for now that the module loads with its importer.
 */
export async function initCoreAuth(): Promise<void> {}
