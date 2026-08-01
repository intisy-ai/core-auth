// Regression test for ensureAccess self-init: dedicated file (vitest isolates module state per
// test file) with NO beforeAll(initCoreAuth) and no preceding acquire() call, so this proves
// AccountManager.ensureAccess awaits initCoreAuth() itself rather than relying on a caller that
// already did. Before the fix, calling ensureAccess directly (as provider account-management code
// does for model discovery/quota refresh/verify/token refresh, off the acquire() path) threw
// "core-auth TeaVM not initialized" the first time it ran in a fresh process.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLiveStore } from "./live-store.js";
import { AccountManager } from "./manager.js";

const PROVIDER = "test-provider-ensure-access-selfinit";

describe("AccountManager.ensureAccess self-init", () => {
  let homeDir: string;

  afterEach(() => {
    if (homeDir) rmSync(homeDir, { recursive: true, force: true });
  });

  it("resolves for a valid unexpired token without a preceding acquire() or initCoreAuth() call", async () => {
    homeDir = mkdtempSync(join(tmpdir(), "core-auth-manager-selfinit-"));
    const store = createLiveStore(homeDir, homeDir);
    const account = { id: "a", enabled: true, access: "tok", expires: Date.now() + 60 * 60 * 1000 };
    store.put(
      "accounts.json",
      JSON.stringify({ version: 1, providers: { [PROVIDER]: { accounts: [account], activeIndex: 0, activeIndexByLane: {} } } }),
    );

    const mgr = new AccountManager(PROVIDER, { store: { dir: homeDir } });
    await expect(mgr.ensureAccess("a")).resolves.toBe("tok");
  });
});
