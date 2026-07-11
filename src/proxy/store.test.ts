// src/proxy/store.test.ts
import { describe, it, expect } from "vitest";
import { migrateStore } from "./store.js";

describe("migrateStore v1 -> v2", () => {
  it("maps owner to account scope and untagged to global", () => {
    const v1 = {
      version: 1, mode: "automatic", providers: {},
      proxies: [
        { url: "http://a", provider: "manual", owner: "acc1", addedAt: 1, stats: {} },
        { url: "http://b", provider: "proxyscrape", addedAt: 2, stats: {} },
      ],
      assignments: { acc1: "http://a" },
      manualSelection: { acc1: ["http://a"] },
    };
    const v2 = migrateStore(v1);
    expect(v2.version).toBe(2);
    expect(v2.modes.default).toBe("automatic");
    expect(v2.proxies[0].scope).toEqual({ type: "account", id: "acc1" });
    expect(v2.proxies[1].scope).toEqual({ type: "global" });
    expect(v2.manualSelection["account:acc1"]).toEqual(["http://a"]);
    expect(v2.manualSelection.acc1).toBeUndefined();
  });

  it("is idempotent on an already-v2 store", () => {
    const v2 = { version: 2, modes: { default: "disabled" }, providers: {}, proxies: [], assignments: {}, manualSelection: {} };
    expect(migrateStore(structuredClone(v2))).toEqual(v2);
  });
});
