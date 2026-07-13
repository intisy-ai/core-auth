import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLiveStore } from "./live-store.js";
import { LockTimeoutError } from "./accounts.js";

let configDir: string;
beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "core-auth-live-store-"));
});
afterEach(() => {
  rmSync(configDir, { recursive: true, force: true });
});

describe("createLiveStore", () => {
  it("round-trips get/put/exists/delete under <configDir>/config/<key>", () => {
    const store = createLiveStore(configDir);

    expect(store.exists("accounts.json")).toBe(false);
    expect(store.get("accounts.json")).toBeNull();

    store.put("accounts.json", JSON.stringify({ hello: "world" }));
    expect(existsSync(join(configDir, "config", "accounts.json"))).toBe(true);
    expect(store.exists("accounts.json")).toBe(true);
    expect(store.get("accounts.json")).toBe(JSON.stringify({ hello: "world" }));

    store.put("accounts.json", JSON.stringify({ hello: "again" }));
    expect(store.get("accounts.json")).toBe(JSON.stringify({ hello: "again" }));

    store.delete("accounts.json");
    expect(store.exists("accounts.json")).toBe(false);
    expect(store.get("accounts.json")).toBeNull();
  });

  it("listKeys returns every stored key starting with prefix", () => {
    const store = createLiveStore(configDir);
    store.put("accounts.json", "{}");
    store.put("models.json", "{}");
    store.put("claude-code-loader.json", "{}");

    expect(store.listKeys("").sort()).toEqual(["accounts.json", "claude-code-loader.json", "models.json"]);
    expect(store.listKeys("acc")).toEqual(["accounts.json"]);
    expect(store.listKeys("nope")).toEqual([]);
  });

  it("listKeys excludes its own .lock and .tmp bookkeeping artifacts, even when they'd match the prefix", () => {
    const store = createLiveStore(configDir);
    store.put("accounts.json", "{}");

    // Simulate the artifacts `withLock`/`put` leave behind: a lock file left by a
    // holder, and an in-flight temp-write that hasn't been renamed into place yet.
    const configSub = join(configDir, "config");
    writeFileSync(join(configSub, "accounts.json.lock"), "");
    writeFileSync(join(configSub, "accounts.json.deadbeef1234.tmp"), "{}");

    // Reproduces the bug: listKeys('') used to return
    // ['accounts.json', 'accounts.json.lock', 'accounts.json.deadbeef1234.tmp'].
    expect(store.listKeys("")).toEqual(["accounts.json"]);
    // A prefix that only matches the artifacts must not surface them either.
    expect(store.listKeys("accounts.json.")).toEqual([]);
  });

  it("put/get/exists/delete each go through the cross-process lock: a held lock fails closed", () => {
    const store = createLiveStore(configDir);
    store.put("accounts.json", "v1");

    // Simulate another process holding this key's lock.
    const configSub = join(configDir, "config");
    mkdirSync(configSub, { recursive: true });
    const lockPath = join(configSub, "accounts.json.lock");
    writeFileSync(lockPath, "");

    try {
      expect(() => store.put("accounts.json", "v2")).toThrow(LockTimeoutError);
      // never wrote unlocked -- the file on disk is still the original value.
      expect(readFileSync(join(configSub, "accounts.json"), "utf8")).toBe("v1");
    } finally {
      rmSync(lockPath, { force: true });
    }
  }, 8000);

  it("a lock held on one key doesn't block an op on a different key", () => {
    const store = createLiveStore(configDir);
    store.put("accounts.json", "a1");

    const configSub = join(configDir, "config");
    mkdirSync(configSub, { recursive: true });
    writeFileSync(join(configSub, "accounts.json.lock"), "");

    try {
      // models.json has its own independent lock -- unaffected by accounts.json's.
      expect(() => store.put("models.json", "m1")).not.toThrow();
      expect(store.get("models.json")).toBe("m1");
    } finally {
      rmSync(join(configSub, "accounts.json.lock"), { force: true });
    }
  });
});
