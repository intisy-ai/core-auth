// src/proxy/manager.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "proxytest-"));
  vi.stubEnv("HUB_CONFIG_DIR", dir);
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });

async function fresh() {
  vi.resetModules();
  return (await import("./manager.js")).proxyManager;
}

describe("ProxyManager sticky at cap", () => {
  it("re-selects a held slot on a cap-full proxy instead of evicting to direct", async () => {
    const pm = await fresh();
    pm.setMode("default", "automatic");
    pm.addManual("http://only", { type: "global" });   // single proxy, cap = 3
    // three accounts fill the proxy to its cap
    expect(pm.selectForAccount("a1", "p")).toBe("http://only");
    expect(pm.selectForAccount("a2", "p")).toBe("http://only");
    expect(pm.selectForAccount("a3", "p")).toBe("http://only");
    // a1 re-selecting must keep its slot — NOT fall through to direct (null)
    expect(pm.selectForAccount("a1", "p")).toBe("http://only");
    // a NEW 4th account is correctly capped out -> direct
    expect(pm.selectForAccount("a4", "p")).toBe(null);
  });
});

describe("ProxyManager scoped selection", () => {
  it("prefers account scope, falls through to global when account all IP-limited", async () => {
    const pm = await fresh();
    pm.setMode("default", "automatic");
    pm.addManual("http://acc", { type: "account", id: "a1" });
    pm.addManual("http://glob", { type: "global" });
    // first pick = account proxy
    expect(pm.selectForAccount("a1", "prov")).toBe("http://acc");
    // account proxy IP-limited -> next pick falls through to global
    pm.reportRateLimit("http://acc", { ipSuspected: true });
    expect(pm.selectForAccount("a1", "prov")).toBe("http://glob");
  });

  it("reportRateLimit does NOT penalize when ipSuspected is false", async () => {
    const pm = await fresh();
    pm.addManual("http://x", { type: "global" });
    pm.reportRateLimit("http://x", { ipSuspected: false });
    const p = pm.get("http://x");
    expect(p.stats.ipRateLimitHits || 0).toBe(0);
  });

  it("per-scope mode overrides default", async () => {
    const pm = await fresh();
    pm.setMode("default", "automatic");
    pm.setMode("provider:prov", "disabled");
    pm.addManual("http://provp", { type: "provider", id: "prov" });
    pm.addManual("http://glob", { type: "global" });
    // provider scope disabled -> skipped -> global chosen
    expect(pm.selectForAccount("a1", "prov")).toBe("http://glob");
  });
});
