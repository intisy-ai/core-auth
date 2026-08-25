// ensureAccess is reached directly, off the acquire() path, by provider account-management code
// (model discovery, quota refresh, verify, token refresh). Its own file because vitest isolates
// module state per test file, so this is the one place that proves the call needs no setup of any
// kind ahead of it.
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

  it("resolves for a valid unexpired token with no preceding acquire() call", async () => {
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
